# newms-plugins

Personal Claude Code plugin set. Discipline, dev pipeline, danxbot orchestration, issue-worker autonomy.

## Plugins

| Plugin | Purpose |
|---|---|
| `base` | Universal discipline. Install everywhere. |
| `investigate` | Read-only diagnostic methodology. No fix-writing. |
| `dev` | Code-writing: TDD, debugging-with-fix, code quality, git safety. |
| `pipeline` | Human-in-loop dev: flow-* skills, plan mode, collaboration. |
| `issues` | Issue card workflow + tracker contract. |
| `danxbot` | Danxbot orchestrator domain knowledge. |
| `issue-worker` | Autonomous issue-worker skills (danx-*). |

## Install

```bash
# Add this marketplace (local path or git URL)
claude plugin marketplace add ~/web/claude-plugins
# Or once pushed to GitHub:
# claude plugin marketplace add github:newms87/claude-plugins

# Install plugins
claude plugin install base@newms-plugins
claude plugin install investigate@newms-plugins
# etc
```

Or declare in a project's `.claude/settings.json`:

```json
{
  "plugins": ["base@newms-plugins", "investigate@newms-plugins", "dev@newms-plugins"]
}
```

## Install matrix

| Env | base | investigate | dev | pipeline | issues | danxbot | issue-worker |
|---|---|---|---|---|---|---|---|
| Global default | ✓ | | | | | | |
| Repo dev session | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| issue-worker workspace | ✓ | ✓ | ✓ | | ✓ | ✓ | ✓ |
| slack-worker workspace | ✓ | ✓ | | | ✓ | ✓ | |
| system-test workspace | ✓ | | | | | ✓ | |

## Editing a plugin — MANDATORY version bump

**Every edit to `<plugin>/skills/**/SKILL.md`, `<plugin>/skills/**/*` resources, or any plugin asset MUST bump `<plugin>/.claude-plugin/plugin.json` `version` in the SAME commit.** autoUpdate keys its on-disk cache by version directory (`~/.claude/plugins/cache/newms-plugins/<plugin>/<version>/`); if version stays static, every consumer (host sessions, container workers, dispatched agents) keeps reading the stale cached copy forever — the push went through, the live world did not move. Patch-bump (`0.3.0` → `0.3.1`) is the right size for skill text edits; minor for new skills; major for breaking schema changes. No exemption for "small" edits — small edits are exactly when this gets skipped. Commit message names the bump (`<plugin>: <change> (0.3.0 → 0.3.1)`).

## Design notes

- **No `rules/` directory.** Plugins don't ship prose rule files — rule content lives inside `skills/<name>/SKILL.md` body, with the skill description handling auto-invocation via Claude's skill matcher.
- **Always-on rules** (e.g. read-only collaboration mode, host-machine paths) → skills with MANDATORY-style descriptions (same pattern as `testing` and `debugging` skills).
- **Discoverable via skill matcher** — every behavioural constraint becomes a skill that triggers on its actual context (running bash, killing process, editing code, opening plan mode, etc.).
