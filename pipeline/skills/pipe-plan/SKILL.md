---
name: pipe-plan
description: 'MANDATORY before EnterPlanMode, before checking off any AC item, before declaring a phase complete, before any commit closing a phase. Loads card-overrides-plan-mode, prose-only plans, zero-context test, phase-boundary audit (no stopgap scaffolding), pipeline auto-execution discipline as TodoWrite checklist. ALSO MANDATORY when picking up a card whose path is NOT clear after initial investigation — this skill carries the "complex card escape hatch" autonomous workers use to expand under-specified cards or escalate architectural unknowns to Blocked.'
---

# Pipe-Plan — Planning Rules + Complex-Card Escape Hatch

## Issue Card Overrides Plan Mode (Default Path)

Issue card assigned (e.g. `ISS-N` YAML at `<repo>/.danxbot/issues/open/<id>.yml`) → DEFAULT path is NEVER use EnterPlanMode. Card IS plan. Edit the YAML directly via `mcp__danx-issue__danx_issue_save` if plan changes. The card was authored by another agent who already planned the work; trust the spec, execute it.

## Complex-Card Escape Hatch (Rare)

Default behavior assumes the card's `description + ac[] + phases[]` fully specify the work. When that assumption breaks, this skill is the only sanctioned exit path. Trigger conditions — ALL must hold:

1. The work is on an active card (`status: In Progress`).
2. After **initial investigation** (read every file the card references, every related skill, every parent epic + sibling phase card, any docs in `<repo>/.danxbot/config/docs/`), the path forward is genuinely unclear — the card under-specifies a non-trivial design choice.
3. The unclear part materially affects what code gets written, not just stylistic preference.
4. The decision is NOT mechanical (i.e. cannot be resolved by reading more code).

If all four hold, the autonomous worker has TWO escape moves — never invent a third:

### Move A — Card-Internal Plan Expansion (preferred when scope is clear)

The decision is one the agent CAN make, but the card needs more detail to track it.

1. Enter ad-hoc plan mode (`EnterPlanMode`) — work the design out as prose only, zero code blocks.
2. Exit plan mode (`ExitPlanMode`).
3. Edit the card YAML — append the resolved design to `description` (or append a Design Note `comments[]` entry timestamped now). Update `phases[]` if phase structure changed. Update `ac[]` to reflect new acceptance criteria.
4. Save: `mcp__danx-issue__danx_issue_save({id})`.
5. Resume implementation against the expanded card.

### Move B — Blocked Escalation (when the decision is OUT of scope)

The decision is one the agent SHOULD NOT make alone. This applies when:

- The architectural choice contradicts a stated directive on the card.
- The choice affects an important platform invariant (auth boundary, data shape consumed by external callers, deploy contract, prod-affecting API).
- The choice was explicitly out-of-scope per the card's wording.
- The decision requires authoritative judgment outside the codebase (priority, scope, business preference).

When any of those hold:

1. Edit the card YAML — set `status: Blocked`, set `blocked: {reason, timestamp}` where `reason` is a one-paragraph crisp blocker description naming the specific decision the human must make (with the agent's recommended option + tradeoffs of each candidate). Append the same content as a `comments[]` entry so it surfaces in the dashboard drawer. The schema's invariant `status === "Blocked" ⟺ blocked !== null` requires both edits in the same save.
2. Save: `mcp__danx-issue__danx_issue_save({id})`.
3. Stop work. Signal completion via `danxbot_complete({status: "completed", summary: "Escalated to Blocked — awaiting decision on <X>"})`.
4. Do NOT speculatively implement against the unclear option — the next agent (after human input) re-picks the card with a resolved spec.

### What Move B is NOT for

Blocked is a LAST RESORT. It is NOT for:

- "Too complex, want a human to confirm" — implement the card.
- "I'm not sure if my approach is right" — implement, then defend in `/pipe-review`.
- "Card description is short" — short ≠ unclear. Initial investigation usually fills the gap.
- "There's a better way than what the card says" — Rule 13 in `pipe-start` (Never Substitute) prohibits this. Implement what's asked.

The bar for Move B is high. If you find yourself escalating cards weekly, the bar is too low.

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
2. `/pipe-review` (fix findings)
3. `/pipe-quality` (audit decisions)
4. `/pipe-commit` (stage and commit)
5. `/pipe-report` (present results)
6. Mark phase complete
7. Repeat for next phase
8. `/pipe-finish` (at session end — Action Items + knowledge dump)

**CRITICAL:** Pipeline automatic. User approval of plan = pre-approval for entire pipeline. NEVER pause between steps. NEVER ask "ready for code review?" Just execute. Do NOT skip quality gates.

**Mechanical enforcement:** `/pipe-commit` skill body has Step 0 — Pipeline Preflight that aborts with `Phase pipeline incomplete. Missing: [code-review | quality-check]` if either gate didn't run in the current phase. The rule above (advisory) is no longer the only barrier — the skill itself refuses to commit. Bypass requires explicit `--skip-pipeline` arg + commit body explanation.

Quality gates run after each phase (independent domains) or once after all related phases (same domain). Never skip.

**CRITICAL: Phase with no code change still runs pipeline.** Verification-only phases, plan-only phases, research phases NOT exempt. Still run `/pipe-report` at phase end + `/pipe-finish` at session end. Code-oriented steps (`/pipe-review`, `/pipe-quality`, `/pipe-commit`) = no-ops on empty diff — still invoke + exit cleanly with "nothing to review / nothing to commit." Pipeline not conditional on code being changed; structure for phase + session closure.

**`/pipe-finish` NEVER optional.** Regardless whether session produced commits, plans, or only investigation, every session ends with `/pipe-finish`. Captures unwritten knowledge + formalizes Action Items otherwise lost when context window destroyed. Skipping `/pipe-finish` because "already filed action items manually" or "no code change" = classic end-of-session shortcut. Do not take.

**Rationalization to watch for:** "No code change, so no pipeline." Wrong. Pipeline = structure, not work — ensures closure happens. Skipping steps because phase light → STOP + run anyway.

## Questions Are Not Decisions

User asks question → answer + wait explicit agreement ("go ahead", "do it", "yes") before editing plan.

## "Review the Plan"

Call `ExitPlanMode` immediately. That = how user approves plans.
