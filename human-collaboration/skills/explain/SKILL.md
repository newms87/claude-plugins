---
name: explain
description: "Explain why the AGENT did something wrong. Use ONLY when the user asks why YOU (Claude) made a mistake, took a wrong action, or violated a rule. This is for agent self-reflection, NOT for debugging code or investigating application bugs."
---

# Explain Behavior Skill

Behavior diagnostic. STOP ALL WORK on invocation.

## Critical Rules - NO EXCEPTIONS

1. **NO tools except `Read` / `Edit` / `Write` against `~/.claude/rules/`, `~/.claude/skills/`, or `~/.claude/CLAUDE.md`** — those are the only artifacts this skill ever changes.
2. **NO code edits, NO bash, NO Grep / Glob, NO investigation in the codebase.** Answer with what's already in the conversation.
3. **NO stop-gap fixes.** Do not propose code changes, refactors, test fixes, or "courses of action." The application code is NOT the target.
4. **The ONLY output is a short diagnosis + a concrete docs/rules/skills change.** Goal is to make the next agent less likely to repeat the mistake — nothing else.

## Response Format — KEEP IT SHORT

### 1. What + Why (≤ 4 lines total)

- **What:** one-line factual description of the wrong action.
- **Why:** one or two lines on the reasoning that produced it. No paragraphs, no narrative, no defensiveness.

### 2. The Fix (the only deliverable)

The fix lives in `~/.claude/rules/`, `~/.claude/skills/`, or `~/.claude/CLAUDE.md`. NEVER in application code.

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
