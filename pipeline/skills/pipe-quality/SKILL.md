---
name: pipe-quality
description: 'Post-review decision audit. Validates that all findings are addressed and no rationalizations slipped through.'
---

# Quality Check — Decision Audit

**Run this AFTER `/pipe-review` and BEFORE `/pipe-commit`.** This is a mandatory pipeline step that audits your decisions about reviewer findings. Its purpose is to catch rationalizations and skipped findings before they get committed.

---

## Step 1: List Every Finding

Go through each reviewer agent's output (test-reviewer, code-reviewer, architecture-reviewer) and list every finding with its disposition:

| # | Reviewer | Finding | Action | Rationale |
|---|----------|---------|--------|-----------|
| 1 | code | Duplicate createObject() | Fixed | Extracted to trait |
| 2 | arch | Interface naming | **SKIPPED** | "Out of scope" |
| 3 | test | Missing edge case test | Fixed | Added test |

**Every finding must appear in this table.** If a finding isn't listed, it wasn't considered.

## Step 2: Challenge Every Skip

For each finding marked SKIPPED, DEFERRED, or NOT FIXED, run it through this checklist:

### Hard Block: Fallback / Legacy / Dead / Obsolete Code Can NEVER Be Skipped

**Before evaluating skip reasons, check this first.** If a finding involves ANY of the following, it is **UNFIXABLE by skip logic** — fix it immediately, no exceptions:

- **Fallback patterns** — catch-and-default, try-A-then-B chains across different write surfaces (HTTP→DB→filesystem), best-effort wrappers (`try*` / `maybe*` / `safe*` / `bestX*` / `graceful*`), graceful-degradation branches, throw-downgraded-to-warn diffs, schema-version reader branching, `if (legacyShape) {…} else {…}`, swallowed-error catch blocks, `?? DEFAULT` on internal-contract input.
- **Backwards-compatible code** — supporting old AND new formats simultaneously
- **Legacy code** — old patterns, old field names, old APIs that should have been removed
- **Obsolete code** — methods, branches, or formats that nothing should use anymore
- **Dead code** — unreachable code, unused methods, no-op assertions

**Fallbacks are the single most defective bug class merged to `main`.** One merged fallback wastes days of operator + token budget — doom loops, false-positive strikes, ghost re-dispatches, half-applied terminal transitions all trace to a fallback that wrote half of a logical transition. The "DX-242 stop-fallback" class burned ~$1K of budget before root cause was traced. Treat every fallback finding as instant-block. There is no "tier-4 retry exception," no "transient infra blip excuse," no "we'll come back to it" — delete the fallback, fix the upstream cause, ship the review-fixes commit clean.

**These are the PRIMARY MISSION of code review.** Discovering and eliminating fallbacks / legacy / backwards-compatible / obsolete / dead code is the most important thing reviewers do. A finding in this category is the highest-priority finding possible. Skipping it — for ANY reason, including all 3 valid skip reasons below — is a critical violation. None of the 3 skip reasons apply to this category. Not "zero value" (removing dead weight is always valuable). Not "would be wrong" (removing obsolete code is always correct). Not "another agent" (you own it). Not "needs its own card" (the review-fixes commit IS the card).

**If a reviewer flags a fallback, old format, legacy pattern, backwards compatibility, or dead code: stop what you're doing and fix it NOW.** The only override is explicit per-merge user authorization quoted verbatim in the PR body for that specific finding — and even that is a smell that warrants a follow-up conversation about why the codebase is being permitted to keep a fallback alive.

### The Allowlist Gate

**For each skip: name the valid reason.** State which of the 3 valid skip reasons applies (#1 another agent, #2 zero value, #3 would be wrong). Quote the reason number and write ONE sentence of justification.

**If you cannot match your skip to one of the 3 reasons, the skip is invalid. Fix it immediately.**

There are no other categories. Any reason that is not one of the 3 — no matter how logical, practical, or reasonable it sounds — is a rationalization. "Not in my diff," "out of scope," "pre-existing," "separate effort," "too complex," "low priority," "needs its own ticket," "it would take too long," "I'll flag it for later" — none of these are reasons. They are rationalizations. The 3 reasons are exhaustive.

**Never use `git stash` or `git checkout` to check if a failure is pre-existing** — other agents and the user are actively modifying files in this repo, and stash/checkout will destroy their uncommitted work. Pre-existing or not, you own it.

### The Only 3 Valid Skip Reasons

To skip a finding, you MUST choose exactly one of these reasons and explain it in ONE sentence. **All other reasons are invalid — implement the fix immediately.**

| # | Reason | Required Proof | NOT Valid |
|---|--------|---------------|-----------|
| 1 | **Another agent is actively working on it** | Show which untracked/staged files prove another agent is mid-edit in that domain | "Someone else should do this" |
| 2 | **Adds zero value to codebase quality** | The change would not improve readability, maintainability, correctness, OR test coverage — not even slightly | "It's a one-liner," "it tests framework behavior," "it would only test mock wiring" |
| 3 | **The correction would be wrong** | Applying the fix would introduce a bug or break behavior | "Splitting would scatter logic," "the file is cohesive," "I prefer the current architecture" |

**Tightened definitions:**
- **"Zero value" means LITERALLY zero.** If the change improves ANY aspect of quality — even marginally — it has value. "Low value" is not "zero value." A test for a one-liner still verifies it doesn't break. A docblock on a small method still helps the next reader.
- **"Would be wrong" means introduces a defect.** Architectural preferences, cohesion arguments, and "I don't think splitting helps" are not defects. If the code would still work correctly after the fix, the fix is not wrong. **"Would be wrong" does NOT mean "would be hard," "would be large," or "would be risky."** If the fix is just big, that's an effort complaint — not a correctness concern.
- **Cost and time are NEVER factors.** "Too many mocks," "would take too long," "significant refactor" are effort complaints, not skip reasons. The mission is 100% perfect quality code. There is no budget. There is no deadline.

**Mechanical check for #3:** Before accepting a #3 skip, write the specific bug or broken behavior the fix would introduce. Name the defect: what breaks, what produces wrong output, what crashes. If you cannot name a concrete defect — only architectural preferences, scope concerns, or effort complaints — the skip is not #3. "Editing this file requires permission" is not a defect unless you can show which rule applies AND that the rule actually covers the file in question.

**If your skip reason is longer than one sentence, you are rationalizing.** Go fix it.

## Step 3: Challenge Test Coverage

Before committing, verify these test coverage questions:

1. **Did I write tests for every new public method?** If not, why not?
2. **Did I test error/edge cases, not just happy paths?** Validation errors, empty inputs, null values?
3. **Did the test-reviewer flag missing tests?** If yes, did I write ALL of them?
4. **Do my tests verify behavior, not implementation?** Would they still pass after a refactor?
5. **Did I run the relevant test suites and confirm 0 failures?**

## Step 4: Final Gut Check

Before proceeding to `/pipe-commit`, answer honestly:

- **Is there any finding I'm hoping the user won't notice I skipped?** If yes, go fix it.
- **Would I be comfortable if the user asked me to explain why I skipped each skipped finding?** If not, go fix it.
- **If I re-ran the reviewers right now, would they find the same issues?** If yes, I haven't finished.

## Step 5: Proceed or Go Back

- **All findings addressed, all skips justified by the 3 valid reasons above** → Proceed to `/pipe-commit`
- **Any finding skipped for an invalid reason** → Go back and fix it before proceeding

---

## Rules

- **This step is NOT optional.** Skipping it is a pipeline violation.
- **Be honest with yourself.** The whole point is catching your own rationalizations.
- **The table in Step 1 is required output.** Show it so the user can see your decision-making.
- **Speed is not a factor.** Taking 2 extra minutes to fix a finding is always cheaper than shipping a skip.
