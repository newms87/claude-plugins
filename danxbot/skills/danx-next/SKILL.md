---
name: danx-next
description: Pull the top card from ToDo and run the full autonomous card processing workflow.
---

# Danx Next Card

You process ONE card. You are the orchestrator — do not delegate workflow steps to subagents (except Step 5 quality gates and Step 4 batch-edits).

**Never ask the operator anything.** No `AskUserQuestion`, no plan-mode
pause, no "ready to proceed?" prompt. There is no terminal attached;
prompts hang the dispatch until the inactivity timer kills it. When you'd
otherwise ask: decide unilaterally + document, OR escalate to Blocked
with the question on the card. Full contract:
`.claude/rules/danx-no-interactive.md`.

## /loop and ScheduleWakeup — narrow contract

You may use Claude Code's `/loop` skill (and the underlying
`ScheduleWakeup` tool) ONLY for in-card async monitoring. Anything else is
a workflow violation — dispatched agents have one exit
(`danxbot_complete`); using `/loop` to defer completion or wait for state
outside this card's scope is the May-7 failure mode (ISS-135 / ISS-136).

**ALLOWED:**

- Polling an async pipeline whose result IS part of this card's AC (e.g.
  dispatch a build, `/loop` every 5 min until it finishes, then verify the
  artifact and proceed).
- Monitoring a long-running test whose pass/fail is the AC under test.
- Watching for the next state of an external system you triggered AS PART
  OF THIS CARD's WORK.

**FORBIDDEN:**

- Waiting for a human to reply (use `status: Blocked` instead — the
  operator opens the card, answers, moves it back).
- Waiting for the next card to land (the poller dispatches; you exit when
  this card is done).
- "Let me check on this in N minutes" for anything outside this card's
  scope.
- Arming `/loop` and then calling `danxbot_complete` in the same dispatch.
  Loop owns completion timing — if you call complete, disarm the loop
  first; if a loop is active, do not call complete.

**RULE:** when you call `danxbot_complete`, every `ScheduleWakeup` armed
during this dispatch must be disarmed (or have already fired and exited).
Active loop + complete signal = workflow violation; the next resume will
re-fire the loop after the dispatch is logically over.

The dispatch prompt told you the YAML path:

```
Edit <repo>/.danxbot/issues/open/<id>.yml directly with the Edit / Write tools.
The watcher mirrors changes to the database automatically; the poller's
per-tick mirror pushes them to the tracker. Call danxbot_complete when done.
```

That YAML is the source of truth for the card. The poller pre-hydrated it from the tracker before this dispatch ran. You read and edit the YAML in place with `Edit` / `Write` — you do NOT make tracker calls and there is no separate "save" verb. The chokidar watcher in the worker (`src/db/issues-mirror.ts`) catches every file change and mirrors it to Postgres; the poller's per-tick outbound mirror pushes the YAML to the tracker (~30-60s latency). When you call `danxbot_complete`, the worker fires an immediate post-completion tracker push so the dashboard sees terminal state without waiting for the next tick.

---

## YAML Schema (read this once)

| Field | Type | Notes |
|---|---|---|
| `schema_version` | `10` | Always exactly `KNOWN_SCHEMA_MAX`. Never change at write time. |
| `tracker` | string | Don't change. |
| `id` | string (`<PREFIX>-N`) | The id you save with. Matches the filename. Don't change. |
| `parent_id` | string \| null | Set on child cards (epic's `id` for phase children, or any other parent's `id` for sub-cards). Reverse linkage to `children[]`. |
| `children` | `string[]` (ids) | Ordered list of child issue ids (`<PREFIX>-N`). On `type: Epic` cards, `children[]` IS the list of phase cards (label "Phases"). On non-epic cards, it's the list of sub-cards (label "Children"). Same field, two labels. Maintained by `danx_issue_create` (when a child card is created from a draft) and by the `danx-epic-link` skill (for human-created phase cards). Phases MUST be cards — there is no separate in-card phase checklist. |
| `dispatch` | `{id, pid, host, kind, started_at, ttl_seconds} \| null` | Poller-managed dispatch record. `null` when no agent is running. Don't touch. |
| `status` | `Review` \| `Backlog` \| `ToDo` \| `In Progress` \| `Blocked` \| `Done` \| `Cancelled` | **Derived — agents NEVER write this field.** Computed every read by `deriveStatus()` (`src/issue/derive-status.ts`) from lifecycle timestamps + gate fields. To move a card, write the trigger: pickup is auto-flipped by the worker (`dispatch != null` → rule 4 → `In Progress`); approve → `ready_at`; complete → worker stamps `completed_at` on `danxbot_complete({status: "complete"})`; cancel → `cancelled_at`; block → `blocked.at`. Direct `status:` literal writes are FORBIDDEN — see CLAUDE.md "Forbidden Patterns". |
| `ready_at` | `string \| null` (ISO) | Triage Approve / agent-marks-ready / move into a `ready`-type list → worker stamps. Derived rule 5 → `ToDo`. |
| `completed_at` | `string \| null` (ISO) | Worker stamps on `danxbot_complete({status: "complete"})`. Derived rule 2 → `Done`. |
| `cancelled_at` | `string \| null` (ISO) | Triage Cancel / move into a `cancelled`-type list → worker stamps. Derived rule 1 → `Cancelled`. |
| `archived_at` | `string \| null` (ISO) | Move into an `archived`-type list → worker stamps. Derived rule 6 → `Backlog`. |
| `list_name` | `string \| null` | **Display-only — workers never read this field for state-machine decisions.** Auto-resolved by the worker to the default list of the derived semantic type. |
| `requires_human` | `null` OR `{reason, steps[], set_by, set_at}` | Orthogonal "this card needs a human" indicator. `null` when no human action needed. Non-null = card cannot make progress until a human acts on a system the agent has zero programmatic reach into (3rd-party token rotation, vendor portal click-through, manual deploy of external infra, restart of host-launched worker the agent cannot start itself). Independent from `blocked`, `waiting_on`, and `conflict_on[]` — **all four dispatch gates may coexist on one card simultaneously, by design.** Each models a different cause + is cleared by a different actor. Picker AND-s them: dispatches only when every gate is null. Coexistence is normal pattern, not rare. The poller's dispatch filter (`src/poller/local-issues.ts`) skips cards with `requires_human != null`. Whitelist + blacklist + routing rules — `requires-human/SKILL.md` + `issue-blocker/SKILL.md` "Field selection" table. |
| `type` | `Bug` \| `Feature` \| `Epic` | Required label. |
| `title` | string | Card name. |
| `description` | string | Full markdown body. |
| `triage` | `{expires_at, reassess_hint, last_status, last_explain, ice, history[]}` | Triage agent owns this. Leave alone. |
| `ac` | `[{check_item_id, title, checked}]` | Acceptance Criteria. Empty `check_item_id` on new items — tracker assigns. |
| `comments` | `[{id?, author, timestamp, text}]` | Append a new comment by adding `{author, timestamp, text}` (no `id`). The worker handles tracker push semantics. |
| `retro` | `{good, bad, action_item_ids[], commits[]}` | Fill on Done / Cancelled / Blocked. The worker auto-renders this as ONE structured comment on terminal save. `action_item_ids[]` is a `string[]` of `<PREFIX>-N` references. **`action_item_ids[]` is a LAST RESORT** — see Step 1.5. Only reference an action item when the work is BOTH unrelated to this card's ACs AND too large to reasonably finish in this session (multi-phase refactor, redesign, cross-cutting work needing its own scoping). Small in-scope or small unrelated fixes you spotted → DO THEM NOW, don't defer. Create the action item card first via `danx_issue_create({type, title, description, ac, ...})`, then push its returned `id` here. `action_item_ids[]` must contain only valid `<PREFIX>-N` format strings. Do NOT append a `## Retro` comment to `comments[]` yourself. |
| `blocked` | `null` OR `{at, reason}` | **Self-block lifecycle trigger.** `null` when the card itself can proceed. Non-null = card itself cannot make progress on its own work; a human (or a subsequent agent dispatch) must clear `blocked: null`. `at` is ISO 8601 (the timestamp the block was stamped — derived rule 3 → status `Blocked`); `reason` is a non-empty sentence. Agents never write `status: "Blocked"` directly — stamp `blocked.at`, the read path derives the status. No `by[]` (that lives on `waiting_on`). |
| `waiting_on` | `null` OR `{reason, timestamp, by[]}` | **Pure dispatch gate, independent of `status`.** `null` when nothing blocks this card. Set to a `{reason, timestamp, by}` record when the card is waiting on **other in-flight work** that does NOT need a human (a phase sibling shipping first, an Action Items card needs to land, a separately-scoped task). `reason` is a non-empty sentence. `timestamp` is current ISO 8601. `by[]` is a non-empty list of the IMMEDIATE `<PREFIX>-N` blocker(s) — never transitive. If A→B→C, A's `by[]` is `["B"]` only; the chain is computed by the poller + dashboard from each card's direct blocker. If no existing card describes the unblock work, **create one** (`danx_issue_create`) and put its id here. The picker skips dispatch while any blocker is non-terminal, then dispatches once every blocker is Done / Cancelled. The field itself is a **durable record** — the system NEVER auto-clears it on dep resolution or status change; only the agent / operator clears it (if the link was a mistake). Any `status` is legal with any `waiting_on` value. **Waiting On is NOT Blocked** — Blocked is when THIS card itself is stuck; Waiting On is when THIS card is queued behind OTHER work. See Step 10b. |

**Save semantics:** there is no save verb. Use `Edit` / `Write` to modify the YAML on disk. The chokidar watcher detects the file change and upserts the new content into the `issues` Postgres table; an `issue_history` row records the RFC 6902 patch from the prior content. Schema validation does NOT block writes — a malformed YAML is mirrored as `{_malformed: true, raw: <text>}`. Verify your edits by re-reading the file after the write.

**Open → closed move:** when the worker stamps `completed_at` or `cancelled_at` (triggered by `danxbot_complete({status: "complete"})` / `danxbot_complete({status: "cancelled"})`), its post-completion auto-sync moves the file from `open/` → `closed/` as part of pushing terminal state to the tracker. You do NOT need to move the file yourself, and you do NOT write `status:` literals.

**Auto-sync:** `danxbot_complete` triggers an immediate tracker push (the watcher mirror to Postgres has already happened on the file write). Without `danxbot_complete`, the YAML still reaches the tracker on the poller's next tick (~30-60s); calling `danxbot_complete` is faster and signals the dispatch is over.

---

## Top-Level Flow

0. Verify on latest `origin/main` (Step 0).
1. Read the YAML the dispatch prompt named.
1.1. **Resume self-check** (Step 1.1) — terminal state + checked ACs + filled retro = call `danxbot_complete` and stop. Do not redo work.
1.5. Internalize the **You Fix What You Find** rule (Step 1.5) before doing anything else.
2. Plan (Step 2).
3. Evaluate scope; epic-split if needed (Step 3).
4. Implement TDD (Step 4).
5. Quality gates (Step 5).
6. Verify ACs (Step 6).
7. Commit (Step 7).
8. Definition-of-Done gate (Step 8).
9. Move to Done (Step 9), Blocked (Step 10), or Waiting On (Step 10b).
10. `danxbot_complete` (Step 11).

Config references: `.claude/rules/danx-repo-config.md` for repo commands. Never hardcode IDs.

---

## Step 0 — Verify on latest `origin/main`

The worker's `dispatchWithRecovery` runs `git fetch origin main` and `git reset --hard origin/main` before spawning you, so your worktree SHOULD already be on the upstream tip. This step is the defense-in-depth audit — confirm freshness once at start so a regression in the dispatch path (skipped fetch, stale cache, racing operator push between fetch and reset) is caught here instead of silently shipping work against stale base.

```bash
git fetch origin --quiet
git rev-list HEAD..origin/main --count
```

- Output `0` → you are on the latest main. Proceed to Step 1.
- Output non-zero → upstream moved between the worker's pre-dispatch fetch and your spawn. Catch up before doing any work:

  ```bash
  git rebase origin/main
  ```

  A clean rebase puts you at HEAD = origin/main. Proceed to Step 1.

  A rebase **conflict** here means your worktree carried in-flight work the worker's `validate()` did not flag (it should have routed you to recovery mode — a regression worth a comment on the card). Don't try to resolve blind. Add a `comments[]` entry titled `## Operator action required` describing the conflicting paths + the fact that the dispatch landed pre-recovery, then follow Step 10 (Blocked).

This step is read-only against your worktree's existing work — if `git status` shows uncommitted changes BEFORE you do anything, the worker mis-routed (validate should have caught dirty state). Same operator-action comment + Blocked.

---

## Step 1 — Read the YAML

`Read <repo>/.danxbot/issues/open/<id>.yml`. The dispatch prompt has the absolute path.

**The worker has already auto-flipped the card to derived `In Progress`** before spawning you (DX-584 dispatch core sets `dispatch != null` on the candidate YAML BEFORE `spawnAgent`; `deriveStatus` rule 4 then projects that to `In Progress` on every read). You do NOT write `status:` on pickup — the field is derived. Direct `status:` literal writes are FORBIDDEN — see CLAUDE.md "Forbidden Patterns".

**Your first edit is `effort_level` if it is unset (DX-512).** Read `.claude/rules/danx-effort-policy.md` — the workspace's auto-rendered policy file carries the operator-tunable assignment prompt and the operator-configured 7-row level ladder. If the YAML's `effort_level` is `null`, pick the lowest level that can plausibly complete the card per the policy file (default `medium`; bump DOWN aggressively for mechanical edits / single-file fixes / doc tweaks; bump UP only for deep reasoning / multi-file refactor). Edit the YAML to set `effort_level: "<level>"`. If `effort_level` is already set, leave it alone — the triage agent owns the level on Review cards; the pickup path only fills the unset case. No status write in the same save (or any save).

**Resume detection:** if `deriveStatus(yaml)` already returns `In Progress` (i.e. `dispatch != null` AND no terminal trigger) AND prior session state is present (checked ACs, comments from earlier in the session, `retro.commits[]`), treat this as resumption — proceed to Step 1.1 validation. The raw `status:` field on disk is advisory; trust the derived value.

If the YAML doesn't exist or fails to parse, signal `danxbot_complete({status: "critical_failure"})` per `.claude/rules/danx-halt-flag.md` — the poller is broken if it dispatched without a YAML.

---

## Step 1.1 — Validate, never trust prior state (CRITICAL)

A card's YAML may carry stale claims from prior dispatches that died
mid-pipeline. **NEVER skip work because a prior agent claimed it was
done.** Always verify the actual state of the code before treating any
prior claim as truth.

Mechanical procedure (every dispatch, no exceptions):

1. **Read the YAML.**
2. **For each `ac[i]` where `checked: true`:** verify the claim against
   real code/test/commit evidence:
   - Read the files the AC names. Confirm the asserted code or
     behavior is actually present.
   - Run the test the AC requires. Confirm it passes.
   - If `retro.commits[]` references the change, find the matching sha
     in `git log origin/main` (or the agent branch). Confirm the
     commit exists AND its diff actually lands the AC's claim.
   - **Any mismatch** (file missing, test fails, commit not in log,
     diff doesn't deliver the AC) → flip `ac[i].checked: false`, save,
     treat as work to do.
3. **For each sha in `retro.commits[]`:** run `git cat-file -t <sha>`
   in THIS card's repo. Output not `commit` (or `git log origin/main`
   doesn't show it) → the sha is one of:
   - **Stale** (rebased away / typo / never pushed) → drop from
     `retro.commits[]`, save.
   - **Cross-repo** (`git cat-file -t <sha>` resolves in `~/web/claude-plugins/`
     or another sibling repo but not in THIS card's repo) → drop from
     `retro.commits[]` AND append a `comments[]` entry titled
     `## External repo work` naming the repo + sha + what shipped.
     Save. See Step 7 — `retro.commits[]` is owned-repo only.

   If the card is Blocked with reason starting `DX-559 enforcement:`,
   this self-heal is exactly what unblocks it: walk each missing sha,
   route to stale-drop or cross-repo-comment, save, then clear
   `blocked: null` + stamp `ready_at: <now>` and call
   `danxbot_complete({status: "complete", summary: "Reconciled
   retro.commits[] after DX-559 block — <one-line summary>"})`.
4. **If `status: "Done"` or `"Cancelled"`** AND every AC verifies in
   step 2 AND every commit verifies in step 3 AND `retro.good` +
   `retro.bad` non-empty: the prior session truly finished. Call
   `danxbot_complete({status: "complete", summary: "Verified prior
   dispatch's terminal state on resume — no work to redo."})` and
   stop. **Do not redo work.** Do not flip status. Do not re-save the
   YAML.
5. **Otherwise:** the card is yours — resume from the first failing
   AC. Prior YAML state is advisory; YOUR evidence is authoritative.

This rule exists because pre-DX-162 dispatched agents could (and did)
call `danxbot_complete` after stamping ACs checked + flipping status
to Done WITHOUT ever running `agent-finalize.sh` / `git commit` /
`git push`. DX-203 and DX-210 both shipped Done with no commit on
`origin/main`; the code sat uncommitted in the working tree for days
until a follow-up dispatch caught the gap. Step 11's pre-call gate
prevents the trap going forward — Step 1.1's revalidation is the
defense for cards already in the broken state.

The May-7 incident gate (ISS-135) is a special case of this same rule:
an orphan-resumed agent that re-runs `/danx-next` against a truly-done
card creates noisy duplicate retro comments. Step 4 of the procedure
covers it: real commits + verified ACs → exit cleanly without redo.

---

## Step 1.5 — You Fix What You Find (CRITICAL)

This card is yours. Action items, follow-up cards, hotfix cards, and Needs
Help moves are a **LAST RESORT**, not a workflow convenience. Default
behaviour for ANY defect, stale config, broken test, or cleanup you discover
during this dispatch — in-scope or not — is to fix it in this session.

Apply this filter, in order, every time you're tempted to defer work:

1. **Required for THIS card's ACs?** → Mandatory. Fix in this dispatch.
   Filing a "hotfix card" / "follow-up card" / "separate bug" for work that
   is required to satisfy this card's ACs is a **rule violation**. The card
   stays In Progress until ITS ACs pass — the fix lives in this session.
2. **Unrelated but small** (a few file edits, no big refactor, fits this
   session)? → Fix in this dispatch. Action items defer work, create tech
   debt, and incur re-dispatch cost. Prefer fixing every time.
3. **Unrelated AND large** (multi-phase refactor, cross-cutting redesign,
   needs its own scoping, would derail this card)? → Action item is OK.
4. **Needs human decision or external access** (credentials, ambiguous spec, repo you can't write to, secret rotation)? → Step 10 / action item. **NOT a valid blocker:** "needs deploy", "needs prod smoke", "needs production verification", "manual UI smoke", "pre-existing flaky test in an unrelated file", "post-terminal-save state I cannot observe from inside this dispatch". A card is **Done when code is committed and tests pass locally** — deploys are an operational concern that ship code already accepted as Done. Never block a card on `make deploy` / `make deploy-smoke` / "verify in prod" / "operator must click the dashboard" / "the watcher will mirror after I exit"; that's how Done turns into Forever-Blocked. Full pattern catalog + programmatic substitutes: `.claude/rules/danx-no-false-blockers.md`.

Mechanical check before writing any action item or going to Blocked:
**"Could I just do this in the next 10–30 minutes?"** Yes → do it. Drop the
action item / cancel the Blocked move.

Examples of work that MUST be done in-session, not deferred:

- Verification card whose verification fails because of a small in-scope
  bug → fix the bug, re-verify. Do NOT file a hotfix card and move to Blocked.
- Stale config in a file you can edit (placeholder list, env var, alias).
- Broken test pointing at a defect in a function you can read + edit.
- Missing file you can write.
- Doc / comment that contradicts current behaviour and confused you.

Only after exhausting in-session fixes do you reach for action items or
Blocked status.

---

## Step 2 — Plan

1. Read the full `description`, all `comments[]`, all `ac[]` titles, and any existing `children[]` (look up each child YAML to see what's already been built).
2. **Bug cards (`type: Bug`):** investigate root cause via `Read` / `Grep` / `Bash` before designing the fix.
3. **Blocked vs Waiting On vs fix-it-yourself:** if the card cannot be done by an agent, route it correctly. Step 10 (Blocked) ONLY for true human-action blockers (credentials, secret rotation, ambiguous spec needing human decision, architectural ambiguity that changes the goal). **"Needs deploy" / "needs prod smoke" / "needs Layer 3 system test" are NOT valid blockers** — Layer 3 tests run locally (`make test-system`); deploys ship code already accepted as Done. Step 10b (Waiting On) for waiting on other in-flight work — no human required, the poller auto-unblocks. Anything else → apply Step 1.5 and fix it yourself in this dispatch.
4. Design the approach in your head. No code yet.
5. Invoke the `/pipe-start` skill to reload pre-implementation rules.

---

## Step 3 — Evaluate Scope (Epic + Phase Linkage)

### Step 3.0 — Pre-flight: is this card already an epic with linked children?

Before deciding whether to split, mechanically check the card's existing
state. ANY of these conditions means the epic is already split — DO NOT
re-split, DO NOT call `danx_issue_create`:

1. **Card's `children: []` is non-empty.** The epic is fully linked. Read
   each child YAML at `<repo>/.danxbot/issues/open/<child-id>.yml`,
   identify the first one with `status: ToDo` (or `In Progress` if you're
   resuming), and treat THAT phase as the work to do. Re-read its YAML
   and restart this workflow at Step 1 using the phase card.
2. **Card's `type: Epic` AND `children: []` is empty.** The epic was
   created without going through `danx_issue_create` (or by a human on
   the tracker UI) — phase cards may already exist in
   `<repo>/.danxbot/issues/open/` but lack the `parent_id` linkage.
   **Invoke the `danx-epic-link` skill via the Skill tool**. It scans
   open issues, identifies this epic's phase children, sets `parent_id`
   on each phase YAML, and sets `children[]` on this epic. After it
   returns, re-read the epic YAML — `children[]` is now populated —
   then jump back to the top of Step 3.0 (the first condition now
   matches and you proceed to the first phase).
3. **Card's `type` is NOT Epic but other YAMLs reference it as their
   parent.** Run `Grep` for `parent_id: "<this.id>"` across
   `<repo>/.danxbot/issues/open/`. Any matches means this card is
   actually an epic that lost its `Epic` label. Promote it: set
   `type: Epic`, populate `children[]` from the matched YAMLs (sorted
   by `Phase N:` like `danx-epic-link` does), save. Then jump back to
   Step 3.0.

Only if NONE of those conditions match do you proceed to Step 3.1.

### Step 3.1 — Decide whether to split

Split into an epic when the card is 3+ implementation phases, spans
different domains, or will exceed ~500 lines. Keep as a single card
when the work is sequential but small — track the work via `ac[]`
items only. There is no in-card phase checklist; phases MUST be
their own cards (ISS-81 retired the old `phases[]` field).

If you decide NOT to split, skip ahead to Step 4.

### Step 3.2 — Perform the split

1. Edit the parent YAML: set `type: Epic`. Keep `status: In Progress` — the epic stays open while phases work. Append a comment summarizing the split (no `id` field). Don't fill `children[]` yet — you don't have the phase ids until after `danx_issue_create` returns. Save.
2. For each phase, write a draft YAML at `<repo>/.danxbot/issues/open/<slug>.yml` (filename can be the kebab-case slug; `.yml` suffix optional in the create call — both forms accepted) with every required field populated. Use this template (`<DRAFT_TEMPLATE>`):
   - `schema_version: 10`
   - `tracker: <same as parent>`
   - `id: ""` (worker assigns the next `<PREFIX>-N`)
   - `parent_id: "<epic id>"` (the epic's `id`, e.g. `ISS-12`)
   - `children: []`
   - `dispatch: null`
   - `status: "ToDo"`
   - `type: "Bug"` or `"Feature"` (the phase's own kind, not `Epic`)
   - `title: "<Epic Title> > Phase N: Description"`
   - `description: "<full body>"`
   - `triage: {expires_at: "", reassess_hint: "", last_status: "", last_explain: "", ice: {total: 0, i: 0, c: 0, e: 0}, history: []}`
   - `ac: [{check_item_id: "", title: "...", checked: false}, ...]` (every required field present, `check_item_id: ""` until worker assigns)
   - `comments: []`
   - `retro: {good: "", bad: "", action_item_ids: [], commits: []}`
3. For each phase YAML, call `danx_issue_create({filename: "<slug>"})`. The worker validates the draft (empty `id` + empty `check_item_id`s are allowed), creates the issue, stamps the assigned `id` back into the YAML, and renames the file to `<id>.yml`. Capture the returned `id` from the response. `{created: false, errors}` → fix the draft and retry.
4. After all phase cards exist, edit the epic YAML once more: set `children: ["<phase-1-id>", "<phase-2-id>", ...]` in phase order. Save. This is the reverse linkage that lets a future epic pickup recognize "already split" without re-scanning open issues.
5. **Stamp `waiting_on` on phase 2..N for serial ordering.** `createCard` always stores `waiting_on: null` — you must add the record in a follow-up save. For each phase card whose index in `children[]` is `>= 1`, edit the phase YAML:
   - Set `waiting_on: {reason: "Waits for <prev-phase-id> (<prev-phase-title>) to complete.", timestamp: "<current ISO>", by: ["<prev-phase-id>"]}`. `<prev-phase-id>` is `children[i-1]`.
   - Phase 1 (`children[0]`) stays `waiting_on: null` — it dispatches first.
   - Save each phase YAML with `Edit` / `Write`. The watcher mirrors the change to the DB. The picker skips dispatching while any blocker is non-terminal, then dispatches phase N+1 once phase N derives `Done` / `Cancelled`. The `waiting_on` record itself stays as a durable dep-history note even after the chain resolves.
   - **Use `waiting_on` for sequential phase chains — NOT `blocked`.** `blocked` is the self-block trigger (human action required, see Step 10); `waiting_on` is the dep-chain gate (other in-flight work, see Step 10b). The v10 schema has no `blocked.by[]` field — only `waiting_on.by[]` is the dep-gate primitive.
   - **Skip this stamping ONLY when phases are genuinely independent** (different domains, no shared state, can ship in any order). Default is sequential — explain in a comment on the epic if you skip.
6. Restart this workflow at Step 1 using the first phase card's YAML.

The epic stays at `status: In Progress` until ALL phase cards are Done — then the final phase agent (or you, if no more phases) flips the epic to `Done` and saves it. After a phase completes, the next phase card lives in `<repo>/.danxbot/issues/open/`. The poller picks it up on the next tick.

---

## Step 4 — Implement (TDD)

1. **Write failing test** capturing the expected behavior.
2. **Run tests** — confirm new test fails (test command from `.claude/rules/danx-repo-config.md`).
3. **Implement** — minimum code to pass.
4. **Run tests** — all green.
5. **Refactor** — clean up; re-run.
6. **Type check** — command from `.claude/rules/danx-repo-config.md` (skip if empty).

**Documentation-only changes:** skip TDD; note this in a comment appended to `comments[]`.

For large repetitive edits, dispatch a `batch-editor` subagent via `Agent` / `Task`.

After implementation, edit the YAML to record progress (e.g. update `comments[]` with a build / test summary). The watcher mirrors the change automatically.

---

## Step 5 — Quality Gates

Launch in parallel via `Agent` / `Task` with `mode: "bypassPermissions"`:
- `test-reviewer` — audit coverage.
- `code-reviewer` — review quality.

Append each result as a new comment to `comments[]`. For each: set `author` to `"test-reviewer"` / `"code-reviewer"`, `timestamp` to the current ISO time, `text` to a multi-line markdown body starting with `## Test Review` or `## Code Review` followed by the subagent output. No `id` field.

If critical issues found, fix them, re-run the failed gate, append a `## Review Fixes` comment summarizing the fixes.

The watcher mirrors every YAML edit automatically — there is no save verb to call.

---

## Step 6 — Check Off Acceptance Criteria

For each `ac[i]`, verify it holds (test evidence, command output, direct code read). Set `ac[i].checked: true` only with direct evidence.

**Never check off an unverified item.** "By construction" / "obviously correct" are not evidence. State must reflect a passing test, captured command output, or a quoted line from code that demonstrably satisfies the criterion.

If you cannot verify an item — repo this worker cannot commit to, depends on external state you cannot reach — leave `checked: false`. Do NOT check it off with an excuse. Do NOT paraphrase it as "done in spirit."

**"Requires deploy" is NOT a valid reason to leave an AC unchecked.** Every AC is verifiable locally. `make test`, `make test-system`, integration tests, manual local smoke against `http://localhost:5566` — all run on this host. Production deploy is operations, NOT a verification gate. If an AC literally says "verify in production," rewrite it to "verify locally via `<command>`" and check it once that passes — `make deploy` ships code already accepted as Done.

---

## Step 7 — Commit

Two paths — pick the one that matches THIS dispatch.

**`retro.commits[]` scope — owned-repo ONLY (DX-559 gate).** Only shas reachable from THIS card's repo's `origin/main` belong in `retro.commits[]`. If your dispatch edited a sibling repo (plugin source under `~/web/claude-plugins/`, another connected repo, any path outside this card's worktree), that work does NOT go in `retro.commits[]`. Instead, append a `comments[]` entry naming the external repo + sha(s) + what shipped. Example:

```
## Plugin work

Edited `~/web/claude-plugins/danxbot/skills/<skill>/SKILL.md`. Published `danxbot v0.3.10`.

Commits (claude-plugins repo):
- `67eefe9` — skill body rewrite
- `1e0a570` — version bump + publish
```

Putting cross-repo shas in `retro.commits[]` makes the DX-559 gate Block your `danxbot_complete({status: "complete"})` call — the gate verifies every sha against this repo's `origin/main` and treats unresolvable shas as missing.

### Step 7a — Multi-worker agent dispatch (persona block present)

If your dispatch prompt's first paragraph reads `You are <name>.` followed by a `Your worktree:` line and a `Your branch:` line, you are running as a multi-worker agent (Alice / Bob / etc.) inside a persistent git worktree. Use the `agent-finalize.sh` helper — do NOT hand-roll the rebase + squash + push.

1. **Compose the title verbatim from the card title.** Drop the `<Epic Title> > Phase N: ` prefix when present — keep just the leaf phase description. Example: `"Multi-Worker > Phase 4: Persona injection + agent-finalize.sh + Conventional Commits squash-merge flow"` → `"Persona injection + agent-finalize.sh + Conventional Commits squash-merge flow"`.
2. **Compose 1–5 bullets summarizing what changed.** Verbs in past tense — `added`, `fixed`, `refactored`, `wired`. Each bullet is a separate command-line argument, properly quoted.
3. **Run from inside your worktree** (the `Your worktree:` path from the persona block):

   ```bash
   cd <Your worktree path>
   bash .danxbot/scripts/agent-finalize.sh <YOUR-NAME> <CARD-ID> "<title>" "<bullet 1>" "<bullet 2>" ...
   ```

   The script: WIP-commits any uncommitted changes, fetches + rebases onto `origin/main`, squashes the agent branch into ONE Conventional Commits commit (`feat(<CARD-ID>): <title>` + bullet body), pushes `HEAD:main` (with rebase-loop on push race up to 5 retries), then resets the agent branch back to `origin/main` for the next dispatch.

4. **Read the exit code:**
   - **Exit 0** — success. The script's stdout contains `PUSHED <sha>`. Capture that sha; append it to `retro.commits[]` in Step 9. Proceed.
   - **Exit 1** — rebase conflict. **This is EXPECTED, not a blocker.** The conflict-check at pick time is permissive on purpose; concurrent agents finalizing back-to-back will collide here regularly, and whoever pushes second owns the merge. **You are responsible for resolving every conflict cleanly, in this dispatch.** Procedure:

     a. Read the script's stderr — it lists every conflicting path.
     b. For each path, open it, read BOTH sides of every `<<<<<<<` / `=======` / `>>>>>>>` marker, and produce a merged result that **keeps all valid code from both sides**. Do not delete the other agent's work to make the conflict go away. Do not pick one side wholesale unless the two edits are semantically identical. The goal is a working tree that contains the intended behavior of *both* cards.
     c. Re-read the file after editing to confirm no markers remain. Run `grep -n "<<<<<<< \|======= \|>>>>>>> " <path>` per path — must return zero matches.
     d. `git add` every resolved path. Run `git rebase --continue`. If git stops on a further commit, repeat (a)–(c) until the rebase completes.
     e. **Run the test suite.** As the rebaser you now own every test the merge could have broken — not just tests for *your* card. From the worktree: `npx vitest run > /tmp/vitest.log 2>&1 ; echo EXIT=$?` and `npx tsc --noEmit`. Any failure caused by your resolution OR by the interaction between the two cards' code paths is YOURS to fix. A failure already present on `origin/main` before your work is a pre-existing condition (rare — `origin/main` should be green) — confirm with `git stash && npx vitest run <failing-file>` only if you have strong evidence the failure is unrelated; otherwise assume the rebase caused it and fix it.
     f. Once tests + typecheck are green, re-invoke `agent-finalize.sh` with the same args. The script will rebase (now a no-op), squash, and push.

     Only escalate to Blocked when the conflict is genuinely outside the scope of either card — e.g. the conflicting file has been deleted on `origin/main` by a third party with no clear "what does this card want" answer. In that rare case, document the path, both diffs verbatim, and the specific decision you cannot make in a `## Operator action required` comment, then follow Step 10 (Blocked). "Conflict was hard" / "I don't know which side wins" / "tests broke" are NOT valid escalations — read both diffs, decide, fix the tests.
   - **Exit 2** — push race exhausted (`PUSH_RACE_EXHAUSTED` on stderr). Five consecutive non-fast-forward push rejections — the remote has another writer pushing faster than you can rebase. Append a comment to the card explaining (script output verbatim), then call `danxbot_complete({status: "failed", summary: "Push race exhausted; operator must finalize."})` and exit. Do NOT loop manually.
   - **Exit 64** — usage error. Either the args were malformed (missing `<title>` / `<bullets>`), `<CARD-ID>` doesn't match `<PREFIX>-N`, or `<title>` contains a newline. The script's stderr names the specific cause. Fix the invocation (single-line title, valid card id) and re-run. Do NOT `git rebase --continue` — that's a different failure.
   - **Exit 65** — wrong branch. The worktree HEAD is not on `<YOUR-NAME>`. Investigate (`git status`, `git branch --show-current`) — the worktree may be wedged. If you can switch back to your branch cleanly (`git checkout <YOUR-NAME>`), re-run the script. If you cannot, document the wedge in a `## Operator action required` comment and follow Step 10 (Blocked).

5. **No-op safety net.** If the script's stdout is `NO_OP` (and stderr contains `no commits ahead of origin/main`) you ran finalize without making any code changes — your dispatch was docs-only, or you forgot to actually edit code. Decide which: docs-only → still Done, leave `retro.commits[]` empty; missing edits → fix them in this dispatch, then re-run finalize. Do NOT push the literal token `NO_OP` into `retro.commits[]`.

### Step 7b — Single-workspace dispatch (no persona block)

If your dispatch prompt has no `You are <name>.` first paragraph, you are running in the single-workspace mode (`<repo>/.danxbot/workspaces/issue-worker/`). Consult `Git Mode` in `.claude/rules/danx-repo-config.md`:

- `auto-merge`: feature branch `danxbot/<kebab-case-title>`, stage + commit, push, merge to main, delete branch.
- `pr`: feature branch, stage + commit, push, `gh pr create`.

Append commit shas to `retro.commits[]`.

---

## Step 8 — Definition-of-Done Gate (CRITICAL)

Before deciding Done vs Blocked, **inspect the actual state of every AC item in the YAML.**

Mechanical procedure:

1. Re-read `<repo>/.danxbot/issues/open/<id>.yml`.
2. Count `ac` entries where `checked === false`.
3. **Zero unchecked** → Step 9 (Done).
4. **One or more unchecked** → run the **Step 1.5 fix-it-yourself check**
   FIRST. Can you fix the underlying defect in this dispatch? YES → fix it,
   re-verify, re-check the AC, then re-run this gate. Only after exhausting
   in-session fixes do you proceed to Step 10. Do NOT move to Done. Do NOT
   rationalize.

Forbidden moves:
- "I'll file a hotfix card / follow-up card and move to Blocked" — if
  the hotfix is what unblocks THIS card's AC, the hotfix IS this card's
  work. Do it now (Step 1.5).
- "The verification revealed defects, so this is a verdict-handoff card" —
  no. A verification card whose verification fails because of small
  in-scope bugs is a card to FIX those bugs, then verify.
- "All the important ACs are done, the rest are minor" — irrelevant. ACs aren't ranked.
- "Remaining ACs require external work, so they don't count" — they count.
  They were defined as required. Step 1.5 → can you do the "external" work
  yourself? If yes, do it. Only escalate when truly external.
- "I'll move to Done; the retro will explain the gaps" — no. The card location is the canonical state.
- "Wording is too strict" — edit the AC item with justification, or fix the
  underlying issue. Filing a separate card to dodge the AC is forbidden.
- "I checked off the AC because the verification ran, even though it failed" — `checked: true` means the criterion HOLDS, not that it was attempted.

A card in Done means: every AC item is `checked: true` with direct evidence. No other definition.

---

## Step 9 — Move to Done

The agent does NOT write `status: Done`. The worker stamps `completed_at = <now ISO>` (and clears `dispatch: null`) on `danxbot_complete({status: "complete"})` via `stampIssueCompleted`; `deriveStatus` rule 2 then projects the card to `Done`. Direct `status:` literal writes are FORBIDDEN — see CLAUDE.md "Forbidden Patterns".

Edit YAML:

1. **Bug cards:** prepend a Bug Diagnosis section to `description` OR append a comment:
   ```
   ## Bug Diagnosis
   **Problem:** ...
   **Root Cause:** ...
   **Solution:** ...
   ```
2. Fill `retro.good`, `retro.bad`, `retro.action_item_ids[]`, `retro.commits[]`. The worker renders the `## Retro` comment automatically when the post-completion auto-sync runs (see Step 11). Do NOT append a `## Retro` comment to `comments[]` yourself. **Action items are a LAST RESORT** — re-apply the Step 1.5 filter to every candidate. If it's required for THIS card's ACs (already done, since you're at Done) it's not an action item. If it's small + you could do it now, do it now and re-commit instead of filing. Only large, separate, scoped follow-ups belong here. Create the action item card first via `danx_issue_create({type, title, description, ac, ...})`, then push its returned `<PREFIX>-N` here. Empty `action_item_ids[]` is the right answer most of the time.

Edit the YAML with `Edit` / `Write` (only retro fields + bug-diagnosis content — no status write). The watcher mirrors the change to the DB. On the `danxbot_complete` call in Step 11, the worker stamps `completed_at`, renders the `## Retro` comment, spawns Action Items cards, moves the file `open/` → `closed/`, and pushes the tracker move.

Skip to Step 11.

---

## Step 10 — Move to Blocked (HUMAN INTERVENTION ONLY)

**MANDATORY:** Before stamping `blocked: {at, reason}` (which derives the
card's status to `Blocked` via `deriveStatus` rule 3), appending a
`## Blocked` comment, OR calling `danxbot_complete({status: "failed", ...})`
with operator-must-X framing — INVOKE the `issue-blocker` skill via the
Skill tool. The 8-item gating checklist there has authority over this
section. If any item fails you are NOT authorized to mark Blocked; return
to in-session work. Failing to invoke the skill before a Blocked move is
a rule violation. Direct `status: "Blocked"` writes are FORBIDDEN — stamp
the trigger only, the read path derives the status.

Blocked is a **LAST RESORT** AND is reserved EXCLUSIVELY for cards that
cannot proceed without a human acting. If the card is just waiting on
other in-flight work — that's **Waiting On** (Step 10b), not Blocked.

Use Step 10 ONLY when the blocker is genuinely one of:

- **Credentials / secrets** a human must rotate / push to SSM.
  - **NOT a Blocker:** "needs deploy" / "needs prod smoke" / "needs Layer 3 system test". Layer 3 (`make test-system`) runs locally on this host — you can run it yourself. Production deploy ships code already accepted as Done; it is NEVER a completion gate. A card whose only remaining ACs are "deploy + smoke prod" is **already Done** — rewrite the ACs to local-verify form, run them, mark Done.
  - **NOT a Blocker:** pre-existing flaky / failing test in an unrelated file. File an Action Item card via `danx_issue_create`, push the id into `retro.action_item_ids[]`, check the AC off (your card's tests pass), proceed. See `.claude/rules/danx-no-false-blockers.md` Pattern 1.
  - **NOT a Blocker:** AC says "manual UI smoke" / "operator clicks X." The agent has the dashboard token at `~/.config/danxbot/dashboard-token` (host mode) + the playwright MCP + the dashboard component-test runner. Verify programmatically (component test → playwright → rewrite AC), check off, proceed. See `.claude/rules/danx-no-false-blockers.md` Pattern 2.
  - **NOT a Blocker:** AC verifies behavior that fires AFTER `danxbot_complete` (epic auto-flip, post-completion auto-sync, watcher mirror, any self-derived state). Rewrite the AC to point at the unit test for the derivation function, run it, check off. See `.claude/rules/danx-no-false-blockers.md` Pattern 3.
- **External repo / file your worker has no write access to** AND no other
  agent is going to fix it for you.
- **Genuine human design decision** (ambiguous spec, missing requirement,
  conflicting stakeholder direction). Specifically: the answer changes the
  goal of the card or its implementation plan in a way ONLY the human can
  decide.
- **Architectural ambiguity** — multiple valid implementations with
  different long-term tradeoffs that need a human call.
- **Card cannot be completed as described** without making an important
  change to the goal or the implementation plan — escalate to a human.
- **Card-specific tool / environment failure** (use `critical_failure` for
  environment-wide failure — see `.claude/rules/danx-halt-flag.md`).

**NOT Step 10 cases — these are Step 10b (Waiting On) or in-session work:**

- Waiting on another card / phase / Action Item to ship first → **Waiting
  On (Step 10b)**, not Blocked. No human action needed; the poller auto-
  unblocks when blockers are Done.
- Stale config in a file you can edit → fix in-session.
- Bug in a function you can read + edit (in any bind-mounted repo) → fix
  in-session.
- Test failure pointing at a defect in the same workspace / repo → fix
  in-session.
- Missing file you can write → fix in-session.
- Anything where the next agent would just open the same files you have
  open and make the same edits you could make now → fix in-session.

If you're about to move to Blocked, ask one more time: **"Does a human
*action* unblock this, or am I just waiting on other work?"** If waiting
on other work, use Step 10b. If you'd just do it yourself in 10–30
minutes, cancel the Blocked move and do it.

Edit YAML:

1. Stamp `blocked: {at: "<current ISO>", reason: "<one sentence>"}`. The derived status becomes `Blocked` via rule 3; the worker auto-applies the Blocked label. Do NOT also write `status: "Blocked"` — that field is derived.
2. Append a Blocked comment to `comments[]`. Logical shape:
   - `author: "danxbot"`
   - `timestamp: <current ISO>`
   - `text:` a multi-line markdown body with these sections:
     - `## Blocked — <one-line summary>`
     - `**What's done:** <bullet list of what landed, with commit shas>`
     - `**What's still needed:** <numbered list — file paths, repo names, exact edits, verification commands>`
     - `**Why this needs human/host help:** <one paragraph>`
     - `**Incomplete ACs:** <bullet list of every unchecked AC item, verbatim>`
     - `**Final AC check:** Before Done, every AC must be checked: true.`
   - No `id` field
3. **Bug cards** with partial progress: also append the `## Bug Diagnosis` block.
4. Fill `retro.{good, bad, action_item_ids, commits}` honestly — the AC gap is the primary "what went wrong." The worker auto-renders the `## Retro` comment when the next pickup eventually moves the card to Done or Cancelled (Blocked is a non-terminal status, so the rendering happens on the eventual terminal save, not now). Filling `retro` now still helps: the next agent inherits it through the YAML. **Re-apply the Step 1.5 filter to every action item candidate.** The fix the next agent will need to make → describe in the Blocked comment, not as an action item card. Only large, unrelated, separately-scopeable follow-ups belong here. Create any action item card first via `danx_issue_create({type, title, description, ac, ...})`, then push its returned `<PREFIX>-N` here. Empty `action_item_ids[]` is the right answer most of the time.

Edit the YAML with `Edit` / `Write`; the watcher mirrors the change.

Skip to Step 11.

---

## Step 10b — Move to Waiting On (waiting on other in-flight work)

Use Step 10b when the card cannot proceed because it is waiting on **other
work that is in flight or about to be in flight**, with NO human action
required. The poller will automatically unblock and dispatch the card once
every blocker reaches Done / Cancelled — you do not need to come back and
toggle anything.

Trigger conditions:

- The fix needs another card / phase to ship first (data model change,
  shared abstraction, dependency upgrade).
- An Action Items card describes prerequisite work this card depends on.
- A sibling phase under the same epic must finish before this phase makes
  sense.

If the only thing blocking the card is human action → use Step 10 (Blocked) instead.

### Procedure

1. **Find the blocking card(s).** Search, in order, until you have at
   least one concrete `<PREFIX>-N` id describing the unblock work:
   1. **Phase siblings via the parent epic.** If this card has
      `parent_id`, read that epic's `children[]` and check each phase
      YAML at `<repo>/.danxbot/issues/open/<child-id>.yml`. The blocker
      is usually a phase that ships first.
   2. **Open issues by topic.** `Grep` and `Read` across
      `<repo>/.danxbot/issues/open/*.yml` for cards covering the
      prerequisite work — ToDo, In Progress, Blocked, or Action Items
      all qualify (the poller imports all of them on every tick).
   3. **In Progress queue.** Cards already being worked on may be the
      blocker.
2. **No existing card describes the unblock work?** You MUST create one.
   Build a draft YAML at `<repo>/.danxbot/issues/open/<slug>.yml`
   describing exactly what needs to happen to unblock, then call
   `danx_issue_create({filename: "<slug>"})`. Pick the right status:
   - Work an autonomous agent can do → `status: "ToDo"`. The poller
     dispatches it like any other ToDo card.
   - Work that needs a human → stamp `blocked: {at: "<current ISO>", reason: "<one sentence>"}` on the draft (derived status `Blocked` via rule 3). Include all evidence the human needs to act.
   Capture the new card's returned `id`.
3. **Edit this card's YAML:**
   - Set `waiting_on` to:
     ```yaml
     waiting_on:
       reason: "<one-sentence explanation — what needs to happen first>"
       timestamp: "<current ISO 8601>"
       by:
         - <PREFIX>-N of each IMMEDIATE blocker
     ```
   - **`by[]` is the IMMEDIATE blocker(s) only.** If card A is waiting
     on B and B is waiting on C, A's `by[]` is `["B"]` — NOT `["B", "C"]`.
     The chain A → B → C is computed automatically by the poller +
     dashboard from each card's direct blocker; restating upstream
     blockers is redundant data that drifts the moment the chain is
     reorganized. Same rule for phase chains (Phase 3 → Phase 2 only,
     never `["Phase 2", "Phase 1"]`).
   - Do NOT change `status`. Leave it as is. `waiting_on` is independent
     of `status` — setting `Blocked` here would be wrong (Blocked is
     human-action-only). The picker uses `waiting_on` alone as the
     dispatch gate.
   - Append a comment to `comments[]` summarizing what you did, what
     blocker(s) you found / created, and what state to expect once the
     blockers ship. No `id` field.
4. Fill `retro.{good, bad, action_item_ids, commits}` honestly — the gap
   between what shipped and what was needed is "what went wrong." Same
   action-items rule as Step 10: only large, separately-scopeable
   follow-ups belong here. Create any action item card first via
   `danx_issue_create({type, title, description, ac, ...})`, then push
   its returned `<PREFIX>-N` to `action_item_ids[]`. Small in-scope work
   belongs in this dispatch or in the blocker card itself, not as a retro
   action item.

### Save and exit

Edit the YAML with `Edit` / `Write`. The watcher mirrors the change to
the DB; the post-completion auto-sync (when `danxbot_complete` fires)
applies the Waiting On label via the tracker, and returns. The picker
skips dispatching this card while any blocker is non-terminal. When
every blocker reaches Done / Cancelled, the picker dispatches the card
on the same tick — the `waiting_on` record itself stays on the card as
a durable dep history note.

Skip to Step 11.

---

## Step 11 — Signal Completion (MANDATORY + GATED)

`danxbot_complete` is the agent's terminal signal. The worker treats
it as proof that the full pipeline ran. **Do not call it until every
prerequisite below holds.** Calling it with prereqs unmet is a
**workflow violation** — the worker writes the dispatch row as
completed, the file moves `open/` → `closed/`, and the work appears
shipped without ever landing on main. DX-203 + DX-210 burned the
budget that way.

### Pre-call gate (mechanical, every status: complete)

| # | Prereq | How to verify |
|---|---|---|
| 1 | All ACs evidence-verified (`ac[i].checked: true` w/ real evidence) | Step 6 + Step 8 |
| 2 | Test-reviewer + code-reviewer findings addressed | Step 5 — `## Code Review` / `## Test Review` / `## Review Fixes` comments appended |
| 3 | Commit landed on `origin/main` | Step 7a: `agent-finalize.sh` exit 0 + `PUSHED <sha>` on stdout. Step 7b: `git log origin/main --grep=<CARD-ID>` returns the commit. |
| 4 | `retro.commits[]` populated with the verified sha(s) | Step 9 |
| 5 | `retro.good` + `retro.bad` non-empty | Step 9 |
| 6 | Terminal trigger set (`completed_at` / `cancelled_at` / `blocked.at`) — worker stamps `completed_at`/`cancelled_at` on `danxbot_complete`; agent stamps `blocked.at` directly for self-blocks | Step 9 (worker stamps `completed_at`) / Step 10 (agent stamps `blocked.at`) |

Any prereq missing → loop back to that step. Do not call
`danxbot_complete` until all six hold.

### Completion contract — `completed` means EVERYTHING on the card is done (DX-654)

`danxbot_complete({status: "complete"})` is a per-CARD signal, not a
per-dispatch one. Two hard preconditions, both required, every time:

1. **Every `ac[i].checked` is `true`** with direct evidence (Step 6 +
   Step 8). Unchecked AC = unfinished work; no "the rest are minor"
   or "remainder lands in a follow-up" exemption.
2. **Every child in `children[]`** (when non-empty) is in a terminal
   status (`Done` / `Cancelled`). A phase parent whose children are
   still ToDo / In Progress / Blocked / Waiting On is NOT complete —
   rollup happens via `deriveStatus`, never via direct write.

If either fails, three options:

- Finish the residue in-session (apply Step 1.5 fix-it-yourself filter
  — default).
- Split into a fresh sibling card for genuinely separate scope; narrow
  this card's AC set; document the split in `comments[]`.
- Route to Blocked (Step 10) / Waiting On (Step 10b) when a real human
  action or external dependency gates the remainder.

**`danxbot_complete({status: "complete"})` on a `type: Epic` candidate
is FORBIDDEN.** Epic terminal state derives from child rollup, never a
direct write. A planning dispatch whose candidate IS the epic (split-
into-phases pattern) calls `danxbot_complete({status: "complete"})`
ONLY when every phase child is already terminal — rare; planning
dispatches typically split-and-handoff. The worker's write-side guard
in `src/issue/stamp-terminal.ts` refuses to stamp `completed_at` /
`cancelled_at` on an Epic YAML and surfaces a
`stamp-terminal-epic-refused` system error. The dispatch row still
finalizes; only the YAML mutation is suppressed. The contract above is
the rule you uphold — the guard is defense in depth.

### Sha-less completion rejected

`danxbot_complete({status: "complete", summary: "<no commit sha>"})`
is rejected as a workflow violation: there is no path to "completed
without a commit" except for documentation-only changes (note this
explicitly in `summary`) or terminal-status `Blocked` / `failed` /
`critical_failure`. Sha format: `feat(<CARD-ID>): <title> @ <sha>`.

### Per-status work-agent table (DX-737 / DX-738 — 6-status lifecycle surface)

| `danxbot_complete({status, …})` | YAML side-effect | Derived status | When to use |
|---|---|---|---|
| `complete` | worker stamps `completed_at` + clears `dispatch` | `Done` | Work shipped on `origin/main`; every AC checked; retro filled. |
| `failed` | worker stamps `blocked: {at, reason: summary}` (summary ≥ 30 chars; shorter → silent cancel + strike) | gated `Blocked` dispatch (raw status unchanged) | Card cannot proceed without a human acting (ambiguous spec, missing credentials, external blocker). Load `danxbot:issue-blocker` skill first — its 8-item gate has authority. |
| `cancelled` | worker stamps `cancelled_at` + clears `dispatch` | `Cancelled` | Card abandoned — work won't ship. Use sparingly; prefer `failed` when the card might still be picked up by a human. |
| `critical_failure` | writes per-repo `CRITICAL_FAILURE` flag (halts poller) | unchanged | Environment is broken (MCP not loading, Bash unavailable, Claude auth missing). See `.claude/rules/danx-halt-flag.md`. |

**Other statuses are NOT for work-agent dispatches.** `ready` / `archive` / `review` exist on the MCP enum for the flesh-out + triage agents — calling them from a `/danx-next` work dispatch is a workflow violation (they reset lifecycle triggers and the card returns to a pre-work state).

**Deprecated aliases (one release cycle, then removed):**

- `completed` → `complete` (renamed for consistency with the rest of the 6-status vocabulary).
- `agent_blocked` → `failed` (DX-722 self-block redesign).

The MCP dispatcher canonicalises both before the worker stamp routes — old skill bodies / cached sessions still complete cleanly, but every NEW caller MUST use the canonical name. The worker logs a stderr deprecation warning on every alias call so the migration signal surfaces.

### Allowed final states

- `status: "complete"` — card finished; worker stamps `completed_at`,
  renders `## Retro`, moves file `open/` → `closed/`. `summary` MUST
  contain the commit sha (or `"docs-only — no commit"` if explicitly
  documentation-only). The deprecated `completed` alias still routes
  here.
- `status: "failed"` — card cannot proceed without a human acting;
  worker stamps `blocked: {at, reason: summary}`. `summary` MUST be
  ≥ 30 chars (shorter → silent downgrade to a `cancelled` stamp +
  agent strike). The deprecated `agent_blocked` alias still routes
  here.
- `status: "cancelled"` — card abandoned; worker stamps
  `cancelled_at`. `summary` describes the abandonment reason.
- `status: "critical_failure"` — environment-level blocker (see
  `.claude/rules/danx-halt-flag.md`). `summary` describes the env
  issue for the operator. No YAML stamp; the poller halts via the
  per-repo `CRITICAL_FAILURE` flag.

### What the worker does on signal

1. Auto-syncs the YAML one final time (safety net).
2. Finalizes the dispatch row.
3. Renders the `## Retro` comment from `retro.{good, bad,
   action_item_ids, commits}`.
4. Spawns Action Items cards from `retro.action_item_ids[]`.
5. Moves the file `open/` → `closed/` (Done / Cancelled).
6. Pushes the tracker move.
7. SIGTERMs claude.
8. Resumes polling.

Never exit without `danxbot_complete`. Never call it with prereqs
unmet.

### Terminal token — emit NO text after the call

`danxbot_complete` IS the report. The `summary` arg + `retro.{good,
bad, commits, action_item_ids}` in the YAML are what the operator,
the dashboard, and the next dispatch will read. The conversation
stream is **not** read by anyone after the tool returns — the worker
SIGTERMs claude within 5s, and any tokens streamed during that
grace window are discarded.

**Forbidden after `danxbot_complete`:**
- convey-format end-of-turn report (`## <headline>`, behavior diff
  table, verify line)
- `pipe-finish` mode A post-commit summary
- `pipe-finish` mode B final-session wrap (mode B is for human-loop
  sessions only — dispatched workers MUST skip it)
- any text response at all

The `base:convey` self-trigger gate has an explicit carve-out for
this — see the "Hard carve-out — terminal MCP calls" section in
that skill. If you reach for a report reflex after the tool result,
that is the rule the carve-out exists to block.

---

## If the YAML Says Empty / Wrong State

If the dispatched YAML is missing or unparseable, signal `critical_failure` — the poller is broken. If the YAML's `status` is already `Done` or `Cancelled` (file should be in `closed/`), something is wrong upstream — signal `failed` with a summary explaining the inconsistency.
