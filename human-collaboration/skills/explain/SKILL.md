---
name: explain
description: 'Explain why the agent (Claude) did something wrong — agent self-reflection, NOT app debugging.'
---

# Explain Behavior Skill

Behavior diagnostic. STOP ALL WORK on invocation.

## Critical Rules - NO EXCEPTIONS

1. **Edits target the PLUGIN SOURCE (`~/web/claude-plugins/<plugin>/skills/<skill>/SKILL.md` or `~/web/claude-plugins/<plugin>/rules/*.md`) — NOT `~/.claude/`.** `~/.claude/plugins/cache/` is a read-only cache; edits there are blown away on `/reload-plugins`. `~/.claude/CLAUDE.md` is a legitimate fallback for user-global config that doesn't belong to any plugin. Allowed tools: `Read` / `Edit` / `Write` on plugin source + `~/.claude/CLAUDE.md`. `Bash` ONLY for `find` / `ls` / `grep` to locate the right plugin file, and for committing the plugin change after the fix.
2. **NO application code edits, NO investigation in the user's project codebase.** Answer with what's already in the conversation.
3. **NO stop-gap fixes.** Do not propose code changes, refactors, test fixes, or "courses of action." The application code is NOT the target.
4. **The ONLY output is a short diagnosis + a concrete docs/rules/skills change.** Goal is to make the next agent less likely to repeat the mistake — nothing else.

## Response Format — KEEP IT SHORT

### 1. What + Why (≤ 4 lines total)

- **What:** one-line factual description of the wrong action.
- **Why:** one or two lines on the reasoning that produced it. No paragraphs, no narrative, no defensiveness.

### 2. The Fix (the only deliverable)

The fix lives in plugin source (`~/web/claude-plugins/<plugin>/skills/<skill>/SKILL.md` for skill text, `~/web/claude-plugins/<plugin>/rules/*.md` for rule files) or `~/.claude/CLAUDE.md` for user-global config not owned by any plugin. NEVER in application code, NEVER in `~/.claude/plugins/cache/` (read-only cache).

**Locating the right plugin:**
1. Failure tied to a named skill that fired? → edit that skill's `SKILL.md` in plugin source.
2. Failure crosses skills / falls between them? → edit the most-related plugin's rule directory or add a new rule there.
3. No plugin owns it? → `~/.claude/CLAUDE.md`.

After editing: commit + push the plugin (`cd ~/web/claude-plugins && git add <plugin>/... && git commit && git push`) so other instances + container workers (`autoUpdate: true`) pick up the change.

- **File:** the specific file (and section) to edit.
- **Change:** the exact addition / replacement, ≤ 5 lines, written verbatim so it can be pasted in.
- **Why this closes the gap:** one line — what about the new wording mechanically blocks the failure mode (a pre-write check, a forbidden-pattern entry, a tightened trigger condition, etc.).

If the existing rule covered the case but was ignored: the rule is too weak — strengthen it (more prominent placement, more specific trigger, mechanical pre-action check). NEVER write "the rule already covers this" — that restates the problem.

After presenting the fix: apply it via `Edit` / `Write`. The skill's job is to ship a docs/rules/skill change, not just describe one.

## Forbidden In This Skill

- "Course Correction Options" / "Option A / Option B" lists.
- Code-level remediation, test rewrites, refactor proposals, follow-up cards, runtime guards.
- Multi-paragraph narratives about what you "thought" or "missed."
- Restating the existing rule as the prevention.

## Remember

User is debugging the agent, not the code. Short diagnosis → concrete rule/skill edit → ship.
