# Plugin Refactor — Phase 7 Verification Report (DX-802)

Read-only sweep of the post-refactor steady state. All 6 plugins were published this session (base v0.3.7, investigate v0.3.4, dev v0.2.8, pipeline v0.3.4, human-collaboration v0.3.2, danxbot v0.3.22). Repo-side Phase 6 cuts in working tree (uncommitted) treated as the post-refactor reality.

---

## 1. Single-trigger-per-skill invariant

Grep methodology: for every `<plugin>:<skill>` name (51 skills across 6 plugins), `grep -rln -F` across every plugin's `hooks/` + `scripts/` subtree. The plugins WITH hook/script trees: base, dev, investigate, human-collaboration, danxbot (pipeline has no hook).

### Active trigger injections (mandate scripts)

Every skill name appears in EXACTLY ONE plugin's mandate body:

| Plugin mandate script | Injects triggers for |
|---|---|
| `base/scripts/plugin-skill-mandate.sh` | `base:tool-discipline`, `base:process-kill`, `base:sub-agent-delegation`, `base:bash-exit-capture`, `base:monitor-polling` (5 base-only triggers) |
| `base/scripts/convey-mandate.sh` | `base:convey` |
| `dev/scripts/ideal-solution-mandate.sh` | `dev:ideal-solution-mindset`, `dev:debugging`, `dev:testing`, `dev:git-discipline` |
| `danxbot/scripts/danxbot-skill-mandate.sh` | The 10 listed danxbot triggers (issue-card-workflow, unblock, issue-blocker, no-false-blockers, requires-human, no-unauthorized-worker-launch, autonomous-mode, halt-flag, danxbot, db-reset) |
| `investigate/scripts/investigation-gate.sh` | `investigate:investigate` (regex-gated UserPromptSubmit) |
| `human-collaboration/scripts/human-loop-mandate.sh` | `human-loop` (text gate; only on prompts containing `?`) |

### Cross-plugin references found

Two grep hits that are NOT trigger injections (they are reference text only):

1. `dev/scripts/ideal-solution-mandate.sh:39` + `dev/skills/repo-optimize/SKILL.md:108` + `dev/skills/ideal-solution-mindset/SKILL.md:3,18,138` — mention `human-collaboration:human-loop` only as a scope-delegation note ("question-vs-decide ergonomics live in human-loop"). Not a trigger.
2. `base/scripts/deny-destructive-db.sh:44` — the deny reason text points users to the sanctioned `danxbot:db-reset` skill. Not a trigger injection; it's user-facing prose printed when the PreToolUse deny gate fires.

**Verdict: PASS.** Zero cross-plugin trigger injection. Two informational cross-references that are intentional (delegation + deny-reason copy).

---

## 2. Stale-pointer sweep

Extracted every `<plugin>:<skill>` token from all 51 SKILL.md files + danxbot CLAUDE.md + danxbot/.claude/rules/*.md. Verified each target exists at `~/web/claude-plugins/<plugin>/skills/<skill>/SKILL.md`.

### False-positive grep hits (NOT actual skill refs)

- `danxbot:latest` — Docker image tag in `danxbot/skills/danxbot/SKILL.md:65`. False positive.
- `danxbot:url` — REPOS env-var syntax `platform:url,danxbot:url` in CLAUDE.md:214. False positive.

### Confirmed stale pointers

| # | Location | Stale pointer | Target status | Severity |
|---|---|---|---|---|
| 1 | `/home/newms/web/danxbot/.claude/rules/make-commands.md:37` | `danxbot:no-authorized-worker-launch` | TYPO — missing `un-`. Real skill is `danxbot:no-unauthorized-worker-launch` (exists). | low — pointer unresolvable as-written |
| 2 | `/home/newms/web/danxbot/CLAUDE.md:88` | `danxbot:danx-prep` | Skill does NOT exist in marketplace plugin. Lives in inject pipeline at `src/inject/workspaces/issue-worker/.claude/skills/danx-prep/SKILL.md`. The Skill tool resolves a bare `danx-prep` from workspace skills, but `<plugin>:<skill>` syntax implies plugin ownership. | medium — pointer technically valid (resolver finds it) but the prefix is misleading |
| 3 | `/home/newms/web/danxbot/.claude/rules/agent-dispatch.md:139,195,233` | `danxbot:danx-prep` (3 occurrences) | Same as #2. | medium |
| 4 | `~/web/claude-plugins/danxbot/skills/danxbot/SKILL.md:135` | `danxbot:danx-prep` | Same as #2 — plugin skill body itself references a sibling skill that does NOT live in the plugin. | medium |

**Verdict: 4 stale pointers** (1 typo + 3 location-references for `danx-prep` which still lives in the inject pipeline rather than the marketplace plugin).

---

## 3. Contradiction sweep (Phase 1 Table 4 re-run)

| Row | Phase 1 contradiction | Post-refactor state | Resolved? |
|---|---|---|---|
| 1 | base hook injected danxbot/dev/pipeline/investigate triggers | base mandate now base-only (5 triggers). Each domain has its own mandate. | YES |
| 2 | base duplicated `investigate:investigate` trigger | base no longer mentions investigate; investigate gate owns it. | YES |
| 3 | base duplicated `dev:debugging` self-trigger gate | Moved to `dev/scripts/ideal-solution-mandate.sh`. | YES |
| 4 | base duplicated `dev:git-discipline` self-trigger gate | Moved to dev mandate. | YES |
| 5 | `no-false-blockers` description says "writing `status: Blocked`" instead of "stamping `blocked: {at, reason}`" | Description still reads `MANDATORY before writing 'status: "Blocked"' on a card` (line 3 of frontmatter). | **NO — REMAINS** |
| 6 | CLAUDE.md forbidden-token statement claims tokens appear "ONLY in this section and rules/agent-dispatch.md" | Not a true contradiction (explicit cross-reference). | n/a |
| 7 | CLAUDE.md "Skill triggers" sub-table duplicated skill descriptions | Sub-table DELETED. Only "Rule files" sub-table remains under "CRITICAL Pointers". | YES |
| 8 | danx-next Step 10 + no-false-blockers overlap | danx-next still 800+ LOC; split into reference files NOT yet shipped. Cross-link relationship remains as-was. | partial — duplication remains in danx-next body |
| 9 | flesh-out + triage-card carry duplicated zero-context-test rubric | No shared `zero-context-test` skill exists in plugin. Duplication remains. | NO |
| 10 | CLAUDE.md + agent-dispatch.md both carry full Trello-decoupling enforcement table | Both files still carry overlapping coverage. Partial trim in CLAUDE.md; rules file still has full table. | partial |

**Verdict: 3 contradictions remain** (#5 stale skill description, #8 + #9 + #10 unfinished body-trim work).

---

## 4. LOC reduction verification

| Metric | Baseline | Current | Target | Delta | Status |
|---|---:|---:|---:|---:|---|
| Marketplace SKILL.md body LOC (all plugins) | 8,632 | 5,943 | ≤ 5,179 (≥40% trim) | -31.1% | **SHORTFALL** — 8.9 points short |
| `/home/newms/web/danxbot/CLAUDE.md` | 375 | 294 | ≤ 200 | -21.6% | **SHORTFALL** — 94 LOC over cap |
| `.claude/rules/*.md` sum | 824 | 791 | ≤ 577 (≥30% trim) | -4.0% | **SHORTFALL** — 26 points short |

Per-file rules breakdown:
- `agent-dispatch.md`: 298 → 265 (11% trim)
- `cancelled-card-audit.md`: 93 → 93 (unchanged)
- `dashboard.md`: 196 → 196 (unchanged)
- `docker-runtime.md`: 128 → 128 (unchanged)
- `make-commands.md`: 59 → 59 (unchanged)
- `service-surface.md`: 39 → 39 (unchanged)
- `settings-file.md`: 11 → 11 (unchanged)

Phase 6 cut mostly hit `agent-dispatch.md` (-33 LOC) and CLAUDE.md (-81 LOC). The other rule files were KEEP-unchanged per Phase 1 Table 3 verdicts, leaving little headroom for the 30% rules-sum target. Skill-body trim of ~2,700 LOC is needed to hit 40%; only ~2,700 LOC was actually trimmed.

**Verdict: SHORTFALL on all three.**

---

## 5. Boot smoke test

Transcript captured to `/tmp/post-refactor-mandate.txt` (57 lines).

| Check | Result |
|---|---|
| base mandate emits ONLY base:* triggers | PASS — body lists `tool-discipline / process-kill / sub-agent-delegation / bash-exit-capture / monitor-polling`. No danxbot:* / dev:* / pipeline:* / investigate:* leakage. |
| danxbot mandate emits the 10 listed high-violation triggers | PASS — all 10 enumerated `(1)…(10)` in body. |
| dev mandate emits the 4 dev triggers (ideal-solution + debugging + testing + git-discipline) | PASS — all 4 sections present. |
| investigate gate fires correctly | PASS — `?` prompts produce JSON gate; non-`?` prompts pass through silently. |
| human-collaboration mandate fires ONLY when prompt contains `?` | PASS — empty / no-`?` returns nothing; `?` returns gate JSON. |
| Duplicate mandate output (e.g. danxbot triggers from base hook) | NONE detected. |

**Verdict: PASS.**

---

## 6. Autonomous-worker safety check

Inspected every workspace settings file under `/home/newms/web/danxbot/src/inject/workspaces/*/.claude/settings.json` (8 workspaces: board-chat, issue-chat, issue-worker, skill-eval, slack-worker, system-evaluator, system-test, worker-repair).

Grep result: **zero workspaces enable `human-collaboration@newms-plugins`.** Every workspace enables `base / investigate / dev / pipeline / danxbot` only. Sample (issue-worker):

```json
"enabledPlugins": {
  "base@newms-plugins": true,
  "investigate@newms-plugins": true,
  "dev@newms-plugins": true,
  "pipeline@newms-plugins": true,
  "danxbot@newms-plugins": true
}
```

The human-collaboration UserPromptSubmit hook (which would deadlock on `?` in dispatch prompts) cannot fire in any dispatched worker because the plugin is not enabled at the workspace boundary.

**Verdict: PASS — no autonomous-worker deadlock risk.**

---

## Verdict
- single-trigger: PASS
- stale-pointers: 4 stale (1 typo `no-authorized-worker-launch` in make-commands.md; 3 occurrences of `danxbot:danx-prep` referencing a skill that lives in the inject pipeline rather than the marketplace plugin)
- contradictions: 3 remaining (Phase 1 row #5 `no-false-blockers` description still uses "writing `status: Blocked`" phrasing; rows #8 #9 #10 unfinished body-trim duplication)
- LOC reduction: SHORTFALL (marketplace 31.1% / target 40%; CLAUDE.md 294 LOC / target ≤200; rules sum 791 LOC / target ≤577 — 4% trim vs 30% target)
- boot smoke: PASS
- autonomous-worker safety: PASS
