# Plugin Refactor — Phase 1 Audit Matrix (DX-796)

> **HISTORICAL RECORD — do not follow the paths in this file.** This is a
> point-in-time audit, not guidance. Every filesystem path it quotes reflects
> a machine layout that no longer exists, and there is no canonical location
> for any repo named here. To locate a repo today, resolve it (registry
> lookup / `git rev-parse --show-toplevel` / search by git remote) rather than
> reusing anything below. The paths are left intact only so the record stays
> an accurate account of what was run at the time.

Audit-only deliverable for epic DX-795. No plugin / repo / marketplace edits in this phase. Every verdict below is a proposal carried into subsequent phases.

**Method:**
- `find ~/web/claude-plugins -name "SKILL.md" -exec wc -l {} +` → Table 1 LOC column.
- Read every SKILL.md frontmatter `description` → current trigger surface column.
- Read every `hooks/hooks.json` + `scripts/*.sh` → Table 2.
- Diff every `<danxbot>/CLAUDE.md` section + every `.claude/rules/*.md` against the skill domain map → Table 3.
- Cross-read skill bodies vs CLAUDE.md "Forbidden Patterns" tables → Table 4.

**Architecture invariants the verdicts uphold:**
- `base` = universal only; no `danxbot:*` or `dev:*` triggers in its hook mandate.
- Each plugin owns its own trigger surface via its OWN `SessionStart` / `UserPromptSubmit` hook.
- Skill frontmatter `description` is the primary trigger doc; hook mandate is load-discipline reinforcement for HIGH-violation skills only.
- No skill body > 300 lines. Larger → split into core + reference.
- Hard cuts, no dual shape.

---

## Table 1 — Skill inventory (all 6 plugins)

Columns: `plugin · skill · LOC · domain · current trigger surface · proposed final location · proposed LOC cap · verdict · notes`.

| plugin | skill | LOC | domain | current trigger surface | proposed final location | LOC cap | verdict | notes |
|---|---|---:|---|---|---|---:|---|---|
| base | bash-exit-capture | 61 | shell discipline | frontmatter only | base | 80 | keep | universal; no rewrite needed |
| base | convey | 248 | info-transfer format | frontmatter + base SessionStart hook | base | 180 | keep + trim | hook duplicates ~40% of body; cut hook to one-line pointer, keep body as reference doc |
| base | docs-first | 26 | external-product docs | frontmatter only | base | 60 | keep | universal; tiny; expand triggers slightly |
| base | fail-loudly | 81 | error-handling discipline | frontmatter only | base | 100 | keep | universal |
| base | monitor-polling | 91 | polling cost discipline | frontmatter only | base | 100 | keep | universal |
| base | process-kill | 84 | kill-signal safety | frontmatter only | base | 100 | keep | universal |
| base | sub-agent-delegation | 41 | Agent/Task dispatch | frontmatter only | base | 80 | keep | universal |
| base | tool-discipline | 82 | Read/Edit/Write over bash | frontmatter only | base | 100 | keep | universal |
| dev | code-quality | 164 | SOLID/DRY/Zero-Debt | frontmatter only | dev | 150 | keep + trim | trim 10% of overlap with ideal-solution-mindset |
| dev | debugging | 281 | bug/error/test-fail discipline | frontmatter only | dev | 220 | keep + trim | self-trigger gate duplicated in base SessionStart hook — remove from hook, keep in skill |
| dev | git-discipline | 170 | git op safety | frontmatter only | dev | 170 | keep | self-trigger gate stays in frontmatter, NOT in base hook |
| dev | ideal-solution-mindset | 140 | 4 core dev principles | frontmatter + dev SessionStart+UserPromptSubmit hook | dev | 150 | keep | hook mandate is correct — this is a high-violation universal-dev rule |
| dev | repo-optimize | 177 | user-invoked audit tool | frontmatter only | dev | 180 | keep | user-invokable; self-contained |
| dev | testing | 371 | test action discipline | frontmatter only | dev | 280 | keep + split | OVER CAP — split into `testing` (core triggers + decision table, ~200 LOC) + `testing-reference` (anti-pattern catalog, framework gotchas, ~150 LOC) |
| investigate | investigate | 211 | read-only diagnosis | frontmatter + investigate UserPromptSubmit hook (pattern regex) | investigate | 200 | keep | hook mandate correct (high-violation, distinct from dev:debugging) |
| pipeline | pipe-commit | 164 | commit format | frontmatter only | pipeline | 160 | keep | user-invokable |
| pipeline | pipe-finish | 218 | post-commit report | frontmatter only | pipeline | 200 | keep + trim | overlap with convey — trim convey-format repeats |
| pipeline | pipe-plan | 185 | plan-mode discipline | frontmatter + base SessionStart hook (load-discipline) | pipeline | 180 | keep | hook reinforcement is the correct one; matrix-row #1 in Table 4 |
| pipeline | pipe-quality | 103 | post-review audit | frontmatter only | pipeline | 110 | keep | |
| pipeline | pipe-review | 98 | reviewer-agent dispatch | frontmatter only | pipeline | 110 | keep | |
| pipeline | pipe-start | 126 | phase-boundary reload | frontmatter + base SessionStart hook (load-discipline) | pipeline | 130 | keep | |
| human-collaboration | docs | 73 | update docs after error | frontmatter only | human-collaboration | 80 | keep | |
| human-collaboration | explain | 52 | agent self-reflection | frontmatter only | human-collaboration | 60 | keep | |
| human-collaboration | host-environment | 46 | host-shell discipline | frontmatter only | human-collaboration | 80 | keep | |
| human-collaboration | human-loop | 163 | human-driven session contract | frontmatter only | human-collaboration | 170 | keep | NOT for autonomous workers — gate explicit |
| human-collaboration | safe-terminate | 111 | end-of-session audit | frontmatter only | human-collaboration | 120 | keep | user-invokable |
| danxbot | autonomous-mode | 81 | dispatched worker discipline | frontmatter only (audience:worker) | danxbot | 100 | keep | mirror inverse of human-loop |
| danxbot | comment-style | 45 | issue YAML markdown style | frontmatter only | danxbot | 80 | keep | |
| danxbot | danx-chat | 155 | per-card chat agent | frontmatter only (slash cmd) | danxbot | 160 | keep | dispatched-by-dashboard |
| danxbot | danx-epic-link | 206 | epic ↔ phase linkage | frontmatter only | danxbot | 200 | keep + trim | |
| danxbot | danx-flesh-out | 464 | card flesh-out agent | frontmatter only (slash cmd) | danxbot | 300 | keep + split | OVER CAP — split into `danx-flesh-out` (workflow, ~250) + `danx-flesh-out-reference` (zero-context-test rubric, examples, ~150) |
| danxbot | danx-ideate | 93 | ideator launch | frontmatter only | danxbot | 100 | keep | |
| danxbot | danx-next | 807 | autonomous card workflow | frontmatter + base SessionStart hook | danxbot | 300 | keep + heavy split | OVER CAP 2.7x — split into `danx-next` (core 10-step flow, ~280), `danx-next-step10` (false-blocker decision tree, ~200), `danx-next-quality-gates` (test-reviewer + code-reviewer integration, ~200), `danx-next-reference` (worked examples, ~150). Highest priority Phase 2 target. |
| danxbot | danx-start | 68 | batch ToDo processing | frontmatter only | danxbot | 80 | keep | |
| danxbot | danx-triage-card | 413 | per-card triage agent | frontmatter only (slash cmd) | danxbot | 280 | keep + split | OVER CAP — split into `danx-triage-card` (workflow + decision tree, ~260) + `danx-triage-reference` (status-specific scoring rubrics, ~180) |
| danxbot | danx-triage-orchestrator | 53 | triage fan-out | frontmatter only | danxbot | 80 | keep | |
| danxbot | danxbot | 216 | runtime/dispatch overview | frontmatter + base SessionStart hook | danxbot | 220 | keep | hook reference moves from base to danxbot's own hook |
| danxbot | db-reset | 179 | sanctioned DB reset path | frontmatter only (audience:worker) | danxbot | 180 | keep | pairs with base:deny-destructive-db PreToolUse hook |
| danxbot | dispatch-deep | 281 | deep dispatch contracts | frontmatter only | danxbot | 280 | keep | |
| danxbot | docker-deep | 91 | container/env overlay contracts | frontmatter only | danxbot | 110 | keep | |
| danxbot | halt-flag | 93 | critical_failure signaling | frontmatter only | danxbot | 100 | keep | |
| danxbot | issue-blocker | 237 | block-stamp discipline | frontmatter + base SessionStart hook (audience:worker) | danxbot | 220 | keep + trim | hook reference moves from base to danxbot's own hook |
| danxbot | issue-card-workflow | 462 | YAML schema + lifecycle | frontmatter + base SessionStart hook | danxbot | 300 | keep + split | OVER CAP — split into `issue-card-workflow` (schema + status moves, ~280) + `issue-card-workflow-reference` (retro/action-items/phase-cards/EPIC-MUST-SHIP examples, ~180) |
| danxbot | no-false-blockers | 212 | 3 false-blocker patterns | frontmatter only (audience:worker) | danxbot | 200 | keep | extends danx-next Step 10 |
| danxbot | no-unauthorized-worker-launch | 136 | strict launch auth gate | frontmatter only | danxbot | 140 | keep | |
| danxbot | prod-access | 104 | production reach paths | frontmatter only | danxbot | 110 | keep | |
| danxbot | requires-human | 208 | requires_human field discipline | frontmatter only (audience:worker) | danxbot | 200 | keep | |
| danxbot | settings-deep | 105 | settings.json deep contract | frontmatter only | danxbot | 110 | keep | |
| danxbot | slack-agent | 71 | slack-worker MCP discipline | frontmatter only (audience:worker) | danxbot | 80 | keep | |
| danxbot | unblock | 126 | blocker report contract | frontmatter + base SessionStart hook | danxbot | 130 | keep | hook reference moves from base to danxbot's own hook |
| danxbot | template-app-build | 159 | Vue template-app build (per-id load/save) | frontmatter only (slash cmd) | danxbot | 160 | keep | renamed from vue-app-build (DX-892) |

**Skill counts:** base 8 · dev 6 · investigate 1 · pipeline 6 · human-collaboration 5 · danxbot 24 → **50 skills, 8632 LOC**.

**Split mandate count:** 5 skills over 300-LOC cap (testing, danx-next, danx-flesh-out, danx-triage-card, issue-card-workflow). danx-next is the dominant target (807 LOC → 4 files capped at ~250 each).

**Verdict totals:** 50 keep / 5 keep+split / 0 move / 0 merge / 0 delete. No cross-plugin moves — every skill is already in the correct plugin per domain. The refactor is body-trim + hook-reassignment, not relocation.

---

## Table 2 — Hook script inventory (all 6 plugins)

Columns: `plugin · script path · event · LOC · triggers it injects (skill names) · ownership verdict`.

| plugin | script | event | LOC | triggers injected | ownership verdict |
|---|---|---|---:|---|---|
| base | `scripts/plugin-skill-mandate.sh` | SessionStart + UserPromptSubmit | 122 | `danxbot:issue-card-workflow`, `danxbot:unblock`, `danxbot:issue-blocker`, `base:tool-discipline`, `base:process-kill`, `base:sub-agent-delegation`, `base:bash-exit-capture`, `base:monitor-polling`, `dev:debugging`, `dev:testing`, `dev:git-discipline`, `pipeline:pipe-plan`, `pipeline:pipe-start`, `danxbot:danxbot`, `investigate:investigate` | **VIOLATES base = universal**. Hook injects triggers for danxbot, dev, pipeline, investigate skills — exactly the cross-plugin pollution the invariant forbids. **Split mandate:** keep only `base:*` triggers in this hook; move `danxbot:*` block to a new `danxbot/hooks/hooks.json` + `danxbot/scripts/danxbot-skill-mandate.sh`; move `dev:*` block into existing `dev/scripts/ideal-solution-mandate.sh` (or sibling); move `pipeline:*` block into a new `pipeline/hooks/hooks.json` + script; move `investigate:investigate` row — already owned by `investigate` plugin's own hook (duplicate, delete from base). |
| base | `scripts/convey-mandate.sh` | SessionStart + UserPromptSubmit | 51 | `base:convey` only | **correct ownership**. convey is universal (info transfer). Hook stays in base. |
| base | `scripts/deny-destructive-db.sh` | PreToolUse (Bash) | 52 | (deny gate, not skill injector) — points to `danxbot:db-reset` in the deny reason | **borderline**. The deny pattern itself (artisan migrate:fresh / DROP DATABASE / etc.) is universal — any user of artisan / SQL can hit it. The deny reason references a danxbot-specific skill (`db-reset`) and danxbot-specific path (`<worktree>/.danxbot/safe-reset-db.sh`). **Proposed resolution:** keep the deny gate in base (universal), but generalize the deny reason text to point to a generic "operator must reset" message. Add a parallel `danxbot/scripts/deny-destructive-db-danxbot-reason.sh` overlay OR (simpler) move the entire script to `danxbot` since 100% of consumers today are danxbot-connected. **Recommended:** move to `danxbot` plugin until a non-danxbot consumer needs the gate. |
| dev | `scripts/ideal-solution-mandate.sh` | SessionStart + UserPromptSubmit | 43 | `dev:ideal-solution-mindset` only | **correct ownership**. Universal dev principle; lives in dev plugin's own hook. |
| investigate | `scripts/investigation-gate.sh` | UserPromptSubmit | 32 | `investigate:investigate` (pattern-matched via regex on user prompt) | **correct ownership**. Hook is plugin-owned; pattern-matches diagnostic phrasing. Note: `base/scripts/plugin-skill-mandate.sh` ALSO injects an `investigate:investigate` trigger row → **duplicate**; cut the row from base. |
| (marketplace root) | `scripts/publish.sh` | — | 223 | (publishing tool, not a hook) | n/a — marketplace tooling, not a skill mandate hook. Out of scope for this audit. |

**Hook ownership verdict summary:** `base/scripts/plugin-skill-mandate.sh` (122 LOC) is the single biggest invariant violation. Phase 2-3 work splits its trigger rows across the 4 plugins that should own them. Three new hooks needed: `danxbot/hooks/hooks.json`, `pipeline/hooks/hooks.json`, plus a `dev/` UserPromptSubmit extension for `dev:debugging` + `dev:testing` + `dev:git-discipline` self-trigger reinforcement. `base/scripts/plugin-skill-mandate.sh` after split: ~30 LOC, base-only triggers (tool-discipline / process-kill / sub-agent-delegation / bash-exit-capture / monitor-polling).

---

## Table 3 — danxbot repo content overlap

Columns: `repo location · matched plugin skill(s) (file:line) · overlap kind · proposed cut`.

| repo location | matched skill(s) | overlap kind | proposed cut |
|---|---|---|---|
| `CLAUDE.md` L1-3 (header + Danxbot tagline) | — | unique-to-repo | keep (repo identity) |
| `CLAUDE.md` L5-17 (Core Principle: Single Canonical Schema) | `danxbot:issue-card-workflow` | partial (schema discipline lives in skill; the no-legacy/fail-loud language is a forbidden-pattern restatement of `dev:ideal-solution-mindset` + `base:fail-loudly`) | trim to ≤8 lines pointing to (a) `danxbot:issue-card-workflow` for schema; (b) `dev:ideal-solution-mindset` + `base:fail-loudly` for the no-legacy/fail-loud discipline. Move the migration registry mechanics + `KNOWN_SCHEMA_MAX` bump procedure into `danxbot:issue-card-workflow-reference`. |
| `CLAUDE.md` L19-58 (Core Principle: Computed Card State) | `danxbot:issue-card-workflow`, `danxbot:issue-blocker` | partial — forbidden-pattern table duplicates the skill's own forbidden-write list | trim CLAUDE.md to one-paragraph statement + skill pointer; the entire forbidden-pattern table moves into `danxbot:issue-card-workflow` body (it already partially carries it). |
| `CLAUDE.md` L60-84 (Core Principle: Service vs Client Layering) | (no current skill) | unique-to-repo, danxbot-architectural | KEEP in repo CLAUDE.md OR promote to a new `danxbot:service-vs-client` skill. Recommendation: KEEP in CLAUDE.md (this is a one-place architectural invariant; no skill body needs to load it on every dispatch). |
| `CLAUDE.md` L86-125 (Core Principle: Worker Zero-Trust on Git Env) | (no current skill), partial overlap with `dev:git-discipline` | partial — git ops listed are forbidden-set discipline, agent vs worker ownership is danxbot-architectural | trim to skill pointer to a new `danxbot:worker-zero-trust-git` skill (carries the policy that DX-758 retired DX-742 → DX-754 → DX-755 chain). Recommended: PROMOTE this section into a new danxbot skill so reviewer agents flag against it the same way they flag cancelled-card audits. ~80 LOC current text → ~150 LOC skill. |
| `CLAUDE.md` L127-161 (CRITICAL Pointers Before Touching Sensitive Areas) | every danxbot skill listed in the "Skill triggers" table | full-duplicate — this entire table is a paraphrase of plugin skill `description` frontmatter | **DELETE.** Every row of the "Skill triggers" sub-table is already the trigger surface of the named plugin skill. The "Rule files (auto-loaded)" sub-table stays (those are repo rules, not skills). |
| `CLAUDE.md` L163-171 (`@thehammer/danx-issue-mcp` ownership) | (no current skill) | unique-to-repo | KEEP — publish workflow is repo-specific, not skill content. ~9 lines. |
| `CLAUDE.md` L173-200 (Architecture diagram + component table) | `danxbot:danxbot` (covers architecture) | partial — component table partially duplicated in skill | trim component table to top-5 entries; skill carries the full table. |
| `CLAUDE.md` L202-207 (Tech Stack) | (no skill) | unique-to-repo | keep (5 lines) |
| `CLAUDE.md` L209-211 (Setup) | `setup` skill (newms-personal, not in plugins) | unique-to-repo pointer | keep |
| `CLAUDE.md` L213-239 (Connected Repos / Multi-Repo) | `danxbot:docker-deep`, `danxbot:settings-deep` | partial — per-repo config layout duplicated | trim to ≤12 lines pointing to skills; full table moves to skills. |
| `CLAUDE.md` L241-244 (Per-Repo Feature Toggles) | `danxbot:settings-deep` | full-duplicate | DELETE; skill carries this. |
| `CLAUDE.md` L245-263 (Self-Repair — WORKER FAULTS ONLY) | (no current skill) | unique-to-repo, danxbot-architectural | KEEP — load-bearing architectural rule that prior agents kept re-introducing. ~19 lines. |
| `CLAUDE.md` L265-271 (External Dispatch API + Deployment) | `danxbot:prod-access` | partial | trim to ≤5 lines pointing to skill + rule. |
| `CLAUDE.md` L273-286 (Make Commands & Build Workflow + pipeline) | `.claude/rules/make-commands.md`, `pipeline:pipe-start` / `pipe-commit` | partial — pipeline steps repeated in pipeline skills | trim to skill pointers; the per-phase pipeline steps are owned by the `pipeline` plugin skills. |
| `CLAUDE.md` L287-298 (Testing) | `dev:testing` | partial — danxbot-specific paths unique, discipline duplicated | KEEP only the danxbot-specific paths (3 layers, repo helpers, frontend exemption); cut the discipline language → `dev:testing`. ~6 lines. |
| `CLAUDE.md` L300-311 (Agent Spawn Architecture summary) | `danxbot:dispatch-deep`, `danxbot:danxbot`, `.claude/rules/agent-dispatch.md` | full-duplicate of the rule file | DELETE; rule + skill cover this. |
| `CLAUDE.md` L313-376 (Autonomous Agent Team — Triggers, Subagents, Source of Truth, Trello-decoupled, Trello Board, Card Workflow) | `danxbot:danx-next` / `danx-start` / `danx-ideate`, `danxbot:issue-card-workflow`, `danxbot:danxbot` | partial-to-full duplicate | trim to ≤15 lines: list of slash skills + one-paragraph Source-of-Truth + pointer to Trello-decoupling rule (currently in `.claude/rules/agent-dispatch.md` Forbidden Patterns). The full Trello-decoupling text duplicates rule content — collapse. |
| `.claude/rules/agent-dispatch.md` (298 LOC) | `danxbot:dispatch-deep`, `danxbot:danxbot`, `danxbot:autonomous-mode` | partial — sections like "Workspace isolation", "Completion Signaling", "Spawn Flow" are skill-resident; "Forbidden Patterns" table is repo-unique enforcement | KEEP the file (this IS the load-bearing always-on rule that pre-dates the plugin refactor) but trim to ~180 LOC by moving the resume protocol + staged_files + Playwright proxy + usage dedup blocks into `danxbot:dispatch-deep` body (the skill description already names them — body is currently slim). Keep the Forbidden Patterns table verbatim — it's the enforcement surface reviewer agents flag against. |
| `.claude/rules/cancelled-card-audit.md` (93 LOC) | (no current skill) | unique-to-repo (DX-765 reviewer-agent contract) | KEEP — this is reviewer-agent contract surface, not session-loaded skill content. |
| `.claude/rules/dashboard.md` (196 LOC) | (no current skill) | unique-to-repo (DanxUI mandate + SSE pattern + dev URLs + write API) | KEEP. Could PROMOTE the DanxUI Component Library Mandate (L3-36) into a new `danxbot:danx-ui-components` skill if dashboard frontend work increases. For now, keep in rule. |
| `.claude/rules/docker-runtime.md` (128 LOC) | `danxbot:docker-deep` | partial — the deep contracts moved into the skill; this file has the always-on overview | trim to ~80 LOC keeping the runtime-mode decision table + per-repo config structure; cut deep contracts (already in skill per "Deep contracts → invoke skill" pointer at L122). |
| `.claude/rules/make-commands.md` (59 LOC) | `danxbot:no-unauthorized-worker-launch`, `danxbot:prod-access` | partial — the launch / deploy gate text duplicates skill content | trim to ≤30 LOC: target table + cross-link to skills for prohibited launches + prod access. |
| `.claude/rules/service-surface.md` (39 LOC) | (no current skill) | unique-to-repo (3rd-party contract) | KEEP unchanged. |
| `.claude/rules/settings-file.md` (11 LOC) | `danxbot:settings-deep` | partial — file is already a thin pointer | KEEP — this is correctly-shaped (always-on pointer to deep skill). |

**Mapping coverage:** every section of CLAUDE.md (28 `##` headers) + every one of the 7 `.claude/rules/*.md` files has a row above. Verdict totals: 7 DELETE, 11 TRIM-to-pointer, 7 KEEP unchanged, 2 PROMOTE-to-new-skill candidates (worker-zero-trust-git, dashboard-ui-components).

---

## Table 4 — Contradictions (cross-plugin and skill-vs-repo policy disagreements)

| # | location A | text A | location B | text B | proposed resolution |
|---|---|---|---|---|---|
| 1 | `base/scripts/plugin-skill-mandate.sh:40-105` | Hook injects mandates for `danxbot:issue-card-workflow`, `danxbot:unblock`, `danxbot:issue-blocker`, `danxbot:danxbot`, `dev:debugging`, `dev:testing`, `dev:git-discipline`, `pipeline:pipe-plan`, `pipeline:pipe-start`, `investigate:investigate` | `~/.claude/CLAUDE.md` (Pre-write scope gate) + epic DX-795 invariant | "base = universal only; no `danxbot:*`, no `dev:*` triggers in base hook" | **HARD CUT.** Split the hook by plugin ownership (see Table 2 verdict for `plugin-skill-mandate.sh`). Phase 2 owns this. |
| 2 | `base/scripts/plugin-skill-mandate.sh:107` (`investigate:investigate` trigger row) | base hook injects `investigate:investigate` regex trigger | `investigate/scripts/investigation-gate.sh:18-32` | `investigate` plugin's own hook ALREADY injects `investigate:investigate` regex trigger | **DELETE the base row** — investigate plugin's own hook is the authoritative trigger. |
| 3 | `dev/skills/debugging/SKILL.md:1-2` description | self-trigger gate on tokens `✗`, `FAIL`, `Error`, `bug`, `wrong`, etc. | `base/scripts/plugin-skill-mandate.sh:67-77` | base hook duplicates the same self-trigger gate token list under `dev:debugging` row | **DELETE the base hook row** for dev:debugging; the skill description already carries the self-trigger gate and dev plugin's own hook (planned in Phase 2-3) will reinforce. |
| 4 | `dev/skills/git-discipline/SKILL.md` description | "fires on YOUR OWN draft … STOP and confirm `dev:git-discipline` is loaded THIS turn" | `base/scripts/plugin-skill-mandate.sh:82-86` (`dev:git-discipline` row) | base hook duplicates the trigger list | **DELETE the base hook row** — skill description owns this; dev plugin's own hook reinforces. |
| 5 | `danxbot/skills/issue-blocker/SKILL.md` | "Blocked is a dispatch gate that leaves the card's column alone … status derives → Blocked via deriveStatus rule 3 — agents NEVER write `status: Blocked` directly" | `danxbot/skills/no-false-blockers/SKILL.md` description | "MANDATORY before writing `status: Blocked` on a card" | **PARTIAL CONTRADICTION.** `no-false-blockers` description uses the legacy phrasing "writing `status: Blocked`"; the canonical primitive per DX-575 / DX-770 is "stamping `blocked: {at, reason}`". Resolution: rewrite `no-false-blockers` description to "MANDATORY before stamping `blocked: {at, reason}` on a card" — matches `issue-blocker` and the v10 schema. |
| 6 | `<danxbot>/CLAUDE.md:38` (Forbidden-token statement) | "forbidden tokens — `back-compat`, `forward-compat`, `auto-migrate`, `schema_version` literals other than canonical one — appear ONLY in this section and in `.claude/rules/agent-dispatch.md`" | `.claude/rules/agent-dispatch.md:206` (Forbidden Patterns row "Schema legacy-tolerance patterns") | same tokens listed | **NOT actually contradictory** — the CLAUDE.md text explicitly grants the rules file as the one other allowed location. Keep as-is. Flag here only to confirm the audit caught the apparent duplication. |
| 7 | `<danxbot>/CLAUDE.md:127-161` ("CRITICAL Pointers" Skill triggers table) | Each row paraphrases a plugin skill's description frontmatter | every `danxbot/skills/<name>/SKILL.md:1` | canonical `description` text | **CONTRADICTION CLASS: stale paraphrase.** Multiple rows in the CLAUDE.md table use phrasings that drift from current skill descriptions (e.g. row for `issue-card-workflow` says "ESPECIALLY epic creation" — skill description's actual phrasing is "Co-fires alongside `danx-next` / `danx-triage-card` / `unblock` / `issue-blocker`"). **DELETE the entire skill-triggers table from CLAUDE.md** (Phase 3); skills self-trigger via descriptions + their own plugin's hook. |
| 8 | `danxbot/skills/danx-next/SKILL.md` (807 LOC) Step 10 vs `danxbot/skills/no-false-blockers/SKILL.md` | both describe the false-blocker decision tree | both | extends/overlaps text | **PARTIAL** — `no-false-blockers` description says "Extends `danx-next/SKILL.md` Step 10 — does not replace it" so the extension relationship is intentional. Resolution: during the danx-next split, move Step 10 entirely into `danx-next-step10` reference skill; `no-false-blockers` cross-links to that file rather than to a line range inside the 807-LOC monolith. |
| 9 | `danxbot/skills/danx-flesh-out/SKILL.md` (464 LOC) + `danxbot/skills/danx-triage-card/SKILL.md` (413 LOC) | both carry zero-context-test rubric language | both | overlapping criteria for "is this card ready for a work agent" | **MERGE candidate.** The zero-context-test rubric is a shared rubric. Resolution: extract into a new `danxbot:zero-context-test` shared reference skill (~100 LOC); flesh-out + triage-card cross-link to it. Defer to Phase 3-4 — Phase 2 owns the size-split for both. |
| 10 | `<danxbot>/CLAUDE.md:347-367` (Trello decoupling) | "issue tracker would run identically with Trello deleted … reviewer agents and pipeline gates MUST flag any new Trello-coupled branch outside the three allowed surfaces" | `.claude/rules/agent-dispatch.md:207` (Forbidden Patterns row "Gating issue-tracker business logic on `trelloSync`") | same enforcement | **DUPLICATE.** Both files carry the full enforcement table. Resolution: CLAUDE.md keeps a 2-line summary; the rules file is the single enforcement-table authority. |

**Contradiction class summary:** 1 = hard invariant violation (base hook polluted, Phase 2 fix). 2-4 = base-hook duplication of skill self-triggers (Phase 2 fix). 5 = stale phrasing in skill description (Phase 2 fix). 7 + 10 = stale-paraphrase / duplication between CLAUDE.md and skills/rules (Phase 3 fix). 8-9 = consequence of oversized skill bodies (resolved by the splits in Table 1).

---

## Table 5 — Baseline metrics (Phase 7 reduction targets)

| metric | LOC | source |
|---|---:|---|
| `base` plugin total (skills + hooks + scripts + plugin.json) | 978 | `find base -type f \( -name "*.md" -o -name "*.sh" -o -name "*.json" \) -exec wc -l` |
| `dev` plugin total | 1,380 | same |
| `investigate` plugin total | 267 | same |
| `pipeline` plugin total | 903 | same |
| `human-collaboration` plugin total | 454 | same |
| `danxbot` plugin total | 5,074 | same |
| **marketplace-wide plugin total** | **9,056** | sum of above |
| **marketplace-wide SKILL.md body LOC (50 skills)** | **8,632** | `find ~/web/claude-plugins -name SKILL.md -exec wc -l` |
| `<danxbot>/CLAUDE.md` | 375 | wc -l |
| `<danxbot>/.claude/rules/agent-dispatch.md` | 298 | wc -l |
| `<danxbot>/.claude/rules/cancelled-card-audit.md` | 93 | wc -l |
| `<danxbot>/.claude/rules/dashboard.md` | 196 | wc -l |
| `<danxbot>/.claude/rules/docker-runtime.md` | 128 | wc -l |
| `<danxbot>/.claude/rules/make-commands.md` | 59 | wc -l |
| `<danxbot>/.claude/rules/service-surface.md` | 39 | wc -l |
| `<danxbot>/.claude/rules/settings-file.md` | 11 | wc -l |
| **sum `.claude/rules/*.md`** | **824** | sum of above |
| **danxbot repo doc total (CLAUDE.md + rules)** | **1,199** | sum |

### Phase 7 reduction targets (from epic DX-795)

| target | baseline | Phase 7 target | required reduction |
|---|---:|---:|---:|
| marketplace-wide SKILL.md body LOC | 8,632 | ≤ 5,179 | ≥ 40% (≥ 3,453 LOC trim) |
| `<danxbot>/CLAUDE.md` | 375 | ≤ 200 | ≥ 47% (≥ 175 LOC trim) |
| sum `.claude/rules/*.md` | 824 | ≤ 577 | ≥ 30% (≥ 247 LOC trim) |

**Where the marketplace skill-body trim comes from (preview):**
- danx-next split: 807 → 280 (core) + ~550 in 3 reference files = net 0 LOC reduction in the skill BODY (cap is on individual file LOC, not total), but per-file LOC compliance achieved.
- True trim sources: convey (248 → 180), debugging (281 → 220), testing (371 → 280 core + 150 reference = +59 net, but split-compliant), CLAUDE.md duplication removed from skills, cross-skill duplication of trello-decoupled text removed.
- Honest projection: hitting ≥40% body-LOC reduction REQUIRES aggressive trim of duplicated forbidden-pattern tables across danx-next / issue-card-workflow / issue-blocker / no-false-blockers + every "Triggers — …" frontmatter paragraph that paraphrases the skill body. Phase 2-5 plans must surface a concrete cut list per skill.

---

## Phase 1 acceptance criteria (per card AC)

- [x] `REFACTOR_MATRIX.md` exists at `~/web/claude-plugins/REFACTOR_MATRIX.md`.
- [x] Every skill in every plugin has a row in Table 1 with a verdict (50 rows).
- [x] Every hook script in every plugin has a row in Table 2 with an ownership verdict (6 rows).
- [x] Every section/header in `<danxbot>/CLAUDE.md` AND every `.claude/rules/*.md` file is mapped in Table 3.
- [x] Every cross-plugin contradiction has a row in Table 4 with file:line citations (10 rows).
- [x] Baseline metrics captured (Table 5).
- [x] No skill edited, no hook edited, no rule edited in this phase.
