# Step Procedures Reference

## Step 0 — Verify on latest `origin/main`

```bash
git fetch origin --quiet
git rev-list HEAD..origin/main --count
```

- **Output 0:** you're on latest main. Proceed to Step 1.
- **Output non-zero:** upstream moved since pre-dispatch fetch. Catch up:
  ```bash
  git rebase origin/main
  ```
  Clean rebase → at HEAD = origin/main. Proceed.

  **Rebase conflict:** worktree carried in-flight work the worker's `validate()` didn't flag. Add comment titled `## Operator action required` describing conflicting paths + pre-recovery dispatch, then follow Step 10 (Blocked).

This step is read-only — if `git status` shows uncommitted changes BEFORE you do anything, worker mis-routed (should have caught dirty state). Same comment + Blocked.

## Step 1 — Read the Issue and Set Effort Level

Query the v2 DB via `mcp__danx_dashboard__issue_get({issue_id})` to fetch the card. The worker auto-flipped the card to derived `In Progress` BEFORE spawning (DX-584: `dispatch != null` set before `spawnAgent`; rule 4 projects to `In Progress`). You do NOT write `status:` on pickup — the field is derived.

**Your first edit is `effort_level` if unset (DX-512).** Read `.claude/rules/danx-effort-policy.md` — the workspace's auto-rendered policy carries operator-tunable assignment prompt + 7-rung level ladder. If YAML's `effort_level` is `null`, pick the lowest level plausible per policy (default `medium`; bump DOWN for mechanical/single-file/doc; bump UP for deep reasoning/multi-file/subtle concurrency). Set `effort_level: "<level>"`. If already set, leave alone — triage owns it on Review cards; pickup only fills unset.

**Resume detection:** if `deriveStatus(yaml)` returns `In Progress` (i.e. `dispatch != null` AND no terminal trigger) AND prior session state exists (checked ACs, comments from earlier, `retro.commits[]`), treat as resumption → proceed to Step 1.1. Raw `status:` field is advisory; trust derived value.

Missing/unparseable YAML → signal `critical_failure` per `danx-halt-flag.md` — poller is broken.

## Step 1.1 — Validate, Never Trust Prior State

A card's YAML may carry stale claims from prior dead dispatches. **NEVER skip work because prior agent claimed done.** Always verify actual code state.

**Mechanical procedure (every dispatch, no exceptions):**

1. **Read the YAML.**
2. **For each `ac[i]` where `checked: true`:** verify against real evidence:
   - Read files the AC names. Confirm asserted code/behavior present.
   - Run test the AC requires. Confirm passes.
   - If `retro.commits[]` references change, find matching sha in `git log origin/main` (or agent branch). Confirm sha exists AND its diff lands the AC's claim.
   - **Any mismatch** (file missing, test fails, commit not in log, diff doesn't deliver) → flip `ac[i].checked: false`, save, treat as work to do.
3. **For each sha in `retro.commits[]`:** run `git cat-file -t <sha>` in THIS repo. Output not `commit` (or `git log origin/main` doesn't show it) → sha is:
   - **Stale** (rebased away / typo / never pushed) → drop from `retro.commits[]`, save.
   - **Cross-repo** (`git cat-file -t <sha>` resolves in `~/web/claude-plugins/` or sibling repo but not THIS repo) → drop from `retro.commits[]` AND append `comments[]` entry titled `## External repo work` naming repo + sha + what shipped. Save.

   If card is Blocked with reason starting `DX-559 enforcement:`, this self-heal unblocks it: walk each missing sha, route to stale-drop or cross-repo-comment, save, then clear `blocked: null` + stamp `ready_at: <now>` and call `danxbot_complete({status: "complete", summary: "Reconciled retro.commits[] after DX-559 block — <one-line summary>"})`.

4. **If `status: "Done"` or `"Cancelled"`** AND every AC verifies AND every commit verifies AND `retro.good` + `retro.bad` non-empty: prior session finished. Call `danxbot_complete({status: "complete", summary: "Verified prior dispatch's terminal state on resume — no work to redo."})` and stop. **Do not redo work.**
5. **Otherwise:** card is yours — resume from first failing AC.

## Step 1.5 — You Fix What You Find

Action items + follow-ups are a **LAST RESORT**, not workflow convenience. Default for ANY defect, stale config, broken test, cleanup during dispatch — in-scope or not — is fix in this session.

Apply filter, in order:

1. **Required for THIS card's ACs?** → Mandatory. Fix in this dispatch. Filing hotfix/follow-up for AC-required work is **rule violation.**
2. **Unrelated but small** (few file edits, no big refactor, fits session)? → Fix in dispatch. Action items create debt + re-dispatch cost.
3. **Unrelated AND large** (multi-phase refactor, cross-cutting redesign, needs own scoping, would derail THIS card)? → Action item OK.
4. **Needs human decision or external access** (credentials, ambiguous spec, repo you can't write, secret rotation)? → Step 10 / action item. **NOT valid blocker:** "needs deploy", "needs prod smoke", "needs production verification", "manual UI smoke", "pre-existing flaky test in unrelated file", "post-terminal-save state I cannot observe". Card is **Done when code committed + tests pass locally** — deploys are operational, not verification gate.

**Mechanical check:** before writing action item or Blocked move: **"Could I just do this in next 10–30 minutes?"** Yes → do it. Drop action item / cancel Blocked.

**Examples of work MUST be done in-session:**
- Verification card whose verification fails on small in-scope bug → fix bug, re-verify. NOT hotfix card + Blocked.
- Stale config in editable file (placeholder list, env var, alias).
- Broken test pointing at function defect you can read + edit.
- Missing file you can write.
- Doc / comment contradicting behavior that confused you.

Only after exhausting in-session fixes reach for action items or Blocked.

## Step 2 — Plan

1. Read full `description`, all `comments[]`, all `ac[]` titles, existing `children[]` (look up each child YAML to see what's built).
2. **Bug cards (`type: Bug`):** investigate root cause via `Read` / `Grep` / `Bash` before designing fix.
3. **Blocked vs Waiting On vs fix-it-yourself:** if card cannot be done by agent, route correctly. Step 10 (Blocked) ONLY for true human-action blockers (credentials, secret rotation, ambiguous spec, architectural ambiguity). **"Needs deploy" / "needs prod smoke" / "needs Layer 3 system test" are NOT valid blockers** — Layer 3 tests run locally (`make test-system`); deploys ship code already accepted as Done. Step 10b (Waiting On) for waiting on other in-flight work — no human required. Anything else → apply Step 1.5, fix yourself.
4. Design approach in head. No code yet.
5. Invoke `/pipe-start` skill to reload pre-implementation rules.

## Step 3.0 — Pre-flight: Is this card already an epic with linked children?

Check card's existing state. ANY condition = epic already split — DO NOT re-split, DO NOT call `danx_issue_create`:

1. **Card's `children: []` is non-empty.** Epic fully linked. Read each child YAML, identify first with `status: ToDo` (or `In Progress` if resuming), treat THAT phase as work. Re-read phase YAML, restart workflow at Step 1 using phase card.
2. **Card's `type: Epic` AND `children: []` empty.** Epic created without `danx_issue_create` (or by human on tracker) — phase cards may exist in `open/` but lack `parent_id` linkage. **Invoke `danx-epic-link` skill via Skill tool.** It scans open issues, identifies epic's phase children, sets `parent_id` on each phase, sets `children[]` on epic. After return, re-read epic YAML — `children[]` now populated — jump back to Step 3.0 (first condition now matches).
3. **Card's `type` is NOT Epic but other YAMLs reference it as parent.** Run `Grep` for `parent_id: "<this.id>"` across `open/`. Any matches = card is actually epic that lost `Epic` label. Promote: set `type: Epic`, populate `children[]` from matched YAMLs (sorted like `danx-epic-link`), save. Jump back to Step 3.0.

Only if NONE match proceed to Step 3.1.

## Step 3.1 — Decide Whether to Split

Split into epic when card is 3+ implementation phases, spans different domains, or exceeds ~500 LOC. Keep as single card when work is sequential but small — track via `ac[]` only. No in-card phase checklist; phases MUST be cards.

If NOT splitting, skip to Step 4.

## Step 3.2 — Perform the Split

1. Call `mcp__danx_dashboard__issue_edit({issue_id, ...})` to update parent: set `type: Epic`. Keep `status: In Progress`. Append comment summarizing split. Don't fill `children[]` yet — don't have phase ids until `danx_issue_create` returns.
2. For each phase, prepare required fields:
   - `schema_version: 10`
   - `tracker: <same as parent>`
   - `id: ""` (worker assigns next `<PREFIX>-N`)
   - `parent_id: "<epic id>"` (epic's `id`, e.g. `ISS-12`)
   - `children: []`
   - `dispatch: null`
   - `status: "ToDo"`
   - `type: "Bug"` or `"Feature"` (phase kind, not `Epic`)
   - `title: "<Epic Title> > Phase N: Description"`
   - `description: "<full body>"`
   - `triage: {expires_at: "", reassess_hint: "", last_status: "", last_explain: "", ice: {total: 0, i: 0, c: 0, e: 0}, history: []}`
   - `ac: [{check_item_id: "", title: "...", checked: false}, ...]` (every field present, `check_item_id: ""` until worker assigns)
   - `comments: []`
   - `retro: {good: "", bad: "", action_item_ids: [], commits: []}`
3. For each phase YAML, call `danx_issue_create({filename: "<slug>"})`. Worker validates, creates issue, stamps assigned `id` back, renames to `<id>.yml`. Capture returned `id`. `{created: false, errors}` → fix draft, retry.
4. After all phases exist, edit epic YAML once more: set `children: ["<phase-1-id>", "<phase-2-id>", ...]` in phase order. Save.
5. **Stamp `waiting_on` on phase 2..N for serial ordering.** For each phase whose index ≥ 1, edit phase YAML:
   - Set `waiting_on: {reason: "Waits for <prev-phase-id> (<prev-phase-title>) to complete.", timestamp: "<current ISO>", by: ["<prev-phase-id>"]}`. `<prev-phase-id>` is `children[i-1]`.
   - Phase 1 stays `waiting_on: null` — dispatches first.
   - Save each phase YAML. Watcher mirrors. Picker skips dispatch while any blocker non-terminal; dispatches phase N+1 once phase N derives `Done` / `Cancelled`. `waiting_on` record stays as durable dep-history note.
   - **Use `waiting_on` for sequential phase chains — NOT `blocked`.** `blocked` is self-block (human required); `waiting_on` is dep-chain gate (other in-flight work).
   - **Skip stamping ONLY when phases genuinely independent** (different domains, no shared state, any order). Default is sequential — explain in comment on epic if skipped.
6. Restart workflow at Step 1 using first phase card's YAML.

Epic stays `In Progress` until ALL phase cards are Done — then final phase agent (or you) flips epic to `Done` + saves.

## Step 4 — Implement (TDD)

1. Write failing test capturing expected behavior.
2. Run tests — confirm new test fails.
3. Implement — minimum code to pass.
4. Run tests — all green.
5. Refactor — clean up; re-run.
6. Type check — command from `.claude/rules/danx-repo-config.md` (skip if empty).

**Documentation-only changes:** skip TDD; note in comment appended to `comments[]`.

For large repetitive edits, dispatch `batch-editor` subagent via `Agent` / `Task`.

After implementation, edit YAML to record progress (update `comments[]` with build/test summary). Watcher mirrors automatically.

## Step 5 — Quality Gates

Launch in parallel via `Agent` / `Task` with `mode: "bypassPermissions"`:
- `test-reviewer` — audit coverage.
- `code-reviewer` — review quality.

Append each result as new comment to `comments[]`. Set `author` to `"test-reviewer"` / `"code-reviewer"`, `timestamp` to current ISO, `text` to markdown body starting with `## Test Review` or `## Code Review` + subagent output. No `id`.

If critical issues found, fix, re-run failed gate, append `## Review Fixes` comment summarizing fixes.

Watcher mirrors every YAML edit — no save verb.

## Step 6 — Check Off Acceptance Criteria

For each `ac[i]`, verify it holds (test evidence, command output, direct code read). Set `ac[i].checked: true` only with direct evidence.

**Never check off unverified item.** "By construction" / "obviously correct" are not evidence. State must reflect passing test, captured command output, or quoted code line demonstrably satisfying criterion.

If you cannot verify — repo this worker cannot commit to, depends on external state unreachable — leave `checked: false`. Do NOT check off with excuse. Do NOT paraphrase as "done in spirit."

**"Requires deploy" is NOT valid reason to leave AC unchecked.** Every AC is verifiable locally. `make test`, `make test-system`, integration tests, manual local smoke against `http://localhost:5566` — all run here. Production deploy is operations, NOT verification gate. If AC says "verify in production," rewrite to "verify locally via `<command>`" + check once passes — `make deploy` ships code already accepted as Done.

## Step 7 — Commit

Two paths — pick the one matching THIS dispatch.

**`retro.commits[]` scope — owned-repo ONLY (DX-559 gate).** Only shas from THIS card's repo's `origin/main` belong in `retro.commits[]`. If dispatch edited sibling repo (plugin under `~/web/claude-plugins/`, another connected repo, any path outside this worktree), that work does NOT go in `retro.commits[]`. Instead, append `comments[]` entry naming external repo + sha(s) + what shipped. Example:

```
## Plugin work

Edited `~/web/claude-plugins/danxbot/skills/<skill>/SKILL.md`. Published `danxbot v0.3.10`.

Commits (claude-plugins repo):
- `67eefe9` — skill body rewrite
- `1e0a570` — version bump + publish
```

Putting cross-repo shas in `retro.commits[]` makes DX-559 gate block your `danxbot_complete({status: "complete"})` — gate verifies every sha against THIS repo's `origin/main`, treats unresolvable as missing.

### Step 7a — Multi-worker agent dispatch (persona block present)

If dispatch prompt's first paragraph is `You are <name>.` followed by `Your worktree:` + `Your branch:` lines, you're in multi-worker mode (Alice / Bob / etc.) in persistent worktree. Use `agent-finalize.sh` helper — DO NOT hand-roll rebase + squash + push.

1. **Compose title verbatim from card title.** Drop `<Epic Title> > Phase N: ` prefix when present — keep leaf phase description. Example: "Persona injection + agent-finalize.sh + Conventional Commits squash-merge flow".
2. **Compose 1–5 bullets summarizing what changed.** Verbs in past tense — `added`, `fixed`, `refactored`, `wired`. Each bullet is separate arg, properly quoted.
3. **Run from inside worktree** (`Your worktree:` path):

   ```bash
   cd <Your worktree path>
   bash .danxbot/scripts/agent-finalize.sh <YOUR-NAME> <CARD-ID> "<title>" "<bullet 1>" "<bullet 2>" ...
   ```

   Script: WIP-commits uncommitted changes, fetches + rebases onto `origin/main`, squashes agent branch to ONE Conventional Commits commit (`feat(<CARD-ID>): <title>` + bullet body), pushes `HEAD:main` (rebase-loop on race up to 5 retries), resets agent branch to `origin/main`.

4. **Read exit code:**
   - **Exit 0:** success. Stdout contains `PUSHED <sha>`. Capture sha; append to `retro.commits[]` in Step 9.
   - **Exit 1:** rebase conflict. **EXPECTED, not blocker.** Conflict-check at pick time is permissive; concurrent agents finalizing back-to-back collide regularly. Whoever pushes second owns merge. **You are responsible for resolving every conflict cleanly, in this dispatch.** Procedure:
     a. Read script's stderr — lists every conflicting path.
     b. For each path, open it, read BOTH sides of every `<<<<<<<` / `=======` / `>>>>>>>` marker, produce merged result that **keeps all valid code from both sides**. Don't delete other agent's work to make conflict disappear. Don't pick one side wholesale unless edits are semantically identical. Goal = working tree containing intended behavior of *both* cards.
     c. Re-read file after editing. Run `grep -n "<<<<<<< \|======= \|>>>>>>> " <path>` — must return zero matches.
     d. `git add` every resolved path. `git rebase --continue`. If git stops on further commit, repeat (a)–(c).
     e. **Run test suite.** As rebaser you own every test the merge could break — not just tests for *your* card. From worktree: `npx vitest run > /tmp/vitest.log 2>&1 ; echo EXIT=$?` and `npx tsc --noEmit`. Any failure caused by your resolution OR by interaction between two cards' code is YOURS to fix. Failure already on `origin/main` before your work is pre-existing (rare — `origin/main` should be green) — confirm with `git stash && npx vitest run <failing-file>` only if you have strong evidence unrelated; else assume rebase caused it, fix it.
     f. Tests + typecheck green, re-invoke `agent-finalize.sh` same args. Script rebases (now no-op), squashes, pushes.

     Escalate to Blocked only when conflict is genuinely outside scope of either card — e.g. conflicting file deleted on `origin/main` by third party with no clear "what does this card want" answer. Document path, both diffs verbatim, specific decision you cannot make in `## Operator action required` comment, follow Step 10. "Conflict was hard" / "I don't know which side wins" / "tests broke" are NOT valid escalations — read diffs, decide, fix tests.
   - **Exit 2:** push race exhausted (`PUSH_RACE_EXHAUSTED` stderr). Five consecutive non-fast-forward rejections — remote has another writer faster than rebase. Append comment explaining (script output verbatim), call `danxbot_complete({status: "failed", summary: "Push race exhausted; operator must finalize."})`, exit. Do NOT loop.
   - **Exit 64:** usage error. Args malformed (missing `<title>` / `<bullets>`), `<CARD-ID>` doesn't match `<PREFIX>-N`, `<title>` has newline. Stderr names cause. Fix invocation (single-line title, valid card id), re-run. Do NOT `git rebase --continue`.
   - **Exit 65:** wrong branch. Worktree HEAD not on `<YOUR-NAME>`. Investigate (`git status`, `git branch --show-current`) — worktree may be wedged. If can switch back cleanly (`git checkout <YOUR-NAME>`), re-run. If can't, document wedge in `## Operator action required` comment, follow Step 10.

5. **No-op safety net.** If stdout is `NO_OP` (stderr contains `no commits ahead of origin/main`) you ran finalize without making changes — dispatch was docs-only, or forgot to edit code. Decide: docs-only → still Done, leave `retro.commits[]` empty; missing edits → fix them, re-run finalize. Do NOT push literal token `NO_OP` to `retro.commits[]`.

### Step 7b — Single-workspace dispatch (no persona block)

If dispatch prompt has no `You are <name>.` first paragraph, you're in single-workspace mode (`<repo>/.danxbot/workspaces/issue-worker/`). Consult `Git Mode` in `.claude/rules/danx-repo-config.md`:

- `auto-merge`: feature branch `danxbot/<kebab-case-title>`, stage + commit, push, merge to main, delete branch.
- `pr`: feature branch, stage + commit, push, `gh pr create`.

Append commit shas to `retro.commits[]`.

## Step 8 — Definition-of-Done Gate

Before deciding Done vs Blocked, **inspect actual state of every AC item in the card.**

**Mechanical procedure:**

1. Re-fetch the card via `mcp__danx_dashboard__issue_get({issue_id})`.
2. Count `ac` entries where `checked === false`.
3. **Zero unchecked** → Step 9 (Done).
4. **One or more unchecked** → run **Step 1.5 fix-it-yourself check** FIRST. Can you fix underlying defect in this dispatch? YES → fix, re-verify, re-check AC, re-run this gate. Only after exhausting in-session fixes proceed to Step 10. Do NOT move to Done. Do NOT rationalize.

**Forbidden moves:**
- "I'll file hotfix/follow-up card + move Blocked" — if hotfix unblocks THIS card's AC, hotfix IS this card's work. Do it now.
- "Verification revealed defects, so this is verdict-handoff card" — no. Verification card whose verification fails on small in-scope bugs is a card to FIX those bugs, then verify.
- "All important ACs are done, rest are minor" — irrelevant. ACs aren't ranked.
- "Remaining ACs require external work, don't count" — they count. They were defined as required. Step 1.5 → can you do "external" work? Yes → do it. Only escalate genuinely external.
- "I'll move to Done; retro will explain gaps" — no. Card location is canonical state.
- "Wording too strict" — edit AC with justification, or fix underlying issue. Dodging via separate card forbidden.
- "I checked off AC because verification ran, even though it failed" — `checked: true` means criterion HOLDS, not attempted.

Card in Done means: every AC item `checked: true` with direct evidence. No other definition.

## Step 9 — Move to Done

Agent does NOT write `status: Done`. Worker stamps `completed_at = <now ISO>` (clears `dispatch: null`) on `danxbot_complete({status: "complete"})` via `stampIssueCompleted`; `deriveStatus` rule 2 projects card to `Done`. Direct `status:` literal write FORBIDDEN.

**Edit YAML:**

1. **Bug cards:** prepend Bug Diagnosis section to `description` OR append comment:
   ```
   ## Bug Diagnosis
   **Problem:** ...
   **Root Cause:** ...
   **Solution:** ...
   ```
2. Fill `retro.good`, `retro.bad`, `retro.action_item_ids[]`, `retro.commits[]`. Worker auto-renders `## Retro` comment on post-completion auto-sync. Do NOT append `## Retro` comment yourself. **Action items are LAST RESORT** — re-apply Step 1.5 filter. If required for THIS card's ACs (already done, at Done), not an action item. If small + you could do now, do it, re-commit instead of filing. Only large separate scoped follow-ups belong. Create action item card first via `danx_issue_create({type, title, description, ac, ...})`, push returned `<PREFIX>-N` here. Empty `action_item_ids[]` is right answer most times.

Edit YAML with `Edit` / `Write` (only retro fields + bug-diagnosis — no status write). Watcher mirrors. On `danxbot_complete` call in Step 11, worker stamps `completed_at`, renders `## Retro` comment, spawns Action Items cards, moves file `open/` → `closed/`, pushes tracker move.

Skip to Step 11.

## Step 10 — Move to Blocked

**MANDATORY:** Before stamping `blocked: {at, reason}` (which derives status to `Blocked` via rule 3), appending `## Blocked` comment, OR calling `danxbot_complete({status: "failed", ...})` with operator-must-X framing — INVOKE `issue-blocker` skill via Skill tool. The 8-item gating checklist there is authoritative. If any item fails you are NOT authorized to mark Blocked; return to in-session work. Failing to invoke before Blocked move is rule violation. Direct `status: "Blocked"` write FORBIDDEN — stamp trigger only, read path derives.

Blocked is **LAST RESORT** AND **EXCLUSIVELY for cards needing human acting**. If card is waiting on other in-flight work — that's **Waiting On** (Step 10b), not Blocked.

Use Step 10 ONLY when blocker is genuinely one of:

- **Credentials / secrets** human must rotate / push to SSM.
  - **NOT Blocker:** "needs deploy" / "needs prod smoke" / "needs Layer 3 system test". Layer 3 (`make test-system`) runs locally — you can run. Prod deploy ships code already accepted Done; NEVER completion gate. Card with only remaining ACs "deploy + smoke prod" is **already Done** — rewrite ACs to local-verify, run them, mark Done.
  - **NOT Blocker:** pre-existing flaky/failing test in unrelated file. File Action Item via `danx_issue_create`, push id to `retro.action_item_ids[]`, check AC off (your card's tests pass), proceed.
  - **NOT Blocker:** AC says "manual UI smoke" / "operator clicks X." Agent has dashboard token + playwright MCP + dashboard component-test runner. Verify programmatically (component test → playwright → rewrite AC), check off, proceed.
  - **NOT Blocker:** AC verifies behavior firing AFTER `danxbot_complete` (epic auto-flip, post-completion auto-sync, watcher mirror, self-derived state). Rewrite AC to unit test for derivation function, run it, check off.
- **External repo / file worker has no write access** AND no other agent fixes it.
- **Genuine human design decision** (ambiguous spec, missing requirement, conflicting direction). Specifically: answer changes goal / implementation plan in way ONLY human decides.
- **Architectural ambiguity** — multiple valid implementations, different tradeoffs, human call.
- **Card cannot be completed as described** without important change to goal / implementation plan.
- **Card-specific tool / environment failure** (use `critical_failure` for environment-wide — `danx-halt-flag.md`).

**`agents.<name>.broken` is strikes-only (DX-758).** Worker no longer stamps `broken` from git env detection. ONLY path to `broken` is N consecutive `danxbot_complete({status: "failed"})` strikes from `src/agent/strikes.ts`. One legit block doesn't "burn" agent; only pattern of false blocks does. Dashboard's "Clear broken" still clears.

**NOT Step 10 cases — these are Step 10b or in-session work:**
- Waiting on another card / phase / Action Item to ship first → **Waiting On** (Step 10b). No human needed; poller auto-unblocks.
- Stale config in editable file → fix in-session.
- Bug in readable/editable function (in any bind-mounted repo) → fix in-session.
- Test failure pointing at defect in same workspace/repo → fix in-session.
- Missing file you can write → fix in-session.
- Anything where next agent would open same files + make same edits you could make now → fix in-session.

One more time: **"Does a human *action* unblock this, or am I just waiting on other work?"** If waiting, use Step 10b. If 10–30 minutes to fix, cancel Blocked, do it.

**Edit YAML:**

1. Stamp `blocked: {at: "<current ISO>", reason: "<one sentence>"}`. Derived status becomes `Blocked` via rule 3; worker auto-applies Blocked label. Do NOT write `status: "Blocked"` — field is derived.
2. Append Blocked comment to `comments[]`. Shape:
   - `author: "danxbot"`
   - `timestamp: <current ISO>`
   - `text:` markdown body with sections:
     - `## Blocked — <one-line summary>`
     - `**What's done:** <bullet list of what landed, with commit shas>`
     - `**What's still needed:** <numbered list — file paths, repo names, exact edits, verification commands>`
     - `**Why this needs human/host help:** <one paragraph>`
     - `**Incomplete ACs:** <bullet list of every unchecked AC item, verbatim>`
     - `**Final AC check:** Before Done, every AC must be checked: true.`
   - No `id` field
3. **Bug cards** with partial progress: also append `## Bug Diagnosis` block.
4. Fill `retro.{good, bad, action_item_ids, commits}` honestly — AC gap is primary "what went wrong." Worker auto-renders `## Retro` comment when next pickup moves card to Done / Cancelled (Blocked is non-terminal; rendering on eventual terminal save). Filling `retro` now helps: next agent inherits through YAML. **Re-apply Step 1.5 filter to every action item candidate.** Fix next agent will need → describe in Blocked comment, not action item card. Only large unrelated separately-scopeable follow-ups belong. Create action item first via `danx_issue_create({type, title, description, ac, ...})`, push returned `<PREFIX>-N`. Empty `action_item_ids[]` right answer most times.

Edit YAML with `Edit` / `Write`; watcher mirrors.

Skip to Step 11.

## Step 10b — Move to Waiting On

Use Step 10b when card cannot proceed because waiting on **other work that's in flight / about to be**, with NO human action required. Poller auto-unblocks + dispatches card once every blocker reaches Done / Cancelled — no manual toggle needed.

**Trigger conditions:**
- Fix needs another card / phase to ship first (data model change, shared abstraction, dependency upgrade).
- Action Items card describes prerequisite work this card depends on.
- Sibling phase under same epic must finish before this phase makes sense.

If only thing blocking is human action → use Step 10 (Blocked).

### Procedure

1. **Find blocking card(s).** Search in order until ≥1 concrete `<PREFIX>-N` id describing unblock work:
   1. **Phase siblings via parent epic.** If card has `parent_id`, read epic's `children[]`, check each phase card via `mcp__danx_dashboard__issue_get`. Blocker usually phase shipping first.
   2. **Open issues by topic.** Use `mcp__danx_dashboard__issue_list` to find cards covering prerequisite — ToDo, In Progress, Blocked, Action Items all qualify.
   3. **In Progress queue.** Cards being worked on may be blocker.
2. **No existing card describes unblock work?** You MUST create one. Prepare the card data describing exactly what needs to happen. Call `danx_issue_create({type, title, description, ac, ...})`. Pick status:
   - Autonomous agent work → call `mcp__danx_dashboard__issue_transition({action: 'ready'})` so the poller dispatches.
   - Human work → call `mcp__danx_dashboard__issue_transition({action: 'block', reason: "<one sentence>"})` (derived `Blocked` via rule 3). Include all evidence human needs in description.
   Capture new card's returned `id`.
3. **Set this card's dependency:**
   - Call `mcp__danx_dashboard__issue_dependency({id: <this-card>, action: 'add', kind: 'depends_on', blocker_ids: [<PREFIX>-N of each IMMEDIATE blocker]})`.
   - **`blocker_ids[]` is IMMEDIATE blocker(s) only.** If A→B→C, A's blocker is `["B"]` — NOT `["B", "C"]`. Chain computed auto by dashboard from each card's direct blocker; restating upstream is redundant + drifts. Same for phase chains (Phase 3 depends on Phase 2 only, never both Phase 2 and Phase 1).
   - Do NOT change `status` directly. The `waiting_on` gate is independent — setting it via dependency call only. Picker uses `waiting_on` alone as dispatch gate.
   - Call `mcp__danx_dashboard__issue_comment({id: <this-card>, text: "<summary of blockers found/created and state once they ship>"})` to add a comment record.
4. Call `mcp__danx_dashboard__issue_retro({id: <this-card>, good: "...", bad: "...", action_item_ids: [...], commits: [...]})` — gap between shipped + needed is "what went wrong." Same action-items rule: only large separately-scopeable follow-ups. Create action item first via `mcp__danx_dashboard__issue_create`, push `<PREFIX>-N`. Small in-scope work belongs in THIS dispatch or blocker card, not retro action item.

### Save and exit

Edit YAML with `Edit` / `Write`. Watcher mirrors; post-completion auto-sync (when `danxbot_complete` fires) applies Waiting On label via tracker, returns. Picker skips dispatch while any blocker non-terminal. When every blocker terminal, picker dispatches card same tick — `waiting_on` record stays as durable dep-history note.

Skip to Step 11.

## Step 11 — Signal Completion

`danxbot_complete` is agent's terminal signal. Worker treats as proof full pipeline ran. **Do not call until every prereq below holds.** Calling with prereqs unmet is **workflow violation** — worker writes dispatch row completed, file moves `open/` → `closed/`, work appears shipped without ever landing main. DX-203 + DX-210 burned the budget.

### Pre-call gate (mechanical, every status: complete)

| # | Prereq | How to verify |
|---|---|---|
| 1 | All ACs evidence-verified (`ac[i].checked: true` with real evidence) | Step 6 + Step 8 |
| 2 | Test-reviewer + code-reviewer findings addressed | Step 5 — `## Code Review` / `## Test Review` / `## Review Fixes` comments appended |
| 3 | Commit landed on `origin/main` | Step 7a: `agent-finalize.sh` exit 0 + `PUSHED <sha>` stdout. Step 7b: `git log origin/main --grep=<CARD-ID>` returns commit. |
| 4 | `retro.commits[]` populated with verified sha(s) | Step 9 |
| 5 | `retro.good` + `retro.bad` non-empty | Step 9 |
| 6 | Terminal trigger set (`completed_at` / `cancelled_at` / `blocked.at`) — worker stamps `completed_at`/`cancelled_at` on `danxbot_complete`; agent stamps `blocked.at` for self-blocks | Step 9 (worker stamps) / Step 10 (agent stamps) |

Any prereq missing → loop back to that step. Do not call `danxbot_complete` until all six hold.

### Completion contract — `completed` means EVERYTHING on card is done

`danxbot_complete({status: "complete"})` is per-CARD signal, not per-dispatch. Two hard preconditions, both required:

1. **Every `ac[i].checked` is `true`** with direct evidence (Step 6 + Step 8). Unchecked AC = unfinished work; no "rest minor" or "remainder lands in follow-up".
2. **Every child in `children[]`** (when non-empty) is terminal (`Done` / `Cancelled`). Phase parent whose children still ToDo/In Progress/Blocked/Waiting On is NOT complete — rollup via `deriveStatus`, never direct write.

If either fails, three options:

- **Finish residue in-session** (apply Step 1.5 filter — default).
- **Split into fresh sibling card** for genuinely separate scope; narrow THIS card's AC set; document in `comments[]`.
- **Route to Blocked / Waiting On** (Step 10 / 10b) when real human action / external dep gates remainder.

**`danxbot_complete({status: "complete"})` on `type: Epic` is FORBIDDEN.** Epic terminal state derives from child rollup, never direct write. Planning dispatch whose candidate IS epic (split-into-phases pattern) calls `danxbot_complete({status: "complete"})` ONLY when every phase child already terminal — rare; planning typically split-and-handoff. Worker's write-side guard (`src/issue/stamp-terminal.ts`) refuses `completed_at` / `cancelled_at` stamp on Epic YAML, surfaces `stamp-terminal-epic-refused` system error. Dispatch row finalizes; YAML mutation suppressed. Guard is defense-in-depth — rule above is what you uphold. If you reach guard, you tripped the rule.

### Sha-less completion rejected

`danxbot_complete({status: "complete", summary: "<no commit sha>"})` rejected as workflow violation: no "completed without commit" path except docs-only (note explicitly in `summary`) or terminal `Blocked` / `failed` / `critical_failure`. Format: `feat(<CARD-ID>): <title> @ <sha>`.

### Per-status table

| `danxbot_complete({status, …})` | YAML side-effect | Derived status | When to use |
|---|---|---|---|
| `complete` | worker stamps `completed_at` + clears `dispatch` | `Done` | Work shipped on `origin/main`; every AC checked; retro filled. |
| `failed` | worker stamps `blocked: {at, reason: summary}` (summary ≥ 30 chars; shorter → silent cancel + strike) | gated `Blocked` dispatch | Card cannot proceed without human acting (ambiguous spec, missing credentials, external blocker). Load `issue-blocker` skill first — its gate is authority. |
| `cancelled` | worker stamps `cancelled_at` + clears `dispatch` | `Cancelled` | Card abandoned — work won't ship. Use sparingly; prefer `failed` when card might still be picked by human. |
| `critical_failure` | writes per-repo `CRITICAL_FAILURE` flag (halts poller) | unchanged | Environment broken (MCP not loading, Bash unavailable, Claude auth missing). See `danx-halt-flag.md`. |

**Other statuses NOT for work agents.** `ready` / `archive` / `review` exist for flesh-out + triage agents — calling from `/danx-next` work dispatch is workflow violation (resets lifecycle triggers, card returns to pre-work state).

DX-770 hard-cut pre-existing `completed` / `agent_blocked` aliases. MCP tool rejects with typed error naming canonical name (`complete` / `failed`). Every caller MUST use canonical name.

### Allowed final states

- `status: "complete"` — finished; worker stamps `completed_at`, renders `## Retro`, moves `open/` → `closed/`. `summary` MUST contain commit sha (or `"docs-only — no commit"` if explicitly docs-only).
- `status: "failed"` — cannot proceed without human; worker stamps `blocked: {at, reason: summary}`. `summary` MUST be ≥ 30 chars (shorter → silent downgrade to cancel + strike).
- `status: "cancelled"` — abandoned; worker stamps `cancelled_at`. `summary` describes abandonment reason.
- `status: "critical_failure"` — environment-level blocker (see `danx-halt-flag.md`). `summary` describes env issue for operator. No YAML stamp; poller halts via per-repo `CRITICAL_FAILURE` flag.

### What worker does on signal

1. Auto-syncs YAML one final time (safety net).
2. Finalizes dispatch row.
3. Renders `## Retro` comment from `retro.{good, bad, action_item_ids, commits}`.
4. Spawns Action Items cards from `retro.action_item_ids[]`.
5. Moves file `open/` → `closed/` (Done / Cancelled).
6. Pushes tracker move.
7. SIGTERMs claude.
8. Resumes polling.

Never exit without `danxbot_complete`. Never call with prereqs unmet.

### Terminal token — emit NO text after call

`danxbot_complete` IS the report. `summary` arg + `retro.{good, bad, commits, action_item_ids}` in YAML are what operator + dashboard + next dispatch read. Conversation stream NOT read after tool returns — worker SIGTERMs claude within 5s; tokens during grace window discarded.

**Forbidden after `danxbot_complete`:**
- convey-format report (`## <headline>`, behavior diff table, verify line)
- `pipe-finish` mode A post-commit summary
- `pipe-finish` mode B final-session wrap (mode B for human sessions only; dispatched workers MUST skip)
- any text response at all

`base:convey` self-trigger gate has explicit carve-out — see "Hard carve-out — terminal MCP calls" section. If you reach for report reflex after tool result, that is the rule the carve-out exists to block.

## If YAML Says Empty / Wrong State

Missing/unparseable YAML → signal `critical_failure` — poller broken. If YAML's `status` already `Done` / `Cancelled` (file should be in `closed/`), something upstream is wrong — signal `failed` with summary explaining inconsistency.
