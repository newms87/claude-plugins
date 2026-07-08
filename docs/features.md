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

---

## Section 2: Desired Features (scratchpad)

- **[Carded CP-5] Fix stale README** — Maintenance — 405 (5×9×9) — correct plugin table + install matrix to the real 6 plugins.
- **[Carded CP-7 Epic] Repo integrity gate** — Maintenance — 336 (7×8×6) — Epic (not Feature: server allows `phase_children` ONLY on type=Epic) with children CP-8 (validate script), CP-9 (version-bump check), CP-10 (GitHub Actions CI).
- **[Carded CP-6] Remove stale REFACTOR artifacts** — Maintenance — 243 (3×9×9) — delete/move completed-epic docs from root.
- **[Carded CP-9] Version-bump enforcement guard** — Maintenance — 240 (8×6×5) — child of CP-7.
- **[Carded CP-11] Fix danx-ideate SKILL container doctrine** — Maintenance — 384 (6×8×8) — align step-2 create guidance with container/phase_children-Epic-only rules.
- **[Carded CP-12 Epic] Skill catalog + authoring guide** — Maintenance — 210 (5×7×6) — gen-skill-index.sh (CP-13), commit+README link (CP-14), docs/authoring-plugins.md (CP-15).
- **[Carded CP-16 Epic] publish.sh dry-run + no-op guard** — Maintenance — 196 (4×7×7) — CP-17 --dry-run, CP-18 skip version-only bumps.
- **[Uncarded] Plugin description single-source-of-truth** — Maintenance — 144 (4×6×6) — reconcile marketplace.json ↔ plugin.json descriptions + drift check; low value, adjacency to CP-8. README `pipeline` row (`flow-*`, "human-in-loop") is stale → flag for CP-5's implementer, not a new card.
- **[Exploratory] Split `danxbot` plugin (25 skills)** — Maintenance — not scored/carded — largest plugin; possible sub-plugin split, but big blast radius + unclear payoff. Revisit only when no clearer work remains.

---

## Session Log (overwrite each session)

**2026-07-08 (run 2)** — Second ideator run. Prior run's CP-5..CP-10 confirmed still open
(README fix, stale-artifact removal, repo-integrity Epic + 3 children). Board now CP-2..CP-18.
Created 3 NEW non-duplicate cards this run:
- **CP-11 (Bug)** — danx-ideate SKILL step-2 contradicts the plugin's own container doctrine
  (frames flat Feature/Bug + ac[], omits phase_children-Epic-only). ICE 384.
- **CP-12 (Epic)** — skill catalog + authoring guide → CP-13 (gen-skill-index.sh),
  CP-14 (commit+README link), CP-15 (docs/authoring-plugins.md). ICE 210.
- **CP-16 (Epic)** — publish.sh hardening → CP-17 (--dry-run), CP-18 (no-op/version-only
  bump guard). ICE 196.
No Danxbot knowledge-doc edits (scope=repo; ideator agent def is NOT shipped by this repo's
plugins — it's injected by the orchestrator, so CP-11's fix targets the in-repo
`danxbot/skills/danx-ideate/SKILL.md`, the only shippable surface).
Mechanics reminders (unchanged, verified again): MCP dashboard tools NOT wired into this
harness → use `curl` POST to `$DANXBOT_DASHBOARD_URL/api/issues` with `Authorization: Bearer
$DANXBOT_DISPATCH_TOKEN`; `board` MUST be in the POST BODY; AC items are `{title,checked}`;
`phase_children[]` is Epic-ONLY (Feature 400s) — so container-with-atomic-children = Epic here.
POST 201 response nests as `{issue:{issue:{id,...}}}` — re-list to read the assigned id.
Everything here is developer/maintenance value (no end-user surface); cards skew Maintenance
by domain. Next: when CP-5 lands, note the `pipeline` README row (`flow-*` → `pipe-*`,
"human-in-loop" → autonomous) was also stale. Uncarded scratchpad item: plugin-description
single-source-of-truth (ICE 144, low value).
