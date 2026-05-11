---
name: debugging
description: 'MANDATORY for every bug, error, unexpected behavior, failing test, unexpected value, INVESTIGATION (any user request to "investigate," "look into," "find out," "why is X," "how does Y work," "what''s happening with Z"), or any time you are about to make a factual ASSERTION about the state of the codebase — file contents paraphrased (not quoted), timing, latency, process state, config values, runtime behavior, causality, "why X works this way," or any claim that goes beyond a direct file quote. ALSO MANDATORY whenever you are about to COMMUNICATE / EXPLAIN / REPORT a bug or problem to the user — even if the diagnosis is already done, even if the user just asked "what went wrong" or "explain that bug" or "what is broken" — the per-bug breakdown format in Phase 12 (Affects / Env / Scenario / Expected / Actual) is REQUIRED for every bug discussed in the response, no narrative substitutes. No minimum size, no "obvious" exemption, no "explanation mode" escape hatch, no "I already know what it is" escape hatch. Loads the full debugging discipline as a checklist tracked via TodoWrite. Invoke BEFORE running commands, reading code for analysis, drafting any answer that contains claims about this system''s behavior, OR drafting any user-facing bug report / failure summary.'
---

# Debugging Skill

Bugs are produced by skipped steps. This skill exists because every "I'll just quickly check X" turns into a wrong fix. The checklist is the work — not overhead before the work.

## When to Invoke

**ALWAYS, the moment you suspect anything is wrong OR are about to claim anything about this system's behavior.** No exceptions. Triggers include:

**Bug / error triggers:**
- A test fails (yours, pre-existing, flaky-looking, doesn't matter)
- A command, request, job, or pipeline returns a non-zero exit / error / 4xx / 5xx
- A value is unexpected — wrong type, wrong shape, missing field, stale, malformed, null where required, scalar where structured
- A user reports anything broken, weird, slow, missing, or "off"
- You read a stack trace, error log, audit record, or alert
- A previously-working flow stops working
- You catch yourself thinking "that's odd" / "that shouldn't happen" / "let me just check"
- Pipeline discovery (DRY violation, dead code, surprising state) where root cause is unclear

**Investigation triggers (user-initiated, not a bug report):**
- User says "investigate," "look into," "find out," "dig into," "figure out," "trace," "audit," "check on," "look at" ANY state or behavior
- User asks "why is X happening?" / "why does X work this way?" / "how does Y work?" / "what's going on with Z?" about local system behavior
- User asks you to report / verify / confirm state ("is the agent running?", "did the job dispatch?", "what does the config say?")
- Any task that reads "understand X before we act on it"

**Assertion triggers (about to make a factual claim about this system):**
- About to state timing / latency / performance claims ("this takes ~Xms", "that's slow", "on a healthy system this would…")
- About to describe what code "does" in paraphrased form rather than quoted lines
- About to explain causality ("this failed because Y", "the reason X happens is Z", "root cause is W")
- About to answer "why" a local design choice exists, when the answer requires more than quoting a comment or docstring
- About to compare runtime behavior under different conditions (cold/warm, healthy/loaded, before/after)
- About to assert what a config value, timeout, env var, or threshold means in practice

**There is no minimum size.** A typo's root cause matters as much as a 500's. "Explanation mode" is not a lower-evidence register — the same Reproduce → Evidence → Hypothesis → Proof chain applies. If your answer would be an essay built from priors, you are in the exact failure mode this skill exists to prevent.

**The "direct quote" exemption:** You do NOT need the skill to answer "what are the parameters of function X?" — that's a file read + quote. You DO need the skill the moment your answer contains *any* claim that isn't a direct quotation from code, docs, or a tool result captured in this conversation. If you find yourself writing "probably," "typically," "usually," "on the order of," "a matter of," "cold start," "warm system," or any other hedge about local behavior — stop, invoke the skill, measure.

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

## Phase 1 — Reproduce

**Goal:** Trigger the bug deterministically. If you cannot reproduce, you do not understand the bug.

- Identify the exact inputs, environment, user/team, and sequence that triggers it.
- If user-reported: ask for the URL, request id, audit request id, console log, exact steps — do not guess.
- Run the trigger yourself OR find runtime evidence the trigger already happened (logs, audit records, DB state).
- If you cannot reproduce after a real attempt, STOP and tell the user. Do not proceed on a hypothetical bug.

**Acceptance:** You can name the exact conditions under which the bug occurs.

## Phase 2 — Capture Runtime Evidence

**Goal:** Look at what actually happened, not what the code suggests might happen.

- Pull the actual data: the offending row, payload, response body, log lines, audit request, session log, error message in full.
- For DB-backed bugs: `SELECT *` the offending row(s). Check `created_at` / `updated_at`.
- For job/queue bugs: read the AuditRequest's `logs` field, `apiLogs`, `errorLogEntries`, parent/child chain.
- For UI bugs: read the actual frontend component AND observe in the browser. API response is not evidence of what the UI rendered.
- Verify the runtime data was produced by CURRENT code/infra, not a previous version. If unsure, reproduce live.

**Forbidden:** Reading source code and concluding "it must be doing X." Code is not evidence.

**Acceptance:** You can quote the actual runtime values — not paraphrase what the code "should" produce.

## Phase 3 — Identify the Producer (for unexpected values)

**Goal:** Find what wrote the bad value. Skip only if the bug is purely behavioral/control-flow with no data involved.

A wrong value is the output of one or more producers — a write path, a migration, an external import, an upstream service, a cache, a default, a serializer, user input. ONE of the following is true:

1. **Producer is currently buggy** — code in the tree right now writes bad values. Fix the producer + backfill rows it wrote.
2. **Producer was buggy in the past, since fixed** — old rows from old code still carry bad values; current code is correct. Need a one-shot data fix; do NOT add tolerance to the consumer.
3. **Producer is correct, consumer's expectation is wrong** — the schema/type/assumption was always wrong. Fix the consumer's expectation by representing reality, not by silencing it.
4. **External/uncontrolled source** — user input, third-party API, file upload, manual DB edit. The boundary code that ingests must validate; downstream consumers can then trust.

**Mechanical check — answer all four before any code edit:**
1. What is the actual offending value? (quoted from runtime, not inferred)
2. What code wrote it? (`git log -S "field"`, search for assignments, check writers/migrations/imports)
3. When was it written? (timestamps vs. git log of the writer)
4. Is the producing code still in the tree, and is it still wrong?

If you cannot answer one, STOP and investigate. A consumer patch with unanswered producer questions is always a silent fallback in disguise.

**Acceptance:** You have named which of the 4 cases applies and have evidence for it.

## Phase 4 — Form Hypothesis

**Goal:** State what you think is wrong, in writing, before testing it.

- One sentence: "I believe X is happening because Y, which is causing Z."
- Every link in the causal chain (X → Y → Z) must be independently verifiable.
- "A could cause B" is NOT "A is causing B." Check: same file? Same code path? Actually executed?
- If the chain has 4+ links, you don't understand it yet — keep investigating.

**Acceptance:** Hypothesis is written down and every link is testable.

## Phase 5 — Prove the Hypothesis

**Goal:** 100% confidence via runtime proof, not 99%.

- Run an experiment: log statement, debug command, reproduction with controlled inputs, dump intermediate state.
- A passing or failing experiment confirms or refutes ONE link in the chain.
- "I'm pretty sure" is not confidence — it's a guess. Guesses cost 30+ minutes when wrong; proof costs 60 seconds.
- If runtime proof is impossible (rare), STATE this and ask the user before proceeding.

**Forbidden:** Skipping this phase because the answer "feels obvious." Especially for one-line fixes.

**Acceptance:** You have direct runtime evidence (log, output, query result, reproduction) that confirms the hypothesis end-to-end.

## Phase 6 — Decide: Diagnose vs. Fix

**Default = diagnose-only.** The user must give an explicit action verb (fix, implement, change, do it, go ahead) to authorize a code change. After presenting findings + options, you are in a HARD STOP — text only until the action verb.

**Exceptions:**
- Pipeline discovery (a test failing during your own work, a DRY violation found mid-refactor): own it, fix it via TDD.
- User said "fix it" / "make it work" in the same message describing the bug: action verb is present, proceed.

**Forbidden:** Treating a question ("why is X happening?") as authorization. Treating an observation ("X is broken") as authorization. Treating concept approval ("good idea") as authorization.

**Acceptance:** Either you have an explicit action verb, OR you have presented findings and stopped.

## Phase 7 — Write the Failing Test

**TDD is non-negotiable for every change — bugs and features alike.**

- Write a test that reproduces the bug.
- Run it; verify it fails for the reason you expect (not for an unrelated reason).
- The test name describes the bug, not the fix.
- "This can't be unit tested" means you don't understand the bug yet — go back to Phase 1.
- Infrastructure, config, cross-process, agent dispatch — all categories require a test. No exemptions.

**Acceptance:** A test exists, fails when run, and the failure mode matches your hypothesis.

## Phase 8 — Implement the Minimal Fix

- Fix the producer if Phase 3 identified case #1 or #4.
- Plan a data fix (Phase 10) if case #2.
- Fix the consumer's expectation if case #3.
- Smallest change that addresses the root cause. No surrounding cleanup, no opportunistic refactor.
- **Three forbidden reflexes:**
  - Make the consumer tolerant (`is_string`, `?? []`, `try/catch`, return null, default value) — converts a loud bug into a silent one.
  - "It's just legacy data, accept it" — without proving the producer is fixed, you don't know it's legacy.
  - "The error message tells me what to change" — the error tells you where the symptom surfaced; the fix usually lives elsewhere.

**Acceptance:** Code change is minimal and addresses the producer/expectation, not the symptom.

## Phase 9 — Verify

- The failing test from Phase 7 now passes.
- Run related tests (`--filter` on the affected area).
- Reproduce the original bug trigger from Phase 1 — confirm it no longer reproduces.
- Never claim "this should work" or "try refreshing." Test it; confirm; report evidence.
- Never remove debug logs added during investigation until the user confirms the fix works in production.

**Acceptance:** New test passes, related tests pass, original trigger no longer reproduces, evidence captured.

## Phase 10 — Backfill / Migrate (if data was wrong)

If Phase 3 identified case #2 (past producer wrote bad rows now in DB) or if your fix changes a value's expected shape:

- Plan the data fix: migration, repair script, backfill job.
- Make it idempotent — running twice must be safe.
- Make it incremental — process delta only, store high-water mark, not truncate-and-reload.
- State expected cost/time of the 10th run vs. 1st — they should be identical for a recurring job, vastly cheaper for a one-shot backfill.
- Run it. Verify by re-querying the affected rows.

**Acceptance:** All known bad rows are repaired, and the producer can no longer create new bad rows.

## Phase 11 — Close the Loop

- Update the active issue card (Edit the YAML `comments[]` / `retro` directly — the chokidar watcher mirrors the change to the DB and the post-completion auto-sync pushes to the tracker) or session notes with what was found and fixed (if applicable).
- If a rule, doc, or skill failure enabled the bug, file an Action Item via `mcp__danx-issue__danx_issue_create` (see `self-improvement.md`).
- If the same class of bug has bitten more than once, propose a rule update — not a memory note.
- Confirm the user sees the fix as resolved before closing the todo.

**Acceptance:** Trello and rules state reflect what was learned; user has confirmed.

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
| **Stop at first finding** | First `grep` hit becomes the answer, no producer trace | Multiple producers may exist; first one isn't always the writer |
| **Restart-to-fix** | Restarting queue/Horizon/server when something is "stuck" without reading the error | Restarts hide errors; the log already had the answer |
| **"Pre-existing, not mine"** | Test fails, deflect because it predates the change | You own the entire codebase. Always. |

## Why This Skill Is Mandatory

The agent that wrote this skill recently:
- Deployed a production hotfix that silenced a TypeError by returning `null` instead of investigating which DB row had bad data and how it got there.
- Wrote a unit test that proved the silent-fallback behavior, calling that "verified."
- Shipped to production thinking the bug was "fixed."

Every step felt locally rational. The checklist exists because that pattern is what local rationality produces under deadline pressure. No amount of "I'll be careful next time" prevents it. The todo list does.
