# Feature Notes — newms-plugins (claude-plugins repo)

Persistent ideator memory for the `claude-plugins` Claude Code plugin marketplace.
Scope: `repo` (this repo only). Board: `claude-plugins:claude-plugins-main` (prefix `CP`).

## What this repo is

A GitHub-distributed Claude Code **plugin marketplace** (`newms-plugins`). Six plugins,
each a directory with `.claude-plugin/plugin.json` + `skills/<name>/SKILL.md` (+ optional
`hooks/hooks.json` and `scripts/*.sh`). Consumers install via marketplace; the marketplace
loader auto-updates a plugin ONLY when its `plugin.json` `version` changes — source edits
without a bump never reach consumers. `scripts/publish.sh` automates the bump+commit+push.

Plugins: `base` (universal discipline), `investigate` (read-only diagnosis), `dev`
(code-writing discipline), `pipeline` (autonomous dev flow), `human-collaboration`
(human-in-loop), `danxbot` (orchestrator domain — 25 skills, the largest).

---

## Section 1: Feature Inventory

| Feature | Status | Notes |
|---|---|---|
| 6 plugins (base/investigate/dev/pipeline/human-collaboration/danxbot) | Complete | All skills under 300-LOC cap post DX-795 refactor (max 281). |
| `scripts/publish.sh` version-bump automation | Complete | Auto-detects changed plugin trees, bumps semver, commits per-plugin, worktree-aware push (defers to agent-finalize.sh inside agent worktrees). |
| Per-plugin hook mandate system | Complete | SessionStart/UserPromptSubmit/PreToolUse hooks; every referenced `scripts/*.sh` currently resolves. |
| Skill LOC refactor (epic DX-795/796) | Complete | Delivered; matrix + phase-7 report are now stale artifacts (see below). |
| README.md accuracy | **Incomplete** | Lists REMOVED plugins `issues` + `issue-worker` (folded into `danxbot`), OMITS `human-collaboration`. Plugin table + install matrix both wrong. Misleads install. ICE 405 (I5×C9×E9). Carded → CP-5. |
| Repo integrity validation (manifests / frontmatter / hook-refs / marketplace sources) | **Incomplete** | Nothing validates plugin.json shape+semver, SKILL.md required frontmatter, hook `scripts/*.sh` existence, marketplace `source` dirs, or LOC caps. No CI (`.github/workflows` absent). Broken plugin can ship to all consumers. ICE 336 (I7×C8×E6). Carded → CP-7 Epic / CP-8. |
| Version-bump enforcement | **Incomplete** | README declares the bump MANDATORY but nothing enforces it — a plugin tree can change with a static version and silently never reach consumers (the #1 documented failure mode). No pre-commit hook / CI gate. ICE 240 (I8×C6×E5). Carded → CP-9 (child of CP-7 Epic). |
| Stale root artifacts (`REFACTOR_MATRIX.md` 205L, `REFACTOR_PHASE7_REPORT.md`) | **Removeable** | Completed-epic deliverables, last touched 2026-06-07, cluttering repo root. ICE 243 (I3×C9×E9). Carded → CP-6. |
| `danx-ideate` SKILL card-creation guidance | **Changeable** | SKILL step-2 frames creation as flat `type:'Feature'\|'Bug'` cards with only `ac[]` — contradicts the plugin's own container doctrine (`danx-flesh-out/overview.md`, `issue-card-workflow/phases-epics.md`) and omits that `phase_children[]` is Epic-only (server 400s it on a Feature). Followed literally → bare-Feature defect or 400. ICE 384 (I6×C8×E8). Carded → CP-11. |
| Skill catalog / index | **Incomplete** | 30+ skills across 6 plugins, no single index; no authoring-invariants guide (LOC cap, mandatory bump, frontmatter, hook `${CLAUDE_PLUGIN_ROOT}` pattern, no rules/ dir). ICE 210 (I5×C7×E6). Carded → CP-12 Epic (CP-13 generator / CP-14 commit+link / CP-15 authoring guide). |
| `scripts/publish.sh` UX/safety | **Upgradeable** | No `--dry-run` preview (first happy-path action is a commit); no guard against no-op version-only bumps. ICE 196 (I4×C7×E7). Carded → CP-16 Epic (CP-17 dry-run / CP-18 no-op guard). |
| Plugin description drift (README table / marketplace.json / plugin.json) | **Upgradeable** | Three description sources diverge (danxbot marketplace desc detailed vs plugin.json short; README `pipeline` row says stale `flow-*`/"human-in-loop"). README fixes belong to CP-5; marketplace↔plugin.json single-source not yet carded (low value, adjacency to CP-8). ICE 144 (I4×C6×E6). Scratchpad only. |
| `deny-destructive-db.sh` pattern coverage (schema-builder APIs) | **Incomplete** | Header comment (L34-35) + deny REASON claim `dropAllTables/dropAllViews/dropAllTypes` schema-builder APIs are blocked, but the actual regex (L36) blocks only `migrate:fresh/refresh/reset`, `db:wipe`, `DROP DATABASE/SCHEMA`. `Schema::dropAllTables()` passes through — silent bypass of the repo's top data-loss guard. Doc/code drift. ICE 448 (I8×C8×E7). Carded → CP-19. |
| `deny-destructive-db.sh` pattern coverage (raw SQL table drops) | **Incomplete** | SEPARATE vector from CP-19: PATTERN also misses raw `DROP TABLE` / `TRUNCATE` / `psql -c 'DROP TABLE …'` / tinker `DB::statement("DROP TABLE …")`. Rule says "agents NEVER … drop … databases" and the deny REASON literally claims raw psql DROP / TRUNCATE loops "will be blocked" — but they sail through. Exclude bare `DELETE FROM` (legit scoped deletes). Same PATTERN line as CP-19 → implement together. ICE 392 (I8×C7×E7). Carded → CP-42. |
| `inject-time.sh` PostToolUse over-injection | **Upgradeable** | base/hooks.json wires inject-time on PostToolUse → a `<time> +Ns` context line after EVERY tool call. Long danx-next dispatches emit hundreds of `+0/+1s` stamps (token noise); the valuable long-op signal (`+5m` build) is rare. Fix: on PostToolUse, suppress injection unless delta ≥ threshold (~30s); UserPromptSubmit stays unconditional (per-turn stamp). Delta already computed. Sibling to CP-25 in same script. ICE 160 (I4×C5×E8). Carded → CP-43. |
| Retired `danx_issue_create` refs BEYOND CP-34 | **Incomplete** | CP-34 (CP-35 db-reset only) missed FOUR more files still naming the retired create tool `danx_issue_create` (correct = `mcp__danx_dashboard__issue_create`): `issue-card-workflow/references/lifecycle-states.md` L25 (canonical lifecycle ref!), `danx-flesh-out/references/overview.md` L5, `no-false-blockers/SKILL.md` L36, `issue-blocker/SKILL.md` L235. Hard tool-not-found on the create branch. `slack-agent` L58 `mcp__danxbot__link_thread_to_issue` is a LEGIT runtime tool, not a defect. ICE 405 (I5×C9×E9). Carded → CP-41. |
| `plugin-skill-mandate.sh` hook wiring | **Incomplete** | Script header says "Fires on SessionStart and UserPromptSubmit" and has UserPromptSubmit stdin-drain code, but base/hooks.json wires it SessionStart-ONLY (UserPromptSubmit runs inject-time only). The load-first mandate never re-fires per prompt; UserPromptSubmit branch is dead code. ICE 280 (I5×C7×E8). Carded → CP-20. |
| Hook-script behavioral tests | **Incomplete** | Zero tests for the runtime logic of deny-destructive-db / investigation-gate / human-loop-mandate / inject-time. CP-7 validates structure, not behavior. No `.bats` suite exists. Silent-regression risk on safety-critical hooks. ICE 245 (I7×C7×E5). Carded → CP-21 Epic (CP-22 harness+deny / CP-23 gates / CP-24 inject-time). |
| `inject-time.sh` /tmp state cleanup | **Upgradeable** | Writes `/tmp/claude-time-hook-${SID}` per session, never pruned → unbounded accumulation on long-lived hosts/workers. Fix: age-based prune on each fire. ICE 168 (I3×C8×E7). Carded → CP-25. |
| Base mandate-script event-wiring drift (`convey-mandate.sh` + `tool-discipline-mandate.sh`) | **Incomplete** | Both headers claim "Fires on SessionStart AND UserPromptSubmit" (tool-discipline L4-5 even states the intent: reinforce "every session AND every turn so they survive context compression") and both carry a `[ "$EVENT" = "UserPromptSubmit" ] && cat >/dev/null` stdin-drain branch — but `base/hooks.json` wires BOTH SessionStart-ONLY (only `inject-time` fires on UserPromptSubmit). So the designed per-turn reinforcement never happens (decays after compression — the exact failure the header cites) and the drain branch is dead code. Same defect CLASS as CP-20 (plugin-skill-mandate) but DIFFERENT files → not a dup. ICE 280 (I5×C7×E8). Carded → CP-26. |
| Post-DB-migration stale references (db-reset tool ref / marketplace.json desc / safe-terminate pkgs) | **Incomplete** | Three assets still name the RETIRED `danx-issue` MCP + YAML card model (docker-deep L56 "the legacy danx-issue server is gone"; pipe-commit "there is NO YAML file"): `danxbot/skills/db-reset/SKILL.md` L135 calls non-existent `mcp__danxbot__danx_issue_create` (should be `mcp__danx_dashboard__issue_create`); `.claude-plugin/marketplace.json` danxbot desc says "issue-card workflow (YAML schema … danx-issue MCP)"; `human-collaboration/skills/safe-terminate/SKILL.md` item 5 lists retired `danx-issue-mcp/` pkg (actual packages/ tree = `danx-dashboard-mcp`). ICE 360 (I5×C8×E9). Carded → CP-34 Epic (CP-35 db-reset / CP-36 marketplace / CP-37 safe-terminate). |
| Root `.gitignore` absent | **Incomplete** | Repo has NO top-level `.gitignore` (only `.danxbot/.gitignore` scoping that subtree); untracked root-owned `claude-projects/` sits uncovered and `git status` is noisy. ICE 270 (I3×C9×E10). Carded → CP-33. |
| Per-plugin CHANGELOG / release notes | **Incomplete** | Distribution is version-driven; autoUpdate swaps the cache on any `plugin.json` bump with ZERO record of what changed. No CHANGELOG at any level; `publish.sh` emits no release notes → consumers get new behavior blind. ICE 150 (I5×C6×E5). Carded → CP-38 Epic (CP-39 gen-changelog.sh / CP-40 publish.sh wiring + README link). |
| MCP tool namespace `mcp__danx_dashboard__` (underscore) | **Complete — NOT a defect** | `danxbot/skills/docker-deep/SKILL.md` L56 authoritatively states the live agent-facing server `@thehammer/danx-dashboard-mcp` has "tools prefixed `mcp__danx_dashboard__`" (underscore), used uniformly across 16+ production skills that demonstrably work. **CP-29's premise (live namespace is the hyphen form `mcp__danx-dashboard__`) is FALSE** — Claude Code sanitizes hyphens in an MCP server name to underscores in the tool prefix. CP-29 should be triaged → Cancel (verified this session via the plugins' own docs + the danx-dashboard-mcp entrypoint). |

---

## Section 2: Desired Features (scratchpad)

- **[Carded CP-5] Fix stale README** — Maintenance — 405 (5×9×9) — correct plugin table + install matrix to the real 6 plugins.
- **[Carded CP-7 Epic] Repo integrity gate** — Maintenance — 336 (7×8×6) — Epic (not Feature: server allows `phase_children` ONLY on type=Epic) with children CP-8 (validate script), CP-9 (version-bump check), CP-10 (GitHub Actions CI).
- **[Carded CP-6] Remove stale REFACTOR artifacts** — Maintenance — 243 (3×9×9) — delete/move completed-epic docs from root.
- **[Carded CP-9] Version-bump enforcement guard** — Maintenance — 240 (8×6×5) — child of CP-7.
- **[Carded CP-11] Fix danx-ideate SKILL container doctrine** — Maintenance — 384 (6×8×8) — align step-2 create guidance with container/phase_children-Epic-only rules.
- **[Carded CP-12 Epic] Skill catalog + authoring guide** — Maintenance — 210 (5×7×6) — gen-skill-index.sh (CP-13), commit+README link (CP-14), docs/authoring-plugins.md (CP-15).
- **[Carded CP-16 Epic] publish.sh dry-run + no-op guard** — Maintenance — 196 (4×7×7) — CP-17 --dry-run, CP-18 skip version-only bumps.
- **[Carded CP-19] deny-destructive-db regex gap** — Maintenance — 448 (8×8×7) — add dropAllTables/Views/Types to the PATTERN so code matches its own doc.
- **[Carded CP-20] plugin-skill-mandate SessionStart-only wiring** — Maintenance — 280 (5×7×8) — align header/code/wiring (prefer wiring on UserPromptSubmit).
- **[Carded CP-21 Epic] bats hook test suite** — Maintenance — 245 (7×7×5) — CP-22 harness+deny-db, CP-23 prompt gates, CP-24 inject-time format/state.
- **[Carded CP-25] inject-time /tmp leak** — Maintenance — 168 (3×8×7) — age-based prune of claude-time-hook-* files.
- **[Uncarded] Plugin description single-source-of-truth** — Maintenance — 144 (4×6×6) — reconcile marketplace.json ↔ plugin.json descriptions + drift check; low value, adjacency to CP-8. README `pipeline` row (`flow-*`, "human-in-loop") is stale → flag for CP-5's implementer, not a new card.
- **[Carded CP-26] Base mandate-script per-turn wiring drift** — Maintenance — 280 (5×7×8) — reconcile `convey-mandate.sh` + `tool-discipline-mandate.sh` header/dead-drain-branch vs SessionStart-only `hooks.json` wiring; resolve consistently with CP-20 (same decision: fire per-turn vs align headers down).
- **[Carded CP-27] investigation-gate ↔ human-loop-mandate double-fire** — Maintenance — 144 (4×6×6) — re-confirmed mechanically (run 4): `investigate/scripts/investigation-gate.sh` fires on "why"/"how does"/etc. → gate says load investigate + gather evidence with Bash/Read/Grep; `human-collaboration/scripts/human-loop-mandate.sh` fires on ANY `?` → gate says "STOP all work — no tool calls except Read." A "why…?" prompt injects BOTH, giving opposite tool-permission instructions in the same turn. Both are read-only, so the clash is narrow (read-only Bash/Grep) but real for co-installed human sessions. Carded to force the precedence decision (likely human-loop answer-first wins).
- **[Uncarded] jq/deps preflight for hooks** — Maintenance — ~125 (5×5×5) — hooks assume `jq` present; if missing under `set -euo pipefail` the deny guard may fail-open. Verify Claude Code fail-open/closed behavior first (base:docs-first). Exploratory until confirmed.
- **[Uncarded] Hook invocation-form inconsistency** — Maintenance — ~168 (3×7×8) — `investigate` + `human-collaboration` hooks.json call their scripts by bare path (`${CLAUDE_PLUGIN_ROOT}/scripts/x.sh`, relying on the +x bit) while base/dev/danxbot use `bash ${CLAUDE_PLUGIN_ROOT}/scripts/x.sh`. Exec bits ARE currently set (100755 in git) so no live bug — purely defensive normalization against a future lost +x bit on the two discipline gates. Below bar given queue depth; fold into CP-8 validate (assert one invocation form) rather than a standalone card.
- **[Exploratory] Split `danxbot` plugin (25 skills)** — Maintenance — not scored/carded — largest plugin; possible sub-plugin split, but big blast radius + unclear payoff. Revisit only when no clearer work remains.
- **[Carded CP-34 Epic] Purge post-DB-migration stale refs** — Maintenance — 360 (5×8×9) — CP-35 db-reset tool ref, CP-36 marketplace.json desc, CP-37 safe-terminate pkg names.
- **[Carded CP-33] Add root `.gitignore`** — Maintenance — 270 (3×9×10).
- **[Carded CP-38 Epic] Per-plugin CHANGELOG** — Maintenance — 150 (5×6×5) — CP-39 gen-changelog.sh, CP-40 publish.sh wiring + README link.
- **[Carded CP-41] Retired `danx_issue_create` in 4 more files** — Maintenance — 405 (5×9×9) — extends CP-34 beyond CP-35's db-reset (lifecycle-states.md, danx-flesh-out overview, no-false-blockers, issue-blocker).
- **[Carded CP-42] deny-db raw SQL table drops** — Maintenance — 392 (8×7×7) — add DROP TABLE / TRUNCATE to PATTERN; implement with CP-19 (same regex line); exclude bare DELETE.
- **[Carded CP-43] inject-time PostToolUse throttle** — Maintenance — 160 (4×5×8) — suppress PostToolUse injection under ~30s delta; keep UserPromptSubmit unconditional.
- **[Uncarded] `argument-hint` frontmatter on 5 SKILL.md** — Maintenance — ~low conf — `argument-hint:` (a slash-command frontmatter key) sits on danx-chat/danx-flesh-out/danx-triage-card/danx-triage-orchestrator/template-app-build SKILL.md; likely ignored by the skill loader. Also non-standard `audience:` on ~6 skills. Uncertain whether these skills double as commands → low confidence; fold into CP-8 validation (assert allowed frontmatter keys) rather than a card.
- **[Uncarded, Dependent] config.yml empty test/lint** — Maintenance — dependent on CP-8/CP-22 — `.danxbot/config/config.yml` declares `commands.test/lint/type_check: ""`, so danx-next Step 5 quality gate runs nothing even once CP-8's validate.sh / CP-22's bats exist. Complements CP-10 (GitHub CI) with the agent-side gate. Card only after CP-8 lands (don't promote a Dependent early).
- **[Verified NOT a defect this run]** — pipeline plugin having ZERO hooks is INTENTIONAL (danx-next step-procedures.md L84 explicitly `/pipe-start`); missing root `.claude/rules/danx-repo-config.md` is MATERIALIZED at dispatch (docker-deep), not committed (CP-31 handles ideator's missing-file fallback); all SKILL.md have name+description; no broken/orphan `references/` links; no real TODO/FIXME; LOC caps hold (max 281 dispatch-deep); `current-time-mandate.sh` header matches its SessionStart-only wiring (unlike CP-20/CP-26).
- **[TRIAGE — CANCEL CP-29]** — the "hyphen namespace" bug is a false positive; underscore prefix is correct per docker-deep L56. Not re-carded (would duplicate/contradict). Flag to operator for Cancel.
- **[Note] Divergent ideator memory** — a parallel narrow-scope (ideator-subtree-only) session created CP-28..CP-32 (ideator plugin self-defects) using a SEPARATE clean-room `docs/features.md` that was never merged here. Those cards are real on the board; this canonical file now records them. CP-29 among them is the false positive above.

---

## Session Log (overwrite each session)

**2026-07-08 (run 6)** — Board now CP-2..CP-43. ALL 42 cards still at Review — 6 runs in, nothing
has ever moved to ToDo/In Progress. The Review queue is the bottleneck, NOT ideation. Repo source
unchanged since run 5 (only feature-note commits + a +61-line UNCOMMITTED diff sitting in
`.danxbot/scripts/agent-finalize.sh` working tree — flag to operator).

This run did a fresh full sweep of `/danxbot/app/repos/claude-plugins` (`$DANX_REPO_ROOT`) hunting
for GENUINELY NEW, non-overlapping findings. Repo is exceptionally clean: no broken/orphan
`references/` links, no real TODO/FIXME, LOC caps hold (max 281), all SKILL.md carry name+desc,
pipeline's zero-hooks is intentional (danx-next `/pipe-start`), missing root danx-repo-config.md is
materialized at dispatch not committed. So most structural defects were already carded run 1-5.

Three NEW grounded cards created (all Bug, all ICE-justified, all file:line-anchored):
1. **CP-41** (405, 5×9×9) — retired `danx_issue_create` in FOUR files CP-34/CP-35 missed:
   issue-card-workflow/references/lifecycle-states.md L25 (the CANONICAL lifecycle ref),
   danx-flesh-out/references/overview.md L5, no-false-blockers L36, issue-blocker L235. `slack-agent`
   L58 `mcp__danxbot__link_thread_to_issue` verified LEGIT (runtime tool, not the retired server).
2. **CP-42** (392, 8×7×7) — deny-destructive-db misses raw `DROP TABLE`/`TRUNCATE`/`psql -c` drops
   (DIFFERENT vector than CP-19's schema-builder API names; same PATTERN line → do together;
   exclude bare DELETE FROM to avoid false positives).
3. **CP-43** (160, 4×5×8) — inject-time injects a stamp after EVERY PostToolUse; throttle to delta
   ≥ ~30s (keep UserPromptSubmit unconditional). Sibling QoS to CP-25.

Uncarded/deferred this run: `argument-hint`/`audience` non-standard SKILL.md frontmatter (low conf →
fold into CP-8 validation); config.yml empty test/lint commands (Dependent on CP-8/CP-22 — don't
promote early). CP-29 STILL a false positive → operator should Cancel it.

API mechanics (correction for next run): on **POST** `/api/issues`, `board` must be in the JSON
BODY (`"board":"claude-plugins:claude-plugins-main"`) — the `?board=` query param is honored on GET
but a POST without body board → 400 "board is required". Success response does NOT echo id/title in
the shape run-5 assumed; re-query the list and take max CP-N to confirm. `ac[]` keyed by `title`.
Subagent still lacks `mcp__danx_dashboard__*` tools → used curl/urllib against the REST API.

Process note for operator: 42 cards unactioned at Review after 6 ideation runs. The marginal value
of MORE cards is near zero; value is now entirely in TRIAGE (start: Cancel CP-29) + DISPATCH.
