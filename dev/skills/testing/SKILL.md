---
name: testing
description: 'Test discipline: pre-run output-to-file, TDD, own-every-test, filter-first, no-skip, deterministic fixtures.'
---

# Testing Skill

Tests = contract between intent and behavior. Skipped steps = test bugs.

**Triggers (ALWAYS first time):** invoke runner · run filtering / full suite · write new test · write TDD failing test · fix failing test · delete test · mark skip/xfail · create/update mocks/fixtures · answer coverage question · report test results. **No minimum size** — one `it.only` is enough. **No "quick check" exception** — that's when output gets lost.

## Core Invariants

**1. Output to file, always:** `<cmd> > /tmp/test.log 2>&1` then grep the file. Never re-run to see different output. One run, many looks.

**2. TDD for every change:** failing test first, fix, verify. Infrastructure, config, cross-process — ALL need tests. "Can't be unit tested" = misunderstanding. Prove behavior via test failing-then-passing.

**3. You own every test:** entire suite is yours. Never "pre-existing" excuse. Suite green = green commit waits.

**4. 100% coverage on new code:** happy + error + edge paths. "Tested manually" ≠ coverage.

**5. Filter-first iteration, full-suite at end:** use `--filter` for seconds-not-minutes feedback. Full suite only when implementation complete + domain-spanning.

**6. Never run tests background or parallel:** database/ports/files shared. NEVER `run_in_background: true`. NEVER dispatch subagent to run tests — parent runs suite once after edits.

**7. No skip/xfail without action item:** fix test, fix code, or delete + replace. Skipped = permanent debt.

---

## Test Writing Essentials

**What to test:** critical logic · state transitions · security / auth · edge cases (empty/one/many, null/malformed) · error handling · bug regression · boundaries.

**Never test:** framework features (routing, casting) · DB constraints · getters/setters · implementation details ("calls Y three times"). **Rule:** would this fail if MY code broke, or only if framework broke? If framework, skip it.

**Test name = contract, not code.** ✅ `returns_422_when_email_is_missing` ❌ `testFoo`. Readable English sentence.

**AAA format:** Arrange (setup) · Act (one step) · Assert. Multiple acts = multiple tests.

**One behavior per test.** Name contains "and" = split it.

**Deterministic fixtures:** no `Date.now()` (freeze time), no `Math.random()` (seed it), no network calls (mock), no env-var mutation without restore, no FS state leaking.

**Isolation:** mock resets between tests · DB txn rollback · no module globals · test order ≠ dependency.

**Mock at edge of module, not inside.** Assert structure not call-counts (unless non-idempotent). Don't over-mock the thing you're testing.

**Protected/private methods with logic:** test directly (make public) or via reflection. "Can't easily test" = design signal.

---

## Fixing Failing Tests

**Triage order:** reproduce from saved file · invoke `dev:debugging` skill (full chain applies) · fix producer or expectation · filter-run to verify · adjacent tests · full suite once.

**Forbidden:** "flaky anyway, re-run it" (find root cause) · "update assertion to match code" (editing spec to fit bug) · "pre-existing, not mine" (you own all tests).

## Framework Gotchas

**Vitest:** `vi.clearAllMocks()` + reset return values in `beforeEach`. `restoreMocks: true` in config better than `afterEach`.

**Pytest:** canonical runner via wrapper (make/compose), not bare `pytest`. Every test function needs marker. Shared fixtures in `conftest.py`. `pytest.raises(Exc, match="...")` for expected failures.

**Vue:** zero warning policy. Missing props · lifecycle hooks outside setup · `{}` stub (use `defineComponent({template:"<span/>"})`).

**System/E2E:** verify server running · full output to file · self-clean (delete test state on all exit paths) · empirical verification (did effect happen) not self-report..

---

## Anti-Patterns This Skill Exists to Prevent

| Anti-pattern | What it looks like | Why it fails |
|---|---|---|
| **Bare test invocation** | `npx vitest run` with no redirect | Scrollback lost; re-run cycle begins; flakes evaporate |
| **Re-run to get different output** | `vitest 2>&1 \| tail` then `vitest 2>&1 \| grep FAIL` then `vitest --reporter=verbose` | Each run rerolls flakes; violates the output-to-file rule |
| **Grep FAIL on stdout that's already noisy** | Tests logging ERROR stacks in passing error-path tests get caught by `grep FAIL` | Signal lost in noise; read the summary block, not the log spam |
| **"Pre-existing failure"** | `git diff` to prove a failure isn't yours, then skip it | You own everything. Green suite or no commit |
| **Full suite for a one-line change** | Skipping `--filter` | 20× slower than needed; iteration cost destroys the fix cycle |
| **`it.skip`-as-fix** | Mark failing test skipped, move on | Permanent debt, suite looks green but isn't |
| **Symptom-suppressing assertion edit** | Changing `toBe(42)` to `toBe(43)` to match broken behavior | Editing the spec to match the bug — invert the arrow, fix the code |
| **Subagent running tests** | Dispatching a test-reviewer agent with Bash permission to re-run | Parallel test runs corrupt each other; parent runs tests |
| **Mock that tests the mock** | Asserting on `fn.mock.calls[0][0].mock.calls[0]` | Over-specified; refactor will break the test without breaking behavior |
| **Wall-clock assertion** | `expect(result.timestamp).toBe(Date.now())` without time freeze | Nondeterministic by construction; fix with injected clock |

---

## Why This Skill Is Mandatory

The agent that wrote this skill recently:

- Ran a full test suite three times in a row, each time piping stdout through a different grep because the first bare invocation lost the output. The third run finally redirected to a file — by which point the pre-existing flake had self-resolved and the "evidence" was just a clean green.
- Looked at a passing run's stderr (tests exercising error paths deliberately log errors) and searched for `FAIL`, which matched log noise, not failures. Conclusion was wrong in both directions.
- Did all of this with a rule file open that explicitly said "Always Dump Test Output to File — Re-running to get different output is FORBIDDEN."

A descriptive rule did not prevent the bad behavior. A mandatory pre-run checklist would have. This skill is that checklist. Invoke it every time you touch a test — no exceptions, no minimum size, no "just one." The 30 seconds the skill takes saves every minute the re-run would have cost.
