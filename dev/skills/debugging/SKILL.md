---
name: debugging
description: 'Investigation + bug-fix discipline: hypothesis → evidence → findings, read-only by default until an explicit instruction to fix (a dispatched card counts as that instruction). Read-only mode reports and stops; fix mode continues through TDD to a verified fix, with the Phase-12 bug-report format for user-facing bugs. Load before investigating a bug or asserting how something behaves — DX-3235: this replaces the retired per-turn debugging-gate hook, which could not tell a background task notification from an operator prompt.'
---

# Debugging Skill

Bugs = skipped steps. The checklist IS the work. **No minimum size** — a typo causing a 500 gets the same checklist as a stack trace with no repro.

**Triggers:** test fails, command errors, unexpected value, user reports broken, stack trace, timing/latency claim, causality claim ("failed because Y"), any factual claim about runtime behavior (timing, causality, process state, config) without direct evidence, hedging in a draft ("probably," "typically," "should be").

**Direct-quote exemption:** "What params does func X take?" = file read + quote. Any claim beyond direct quotation needs this skill.

## Mode switch — read-only by default

**Default mode is READ-ONLY.** Before investigating, say so plainly: state that you will change nothing and only report — no `Edit`, `Write`, `git checkout`, kill, restart, deploy, or MCP write tool during this pass.

**Switch to fix mode only on an explicit instruction to fix.** The user says "fix it" or names an action verb, or — for a dispatched worker with no operator to ask — the dispatched card itself IS that instruction: being handed the card to work counts as authorization to fix. Forbidden: treating a bare question, an observation, or "yes that's a bug" as fix authorization in an operator session.

Once in fix mode, the same evidence discipline continues straight through implementation — you do not stop and re-report before fixing.

## Mandatory setup — create the todo list first

Before reading code, running commands, or proposing anything, call `TodoWrite` with one todo per phase below. Mark `in_progress` when started, `completed` only when its acceptance criterion is met. A phase that doesn't apply is `completed` with a one-line reason ("N/A — no stored data involved") — never skipped silently.

## Phases 1–5 — Reproduce → Prove (both modes)

1. **State the question / reproduce.** One sentence, specific scope, not "investigate the worker." If user-reported, ask for the URL / request-id / steps — don't guess. STOP if you can't reproduce.
   - Bad: "investigate the service"
   - Good: "Why does the checkout API return 500 for guest-cart requests in staging?"
2. **Hypothesis, before tools.** "I expect X because Y. If right, evidence Z appears. If wrong, evidence W appears."
3. **List evidence sources**, cheapest/most-direct first: file paths, process state (`ps`/`docker ps`), logs, DB rows, HTTP probes, config, `git log`/`blame`, authoring history. No fanout before committing to the cheapest source.
   - **Definition-before-history gate.** "What does X do now" (a named make target / script / route / config key) → read its CURRENT definition first (grep the literal name, read the whole match); only then reach for `git log`/`blame` to answer "how did it change." Already formed a verdict and reaching for history to confirm it → STOP, re-read the current definition in full first.
4. **Gather evidence.** Capture verbatim: file contents (cite line numbers), command output (exit code per `base:shell-discipline`), HTTP shape, DB row shape. **Read-only pass: zero edits** — only read tools, read-only Bash, and WebFetch. Read-only probes need NO authorization, including against prod/remote (`ps`, `curl`, `docker logs`, `psql SELECT`) — gathering them IS the job. Never say "I can't see prod from here" or offer a read-only probe as something to approve. Only a WRITE against prod (restart, deploy, secrets-push, DB mutation) crosses the authorization line.
5. **Verify against hypothesis.** Confirms → continue. Contradicts → revise the hypothesis, say so, re-run step 3 if needed. Ambiguous → name the disambiguating evidence and get it. Never silently retcon a wrong guess.
   - **Identify the producer** (bug-specific): find what wrote the bad value — (1) currently buggy, (2) was buggy, now fixed, (3) expectation wrong, (4) external source. Answer all four before editing.
   - **Source-of-truth gate.** Before claiming row/record X causes behavior Y, grep the decision-point query and confirm your evidence comes from the EXACT field the consuming code reads, not a sibling surface that merely looks authoritative. A `status='running'` row ≠ a live process — check the pid.
   - **Green-parts, broken-whole.** Every adjacent probe that comes back green is evidence about a component, not about the still-failing path. Before any root-cause claim, reproduce the symptom on its own end-to-end path and observe the exact artifact the consumer sees (the actual HTTP response on the same url/port, the rendered DOM, the actual returned value) — not a chain of green neighbors.

## Read-only mode ends here — report and STOP

Report per `base:convey`, ≤20 lines, zero codebase context assumed:

1. **Headline** ≤12 words, plain English
2. **Problem** — 1-2 sentences, user-visible terms
3. **Steps to reproduce** — numbered, observable from outside the code
4. **Expected** / 5. **Actual** — one sentence each, never combined ("X failed because Y")
6. **Root cause**, plain English first, symbols allowed only in parens after
7. **Evidence** — `file:line` / command / row refs, short bullets
8. **Hypothesis delta**, only if the guess changed
9. **Fix options** — plain English, numbered, no code/diffs/paths in the option text

Forbidden: hedging, a unilateral fix as the first option, "do nothing," "investigate further" as filler (only when a specific next probe is named), unverified suspect lists ("Suspect X, or Y, or Z").

**Then stop.** No "while we're here." Wait for the user to pick — or, for a dispatched worker, proceed straight into fix mode, since the dispatch already is the fix instruction.

## Fix mode — Phases 6–11

**6. Solution quality**, decided before writing code: (1) mechanism not symptom, (2) textbook for the platform, (3) fixes the class not the instance. Tier 1 (mechanism/textbook) > Tier 2 (architectural) > Tier 3 (observability, co-ships with T1) > Tier 4 (defense, under T1 only). Forbidden: symptom-only patch, retry as the primary fix, a local patch without naming other call sites, "later" with no artifact.

**7. Write the failing test.** TDD non-negotiable; the test describes the bug, not the fix — see `dev:testing`.

**8. Implement.** Fix the producer (case 1/4), plan a data fix (case 2), fix the expectation (case 3). Minimal — no fallback/consumer-tolerant patch (`??`, `try/catch`) papering over the bug; see `dev:ideal-solution-mindset` #2.

**Mechanism-read gate (mandatory before the first edit/commit).** Quote, from the source that ENFORCES the behavior (`file:line`) — never an error string, a sibling test's pattern, or "the other case does X" — the rule the fix must satisfy. Can't cite the enforcing code → you don't understand the fix yet: keep reading, don't edit. Doubly mandatory when validation is expensive (a multi-minute run, an LLM pipeline, a deploy) — there you get one shot, so certainty comes from reading the contract, never "commit a guess and see what the next run says."

**9. Verify.** Failing test passes, related tests pass, original trigger gone, evidence captured.

**10. Backfill / migrate** (if stored data was wrong). Idempotent + incremental (delta + high-water mark, never truncate-reload) — cost/time identical on the 10th run.

**11. Close the loop.** Update the card/notes. File an Action Item if a rule/doc gap enabled the bug; propose a rule update if the class repeats.

## Phase 12 — Bug explanation format (mandatory for every user-facing bug report)

Trigger: the response will tell the user about one or more bugs/problems/failures/regressions — whether just diagnosed, asked to "explain X," summarizing a test run, or listing what's broken. Every distinct bug gets its own block, no narrative substitution:

```
## #N — <one-line bug name>
- **Affects:** who/what is impacted (component, command, code path, user role)
- **Env:** environment/runtime/config/state required to hit it (host vs docker, flags, version, prerequisite data)
- **Scenario:** the exact step sequence that triggers it — concrete, not abstract
- **Expected:** what the system was designed/documented to do at that step
- **Actual:** what it actually does, including the specific symptom (error message, exit code, wrong value, missing record)
```

A side effect uses the same shape under `Side-effect — <name>`. A summary table may serve as a TOC at the top but never replaces the per-bug blocks. Forbidden: narrative bug reports ("So what happened was…"), mixing Expected/Actual in one sentence, skipping Env as "obvious," combining N bugs into one block to save space.

## Anti-patterns

| Anti-pattern | What it looks like | Why it fails |
|---|---|---|
| Detective-carpenter | Find "timeout too short" → bump it → never learn whether a deeper bug was masked | Symptom patch hides the real defect |
| Hedging | Zero numbers, useless | Not falsifiable |
| Scope drift | "Why did one dispatch fail" → auditing the whole week | Answer the original question, then stop |
| Suspect lists | "Suspect X, or Y, or Z" on vibes | Forbidden unverified; one verified candidate, or name the next probe |
| One-to-all extrapolation | Read 1 instance, asserted the whole set ("all 5 cards are X") | A claim quantified over N items requires N items read |
| Symptom-suppressing accessor | `?? []`, `is_string` branch, `try/catch`, return null to silence a type error | Hides the bug from every other reader of the same data |
| "Obvious" one-line fix | Skip reproduction/evidence because the diff is small | A small guess is still a guess |
| Read-code-then-conclude | "Looking at this function, the bug must be X" — nothing run | Code says what could happen; only runtime says what did |
| Adjacent-artifact substitution | Verify artifact A (an import, a config key, a filename) and assert a different fact B it merely connects to | The driver is not the database; the key is not the value — verify the target fact directly |
| Stop at first finding | First grep hit becomes the answer, no producer trace | Multiple producers may exist |
| Restart-to-fix | Restart a stuck queue/server without reading the error | Restarts hide the error the log already had |
| "Pre-existing, not mine" | Deflect a failing test that predates the change | You own the entire codebase, always |
