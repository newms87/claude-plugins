---
name: pipe-start
description: 'Reload critical development rules at phase boundary / before writing code.'
---

# Pipe-Start — Pre-Implementation Rule Reload

**Invoke this skill before every implementation phase.** This is not optional. The orchestrator invokes it automatically at each phase boundary. If you're implementing without a phased plan, invoke it once before you start writing code.

Read every rule below. These are the rules you are most likely to violate under pressure. Knowing about them is not enough — you must actively check each one during implementation.

---

## Canonical Workflow

**Two variants — pick by context.** If `process.env.DANXBOT_DISPATCH_ID` is set, you are a dispatched worker; the danx-next workflow OWNS the post-implementation chain and the pipeline post-impl skills (`pipe-review`, `pipe-quality`, `pipe-commit`, `pipe-finish`) are NOT auto-invoked — quality gates run as inline Test Reviewer + Code Reviewer subagents per `danxbot:danx-next` Step 5, commit runs as `agent-finalize.sh` per Step 7a, completion runs as `danxbot_complete` per Step 11. Reading the table below as a TODO list when dispatched = workflow violation.

### Human-loop session (no `DANXBOT_DISPATCH_ID`)

```
PLAN SOURCE
  Issue card (<PREFIX>-N in dashboard DB) → danxbot:issue-card-workflow skill
  Card path unclear after initial investigation → danxbot:plan-workflow (escape hatch)
  No card + investigation → dev:debugging skill
PRE-IMPL (every phase)
  pipe-start (this skill)
IMPLEMENT
  TDD via dev:testing skill
  dev:debugging skill on bugs / investigations / assertions
PIPELINE (automatic, no pause)
  pipe-review → pipe-quality → pipe-commit → pipe-finish (mode A — post-commit report following base:convey)
PHASE ADVANCE
  re-invoke pipe-start for the next phase
SESSION END
  pipe-finish (mode B)
```

**Pipeline is fully automatic once implementation starts — no pauses, no "ready for review?" questions between steps.** The user's plan approval is pre-approval for the entire chain.

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

Read-only until the user gives an explicit imperative ("go ahead," "do it," "fix it," "make that change"). Questions, observations, "sounds good," "hmm" are NOT approval — when in doubt, you don't have it. After presenting options or a diagnosis, hard-stop: text only until an explicit action verb.

### 2. Verify, Never Guess

Canon — the always-injected operating contract, principle 2. Not restated here.

Pipeline-specific: this pipeline's own review/investigation agents return **hypotheses**, not findings — verify with actual data before acting on anything they hand back.

### 3. No Backwards Compatibility, No Legacy, No Dead Code

`dev:ideal-solution-mindset` principle #2. Not restated here.

### 4. Fail Loud — No Silent Fallbacks

`base:fail-loudly`. Not restated here.

### 5. TDD for Every Bug Fix

`dev:testing`. Not restated here.

### 6. Refactor First, Build Second

`dev:ideal-solution-mindset` #2 / `dev:code-quality`. Not restated here.

### 7. Own the Entire Codebase

`dev:code-quality` "Own All Code". Not restated here.

### 8. Use Dedicated Tools

`base:tool-discipline`. Not restated here.

### 10. Issue Card IS the Plan

`danxbot:issue-card-workflow`. Not restated here.

### 11. Complete ALL Work

Never silently drop parts of a plan. Verify every acceptance criterion before committing — if something isn't done, say so, don't check it off. Marking incomplete work complete is worse than not doing it.

### 12. Never Cancel Running Processes

`base:process-kill`. Not restated here.

### 13. Never Substitute Your "Better" Approach

When the user specifies HOW, follow their method. Think an alternative is better? Present it and let them choose — "equivalent results" is your hypothesis, not a fact.

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
