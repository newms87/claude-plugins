---
name: testing
description: |-
  MANDATORY before any test ACTION — running a test, writing a test, fixing a failing test, deleting a test, adding/changing mocks or fixtures, or REASONING about test coverage. Trigger fires the FIRST time in a session that any of those happen. Pick the right answer mechanically — the disambiguator is "is the user about to act on test contents or test behavior?" If yes, this skill is required. If they are only renaming a file, bumping a dep, editing docs, or moving a fixture path WITHOUT touching test code, this skill is not the right tool.

  FIRES on:
  - Invoking a test runner — `vitest`, `pytest`, `jest`, `rspec`, `phpunit`, `go test`, `cargo test`, `npm test`, `yarn test`, `make test*`, `./vendor/bin/sail test`, any language-specific runner
  - Writing a new test file or adding a test case (`it(...)`, `test(...)`, `def test_*`, etc.) to an existing file
  - Writing a failing test as part of a TDD bug-fix or feature flow
  - Fixing a failing test — changing assertions, adjusting mocks, debugging output, root-causing
  - Deleting a test file or test case (including "obsolete" cleanup of tests whose subject module is gone)
  - Creating / updating / removing mocks, stubs, spies, fixtures, factories, conftest fixtures, `vi.mock`, `jest.mock`, monkeypatch
  - Inspecting a test file to answer coverage questions — "does this cover the 401 path?", "is X tested?", "list the gaps in coverage for Y"
  - Reasoning about whether something is sufficiently tested — listing coverage gaps, judging suite quality
  - Reading or reporting test pass/fail counts, suite outputs, CI test results

  DOES NOT fire on (these are FILE / CONFIG / DOCS edits, NOT test actions):
  - Renaming a test file with no content change (e.g. "rename launcher.test.ts to spawn-agent.test.ts — file rename only")
  - Moving a fixture file to a new path and updating imports (path-only edit, no test logic touched)
  - Bumping a test-framework dependency version in `package.json` / `pyproject.toml` / `Cargo.toml` (dep version bump only)
  - Updating CI / GitHub Actions / pipeline config — cache settings, runner image, scheduling — when no test code or test command changes
  - Adding test-output directories (`coverage/`, `.pytest_cache/`, `.vitest-cache/`) to `.gitignore`
  - Editing docs ABOUT tests — README badge URLs, CONTRIBUTING heading anchors, doc rewordings of test sections
  - Updating non-test npm / cargo / composer scripts (lint, format, build) where the test-script line is untouched
  - Deleting test-adjacent shell scripts / runner wrappers when no test code or test invocation changes

  Loads the complete testing discipline (output-to-file, TDD, you-own-every-test, filter-first, no-skip, deterministic fixtures, mock discipline, framework gotchas, anti-pattern catalog) as a TodoWrite checklist. Invoke BEFORE the first tool call in a test-related sequence — never after. You do not get to invoke a single test "just to see," add a fixture, create a mock, delete a test file, fix a failing test, or report test results without this skill first.
---

# Testing Skill

Tests are the contract between intent and behavior. Most test bugs are caused by skipped steps — starting to run before you know what you're running, writing before you know what you're verifying, fixing before you know why it failed. This skill is the checklist that prevents all three.

## When to Invoke

**ALWAYS, the first time in a session you touch any test.** No exceptions. No "it's just one test." No "I'm only checking." No "the suite will take 20s, let me just run it." Triggers include:

**Run triggers:**
- About to invoke `vitest`, `pytest`, `jest`, `rspec`, `go test`, `cargo test`, `phpunit`, `./vendor/bin/sail test`, `make test*`, `npm test`, `yarn test`, or any project-specific wrapper
- About to re-run a test you just ran
- About to run the full suite
- About to run a filtered/single test
- About to run a test in a subprocess, CI script, or pipeline step

**Write triggers:**
- About to create a new test file
- About to add a test case to an existing file
- About to write a failing test for a bug fix (TDD)
- About to write a test to verify a newly added feature
- About to extend a mock helper / fixture / factory / conftest.py

**Fix triggers:**
- A test is failing (yours, pre-existing, flaky-looking, doesn't matter)
- A suite run reports non-zero exit
- About to mark a test as `skip`, `xfail`, `it.skip`, `describe.skip`, `@pytest.mark.skip`
- About to delete a test
- About to change a test's assertions to match "what the code does" rather than "what the code should do"

**Reason triggers:**
- Answering "is this tested?" / "what's the coverage?" / "which tests cover X?"
- About to tell the user "tests pass" or "all green" or "coverage is fine"
- About to run a reviewer agent that will ask about tests

**No minimum size.** A single `it.only` is enough. `make test --filter=one-test` is enough. Editing a single assertion is enough. If your action is test-adjacent, the skill is required.

**The rationalization to watch for:** "This is just to check something quickly." That is exactly the case where the output gets lost, the wrong filter gets used, and the re-run cycle begins. The 30 seconds to create the todos saves 10 minutes of re-running.

## Mandatory Setup — Create the Todo List FIRST

Before running any test command, writing any test code, or making any assertion about coverage, call `TodoWrite` and create one todo per section below that applies to the current task. The todos ARE the workflow. Mark each `in_progress` when you start it, `completed` only when its acceptance criterion is met.

Minimum task sets:

- **Running tests:** pre-run check → invoke → read results → triage failures.
- **Writing tests:** identify contract → AAA plan → write test(s) → run to verify they fail for the right reason (for bug-fix tests) or pass against new behavior (for feature tests) → run adjacent tests to catch regressions.
- **Fixing a failing test:** reproduce the failure → diagnose via the `debugging` skill → fix producer OR update expectation (per debugging decision tree) → rerun → confirm.

Never skip a step silently. If a step doesn't apply, mark it complete with a one-line reason.

---

## Core Invariants (non-negotiable)

These are the load-bearing rules. Violating one invalidates the test run.

### 1. Output goes to a file. Always. The first time.

**Never run a test suite bare.** Always capture:

```bash
<test-command> > /tmp/test-output.txt 2>&1
```

Then `grep`/`tail`/`less` the file. Re-running to change what stdout said is FORBIDDEN.

**Pre-run mechanical check — answer YES before pressing enter:**

1. Does the command redirect stdout+stderr to a file? `> /tmp/…\.log 2>&1` or `--reporter=junit --outputFile=…` counts.
2. If NO, can I honestly claim the output will still be readable after the test finishes? (Terminal scrollback is not "readable" — it's ephemeral and pipe buffers truncate.)
3. If still NO, rewrite the command before pressing enter.

❌ **Forbidden pattern, explicitly:**

```bash
npx vitest run 2>&1 | tail -15                    # lossy
npx vitest run 2>&1 | grep FAIL                   # grep on ephemeral stdout
# …1 failure shown but no stack trace visible…
npx vitest run --reporter=verbose 2>&1 | grep FAIL  # re-run to get different stdout — THIS IS THE BUG
```

Each re-run is a fresh roll of the dice. Flakes evaporate. Ordering changes. The failure you need to read vanishes. Save the output ONCE, grep the file N times.

✅ **Correct:**

```bash
npx vitest run > /tmp/vitest.log 2>&1
# Suite finishes. Now grep the file, not stdout:
grep -E "FAIL|✗" /tmp/vitest.log
grep -A 20 "mockInitPlatformPool" /tmp/vitest.log
tail -30 /tmp/vitest.log
```

One run, many looks. A flake exposes itself once; you study the corpse.

### 2. TDD for every change — no exceptions, no category exemptions

Failing test first, then fix/implement, then verify. Every bug fix, every feature, every refactor that touches behavior. Infrastructure, config, cross-process behavior, agent dispatch restrictions, shell-script helpers, bash-generated content — ALL require a test.

"This can't be unit tested" means you don't understand the problem yet. Go back to the `debugging` skill and keep hypothesizing until you can name the observable behavior that proves the fix.

Never claim something works without test evidence. "I ran it manually and it looked right" is not evidence; it's an assertion without proof. The proof is a test that FAILS WITHOUT YOUR CHANGE and PASSES WITH IT.

### 3. You own every test

**The entire suite is yours.** Not just your changes. Not just the tests you wrote. Every file, every assertion, every fixture — yours.

- NEVER dismiss a failure as "pre-existing" or "not mine."
- NEVER check `git diff` to prove a failure isn't yours as a way to avoid fixing it. Check is simple: **is the suite green?** If no, fix it. The commit waits.
- If a reviewer flags a missing test, write it. No exceptions.
- If a test is flaky, fix the flake or delete the test with a replacement. Never retry until green.

### 4. 100% test coverage on new code

All features and bug fixes MUST have comprehensive tests covering happy paths AND error paths AND edge cases. No exceptions. "I tested it manually" is not coverage.

After every implementation, ask yourself: *"What new public methods did I add, and where are their tests?"* If you can't answer with file:line, you are not done.

### 5. Filter first. Full suite only at the end.

**Always use `--filter` (or the runner's equivalent) for iterative work.** Filtered runs take seconds; full suites take minutes. You iterate on filtered.

**Run the full suite ONLY when ALL are true:**
- Implementation is 100% complete (not mid-work)
- All filtered tests pass
- Changes span multiple domains OR touch shared infrastructure
- You believe changes could break something outside your immediate domain

**Full-suite protocol when you do run it:**
1. Run ONCE, redirected to a file: `<cmd> > /tmp/test-output.txt 2>&1`
2. If failures: fix them with `--filter` iterations
3. After fixes: full suite ONE more time, also to file
4. Read the saved file — NEVER re-run just to see output

### 6. Never run tests in parallel or background from your agent loop

Tests share a database, ports, temp files, file locks. Parallel processes block each other or corrupt each other's fixtures. A second test run while the first is going will lock up — the apparent "hang" is resource contention, not a bug.

- **NEVER use `run_in_background: true` for a test command.**
- **NEVER dispatch a subagent to run tests.** Subagents can edit test files. They never run them. The parent agent runs the suite ONCE after all subagent edits are done.
- While a test suite is running, do NOT edit code, read files, launch agents, or make decisions. Wait. Then proceed.

### 7. No `xfail`, no `skip`, no "known flake" without an action item

If a test is failing:
- Fix it, OR
- Fix the code under test, OR
- Prove it's testing the wrong contract and delete it (with a replacement that tests the right contract)

Skipping a failing test to "come back later" creates permanent debt. If you genuinely cannot fix it in the current scope, create a Trello Action Items card with the exact failure, the exact command, the exact file:line, and what you tried — then fix the real problem, not the symptom, within the session.

---

## Writing Tests — Industry-Standard Practice

### What to test

**Write these:**
- Critical business logic with complex conditions
- State transitions and workflow correctness
- Security, authorization, and permission checks
- Edge cases that could cause data corruption or silent incorrect results
- Error handling and exception scenarios
- Regression tests for every bug fix (reproduces the bug BEFORE fix)
- Behavior at boundaries: empty, one, many; zero, negative, max; missing, null, malformed
- Contracts between modules — the interface, not the implementation

**Never write these:**
- "Factory creates model" — tests the factory, not your code
- "Framework feature works" — relationships, casts, routing, JSON serialization (trust the framework)
- "Database constraint enforces unique" — trust the migration
- Getters/setters without logic — basic property access
- Mock of the DB instead of using a real test DB
- Implementation details: "X calls Y three times" when the observable behavior is "X returns the right value"

**Test rule:** *Would this test fail if MY code has a bug, or only if the framework has a bug?* If the answer is framework, don't write it.

### Test naming — describe the contract, not the code

Good names state a behavior the reader can verify from the outside:

- ✅ `returns_422_when_email_is_missing`
- ✅ `flushes_pending_events_before_the_stop_signal`
- ✅ `retries_exactly_three_times_on_transient_error_then_throws`
- ✅ `updates_the_row_in_place_when_already_processed`

Bad names describe the code:

- ❌ `testFoo` / `test_method_1`
- ❌ `calls_helperFoo_with_args` (implementation detail)
- ❌ `works_correctly` (says nothing)
- ❌ `regression_for_bug_#1234` (opaque — describe what the bug was)

The test name should be a readable English sentence describing a verifiable claim. If you can't write that sentence, you haven't decided what you're testing.

### AAA — Arrange, Act, Assert

Every test has three sections, in that order, separated by a blank line:

```ts
it("returns 422 when email is missing", () => {
  // Arrange
  const request = buildRequest({ email: undefined, password: "x" });

  // Act
  const response = handler(request);

  // Assert
  expect(response.status).toBe(422);
  expect(response.body.errors.email).toBe("required");
});
```

If a single test has multiple Act steps, it is testing multiple things — split it. If Arrange grows past ~10 lines of setup, extract a fixture or helper.

### One behavior per test

If a test's name contains "and" (e.g. `creates_the_row_and_emits_the_event_and_updates_the_cache`), it is three tests. Split them. A failure in any one of the three is then named precisely, and debugging is trivial.

### Deterministic fixtures — no wall-clock, no ambient state

- **No `Date.now()`** in tests. Inject a clock, freeze it, or use the framework's time-travel helpers (`vi.setSystemTime`, `pytest-freezegun`, etc.).
- **No `Math.random()`/`secrets.token_*`** baked into assertions. Inject a seeded RNG or stub the generator.
- **No network calls.** Mock the HTTP client, use a capture server (see existing `src/__tests__/integration/helpers/capture-server.ts`-style helpers), or use a dedicated VCR/fixtures file.
- **No filesystem state leaking between tests.** Use `mkdtempSync` + per-test cleanup, `tmp_path` (pytest), or equivalent.
- **No env-var mutation without restoration.** Snapshot → mutate → restore in teardown.

A test that passes on your machine and fails in CI is almost always a deterministic-fixture violation. Find it, fix it — don't retry.

### Isolation — each test runs in a clean world

- **Mock state resets between tests.** `vi.clearAllMocks()` in `beforeEach` AND explicitly reset any `mockImplementation`/`mockReturnValue` — `vi.restoreAllMocks()` alone does NOT reliably clear return values. Use `restoreMocks: true` in vitest config where possible.
- **DB state resets or uses transactions that roll back.** Never share mutable DB rows across tests.
- **No module-level state as test setup.** Fixtures go through the framework's fixture system (conftest.py, beforeEach, etc.). Module globals (`_cache = {}`) leak between tests.
- **Test order must not matter.** If your suite fails when tests run in a different order, you have leaking state. Fix that, don't lock the order.

### Mock discipline

- Mock at the edge of your module (the imported collaborator), not inside it.
- Assert on structural content (`objectContaining`, `stringContaining`, `stringMatching`) when details are irrelevant — fragile tests over-specify.
- Verify call counts when they matter (`toHaveBeenCalledTimes(1)` for non-idempotent operations), not for every call.
- Never mock what you're testing. If you're testing `foo()`, don't mock `foo`'s internals so heavily that you're asserting mock call shapes — that tests the mock, not the code.

### Test protected/private methods when they hold logic

Protected/private methods contain logic that needs tests. Either:
1. Make the method public and test directly (often the right answer — if it's worth testing, the contract is worth exposing), OR
2. Use reflection / `__privateAccess` / framework equivalents to reach in and test

Never skip a test because the method is protected. "Can't easily test" is not a technical limitation; it's a design signal.

### Dependency count is never a reason to skip

If a class has 5, 10, or 100 dependencies, mock them all and write the test. Extract common mock setups into a shared helper (trait, fixture, factory) so multiple tests reuse the scaffolding. "Too many mocks" is a rationalization, not a technical blocker.

---

## Fixing Tests — the Failure Triage Order

When a test fails:

1. **Reproduce the failure locally, from the saved output file.** Not from memory, not from scrollback.
2. **Invoke the `debugging` skill** — failing test is a classic debugging trigger. The full Reproduce → Evidence → Producer → Hypothesis → Proof chain applies.
3. **Decide: fix the producer, or fix the expectation?** Per the debugging skill's Phase 3 (Identify the Producer):
   - Test is wrong, code is right → update the test (rare — be suspicious).
   - Code is wrong, test is right → fix the code.
   - Both are wrong → fix both (rarer still).
4. **Run the single failing test only** (`--filter=…`) to verify the fix.
5. **Run adjacent tests** (same file, same module) to catch collateral damage.
6. **Run the full suite at the end, ONCE, to file.**

**Forbidden triage moves:**

- "This test was flaky anyway, let me re-run it" — re-run is forbidden as a fix. Find root cause.
- "I'll just update the assertion to match what the code does" — that's editing the specification to match the broken code. Stop. The test is documenting a contract; if you're about to change it, you need an explicit reason written into the test name or a PR description.
- "This failure is pre-existing, not mine" — you own it. See Core Invariants #3.

---

## Framework-Specific Notes

### Vitest (TypeScript/JavaScript)

- `vi.clearAllMocks()` in `beforeEach`. Explicitly reset return values too.
- `vi.restoreAllMocks()` in `afterEach` does NOT reliably clear return values — don't rely on it alone.
- If you're writing dashboard/SPA tests, note that `restoreMocks: true` may be set in the dashboard vitest config — DON'T add redundant `vi.restoreAllMocks()` in `afterEach`.
- Run with `> /tmp/vitest.log 2>&1` every time. Suite is fast; output is cheap; lost output is expensive.

### Pytest (Python)

- Pytest is the canonical runner. Never write homegrown `assert_true()` helpers. Never `python3 test_x.py` directly.
- Every new test function MUST carry at least one marker (`unit`, `integration`, `slow`, or project-specific). Markers are declared with `--strict-markers` so typos fail collection loudly. To add a marker, register it in `pyproject.toml` first.
- Tests live in a dedicated tree (commonly `<project>/user_data/tests/` or `<project>/tests/`) mirroring the source tree. A file named `test_foo.py` tests `…/foo.py` — nothing else.
- Shared fixtures (2+ test files) live in `conftest.py`. File-local fixtures stay in the test file. Never use module-level state (`_cache = {}`) as shared setup.
- Run tests via the project's documented wrapper (Makefile target, docker-compose profile). Never `pytest` directly in commits or CI configs — go through the wrapper so invocations are consistent.
- Use `pytest.raises(SomeExc, match="...")` to assert expected failures. Never `try/except` to swallow — that's how silent bugs become permanent.

### Vue / UI tests

Vue warnings are bugs, not noise. Zero-warning policy. Common causes:
- Composable with lifecycle hooks (`onMounted`, `onUnmounted`) called outside a component setup — wrap in `mount(defineComponent({ setup() { … } }))`.
- `defineComponent()` result passed as a prop — wrap with `markRaw()`.
- Required prop omitted — always provide all required props.
- Empty object `{}` used as a component stub — use `defineComponent({ template: "<span />" })`.

For UI features: type checks (`tsc --noEmit`, `vue-tsc --noEmit`) verify CODE correctness; running the feature in the browser verifies FEATURE correctness. Type-green is not feature-done.

### System tests / E2E

- Always against a running worker/server — verify liveness before firing.
- Always capture the full output to a file — system tests are slower than unit, and re-runs are expensive.
- Always self-clean. Create throwaway state (test cards, test rows, test files) with deterministic names (include a timestamp and PID), and always delete on every exit path — including early returns and exceptions.
- Prefer empirical verification (did the side effect actually happen?) over self-reporting (did the agent say it happened?).

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
