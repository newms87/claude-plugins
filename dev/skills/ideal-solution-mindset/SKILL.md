---
name: ideal-solution-mindset
description: 'Core dev principles: ideal correct solution, no legacy/fallbacks/dead code, fix forward never revert, reduce complexity, DRY + SOLID reuse-first.'
---

# Ideal Solution Mindset

`Correct > Fast` · `Hard cut > Migration` · `Forward > Backward` · `Simple > Clever` · `Reuse > Rebuild`

## The Mission

Build the system **correctly** every time. Cost, effort, and token usage are never factors when choosing between a correct solution and a worse one. Every line either earns its place under the principles below or is deleted in the same change. This blocks two mirror-image failures: the fastest patch that leaves a legacy path running (below), and withdrawing your own imperfect new work instead of finishing it (#2b).

**Principles-only and context-free** — applies identically to autonomous workers, dispatched agents, and human-in-the-loop sessions. Whether/how to surface a decision to a human is `human-collaboration:human-loop`'s concern.

## The Principles

### #1 — Ideal Correct Solution

The architecturally correct, runtime-best answer is the **only** answer. Dev time, code size, repo count, "we'd have to touch the shared library" are anxieties, not constraints.

Gate: *"Is the only reason I prefer A over B that A is faster to write?"* Yes → drop A, choose B, don't mention it. **Disqualified** as a reason to prefer the worse approach: takes longer, touches another module/repo, needs new tests/types/abstractions — each is just what the ideal approach costs. Pay it.

Real trade-offs are only ones the **running system** experiences differently: architecturally-clean approaches with different invariants; a runtime trade (latency/memory/freshness/determinism/security); or a capability gap that can't be filled in scope. Dev-effort-only difference → no decision, pick the ideal one.

### #2 — No Legacy, No Fallbacks, No Dead Code

A legacy path that "still works" is as dangerous as a known bug — it hides the new contract and trains readers to expect both shapes. One correct way per concept, always. Hard cuts are the default: touching an area → bring the rest of it to the new shape in the same change. Non-conforming out-of-scope callers **fail loudly**, never silently degrade.

**Deleting a feature means erasing every trace of it** — the codebase must read as if it never existed. A comment/test/guard whose only purpose is recording a feature is gone is itself dead weight: delete it with the feature. (Guarding a *generic* anti-pattern class with no implementation to delete — "never write a back-compat reader" — is a standing rule, not a tombstone; the line is whether it names one specific dead feature.)

Forbidden:
- "Old format" + "new format" handling in one function; `if (legacyShape) {…} else {…}` migration branches; fallback values papering over a missing required input.
- A new required scope/identity/key field made `optional` with a default so a migration "stays transparent" — this becomes a permanent silent fallback. Backfill existing rows explicitly in the migration; every new write supplies the field or fails loud. A parent legitimately having zero of the new entity is a valid state, never a trigger to invent a default.
- Shims, back-compat adapters, deprecated wrappers re-exporting the new name, dead exports/imports/routes, commented-out blocks, `# TODO: remove`, `try/except: pass` swallowing errors to keep an old caller alive.

Gate before saving any file in a fix or refactor: *"Is there any code here made obsolete by my change that I left intact?"* Yes → delete it in the same commit, update every caller, fail loudly at any remaining surface. "Out of scope" is the rationalization that ships dead code.

### #2b — Fix Forward: Never Revert Work That Is Merely Imperfect

#2 deletes code that is **wrong**. This protects code that is **right and unfinished** — easily confused with #2, since "remove it" feels like the same tidy instinct.

**When something you built doesn't work perfectly, fix it. Do not withdraw it.** A revert costs the code AND the understanding that produced it, and a write-up left behind now describes a defect no longer in the tree, so nothing can check it — a confident explanation on top is worse than the defect.

Gate: *"Can this defect harm a person or destroy data TODAY, in something already shipped and depended on?"* **No** → fix it forward (cosmetic breakage, a wrong offset, 2/4 cases working, not yet fully understood — unreleased/consumer-less work can't harm anyone, so reverting only maximizes delay). **Yes** → removal is on the table, weighed against a forward hotfix, whichever reaches safety faster — otherwise only four reasons to remove instead of fix: (1) explicitly told to revert; (2) wrong and unwanted, not imperfect — #2's territory, tombstone included; (3) starting over is genuinely faster — say so and start over, don't remove-and-stop; (4) should be eliminated and forgotten, not deferred.

Rationalizations this gate blocks: "isn't finished," "works in some cases," "not certain of the cause," "a checkpoint/handoff is coming." A session boundary is not a deadline. Can't land now → ship behind the narrowest safe switch; leave the diagnosis in the source beside the code it explains, never in a report standing where the code used to be.

### #2c — Fail Loudly: No Fallbacks for Critical-Path Errors

A critical failure (save fails, an MCP call unreachable, state comes back corrupted) aborts loud, immediately, at the point of failure — a fallback here is #2's legacy-shape thinking applied to error handling.

Forbidden: a try-A-then-B chain (two surfaces now hold partial truth); a default returned on error; an optional discriminator defaulted when missing (`obj.kind ?? "unknown"` — missing IS the bug); swallow-and-log with no rethrow; anything named `bestEffortX`/`tryX`/`safeX` on a critical path; a retry-with-different-mechanism chain (HTTP → DB → filesystem queue…) where truth lives nowhere.

Not a fallback: input validation, pagination/optional-arg defaults, a bounded timeout on an external call (the timeout firing loud IS the failure surface), or a bounded Tier-4 retry used as insurance. Name the invariant being guarded; recover only if genuinely recoverable at this layer, else throw as close to the producer as possible. A fallback reaching `main` is an emergency — fix upstream and delete it in the same change.

### #3 — Reduce Complexity

Complexity and over-engineering are the same failure. Design feels complex → ask "what's the simplest shape that could solve this?", then "is that shape also correct?" — yes → ship it; no → climb just far enough to be correct, no further.

Forbidden: a new abstraction layer "in case we need it later"; a config knob for a value with one correct setting; a generic helper with no current caller; unreachable state-machine branches; a wrapper class that only delegates to its single dependency.

Gate: *"What would this look like if I refused to add it?"* Correct → ship that. Wrong → name the specific invariant the new layer enforces; that's the only thing it's allowed to do.

### #4 — DRY + SOLID — Reuse Before You Build

Before adding any new utility, class, service, helper, or pattern, prove nothing already does this job — skipping the audit means a duplicated concept and every future reader guessing which copy is canonical.

Audit (search, don't guess): same capability under a different name (grep the operation in plain English, the data shape, the directory siblings); same capability, partial coverage (extend it, don't fork); same capability, wrong location (move it, don't copy it). Only after the audit returns nothing usable, write the new thing; name what you searched for in your plan.

Forbidden: reimplementing date/id formatting, an error-envelope shape, or an event-bus call that already lives in a shared module; a new service class whose methods only delegate 1:1; copy-pasting a helper because "importing felt awkward."

SOLID is the orthogonal half: single responsibility per class, depend on the abstraction the system already exposes, don't reach across domain boundaries.

## Pre-Plan Reflection Loop (before declaring any plan ready)

Mechanical, in order: (1) state the goal in one sentence, the system's own nouns; (2) name the ideal correct shape — *the* shape, not an option; (3) reuse audit — what already does part of this? cite paths; (4) legacy audit — what does this make obsolete? list paths, commit to deleting in scope; (5) complexity check — is the plan the simplest correct shape, or one layer above? (6) experiment check — could a quick one confirm/kill this? dispatch a sub-agent to RUN it, never one that re-implements the rule under test or reads a comment as confirmation; (7) removal audit — does the plan remove anything merely unfinished? that's #2b — fix forward or name the exception; (8) cost-only objections — did "faster to ship" shape the plan? re-evaluate without that filter.

Any step changes the plan → restart from (2). Ready when one full pass produces no edits.

## Red Flags — Stop Immediately

| Thought | Violation |
|---|---|
| "I'll just add a flag for now" / "faster to keep both shapes" | #2 — delete the legacy path / pick the ideal shape |
| "This is getting complex but I think it's fine" | #3 — restart the simplification loop |
| "I'll write a new helper for this" | #4 — until the reuse audit is in writing |
| "I'll leave the old function, something might still call it" | #2 — find every caller, remove or update, delete it |
| "I'll leave a comment/test noting the feature was removed" | #2 — a tombstone is dead code; the clean tree is the record |
| "I'll add a fallback so it doesn't break in the old case" | #2c — fail loudly instead |
| "Make the new field optional with a default so migration stays transparent" | #2 — required + fail-loud; backfill in the migration |
| "I'll come back and clean this up later" | Won't happen — clean it up now |
| "I'll revert this and redo it properly later" / "safer to back out until I understand it" | #2b — later is now; understanding needs the code that reproduces the defect |
| "Works for some cases but not all, pull it for now" | #2b — partial isn't wrong; finish the remaining cases |
| "A handoff/checkpoint is coming, so leave the tree clean" | #2b — a session boundary is not a deadline |
| "Can't reuse the existing endpoint because \<constraint\>" | Unverified until you cite the `file:line` that enforces it — a hypothesis, not a constraint |

## Composes With

This skill owns the decision/principle; these own the mechanics — this skill wins on principle, they win on mechanics.

- `dev:git-discipline` — mechanics of destructive git ops.
- `dev:code-quality` — file-level execution (refactor first, comments-are-authoritative).
- `dev:debugging` — read-only-by-default investigation and bug-fix workflow; this skill adds "delete obsolete code in the same commit" and the #4 reuse audit to its findings.
- `danxbot:plan-workflow` — where a plan is recorded; this skill is what it must satisfy before leaving plan mode.
- `human-collaboration:human-loop` — when/whether to surface a decision to a human; this skill applies regardless.
