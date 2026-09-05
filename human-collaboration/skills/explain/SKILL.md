---
name: explain
description: 'Explain why the agent (Claude) did something wrong — agent self-reflection, NOT app debugging.'
---

# Explain Behavior Skill

Behavior diagnostic. STOP ALL WORK on invocation.

## Critical Rules - NO EXCEPTIONS

0. **Fix an ALREADY-LOADED surface. NEVER search/discover a skill or rule to edit.** The surface that produced the behavior is already in this session's context — a loaded skill body, an injected reminder/summary, or a rule file you read this turn. Edit THAT exact surface. If the behavior came from an injected summary or hook, fix the injection surface (description frontmatter / hook text) — editing a skill BODY that was never loaded does NOT change behavior on the no-load path. `find`/`grep` to *discover which* skill is wrong = the violation this rule blocks; it defeats the skill's purpose.
1. **Edits target the PLUGIN SOURCE checkout (`<source>/<plugin>/skills/<skill>/SKILL.md`) — NOT `~/.claude/`.** **`<source>` is machine-specific — RESOLVE it, never assume a path.** Read `~/.claude/plugins/known_marketplaces.json` for the marketplace `source.url` and `installLocation`; the `installLocation` clone is a real checkout of that same repo. Look for an existing source checkout beside the other repos on this machine BEFORE cloning — a second clone of a repo already present is a duplicate that silently drifts. `~/.claude/plugins/cache/` is a read-only cache; edits there are blown away on `/reload-plugins`. `~/.claude/CLAUDE.md` is a legitimate fallback for user-global config that doesn't belong to any plugin.

   **REACH TEST — state this out loud before you write, every time:** name who this fix reaches. Plugin source → every agent, every machine, every dispatched worker. `~/.claude/CLAUDE.md` → every agent on THIS machine only. **Anything narrower than those two is the wrong location and you write it somewhere else.** A project-scoped memory file (`~/.claude/projects/*/memory/`), a repo `.md`, a note in the artifact, a card comment — all reach one agent in one project and may not even load. Those are NOT fallbacks; choosing one means the behavior recurs everywhere else and you will diagnose it again. If no plugin owns the behavior, the answer is `~/.claude/CLAUDE.md`, never a memory file.

   Allowed tools: `Read` / `Edit` / `Write` on plugin source + `~/.claude/CLAUDE.md`. `Bash` find/ls/grep ONLY to resolve the on-disk SOURCE path of a surface you ALREADY identified from context (cache path → source path) — NEVER to find which skill/rule to edit. Plus Bash for committing the change.
2. **NO application code edits, NO investigation in the user's project codebase.** Answer with what's already in the conversation.
3. **NO stop-gap fixes.** Do not propose code changes, refactors, test fixes, or "courses of action." The application code is NOT the target.
4. **The ONLY output is a short diagnosis + a concrete docs/rules/skills change.** Goal is to make the next agent less likely to repeat the mistake — nothing else.

## Response Format — KEEP IT SHORT

### 1. What + Why (≤ 4 lines total)

- **What:** one-line factual description of the wrong action.
- **Why:** one or two lines on the reasoning that produced it. No paragraphs, no narrative, no defensiveness.

### 2. The Fix (the only deliverable)

The fix lives in the plugin source checkout (`<source>/<plugin>/skills/<skill>/SKILL.md`) or `~/.claude/CLAUDE.md` for user-global config not owned by any plugin. NEVER in application code, NEVER in `~/.claude/plugins/cache/` (read-only cache). Resolve `<source>` per rule 1 — do not hardcode it.

**Locating the right plugin:**
1. Failure tied to a named skill that fired? → edit that skill's `SKILL.md` in plugin source.
2. Failure crosses skills / falls between them? → edit the most-related plugin's rule directory or add a new rule there.
3. No plugin owns it? → `~/.claude/CLAUDE.md`.

After editing you MUST publish. **A pushed edit that does not bump the plugin version reaches nobody** — consumers hold whatever version was cached at install, so the fix silently never lands on dispatched workers, other machines, or other sessions. Use the repo's publish script if it ships one (`ls scripts/`); it bumps, commits and pushes in one step. Only if there is none: `git add <plugin>/... && git commit && git push`, and bump the version yourself. The task is not done until the new version is on the remote — say which version you published.

**If the behavior came from an injected description/frontmatter rather than a loaded body, fix BOTH.** A body-only edit never fires on the no-load path, which is usually the common one.

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
