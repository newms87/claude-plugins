---
name: debugging
description: 'Bug + investigation discipline: Reproduce → Evidence → Hypothesis → Proof + Phase 12 per-bug format (Affects/Env/Scenario/Expected/Actual).'
---

# Debugging Skill

Bugs = skipped steps. The checklist IS the work.

**Triggers:** test fails · command returns error · unexpected value · user reports broken · stack trace / error log · any claim about system behavior · timing/latency claims · paraphrased code description · causality claim ("failed because Y") · config-value assertion.

**No minimum size.** Typo = 500 error. Same checklist applies.

**Direct-quote exemption:** "What params does func X take?" = file read + quote. Any claim beyond direct quotation = needs this skill.

## Mandatory Setup — Create the Todo List FIRST

Before reading code, running commands, or proposing anything, call `TodoWrite` and create one todo per checklist phase below. The todos ARE the workflow. Mark each `in_progress` when you start it, `completed` only when its acceptance criterion is met.

The phases are:

1. Reproduce
2. Capture Runtime Evidence
3. Identify the Producer (for unexpected values)
4. Form Hypothesis
5. Prove the Hypothesis
6. Decide Diagnose vs. Fix
7. Write the Failing Test
8. Implement the Minimal Fix
9. Verify
10. Backfill / Migrate (if data was wrong)
11. Close the Loop

You do NOT skip phases. If a phase doesn't apply, mark it complete with a one-line reason ("N/A — bug is purely runtime, no stored data involved"). Skipping silently is the failure mode this skill exists to prevent.

---

## Phases 1–5: Reproduce → Prove

**1. Reproduce:** exact inputs/env/sequence. If user-reported, ask URL/request-id/steps — don't guess. STOP if can't reproduce.

**2. Capture evidence:** pull actual data (offending row, payload, log, audit record). DB bugs: `SELECT *` + timestamps. Forbidden: "code suggests it must do X".

**3. Identify producer:** find what wrote the bad value. (1) currently buggy, (2) was buggy, fixed now, (3) expectation wrong, (4) external source. Answer all four before editing.

**4. Form hypothesis:** one sentence "X happening because Y causing Z." Every link independently verifiable. 4+ links = don't understand yet.

**5. Prove hypothesis:** experiment (log, debug cmd, repro, dump state). Proof = runtime artifact (log line, file:line, command output, DB row, JSONL). Forbidden proof: different instance, code-read, pattern-match. Pre-report audit: `LINK: <claim> | PROOF: <artifact-id>` for every causal link.

## Phases 6–11: Decide → Close

**6. Decide:** diagnose-only default (need action verb: fix/implement/change). Exceptions: pipeline discovery (own it), user said "fix it" in bug message. Forbidden: treating question/observation/concept-approval as auth.

**6.5. Solution quality:** (1) mechanism not symptom, (2) textbook for platform, (3) class not instance. Tier 1 (fixes mechanism, textbook) > Tier 2 (architectural) > Tier 3 (observability, co-ships with T1) > Tier 4 (defense, under T1 only). Forbidden: symptom-only patch, retry as primary, local patch without naming others, "later" without artifact.

**7. Write failing test:** TDD non-negotiable. Test describes bug, not fix. "Can't unit test" = misunderstanding. All categories (infra, config, cross-process) require tests.

**8. Implement:** fix producer (case #1/#4), plan data fix (case #2), fix expectation (case #3). Minimal. Forbidden: consumer tolerant (`??`, `try/catch`), "legacy data accept it", "error message tells what to change".

**8.0. MECHANISM-READ GATE (mandatory before the FIRST edit/commit of any fix).** Quote, from the source that ENFORCES the behavior (the validator/contract/shape/level/config code itself — `file:line`), the rule the fix must satisfy. An error STRING, a sibling test's pattern, or "the other case does X" is NOT that source — it tells you a symptom, not the governing contract. If you cannot cite the enforcing code, you do not understand the fix yet: keep reading, do NOT edit. **Doubly mandatory when validation is expensive** (a multi-minute run, an LLM pipeline, a deploy) — there you get one shot, so certainty comes from reading the contract, never from "commit a guess and see what the next run says." Committing a fix on an inferred mechanism = the failure this gate blocks.

**9. Verify:** failing test passes · related tests pass · original trigger gone · evidence captured.

**10. Backfill:** idempotent + incremental (delta + high-water mark, not truncate-reload). Cost/time 10th run identical.

**11. Close:** update card/notes, file Action Item if rule/doc failure enabled bug, propose rule update if class repeats.

---

## Phase 12 — Bug Explanation Format (MANDATORY for every user-facing bug report)

**Trigger:** any time the response will tell the user about one or more bugs / problems / failures / regressions — whether you just diagnosed them, were asked "explain X," are summarizing a test run, or are listing what is broken.

**Rule:** every distinct bug gets its own block in this exact shape. No narrative substitution. No "I'll just describe it" shortcut.

```
## #N — <one-line bug name>

- **Affects:** who/what is impacted (component, command, code path, user role)
- **Env:** the environment / runtime / config / state required to hit it (host vs docker, specific flags, version, prerequisite data)
- **Scenario:** the exact step sequence that triggers it — concrete, not abstract
- **Expected:** what the system was designed/documented to do at that step
- **Actual:** what it actually does, including the specific symptom (error message, exit code, wrong value, missing record)
```

Multiple bugs → one block per bug, numbered. A "side effect" of a bug uses the same shape with `Side-effect — <name>` heading. A bug summary table is OK as a TOC at the top, but it does NOT replace the per-bug blocks.

**Why this is mandatory:** prose bug reports collapse the five distinct facts into a single ambiguous paragraph — the reader can't tell whether `Actual` is observed or hypothesized, can't reproduce without re-asking for `Scenario`, and can't decide blast radius without `Affects`. The five fields force every claim to be either evidence-backed or visibly missing.

**Forbidden:**
- Narrative bug reports ("So what happened was…").
- Mixing `Expected` and `Actual` in one sentence ("X failed because Y").
- Skipping `Env` because "it's obvious" — environment-dependence is the most-skipped, most-bug-causing field.
- Combining N bugs into one block to "save space" — each independent failure mode is its own block.

---

## Anti-Patterns This Skill Exists To Prevent

| Anti-pattern | What it looks like | Why it fails |
|---|---|---|
| **Symptom-suppressing accessor** | Adding `?? []`, `is_string` branch, `try/catch`, return null to make the type error go away | Hides bug from every other reader of the same data |
| **"Obvious" one-line fix** | Skipping reproduction + evidence because the diff is small | Small diffs based on guesses are still guesses |
| **Read-code-then-conclude** | "Looking at this function, the bug must be X" without running anything | Code says what could happen; only runtime says what did |
| **Adjacent-artifact substitution** | Verifying artifact A (a driver import, config key, filename, env var) and asserting a *different* fact B it merely connects to — `pg` import → "the DB is Postgres", `.env` key present → "the value is set", filename → "the contents" | A is not B. The driver is not the database, the key is not the value. Name the target fact and verify THAT directly — don't let a nearby artifact stand in for it. |
| **Stop at first finding** | First `grep` hit becomes the answer, no producer trace | Multiple producers may exist; first one isn't always the writer |
| **Restart-to-fix** | Restarting queue/Horizon/server when something is "stuck" without reading the error | Restarts hide errors; the log already had the answer |
| **"Pre-existing, not mine"** | Test fails, deflect because it predates the change | You own the entire codebase. Always. |

## Why This Skill Is Mandatory

The agent that wrote this skill recently:
- Deployed a production hotfix that silenced a TypeError by returning `null` instead of investigating which DB row had bad data and how it got there.
- Wrote a unit test that proved the silent-fallback behavior, calling that "verified."
- Shipped to production thinking the bug was "fixed."

Every step felt locally rational. The checklist exists because that pattern is what local rationality produces under deadline pressure. No amount of "I'll be careful next time" prevents it. The todo list does.
