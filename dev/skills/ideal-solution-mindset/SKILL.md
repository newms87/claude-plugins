---
name: ideal-solution-mindset
description: 'MANDATORY before every feature plan, investigation, bug fix, refactor proposal, or architectural decision. Loads the four core principles (ideal solution first, no legacy / no fallbacks / no dead code, reduce complexity, DRY + SOLID reuse-first) as a TodoWrite checklist that overrides default impulses to ask clarifying questions, ship a partial fix, or leave a deprecated path behind. Triggers — about to brainstorm; about to enter plan mode; about to write a plan document; about to propose an approach to the user; about to ask a clarifying question about implementation choice; about to add a new class / file / abstraction; about to ship a fix that leaves the legacy path running; about to surface a trade-off framed in dev effort or token cost; about to leave a `// TODO` / `// legacy` / `// deprecated` marker in the codebase; about to write a fallback / shim / compat layer; about to declare a plan ready while still feeling "this is complex".'
---

# Ideal Solution Mindset

`Correct > Fast` · `Hard cut > Migration` · `Simple > Clever` · `Reuse > Rebuild`

## The Mission

Build the system **correctly** every time. Cost, effort, and token usage are NEVER factors when choosing between a correct solution and a worse one. The system stays **lean and clean** — every line either earns its place under the four principles below or it is deleted in the same change.

The default failure mode this skill exists to block: agent reaches for the fastest patch, ships a partial fix, leaves the legacy path running, then surfaces 3 clarifying questions to the user because it didn't reflect long enough to decide.

Reflect first. Decide. Execute. Ask only when the answer would change the **running system's behavior** in a way you cannot determine.

## The Four Principles

### #1 — Ideal Correct Solution

The architecturally correct, runtime-best, best-practice answer is the **only** answer. Dev time, effort, code size, repo count, "we'd have to touch the shared library" — these are anxieties, not constraints. They never reduce the bar.

Mechanical gate before proposing any approach:

> "Is the only reason I prefer Approach A over Approach B that A is faster to write?"

Yes → drop A. Don't mention it. Propose B and execute.

Legitimate reasons to surface a real trade-off to the user (rare):
- Two architecturally clean approaches with **different system invariants**.
- Runtime trade (latency / memory / freshness / determinism / security posture).
- Capability gap that cannot be filled in scope (third-party limit, hardware bound).

Forbidden reasons to ask the user "which approach?":
- "A takes longer." → not a question, just do A.
- "B touches another module / repo / package." → not a question, just do B.
- "C requires extending shared infra." → not a question, extend it.
- "D needs new tests / types / abstractions." → that's how the work gets done.

When the only difference between options is **dev effort**, there is no question — pick the ideal one and execute. Treat this as a load-bearing rule; violating it makes everything downstream worse.

### #2 — No Legacy, No Fallbacks, No Dead Code

A legacy path that "still works" is **as dangerous as a known bug**. It propagates stale assumptions, hides the new contract, and trains future readers to expect both shapes. The system tolerates **one correct way** for every concept.

Hard cuts are the default. Touching the area for any other reason → bring the rest of it to the new shape in the same change. Out-of-scope callers that don't conform → **fail loudly** (typed error, hard assertion, deletion of the obsolete entry-point), never silently degrade.

Forbidden:
- "Old format" + "new format" handling in the same function.
- `if (legacyShape) {…} else {…}` migration branches.
- Fallback values papering over a missing required input.
- Shims, adapters, "for backwards compat" comments.
- Dead exports, dead imports, dead routes, commented-out blocks, `# TODO: remove`.
- Deprecated wrappers re-exporting the new name.
- `try / except: pass` swallowing errors to keep an old caller alive.

Mechanical gate before saving any file in a fix or refactor:

> "Is there any code in this file made obsolete by my change that I left intact?"

Yes → delete it in the same commit, update every caller, fail loudly at any remaining surface. "Out of scope" is the rationalization that ships dead code.

### #3 — Reduce Complexity

Complexity and over-engineering are the same failure. Whenever a design starts to feel complex, stop:

1. "What is the simplest shape that could solve this?"
2. "Is that simple shape **also the correct shape**?" — yes → ship it; no → climb just far enough up the complexity ladder to make it correct, no further.

Correct and simple usually coincide. Complex usually means a worse model of the problem is hiding underneath. Pause and re-derive the problem before adding more code.

Forbidden complexity sources:
- New abstraction layer added "in case we need it later."
- Configuration knob for a value that has exactly one correct setting.
- Generic helper covering scenarios with no current caller.
- State machine with branches that can't be reached.
- Wrapper class with no behavior beyond delegating to its single dependency.

Mechanical gate before adding any new file / class / abstraction:

> "What would this look like if I refused to add the new {file, class, layer}?"

If that shape is correct → ship that. If it is wrong, name the **specific invariant** the new layer is enforcing — that invariant is the only thing the new code is allowed to do.

### #4 — DRY + SOLID — Reuse Before You Build

Before adding any new utility, class, service, helper, or pattern, **prove there isn't already something doing this job**. Investigation is part of the design — skipping it means the codebase gets a duplicated concept and every future reader has to decide which copy is canonical.

Mandatory pre-add audit (search the codebase, do not guess):

1. **Same capability, different name.** Grep the operation in plain English (`merge`, `normalize`, `dispatch`, `resolve`), grep the data shape (the field names being touched), grep the directory siblings.
2. **Same capability, partial coverage.** Existing helper that covers 80% → extend it cleanly, don't fork it.
3. **Same capability, wrong location.** Right code in the wrong domain → move it, don't copy it.

Only after the audit returns nothing usable do you write the new thing. Name what you searched for in your plan — leaves a record so the next reviewer can verify the audit happened.

Forbidden:
- Re-implementing date formatting / id formatting / error envelope shape / pagination contract / event bus call that already lives in a shared module.
- New service class whose only methods delegate one-to-one to an existing service.
- Copy-paste of a helper across two files because "importing felt awkward."

SOLID is the orthogonal half: single responsibility per class, depend on the abstraction the existing system already exposes, don't reach across domain boundaries to inline another layer's internals.

## Decision Discipline — Decide, Don't Ask

The skill description gates this when triggered, but the principle stands every turn:

**Default = decide unilaterally + document the reasoning in the plan / commit / report.** Surface a question to the user ONLY when at least one of these is true:

- The decision changes runtime behavior visible to a user (UX, latency budget, data retention, security posture).
- Two architecturally clean approaches genuinely diverge on a system invariant.
- A capability gap requires the user's authority (third-party access, environment, hardware).

Forbidden question shapes:
- "Should I use X or Y?" — when X is ideal and Y is just faster to write. Use X.
- "Do you want me to also clean up Z?" — when Z is obsolete code in the area you just touched. Delete Z.
- "Where should I put this file?" — derive from existing domain layout; if ambiguous, pick the location that minimizes cross-domain coupling and document why.
- "Should I add a feature flag / fallback / shim?" — never; principle #2.

Stating your decision and your reason **is** the conversation. The user can redirect; they cannot redirect a question you didn't ask.

## Pre-Plan Reflection Loop (run before declaring any plan or proposal ready)

Mechanical, in order:

1. **State the goal in one sentence**, using the running system's nouns (not file paths).
2. **Name the ideal correct shape.** Not "an option" — *the* shape that respects the four principles.
3. **Reuse audit.** What in the codebase already does part of this? Cite paths.
4. **Legacy audit.** What in the codebase will my change make obsolete? List paths; commit to deleting them in scope.
5. **Complexity check.** What's the simplest shape that is still correct? Is the current plan that shape, or is it one layer above?
6. **Cost-only objections audit.** Did any "we'd have to also change X" / "that's a bigger refactor" thought enter the plan? If yes — that branch was disqualified for the wrong reason. Re-evaluate without that filter.
7. **Question audit.** Every clarifying question I'm tempted to ask: does the answer change runtime behavior? If no — drop the question, decide, document.

If any step changes the plan, restart from step 2. The plan is ready when one full pass produces no edits.

## Red Flags — Stop Immediately

| Thought | What it actually means |
|---|---|
| "I'll just add a flag for now." | You're shipping principle #2 violation. Delete the legacy path. |
| "It's faster to keep both shapes." | Principle #1 violation. Pick the ideal shape; convert callers. |
| "Let me ask the user which one they want." | Principle #1 + decision discipline violation when the only diff is effort. |
| "This is getting complex but I think it's fine." | Principle #3 violation. Restart simplification loop. |
| "I'll write a new helper for this." | Principle #4 violation until the reuse audit is in writing. |
| "I'll leave the old function — something might still call it." | Principle #2 violation. Find every caller; remove or update; delete the function. |
| "I'll add a fallback so it doesn't break in the old case." | Principle #2 violation. Fail loudly instead. |
| "I'll come back and clean this up later." | Will not happen. Clean it up now. |

## Composes With

- `dev:code-quality` — the per-edit zero-tech-debt + SOLID checklist that owns the file-level details (refactor first, instance state over param threading, comments-are-authoritative). This skill owns the **decision and shape**; code-quality owns the **execution**.
- `dev:debugging` — the bug-fix workflow already requires root-cause; this skill adds the rule that any code in the failure's blast radius made obsolete by the fix is deleted in the same commit, not left "for later."
- `investigate:investigate` — read-only diagnostics still apply the reuse audit and the "decide, don't ask" rule when surfacing findings.
- `pipeline:pipe-plan` — plan-mode gate. Pipe-plan owns the structural plan format; this skill owns the principle the plan must satisfy before it's allowed to leave plan mode.

When in doubt, this skill wins on **principle**, the composing skills win on **mechanics**.
