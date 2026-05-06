---
name: planning-discipline
description: 'MANDATORY before EnterPlanMode, before checking off any AC item, before declaring a phase complete, before any commit closing a phase. Loads card-overrides-plan-mode, prose-only plans, zero-context test, phase-boundary audit (no stopgap scaffolding), pipeline auto-execution discipline as TodoWrite checklist.'
---

# Planning Rules

## Issue Card Overrides Plan Mode

Issue card assigned (e.g. `ISS-N` YAML at `<repo>/.danxbot/issues/open/<id>.yml`) → NEVER use EnterPlanMode. Card IS plan. Edit the YAML directly via `mcp__danx-issue__danx_issue_save` if plan changes.

## Plan Files

**Location:** `~/.claude/plans/` only. Create ONLY via `EnterPlanMode`. Never write plan files manually.

**Editing:** Use Edit (preserves content). Never use Write (overwrites everything).

**Content:** Prose only — zero code blocks. Code locks in details before approval.

**Zero-context test:** Write as if amnesic. Include exact file paths, specific method names, clear reasoning.

## CRITICAL: Card Instructions Are Not Suggestions

Card specifies technical approach (endpoint to call, component to reuse, data to display) → requirement, not suggestion replaceable with simpler alternative. Specified approach has genuine technical blocker → STOP, report blocker to user with proposed alternative. Never silently substitute placeholder + mark work complete. "Too complex" + "too coupled" not blockers — engineering problems to solve.

## CRITICAL: Phase Boundary Audit — Never Build Stopgap Scaffolding for a Misplaced AC

Before implementing a phase card, audit whether each AC item is **clean within this phase** OR requires **stopgap scaffolding** to satisfy. Stopgap scaffolding = code existing only to bridge a missing capability shipping in a later phase. Smell list:

- "Phase N only" branches / flags
- Refetching state from a remote system because the local source-of-truth isn't writable yet
- Fake bridges between two halves that don't compose until Phase N+1
- "Transient" sync paths the description itself flags as "purely advisory until later"
- Any branch you'd delete in the next phase

Stopgap scaffolding = same anti-pattern as backwards-compat shims, dressed in phased delivery. The "no backwards compat / no silent fallbacks / no temporary shims" rules apply identically. Future-phase capability is not yet a thing; do not pretend it is.

**Mechanical 5-line check** before writing any code for an AC: "Could this AC be implemented in ~5 lines using a mechanism shipping IN this phase?" No → AC misplaced. Stop. Surface the misplacement to the user. Propose moving the AC to the phase where the capability lands naturally (usually one phase later). Never design glue to make a misplaced AC pass.

When a phase boundary forces stopgap design:
1. STOP. Do not write the glue.
2. Read the parent epic + sibling phase cards.
3. Identify which phase the AC belongs in (look for the natural mover capability).
4. Propose to user: remove from current phase, add to target phase.
5. Update card AC checklists in both directions; post a comment on each card explaining the reshuffle.
6. Resume implementation only on the slimmed phase.

Phase boundaries set by the planner are estimates — implementation reveals true seams. A reshuffle is a clean signal, not a failure.

## Implementation Checklist

Before starting, create checklist of all discussed items. Track each. ANY item incomplete at commit time → STOP immediately + tell user what wasn't implemented. Never commit partial work.

Before checking off any item, verify literal claim true (via grep/test/code read).

## Shared Abstractions

2+ classes share logic → explicitly name abstraction + where lives. Continuation sessions need know: "use X trait/service, don't reinline."

## Phases

Use multiple phases only when scope exceeds single pipeline run. Each phase = complete pipeline run. Phases never justify backwards compat — broken code signals next phase to fix.

**CRITICAL: One Phase = One Commit = One Card Lifecycle.** Each phase card gets own commit. After each phase commit: check off all AC items on phase card, move phase card to Done. Epic's `children[]` already references the phase card; the worker resolves child status when rendering the epic. Do NOT batch multiple phases into single commit — makes structurally impossible maintain accurate card state. Commit boundary IS phase boundary. (ISS-81 retired the in-card "Implementation Phases" checklist — phases are full cards in `children[]`, not checklist items.)

## Refactoring Tools

Renaming/moving symbols across files → specify tool in plan: `phpactor class:move` (PHP), `ts-morph`/`gopls rename`/`rope` (other languages). Never plan manual find-and-replace.

## Code Review Priorities

Code review = running reviewer agents via Task tool, NOT you reading code.

**Run when:** Multi-file, >10 lines, new feature, phase completion.

**Priority order:**
1. Legacy code, backwards compatibility, dead code
2. Silent fallbacks (`??`, defaults, implicit infers)
3. Everything else (style, DRY, tests)

Never modify reviewer agents to reduce findings. Reviewers intentionally aggressive — fix all findings.

## The Pipeline (Automatic)

1. Implement (write code, tests)
2. `/flow-code-review` (fix findings)
3. `/flow-quality-check` (audit decisions)
4. `/flow-commit` (stage and commit)
5. `/flow-report` (present results)
6. Mark phase complete
7. Repeat for next phase
8. `/flow-finish` (at session end — Action Items + knowledge dump)

**CRITICAL:** Pipeline automatic. User approval of plan = pre-approval for entire pipeline. NEVER pause between steps. NEVER ask "ready for code review?" Just execute. Do NOT skip quality gates.

**Mechanical enforcement:** `/flow-commit` skill body has Step 0 — Pipeline Preflight that aborts with `Phase pipeline incomplete. Missing: [code-review | quality-check]` if either gate didn't run in the current phase. The rule above (advisory) is no longer the only barrier — the skill itself refuses to commit. Bypass requires explicit `--skip-pipeline` arg + commit body explanation.

Quality gates run after each phase (independent domains) or once after all related phases (same domain). Never skip.

**CRITICAL: Phase with no code change still runs pipeline.** Verification-only phases, plan-only phases, research phases NOT exempt. Still run `/flow-report` at phase end + `/flow-finish` at session end. Code-oriented steps (`/flow-code-review`, `/flow-quality-check`, `/flow-commit`) = no-ops on empty diff — still invoke + exit cleanly with "nothing to review / nothing to commit." Pipeline not conditional on code being changed; structure for phase + session closure.

**`/flow-finish` NEVER optional.** Regardless whether session produced commits, plans, or only investigation, every session ends with `/flow-finish`. Captures unwritten knowledge + formalizes Action Items otherwise lost when context window destroyed. Skipping `/flow-finish` because "already filed action items manually" or "no code change" = classic end-of-session shortcut. Do not take.

**Rationalization to watch for:** "No code change, so no pipeline." Wrong. Pipeline = structure, not work — ensures closure happens. Skipping steps because phase light → STOP + run anyway.

## Questions Are Not Decisions

User asks question → answer + wait explicit agreement ("go ahead", "do it", "yes") before editing plan.

## "Review the Plan"

Call `ExitPlanMode` immediately. That = how user approves plans.
