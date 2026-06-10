---
name: pipe-start
description: 'Reload critical development rules at phase boundary / before writing code.'
---

# Pipe-Start — Pre-Implementation Rule Reload

**Invoke this skill before every implementation phase.** This is not optional. `/next-phase` and the orchestrator invoke it automatically. If you're implementing without a phased plan, invoke it once before you start writing code.

Read every rule below. These are the rules you are most likely to violate under pressure. Knowing about them is not enough — you must actively check each one during implementation.

---

## Canonical Workflow

**Two variants — pick by context.** If `process.env.DANXBOT_DISPATCH_ID` is set, you are a dispatched worker; the danx-next workflow OWNS the post-implementation chain and the pipeline post-impl skills (`pipe-review`, `pipe-quality`, `pipe-commit`, `pipe-finish`) are NOT auto-invoked — quality gates run as inline Test Reviewer + Code Reviewer subagents per `danxbot:danx-next` Step 5, commit runs as `agent-finalize.sh` per Step 7a, completion runs as `danxbot_complete` per Step 11. Reading the table below as a TODO list when dispatched = workflow violation.

### Human-loop session (no `DANXBOT_DISPATCH_ID`)

```
PLAN SOURCE
  Issue card (<PREFIX>-N in dashboard DB) → danxbot:issue-card-workflow skill
  Card path unclear after initial investigation → pipe-plan (escape hatch)
  No card + investigation → dev:debugging skill
PRE-IMPL (every phase)
  pipe-start (this skill)
IMPLEMENT
  TDD via dev:testing skill
  dev:debugging skill on bugs / investigations / assertions
PIPELINE (automatic, no pause)
  pipe-review → pipe-quality → pipe-commit → pipe-finish (mode A — post-commit report following base:convey)
PHASE ADVANCE
  next-phase
SESSION END
  pipe-finish (mode B)
```

### Dispatched worker (`DANXBOT_DISPATCH_ID` set)

```
PLAN SOURCE
  Dispatch prompt names the ISS-N → danxbot:danx-next skill owns flow
PRE-IMPL
  pipe-start (this skill — load rules, NOTHING ELSE)
IMPLEMENT
  TDD via dev:testing skill
  dev:debugging skill on bugs / investigations / assertions
QUALITY + COMMIT + COMPLETION
  danx-next Step 5 (inline Test Reviewer + Code Reviewer subagents)
  danx-next Step 7a (agent-finalize.sh)
  danx-next Step 11 (danxbot_complete — emit NO text after the call)
```

Post-implementation pipeline skills are reserved for human-loop sessions; in dispatched mode they are orphaned by design.

---

## The Rules

### 1. Read-Only Until Approved

You are in read-only mode unless the user said "go ahead," "do it," "fix it," "make that change," or gave an explicit imperative. Questions, observations, "sounds good," and "hmm" are NOT approval. When in doubt, you do not have approval. After presenting options or a diagnosis, enter a hard stop — text only until an explicit action verb.

### 2. Verify, Never Guess

Before using a prop, component, icon name, or enum value — read the source. Before writing code — read the existing implementation. Before assuming — check the codebase. A wrong guess wastes more time than reading a file. Agent investigation results are hypotheses — verify with actual data before acting.

### 3. No Backwards Compatibility, No Legacy, No Dead Code

ONE correct pattern for everything. Never add fallbacks for old formats, compatibility layers, deprecated paths, or "temporary" bridges between old and new. Broken code that fails loudly is better than "working" code with two paths. A fallback hides the real bug permanently.

### 4. Fail Loud — No Silent Fallbacks

Every `??`, every default value, every `isset()` guard is suspicious. The default action is THROW, not fallback. A silent fallback is the worst kind of bug — the system appears to work while producing wrong results. Only use defaults when the value is genuinely optional (pagination page defaults to 1).

### 5. TDD for Every Bug Fix

Write a failing test FIRST. Run it. Verify it fails for the right reason. THEN fix the code. No exceptions — not for "obvious" fixes, not for "urgent" fixes, not for "simple" one-liners. Multiple bugs = multiple sequential TDD cycles.

### 6. Refactor First, Build Second

If you see a DRY or SOLID violation, fix it BEFORE building on top of it. Building on bad code means your new code will need rewriting when the foundation is eventually fixed. Extract shared abstractions before building consumers.

### 7. Own the Entire Codebase

You are responsible for ALL code in this repo — not just your changes. "Pre-existing," "out of scope," and "I didn't write this" are not valid reasons to skip a fix. Cross-session: you ARE every previous Claude session.

### 8. Use Dedicated Tools

Read/Edit/Write/Glob/Grep — never bash equivalents (cat, sed, grep, find). Linting runs automatically via hooks — never run lint manually. Import order: add usage code FIRST, then the import (linters delete unused imports between edits).

### 9. Follow the Pipeline

Every phase: Implement -> `/pipe-review` -> `/pipe-quality` -> `/pipe-commit` -> `/pipe-finish` (mode A — post-commit report + next-phase invocation). At session end: `/pipe-finish` (mode B — Action Items + knowledge dump). All reports follow the `base:convey` format (concept-first headline, behavior-diff table, ASCII flow, caveats, verify). Pipeline is fully automatic after implementation — no pauses, no "ready for review?" questions. The user's plan approval is pre-approval for the entire pipeline.

### 10. Issue Card IS the Plan

When an issue card is assigned (e.g. `<PREFIX>-N`), never use EnterPlanMode. The card (`description` + `ac[]` + child phase cards + `comments[]`) IS the plan. Read it with `mcp__danx_dashboard__issue_get({id})` before starting. Re-read after context compaction.

### 11. Complete ALL Work

Never silently drop parts of a plan. Before committing, verify every acceptance criterion is satisfied. If something isn't done, say so — don't check it off. Marking incomplete work as complete is worse than not doing it.

### 12. Never Cancel Running Processes

A running backtest/hyperopt/download represents time investment. Never kill without explicit "stop it" / "kill it" from the user.

### 13. Never Substitute Your "Better" Approach

When the user specifies HOW, follow their method. If you think an alternative is better, present it and let them choose. "Equivalent results" is your hypothesis, not a fact.

### 14. Makefile First (Million Repo)

Check `make help` before doing ANYTHING in the million repo. If a Makefile target exists, use it. Never write ad-hoc scripts, inline Python, or manual docker exec when a target exists.

---

## Pre-Implementation Checklist

Before writing your first line of code in this phase, confirm:

- [ ] I have read the full card/plan for this phase
- [ ] I have read every file I'm about to modify
- [ ] I know which shared abstractions exist and will use them
- [ ] I am NOT building on code that needs refactoring first
- [ ] My approach does NOT add backwards compatibility or fallbacks
