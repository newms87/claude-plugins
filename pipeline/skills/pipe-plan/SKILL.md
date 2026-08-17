---
name: pipe-plan
description: 'Card-overrides-plan-mode + prose-only plans + zero-context test + phase-boundary audit + pipeline auto-execution discipline. human-collaboration:shared-plan runs alongside this, always, in human-driven sessions: the card stays the durable work-record, the shared-plan page is the live planning surface for options/decisions being worked out — not a substitute for the card, not duplicated content.'
---

# Pipe-Plan — Planning + Complex-Card Escape Hatch

## Issue Card Overrides Plan Mode (default)

Card assigned (`<PREFIX>-N`, lives in the dashboard DB) → DEFAULT is NEVER use EnterPlanMode. Card IS plan. Update it via `mcp__danx-dashboard__issue_edit` if the plan changes — the tool writes the DB directly (no file, no mirror). Trust spec, execute.

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
3. Append resolved design to the card — via `mcp__danx-dashboard__issue_edit({id, description})` OR a timestamped Design Note via `mcp__danx-dashboard__issue_comment({id, action: 'add', text})`. Update child phase cards + `ac[]` if changed (`issue_edit`).
4. Resume implementation

### Move B — Blocked escalation (out of scope)

Decision agent SHOULD NOT make alone:
- Architectural choice contradicts card directive
- Affects platform invariant (auth boundary, external-caller data shape, deploy contract, prod API)
- Explicitly out-of-scope per card wording
- Requires authoritative judgment (priority, scope, business preference)

When any holds:
1. Block the card via `mcp__danx-dashboard__issue_transition({id, action: 'block', reason})`. Reason = one paragraph naming the specific decision the human must make + agent's recommended option + tradeoffs. The server stamps `blocked: {at, reason}` and derives `status: Blocked` — no separate `status` write.
2. Stop. `danxbot_complete({status: "failed", summary: "Escalated to Blocked — awaiting decision on <X>"})`
3. NEVER speculatively implement against unclear option

**Move B NOT for:** "too complex," "I'm unsure," "card is short," "I have a better way." Bar is high.

## EVERY plan lives in a card — all repos, always

Whenever you plan work — `EnterPlanMode` or not — the durable work-record is a TRACKER CARD, never a plan file or standalone `.md`. This holds for **every repo, not just danxbot**. (In a human-driven session, `human-collaboration:shared-plan`'s page is ALWAYS also running as the live surface for decisions/options — that's a different vessel for a different audience, not a substitute for the card; link the card id on the page and the page's path/URL on the card.)

**All durable task content lives on the card.** Anything another agent or a human might read, or that you will reference later — design notes, decisions, fix plans, AC, phase handoffs — goes on the card: its `description`/`ac[]`, a `comments[]` note, or a child/new card as fits the scope. A throwaway inline checklist for your own momentary execution is fine; the instant content needs to persist or be seen by anyone else, it belongs on a card.

**ONLY exception:** the user explicitly says we are NOT using cards this time — "just implement", "plan inline", "no card", "don't make a card". Absent that explicit opt-out, file the card(s).

**Which repo (dynamic — resolve, don't assume):**
1. Default = the repo this session is instantiated in (~99% of the time).
2. Plan touches a DIFFERENT or additional repo? List danxbot's connected repos (`mcp__danx-dashboard__issue_list` accepts `repo`; the connected set = `REPOS`/dashboard repo selector) and pick the one the work belongs in — file the card THERE (`mcp__danx-dashboard__issue_create({repo})`).
3. Genuinely spans repos → a card per involved repo (or an Epic in the primary repo with a cross-repo note + sibling cards).

**Mechanical gate before `ExitPlanMode`:** card(s) filed (Epic + phase children for ≥2 phases; reopen an existing id via `issue_transition` rather than re-create). Not filed → not done.

## Plan files

`~/.claude/plans/*.md` is APPROVAL-ROUND-TRIP SCRATCH ONLY — cards are the durable artifact (see the card rule above). A plan that lives only in the file, or a breakdown deferred to an in-plan "Phase 0", is the forbidden parallel-spec failure (issue-card-workflow "NEVER write plans as a standalone `.md` substitute"). When you do use the `EnterPlanMode` file for the approval round-trip:

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
