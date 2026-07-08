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

---

## Section 2: Desired Features (scratchpad)

- **[Carded CP-5] Fix stale README** — Maintenance — 405 (5×9×9) — correct plugin table + install matrix to the real 6 plugins.
- **[Carded CP-7 Epic] Repo integrity gate** — Maintenance — 336 (7×8×6) — Epic (not Feature: server allows `phase_children` ONLY on type=Epic) with children CP-8 (validate script), CP-9 (version-bump check), CP-10 (GitHub Actions CI).
- **[Carded CP-6] Remove stale REFACTOR artifacts** — Maintenance — 243 (3×9×9) — delete/move completed-epic docs from root.
- **[Carded CP-9] Version-bump enforcement guard** — Maintenance — 240 (8×6×5) — child of CP-7.
- **[Exploratory] Split `danxbot` plugin (25 skills)** — Maintenance — not scored/carded — largest plugin; possible sub-plugin split, but big blast radius + unclear payoff. Revisit only when no clearer work remains.
- **[Exploratory] Auto-generated skill catalog / index doc** — Maintenance — not carded — generate a per-plugin skill index from frontmatter; nice-to-have, low urgency.

---

## Session Log (overwrite each session)

**2026-07-08** — First ideator run on this repo. Established the repo is a plugin
marketplace (not a code app). MCP dashboard tools are NOT wired into this harness;
reached the dashboard via `curl` against `$DANXBOT_DASHBOARD_URL/api/issues?board=claude-plugins:claude-plugins-main`
with `Authorization: Bearer $DANXBOT_DISPATCH_TOKEN` (same surface the
`@thehammer/danx-dashboard-mcp` http-client uses). Create payload: `{type,title,description,
ac:[{title}],phase_children:[{type,title,description,ac}],gate_decisions?}`. Two gotchas
learned this run: (1) `phase_children[]` is valid ONLY on `type=Epic` (server 400s it on
Feature — so a container-with-children MUST be an Epic here, not a Feature); (2) `board` must
appear in the POST BODY, not just the query string. This board's optional quality gates
defaulted to `required:false` and did NOT force `gate_decisions` on create.
Existing open cards CP-2/3/4 are narrow cross-repo danxbot-workflow delegations — no overlap
with the repo-health items carded this session. All value here is developer/maintenance
value (no end-user surface), so cards skew Maintenance by nature of the domain.
