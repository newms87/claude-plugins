---
name: pipe-plan
description: 'MANDATORY before EnterPlanMode, before checking off any AC item, before declaring a phase complete, before any commit closing a phase. Loads card-overrides-plan-mode, prose-only plans, zero-context test, phase-boundary audit (no stopgap scaffolding), pipeline auto-execution discipline as TodoWrite checklist. ALSO MANDATORY when picking up a card whose path is NOT clear after initial investigation — this skill carries the "complex card escape hatch" autonomous workers use to expand under-specified cards or escalate architectural unknowns to Blocked.'
---

# Pipe-Plan — Planning + Complex-Card Escape Hatch

## Issue Card Overrides Plan Mode (default)

Card assigned (`ISS-N` YAML at `<repo>/.danxbot/issues/open/<id>.yml`) → DEFAULT is NEVER use EnterPlanMode. Card IS plan. Edit YAML directly with `Edit`/`Write` if plan changes — chokidar mirrors to DB, auto-sync pushes to tracker. Trust spec, execute.

## Complex-Card Escape Hatch (rare)

Default assumes `description + ac[] + phases[]` fully specify. When broken, this is the only sanctioned exit. ALL must hold:

1. Card `status: In Progress`
2. After initial investigation (every referenced file, related skills, parent epic, sibling phases, `<repo>/.danxbot/config/docs/`), path genuinely unclear
3. Unclear part materially affects code, not stylistic
4. NOT mechanical (can't be resolved by reading more code)

Two escape moves only:

### Move A — Card-internal plan expansion (scope clear)

Agent CAN make the decision but card needs detail.

1. `EnterPlanMode` — prose only, zero code blocks
2. `ExitPlanMode`
3. Edit card YAML — append resolved design to `description` OR timestamped Design Note `comments[]`. Update `phases[]` + `ac[]` if changed. (chokidar mirrors, auto-sync pushes)
4. Resume implementation

### Move B — Blocked escalation (out of scope)

Decision agent SHOULD NOT make alone:
- Architectural choice contradicts card directive
- Affects platform invariant (auth boundary, external-caller data shape, deploy contract, prod API)
- Explicitly out-of-scope per card wording
- Requires authoritative judgment (priority, scope, business preference)

When any holds:
1. Edit card YAML — `status: Blocked`, `blocked: {reason, timestamp}`. Reason = one paragraph naming specific decision the human must make + agent's recommended option + tradeoffs. Append same as `comments[]`. Schema invariant `status === "Blocked" ⟺ blocked !== null` requires both edits same save.
2. Stop. `danxbot_complete({status: "completed", summary: "Escalated to Blocked — awaiting decision on <X>"})`
3. NEVER speculatively implement against unclear option

**Move B NOT for:** "too complex," "I'm unsure," "card is short," "I have a better way." Bar is high.

## Plan files

- Location: `~/.claude/plans/` only. Create only via `EnterPlanMode`.
- Edit with `Edit` (Write overwrites).
- Prose only — zero code blocks.
- Zero-context test: write as amnesic — exact file paths, method names, reasoning.

## Card instructions are not suggestions

Card specifies endpoint/component/data → requirement. Genuine blocker → STOP, report + propose alternative. Never silently substitute placeholder + mark complete. "Too complex"/"too coupled" are engineering problems to solve, not blockers.

## Solution Quality Bar — Root Cause Over Symptom

Every proposed approach clears 3 questions or it's draft:

1. **Mechanism, not symptom.** Raising timeout, retry, swallow exception, restart = not solution.
2. **Textbook for platform.** Canonical for language/framework? If not, name textbook answer + justify deviation.
3. **Class, not instance.** Eliminates failure class? Same mechanism at N other sites → name them or open follow-up.

**Tiered ordering — mandatory when >1 option:**

| Tier | Role |
|---|---|
| 1 | Underlying mechanism. Textbook. Default recommendation. |
| 2 | Reduce blast radius (isolation, decoupling, backpressure, concurrency caps) |
| 3 | Observability. Co-ships with T1, never replaces. |
| 4 | Defense in depth (retries, timeouts, fallbacks). Under T1 only, safety net label. Never primary. |

**Forbidden:**
- Symptom-only as solution
- Retry/fallback as primary
- Local patch with N other unnamed sites
- "Quick win now, real fix later" with no named follow-up
- Refusing T1 as "bigger" — name cost honestly

**Evidence thin:** First option = T1-shaped "investigate further to confirm <mechanism>". Never default to T4 because data thin.

## Phase Boundary Audit — No Stopgap Scaffolding

Audit each AC: clean within phase OR stopgap (code bridging missing later-phase capability)?

Smells:
- "Phase N only" branches/flags
- Refetching from remote because local SoT not writable yet
- Fake bridges that don't compose until Phase N+1
- "Transient"/"purely advisory until later" sync paths
- Any branch you'd delete next phase

Stopgap = same anti-pattern as backwards-compat shims. Future-phase capability doesn't yet exist.

**5-line check before AC code:** "Could this AC be ~5 lines using THIS phase's mechanism?" No → misplaced. STOP. Surface, propose move to natural-fit phase. Never design glue.

Forced stopgap:
1. STOP, no glue
2. Read parent epic + sibling phases
3. Identify natural phase
4. Propose to user: remove here, add there
5. Update both card AC checklists + comment
6. Resume slimmed phase

Phase boundaries are estimates — reshuffle = clean signal, not failure.

## Implementation Checklist

Before starting: checklist of all discussed items. Track each. ANY incomplete at commit → STOP + tell user. Never commit partial.

Before checking off: verify literal claim (grep/test/code read).

## Shared Abstractions

2+ classes share logic → name abstraction + location. Continuation sessions need "use X trait/service, don't reinline."

## Phases

One phase = one pipeline run + one commit + one card lifecycle. Commit boundary IS phase boundary.

## Refactoring tools

Renaming/moving across files → specify tool: `phpactor class:move` (PHP), `ts-morph`/`gopls rename`/`rope` (other). Never manual find-and-replace.

## Code Review priorities

Code review = reviewer agents via Task tool, NOT you reading.

**Run when:** Multi-file, >10 lines, new feature, phase completion.

**Priority:**
1. Legacy code, backwards compat, dead code
2. Silent fallbacks (`??`, defaults, implicit infers)
3. Everything else (style, DRY, tests)

Never modify reviewer agents to reduce findings.

## The Pipeline (automatic)

1. Implement (code + tests)
2. `/pipe-review` (fix findings)
3. `/pipe-quality` (audit decisions)
4. `/pipe-commit` (stage + commit)
5. `/pipe-finish` mode A — convey-format report + invoke `/next-phase`
6. Mark phase complete
7. Repeat
8. `/pipe-finish` mode B (session end — Action Items + knowledge dump)

**Pipeline automatic.** Plan approval = pre-approval for entire pipeline. NEVER pause between steps. NEVER ask "ready for code review?" Just execute. Never skip quality gates.

**Mechanical enforcement:** `/pipe-commit` Step 0 aborts with `Phase pipeline incomplete. Missing: [code-review | quality-check]` if either gate skipped. Bypass = `--skip-pipeline` + commit body explanation.

Quality gates: after each phase (independent domains) OR once after all related phases (same domain). Never skip.

**Phase with no code change still runs pipeline.** Verification-only / plan-only / research not exempt. Code-oriented steps no-op on empty diff. Pipeline = structure not work.

**`/pipe-finish` NEVER optional.** Every session ends with it. Captures unwritten knowledge + Action Items.

**Rationalization:** "No code change, no pipeline." Wrong — STOP + run.

## Questions ≠ decisions

Question → answer + wait explicit agreement ("go ahead", "do it", "yes") before editing plan.

## "Review the plan"

Call `ExitPlanMode` immediately — that's how user approves.
