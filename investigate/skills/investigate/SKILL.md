---
name: investigate
description: MANDATORY when investigating, diagnosing, or asserting facts about a running system WITHOUT applying a fix. Triggers — user says "investigate," "look into," "find out," "dig into," "figure out," "trace," "audit," "check on"; user asks "why is X happening", "how does Y work", "what's going on with Z", "is the agent running", "did it dispatch"; user requests read-only analysis of call chains, runtime behavior, worker/process inventory, detector/component interactions, configuration fallback logic, or environment-specific behavior differences; about to STATE a factual claim about timing, latency, runtime behavior, causality, config values, process state, feature flags, or "why X works this way" with anything more than a direct file quotation. Use INSTEAD OF the debugging skill when the assignment is read-only — diagnosis only, no code changes, no failing test, no fix, no modifications to runtime state. If the task crosses into "fix it now," switch to the debugging skill (load it via Skill tool) and follow the full TDD discipline. **When reporting investigation findings about a bug / problem / failure to the user, the per-bug Affects/Env/Scenario/Expected/Actual format from the `debugging` skill Phase 12 is REQUIRED — load `debugging` for the format spec.** Loads investigation discipline as TodoWrite checklist.
---

# Investigate Skill

Read-only diagnostic methodology. Hypothesis → evidence → findings → options. **You do not fix.** You report. The user decides next steps.

This skill exists because investigation and fix-writing are different work, and conflating them produces both bad investigations (skipped because "I'll just patch it") and bad fixes (applied before root cause is known). Use this skill when the assignment is "tell me what's happening." Switch to the `debugging` skill the moment the assignment becomes "fix what's happening."

## When to invoke

**Always, the moment ANY of these is true:**

**User-initiated investigation:**
- "Investigate X" / "look into X" / "find out about X" / "dig into X" / "trace X" / "audit X" / "figure out X" / "check on X" / "look at X"
- "Why is X happening?" / "Why does Y work this way?" / "How does Z work?" / "What's going on with W?"
- "Is the agent running?" / "Did the job dispatch?" / "Did the deploy land?" / "Is the cache warm?"

**About to make a factual assertion about a running system:**
- Timing / latency / performance ("takes Xms," "is slow," "fine on a healthy system," "cold start," "warm system")
- What code does in paraphrase (not direct quotation)
- Causality ("failed because X," "root cause is Y," "this happens when Z")
- Why a local design choice exists, when the answer requires more than quoting a docstring
- What a config value, timeout, env var, or threshold means in practice
- Whether a process is running / a job ran / a service is responsive
- Comparison of runtime behavior under different conditions

If your draft answer contains any of: "probably," "typically," "usually," "on the order of," "a matter of," "should be around," "in most cases," "likely" — about local behavior — STOP. Hedge = tell. Invoke this skill, gather evidence, report numbers.

## When NOT to invoke

- Direct file reads where the answer IS a literal quotation ("function X takes args (a, b, c)", "the const is 2000ms"). Plain Read use covered by general "verify, never guess" discipline.
- The assignment is to apply a fix → use the `debugging` skill instead. That one assumes you'll write a failing test and ship a change.
- Pure documentation lookups → general WebFetch / context7 covers it.

The line: **answer contains any claim not directly quotable from code, docs, or tool output captured in this conversation → investigation, skill required.**

## The Discipline

Pin this checklist via TodoWrite at the START of the investigation. Walk it linearly. No "I'll just check first" shortcuts — those are exactly the steps this skill exists to prevent.

### 1. State the question

Write the actual question being answered, in one sentence, with the specific scope:

- Bad: "investigate the worker"
- Good: "Why does the gpt-manager worker on EC2 prod return 503 for /api/launch when called with the system-test workspace?"

If the user gave a vague prompt, refine it into a specific question first. Tell the user the refined question and confirm before proceeding.

### 2. Form a hypothesis

State your initial guess, in writing, BEFORE running any tool. The hypothesis is wrong half the time — that's fine. Writing it makes the wrongness visible when evidence contradicts it.

Format: "I expect the cause is X because Y. If I'm right, evidence Z will appear. If I'm wrong, evidence W will appear."

### 3. Identify evidence sources

List, in writing, where the evidence lives BEFORE running anything:

- File path(s) — `Read` / `Grep` targets
- Process state — `docker ps`, `ps`, container shells
- Logs — `make deploy-logs`, `docker logs`, JSONL session files at `~/.claude/projects/`
- Database rows — `mysql` exec into the worker container
- HTTP probes — `curl` against worker / dashboard / proxy endpoints
- Config files — `.env`, compose, target YAML, settings.json
- Code authoring history — `git log`, `git blame`

Pick the cheapest, most direct evidence first. Do not fan out before you've committed to which sources you'll actually read.

### 4. Gather evidence

Read the sources you listed. Capture verbatim what you find — file contents (line numbers cited), command output (exit code captured per `bash-exit-capture` discipline), HTTP response shape, DB row shape.

**Hard rule: zero edits.** No `Edit`, `Write`, `git checkout`, kill, restart, deploy, no MCP write tool. Only Read, Grep, Glob, Bash (read-only), MCP read tools, WebFetch.

If a step requires a write (running a script that mutates state, dispatching a one-shot, restarting a process to observe boot order) — STOP. Tell the user what would need to be done and why, and ask for explicit authorization before doing it. Investigation that crosses into mutation is no longer investigation.

### 5. Verify against hypothesis

For each piece of evidence: does it confirm or contradict the hypothesis from step 2?

- Confirms → continue to step 6.
- Contradicts → revise the hypothesis. Note the contradiction explicitly. Re-run step 3 if a new evidence source is needed.
- Ambiguous → state which other evidence would disambiguate. Get it.

Do NOT silently retcon the hypothesis to match evidence after the fact. If the original guess was wrong, say so.

### 6. Report findings

Output follows `base:convey` — concept-first headline, tables, ASCII flow, caveats, verify line. Investigation budget under convey: **≤20 lines**. Map the standard convey sections to the investigation-specific items below:

1. **Headline** = the specific question being answered (≤12 words).
2. **Goal / Answer** — one sentence. The direct answer.
3. **Evidence** (replaces "Behavior diff" / "Flow" for this skill) — the verbatim `file:line` / command output / row that supports the answer. Cite paths and line numbers. Quote no more than one short snippet (per copyright discipline). Tabular when evidence has multiple axes.
4. **What was wrong with my initial hypothesis** (if applicable) — one sentence. Honest delta. Skip if hypothesis matched.
5. **Options for next steps** — numbered list. Each option = one specific action the user could authorize. Include the option "do nothing" when reasonable. This is the convey "Caveats / next actions" section, retitled.

Forbidden in the report:
- Hedging language about local behavior ("probably," "typically," "should be") — if you reached for it, you didn't gather enough evidence
- Generic prescriptions not backed by the evidence ("you should add monitoring") unless explicitly asked
- A unilateral fix description as the first option — fixes are only options the user can pick from

### 7. STOP

After the report, do nothing. Do not start writing the fix you proposed. Do not "while we're here" anything. Wait for the user to pick an option.

If the user picks an option that requires code changes → switch to the `debugging` skill (or whatever skill matches the work) and follow ITS discipline.

## Anti-patterns this skill prevents

- **The detective who's also the carpenter.** Investigation says "the timeout is too short," carpenter immediately bumps the timeout. Now you'll never know if the real cause was a deeper bug masked by the short timeout.
- **The hedging novelist.** "Probably it's slow because the cache might be cold and the agent typically takes a while to warm up." Zero numbers. Useless.
- **The accidental mutation.** "Let me just restart the container to see fresh logs" — now you destroyed the evidence state of the original failure.
- **The retcon hypothesis.** Original guess: "auth token expired." Evidence: token is fine, MCP server crashed at boot. Report: "I diagnosed an MCP boot crash." Wrong — say "my hypothesis was wrong, real cause is X."
- **The infinite scope drift.** Question was "why did this one dispatch fail." Investigation expands to auditing every dispatch from the last week. STOP. Answer the original question. Note the broader patterns as observations the user can decide to act on.
- **The suspect-list-as-finding.** Discrepancy observed (stored value ≠ recomputed value, stale-looking state, unexpected timestamp). Output: "Suspect: X, OR Y, OR Z" with mechanisms drawn from recent commit messages or vibes. This is a guess wearing a finding's clothes. Forbidden: the words "Suspect:", "Likely:", "Probably:" introducing an unverified mechanism; "OR"-separated cause lists presented as the answer; pattern-matching a recent commit subject into a causation claim without reading the diff. Required: pick ONE candidate, read the actual code path that would have produced the observation, report verified or "still unknown — next probe is N." A list of guesses is not an investigation result.

## Investigation vs Debugging — pick the right skill

| You're about to... | Use |
|---|---|
| Tell the user what's happening on their system | `investigate` |
| Tell the user why something happened in the past | `investigate` |
| Quote runtime numbers (latency, memory, count) | `investigate` |
| Write a failing test that reproduces a bug | `debugging` |
| Edit code to fix a bug | `debugging` |
| Apply a config change to fix runtime behavior | `debugging` |
| Decide between two architectural options | start with `investigate` to map the current state, then escalate if user picks an option that requires code |

Both can run in the same session — investigate first, debug after the user picks an option. Don't merge them.

## Reporting format reference

Skeleton you can copy:

```
## Investigation: <one-line question>

**Answer.** <one sentence>

**Evidence.**
- `path/to/file.ts:42` — <what's there>
- `docker logs danxbot-worker-<repo>` — exit code 137 at 12:04 UTC; OOMKilled per `docker inspect`
- DB: `dispatches` row id=830cbd99 has `status=failed`, `summary='Agent timed out after 600s'`

**Hypothesis check.** I expected <X>; evidence shows <Y>. Delta: <one sentence>.

**Options.**
1. Increase the timeout to N seconds (small, low-risk).
2. Reduce the prompt size by stripping the inject step (medium).
3. Investigate further — specifically <next question> — before changing anything.
4. Do nothing; current behavior is acceptable.
```

If the report does not fit this skeleton, the investigation is incomplete or the question is unclear. Iterate before sending.
