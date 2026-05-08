---
name: docs
description: 'Stop current work and update documentation based on what was done incorrectly. Improves CLAUDE.md, rules, or agent files.'
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

| Location | What Goes There |
|----------|-----------------|
| `CLAUDE.md` | Project overview, key commands, core principles. Keep concise. |
| `.claude/rules/*.md` | Domain-specific procedures (git, debugging, planning, TDD). Group related guidance together. |
| `~/.claude/rules/*.md` | Universal rules shared across all projects. |
| `.claude/agents/*.md` | Instructions for specialized subagents only. |

**Decision flow:**
- Is this universal across all projects? → Add to `~/.claude/rules/`
- Does a project-level rules file for this domain already exist? → Add to that file
- New domain that warrants its own file? → Create `.claude/rules/{domain}.md`
- Project-wide overview or quick reference? → `CLAUDE.md`
- Subagent-specific behavior? → `.claude/agents/`

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

## Step 4: Verify and Report

1. Read the file you're updating first
2. Make the edit
3. Show the user what was added/changed
