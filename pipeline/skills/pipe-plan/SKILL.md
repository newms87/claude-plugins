---
name: pipe-plan
description: 'MANDATORY before EnterPlanMode, before checking off any AC item, before declaring a phase complete, before any commit closing a phase. Loads card-overrides-plan-mode, prose-only plans, zero-context test, phase-boundary audit (no stopgap scaffolding), pipeline auto-execution discipline as TodoWrite checklist. ALSO MANDATORY when picking up a card whose path is NOT clear after initial investigation — this skill carries the "complex card escape hatch" autonomous workers use to expand under-specified cards or escalate architectural unknowns to Blocked.'
---

# Pipe-Plan — Planning Rules + Complex-Card Escape Hatch

## Issue Card Overrides Plan Mode (Default Path)

Issue card assigned (e.g. `ISS-N` YAML at `<repo>/.danxbot/issues/open/<id>.yml`) → DEFAULT path is NEVER use EnterPlanMode. Card IS plan. Edit the YAML directly with `Edit` / `Write` if plan changes — the chokidar watcher mirrors the change to the DB on the file event, and the post-completion auto-sync pushes to the tracker. The card was authored by another agent who already planned the work; trust the spec, execute it.

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
3. Edit the card YAML — append the resolved design to `description` (or append a Design Note `comments[]` entry timestamped now). Update `phases[]` if phase structure changed. Update `ac[]` to reflect new acceptance criteria. The chokidar watcher mirrors the edit to the DB; the post-completion auto-sync pushes to the tracker.
4. Resume implementation against the expanded card.

### Move B — Blocked Escalation (when the decision is OUT of scope)

The decision is one the agent SHOULD NOT make alone. This applies when:

- The architectural choice contradicts a stated directive on the card.
- The choice affects an important platform invariant (auth boundary, data shape consumed by external callers, deploy contract, prod-affecting API).
- The choice was explicitly out-of-scope per the card's wording.
- The decision requires authoritative judgment outside the codebase (priority, scope, business preference).

When any of those hold:

1. Edit the card YAML — set `status: Blocked`, set `blocked: {reason, timestamp}` where `reason` is a one-paragraph crisp blocker description naming the specific decision the human must make (with the agent's recommended option + tradeoffs of each candidate). Append the same content as a `comments[]` entry so it surfaces in the dashboard drawer. The schema's invariant `status === "Blocked" ⟺ blocked !== null` requires both edits in the same save. The chokidar watcher mirrors the edit to the DB; the post-completion auto-sync pushes to the tracker.
2. Stop work. Signal completion via `danxbot_complete({status: "completed", summary: "Escalated to Blocked — awaiting decision on <X>"})`.
3. Do NOT speculatively implement against the unclear option — the next agent (after human input) re-picks the card with a resolved spec.

### What Move B is NOT for

Blocked is LAST RESORT — NOT for "too complex," "I'm unsure," "card is short," or "I have a better way." The bar is high.

## Plan Files

**Location:** `~/.claude/plans/` only. Create ONLY via `EnterPlanMode`. Never write plan files manually.

**Editing:** Use Edit (preserves content). Never use Write (overwrites everything).

**Content:** Prose only — zero code blocks. Code locks in details before approval.

**Zero-context test:** Write as if amnesic. Include exact file paths, specific method names, clear reasoning.

## CRITICAL: Card Instructions Are Not Suggestions

Card specifies technical approach (endpoint to call, component to reuse, data to display) → requirement, not suggestion replaceable with simpler alternative. Specified approach has genuine technical blocker → STOP, report blocker to user with proposed alternative. Never silently substitute placeholder + mark work complete. "Too complex" + "too coupled" not blockers — engineering problems to solve.

## CRITICAL: Solution Quality Bar — Root Cause Over Symptom

Applies to every plan you write, every option you propose, every approach you recommend in plan mode, brainstorming, options lists, or commit bodies. Every proposed approach MUST clear three questions BEFORE it appears in the plan or options list. Failing any question = draft, not a candidate.

1. **Mechanism, not symptom.** Does the approach address the underlying mechanism the evidence (or card) identifies? Raising a timeout, adding a retry, swallowing an exception, widening an allowlist, or restarting the process makes the symptom disappear without touching the mechanism — that is not a solution.
2. **Textbook for the platform.** Would a senior engineer reading the diff agree this is the canonical way the language / framework / platform recommends solving this class of problem? If not, name the textbook answer in the plan and justify the deviation in writing.
3. **Class, not instance.** Does the approach eliminate the failure class, or only the one observed instance? Same mechanism lives at N other call sites → say so; either widen the scope or open a follow-up artifact (card / TODO carrying a date or condition).

**Tiered ordering — mandatory when listing more than one option in a plan.** Rank by root-cause depth, never by ease:

| Tier | Role |
|---|---|
| 1 | Fixes the underlying mechanism. The textbook answer. Default recommendation. |
| 2 | Reduces the mechanism's blast radius via architectural change (isolation, decoupling, concurrency caps, backpressure). |
| 3 | Observability. Instrumentation so the next regression surfaces before it bites. Co-ships with Tier 1, never replaces it. |
| 4 | Defense in depth — retries, timeouts, fallbacks, graceful degradation. Ship ONLY UNDER a Tier 1 fix and label as a safety net. Never the primary recommendation. |

**Forbidden in any plan / options list (each fails the bar):**

- Symptom-only patch presented as the solution ("raise the timeout to 60s").
- Retry / fallback / fail-soft branch presented as the primary mechanism.
- Local patch when the same mechanism exists at N other call sites and the patch covers only one — without naming the others.
- "Quick win now, real fix later" without a named follow-up artifact.
- Refusing Tier 1 because it is "a bigger change." Bigger IS what root-cause work looks like — name the cost honestly instead of disguising the deferral as a Tier 4 option.

**When evidence is insufficient to commit to Tier 1:** SAY SO. The plan's first option is a Tier-1-shaped probe ("investigate further to confirm <named mechanism>"). Never default to a Tier 4 patch because the data is thin.

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

One phase = one complete pipeline run + one commit + one card lifecycle. Commit boundary IS phase boundary.

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
5. `/pipe-finish` mode A — post-commit report in `base:convey` format + invoke `/next-phase`
6. Mark phase complete
7. Repeat for next phase
8. `/pipe-finish` mode B (at session end — Action Items + knowledge dump)

**CRITICAL:** Pipeline automatic. User approval of plan = pre-approval for entire pipeline. NEVER pause between steps. NEVER ask "ready for code review?" Just execute. Do NOT skip quality gates.

**Mechanical enforcement:** `/pipe-commit` skill body has Step 0 — Pipeline Preflight that aborts with `Phase pipeline incomplete. Missing: [code-review | quality-check]` if either gate didn't run in the current phase. The rule above (advisory) is no longer the only barrier — the skill itself refuses to commit. Bypass requires explicit `--skip-pipeline` arg + commit body explanation.

Quality gates run after each phase (independent domains) or once after all related phases (same domain). Never skip.

**CRITICAL: Phase with no code change still runs pipeline.** Verification-only phases, plan-only phases, research phases NOT exempt. Still run `/pipe-finish` mode A at phase end + mode B at session end. Code-oriented steps (`/pipe-review`, `/pipe-quality`, `/pipe-commit`) = no-ops on empty diff — still invoke + exit cleanly with "nothing to review / nothing to commit." Pipeline not conditional on code being changed; structure for phase + session closure.

**`/pipe-finish` NEVER optional.** Regardless whether session produced commits, plans, or only investigation, every session ends with `/pipe-finish`. Captures unwritten knowledge + formalizes Action Items otherwise lost when context window destroyed. Skipping `/pipe-finish` because "already filed action items manually" or "no code change" = classic end-of-session shortcut. Do not take.

**Rationalization to watch for:** "No code change, so no pipeline." Wrong. Pipeline = structure, not work — ensures closure happens. Skipping steps because phase light → STOP + run anyway.

## Questions Are Not Decisions

User asks question → answer + wait explicit agreement ("go ahead", "do it", "yes") before editing plan.

## "Review the Plan"

Call `ExitPlanMode` immediately. That = how user approves plans.
