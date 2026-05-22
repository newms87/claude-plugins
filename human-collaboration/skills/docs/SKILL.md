---
name: docs
description: 'Stop current work and improve CLAUDE.md / rules / agent files based on what was done incorrectly.'
---

# Documentation Update Workflow

Stop what you're doing. The user identified something done incorrectly that needs documentation.

## Step 1: Understand the Problem

From the conversation context and user's `/docs` message:
1. What was done wrong?
2. What is the correct approach?
3. Is this a pattern that could recur?

## Step 2: Choose the Right Location

Both `CLAUDE.md` and `.claude/rules/*.md` are loaded automatically with the same priority. The difference is organizational.

| Location | What Goes There | Audience |
|----------|-----------------|----------|
| `CLAUDE.md` | Project overview, key commands, core principles. Keep concise. | Any agent loading the project |
| `.claude/rules/*.md` | Domain-specific procedures (git, debugging, planning, TDD). | Any agent loading the project |
| `~/.claude/rules/*.md`, `~/.claude/CLAUDE.md` | Operator's main-thread Claude Code session ONLY. | **Main session only** — does NOT load for dispatched-agent contexts (danxbot worker dispatches running as a different user / different HOME, agent-SDK subagents, container workers). |
| Plugin source (`~/web/claude-plugins/<plugin>/{rules,skills}/`) | Universal rules + skills shared across projects, agents, dispatched contexts. Loaded via the marketplace + `autoUpdate`. | All instances that consume the plugin. |
| Workspace inject path (`~/web/danxbot/src/poller/inject/workspaces/<workspace>/.claude/{rules,skills}/`) | Rules that fire INSIDE danxbot dispatched agents specifically. The poller mirrors this tree into every connected repo's workspace dir each tick. | Dispatched danxbot agents. |
| `.claude/agents/*.md` | Instructions for specialized subagents only. | Subagents |

**Decision flow:**
- Will a danxbot dispatched agent run this rule? → Plugin source OR workspace inject path. **NEVER `~/.claude/`** — dispatched agents don't load it.
- Universal across all projects + main + dispatched contexts? → Plugin source (via `~/web/claude-plugins/`).
- Operator's main session only (no dispatched-agent audience)? → `~/.claude/rules/` or `~/.claude/CLAUDE.md`.
- Project-level domain rule already exists? → Add to that file.
- New project domain? → Create `.claude/rules/{domain}.md`.
- Project overview / quick reference? → `CLAUDE.md`.
- Subagent-specific? → `.claude/agents/`.

**Anti-pattern:** dropping a generalized rule (applies to dispatched agents OR cross-project) into `~/.claude/` because it's the easiest path. Dispatched agents never read it; the rule won't fire where it's needed.

**Path-specific rules:** Add YAML frontmatter with `paths` to scope rules to specific files:
```yaml
---
paths: ["src/api/**", "routes/**"]
---
```

## Step 3: Write Succinct Documentation

**Rules for writing:**
- State the rule directly. No preamble.
- Show the correct way. One example maximum.
- Only show a "bad" example if the mistake is non-obvious from the good example alone.
- No dissertations. Keep entries concise.

### Step 3a: Domain-Neutrality Gate (MANDATORY for plugin source edits)

Before writing into ANY plugin under `~/web/claude-plugins/<plugin>/` — except the one plugin that owns the named domain — STOP and scrub the draft for domain-specific vocab. The plugin's audience is every consumer of the marketplace, not just the repo where the failure surfaced.

Mechanical pre-write check — answer YES to all FOUR before saving:

1. **No repo names** in prose or examples (`danxbot`, `gpt-manager`, `<my-project>`, etc.). Use "this system" or drop the example.
2. **No app-specific nouns** (e.g. `dispatch row`, `card YAML`, `worker`, `poller`, `Trello`, `Slack listener`). Replace with the generic primitive ("source-of-truth record", "queue entry", "background process").
3. **No tool / make-target / file-path names from a single repo.** Replace with the action they perform ("the registry lookup", "the cron entry").
4. **Lead with the principle, not the trigger.** The failure that produced this edit is one instance of a class — write the class. The repo-specific trigger goes in the COMMIT MESSAGE, not the skill body.

If any answer is NO → rewrite or relocate. Domain-specific rules belong in the plugin that owns the domain (e.g. `danxbot:*`), or in the project's own `.claude/rules/`, never in a base/dev/pipeline/human-collaboration plugin.

## Step 4: Verify and Report

1. Read the file you're updating first
2. Make the edit
3. Show the user what was added/changed
