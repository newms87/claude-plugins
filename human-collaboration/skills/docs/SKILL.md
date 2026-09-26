---
name: docs
description: 'Diagnose a wrong agent action, then fix it by briefly refining an existing rule/skill/hook/MCP description, expanding documentation, or escalating — never by adding a new skill.'
---

# Diagnose, Then Fix (Never Add a Skill)

Triggered when the operator flags something done wrong. Stop other work.

## 1. Explain first (read-only)

- **What:** one line, the wrong action.
- **Why:** one or two lines, the reasoning that produced it.

No code edits, no investigation in the project codebase yet.

## 2. Resolve with the ladder, in order

1. **Missing context** (the agent didn't know a fact it needed) → expand the documentation
   agents reference. Never a rule or skill change.
2. **No rule exists for this behaviour** → add it BRIEFLY to the existing skill, rule, hook, or
   MCP tool description that owns the subject. First read every related item as a whole so
   nothing is duplicated.
3. **The rule exists and was still broken** → sharpen it with ONE concise, generalised example.
   Never a bullet list of cases.
4. **Text can't fix it** → say so plainly and escalate to the operator with a proposed system
   change (an MCP tool response reminder, the janitor, or code) instead of writing more prose.

**Never create a new skill.** A persisting bad behaviour is cheaper than another skill nobody
needed — that habit is what bloated this plugin set before.

## 3. Locate the target and edit it

Fix the surface that actually produced the behaviour — an already-loaded skill body, an injected
description/frontmatter, a hook, or an MCP tool's response text. Editing a body that was never
loaded doesn't change the no-load path; if the failure came from a description/frontmatter, fix
that, not just the body.

Resolve the plugin source checkout (never `~/.claude/plugins/cache/`, read-only) by remote, not
by guessing a path: check `~/.claude/plugins/known_marketplaces.json` first, then search sibling
repos by `git remote get-url origin`. Use what you find; never clone a second copy.

- Reaches every project, machine, and dispatched context → plugin source.
- This machine's main session only → `~/.claude/CLAUDE.md`.
- One repo only → that repo's `.claude/CLAUDE.md` or `.claude/rules/`.

Apply the edit yourself (`Edit`/`Write`). A plugin edit is not done until published: bump the
version and push (`scripts/publish.sh` if the repo has one) — publishing is standing,
pre-authorized, never needs approval.

## 4. End state

Every run ends in exactly one of two states — say which:
- **Resolved:** name the file and the brief edit (or doc expansion) made and published.
- **Escalated:** name the proposed system change and ask the operator to confirm it.
