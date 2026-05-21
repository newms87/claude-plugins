---
name: investigate
description: 'MANDATORY when investigating, diagnosing, or asserting facts about a running system WITHOUT applying a fix in the same prompt. Triggers — user says "investigate," "look into," "find out," "dig into," "figure out," "trace," "audit," "check on," or "walk me through"; user asks "why is X happening", "how does Y work", "what''s going on with Z", "is the agent running", "did it dispatch"; about to STATE a factual claim about timing, latency, runtime behavior, causality, config values, process state, or "why X works this way" with anything more than a direct file quotation. Use INSTEAD OF the debugging skill when the assignment is read-only — diagnosis only, no code changes, no failing test, no fix. If the task crosses into "fix it now," "and fix X," "and patch X," "and apply the fix/patch," "and add X," "and add the missing X," "and build X," "and write X," "and create X," "and rewrite X," "and refactor X," "and extract X," "and modify X," "and change X," "once you find it," "once you''ve located it," "in the same dispatch," "in this same session," "while you''re in there" — switch to the debugging skill (load it via Skill tool) and follow the full TDD discipline. **When reporting investigation findings about a bug / problem / failure to the user, the per-bug Affects/Env/Scenario/Expected/Actual format from the `debugging` skill Phase 12 is REQUIRED — load `debugging` for the format spec.** Loads investigation discipline as TodoWrite checklist.'
---

# Investigate Skill

Read-only diagnostic methodology. Hypothesis → evidence → findings → options. **You do not fix.** You report. The user decides next steps.

This skill exists because investigation and fix-writing are different work, and conflating them produces both bad investigations (skipped because "I'll just patch it") and bad fixes (applied before root cause is known). Use this skill when the assignment is "tell me what's happening." Switch to the `debugging` skill the moment the assignment becomes "fix what's happening."

## When to invoke

- User says "investigate," "find out," "look into," "why," "how does," "what's happening"
- You are about to make a factual claim about runtime behavior (timing, causality, process state, config meaning) without direct evidence
- Task-completion messages (exit codes, "command completed") tell you the wrapper finished, NOT whether the underlying process is alive. Verify with live probe (ps, curl, docker ps, systemctl status) before asserting anything about process state.
- Draft answer contains hedging ("probably," "typically," "should be," "likely") about local behavior → STOP, gather evidence instead.

**Not for:** Direct file quotes ("function X takes args a,b,c"), documentation lookups, or when the assignment is to apply a fix.

**The line:** answer contains any claim not directly quotable from code, docs, or tool output captured in this conversation → skill required.

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

**Audience default — write for a reader with ZERO codebase context.** Plain English first; file paths and symbol names are footnotes, not the report. If the reader could not understand the report without already knowing what `pickCardForAgent` / `assigned_agent` / `DX-368` mean, you have failed the audience gate. Only switch to code-anchored framing when the user explicitly says "I know the code" / "give me file:lines" / "I'm in the source already."

Required sections in this order — every one mandatory, no skipping:

1. **Headline** = the specific question being answered (≤12 words). Plain English.
2. **Problem statement** — one or two sentences. What is broken, in user-visible terms. No code names.
3. **Steps to reproduce** — numbered, observable from outside the code. ("Open card X." "Wait one tick." "Watch the dashboard.") If the failure is passive ("system idles when it shouldn't"), say so explicitly.
4. **Expected behavior** — one sentence. What a reasonable observer would expect to see.
5. **Actual behavior** — one sentence. What is happening instead. Include the user-visible symptom (idle queue, repeated error banner, etc.), not the internal error string.
6. **Root cause — in plain English** — one or two sentences. Translate the mechanism into an analogy or everyday-language description first ("the picker picks the first agent alphabetically, asks 'can you take this card', gets a no, and gives up instead of asking the next agent"). Symbol names allowed only AFTER the plain-English version, in parentheses.
7. **Evidence (footnotes)** — `file:line` / command output / row references. One short bullet list. This is for the user to verify later if they want; it is NOT the explanation.
8. **What was wrong with my initial hypothesis** (if applicable) — one sentence. Honest delta. Skip if hypothesis matched.
9. **Fix options — in plain English** — numbered list. Each option = one sentence describing the change in user-visible terms ("teach the picker to keep trying the next agent when the first one can't take the card"). No code, no diffs, no file paths inside the option text. NEVER include "do nothing" — the user invoked an investigation to act, not to be told inaction is on the menu. Include "investigate further" ONLY when one of these is true: (a) the root cause is still uncertain and a specific next probe is named, (b) the fix may interact with other behavior / hidden dependencies you have not yet mapped, (c) a behavioral invariant elsewhere relies on the current (buggy) shape and changing it risks regression. State which condition applies in one phrase. Otherwise omit.

Forbidden in the report:
- Hedging language about local behavior ("probably," "typically," "should be") — if you reached for it, you didn't gather enough evidence
- Generic prescriptions not backed by the evidence ("you should add monitoring") unless explicitly asked
- A unilateral fix description as the first option — fixes are only options the user can pick from
- "Do nothing" / "leave as-is" / "no action" as an option. The user asked for an investigation because they want to act; offering inaction insults the ask.
- "Investigate further" as a filler option when root cause is verified and no coupling risk exists. Only include when uncertainty or dependency-risk is named.
- Leading with a file:line table, an internal symbol name, an issue tracker ID, or any term that requires codebase context to parse. Plain English first; symbols and paths belong in the "Evidence (footnotes)" section.
- Fix options written as code snippets, diffs, function signatures, or "change X line N to Y". Options describe behavior change, not the patch.

### 6a. Solution Quality Bar — Root Cause Over Symptom

Every option in the fix list MUST clear three questions BEFORE it ships in the report. Failing any question = draft, not an option.

1. **Mechanism, not symptom.** Does the option address the underlying mechanism the evidence identified? Raising a timeout, adding a retry, swallowing an exception, widening an allowlist, or restarting the process makes the symptom disappear without touching the mechanism — that is not a fix.
2. **Textbook for the platform.** Would a senior engineer reading the diff agree this is the canonical way the language / framework / platform recommends solving this class of problem? If not, name the textbook answer explicitly in the option text and justify the deviation in writing.
3. **Class, not instance.** Does the option eliminate the failure class, or only the one observed instance? If the same mechanism lives at N other call sites and they remain exposed, the option is partial — say so in the option body.

**Tiered ordering — mandatory when listing more than one option.** Rank by root-cause depth, never by ease:

| Tier | Role |
|---|---|
| 1 | Fixes the underlying mechanism. The textbook answer. Default recommendation. |
| 2 | Reduces the mechanism's blast radius via architectural change (isolation, decoupling, concurrency caps, backpressure). |
| 3 | Observability. Instrumentation so the next regression surfaces before it bites. Co-ships with Tier 1, never replaces it. |
| 4 | Defense in depth — retries, timeouts, fallbacks, graceful degradation. Ship ONLY UNDER a Tier 1 fix and label it as a safety net. Never the primary recommendation. |

**Forbidden patterns (each fails the bar):**

- Symptom-only fix presented as the solution ("raise the timeout to 60s").
- Retry / fallback / fail-soft branch presented as the primary mechanism.
- Local patch when the same mechanism exists at N other call sites and the patch covers only one — without naming the others.
- "Quick win first, real fix later" with no named follow-up artifact (issue / card / TODO carrying a date or condition).
- Refusing Tier 1 because it is "a bigger change." Bigger IS what root-cause work looks like — name the cost honestly instead of disguising the deferral as a Tier 4 option.

**When evidence is insufficient to commit to Tier 1:** SAY SO. List a Tier-1-shaped "investigate further to confirm <named mechanism>" option ahead of any Tier 4 patch. Never default to symptom-masking because the data is thin.

### 7. STOP

After the report, do nothing. Do not start writing the fix you proposed. Do not "while we're here" anything. Wait for the user to pick an option.

If the user picks an option that requires code changes → switch to the `debugging` skill (or whatever skill matches the work) and follow ITS discipline.

## Anti-patterns

- **The detective-carpenter.** Finding "timeout too short" → immediately bump it. Now you never know if a deeper bug was masked.
- **Hedging.** "Probably it's slow because the cache might be cold and agents typically..." Zero numbers, useless.
- **Scope drift.** Question: "why one dispatch fail." Answer expands to auditing the week. STOP. Answer the original. Note patterns separately.
- **Suspect lists.** Discrepancy → "Suspect X, OR Y, OR Z" with vibes. Forbidden: words like "Suspect:" or "Likely:" on unverified guesses. Required: one candidate, verified with code, or "still unknown — next probe is N."

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

Skeleton you can copy (audience-default form — plain English, footnotes for code):

```
## <one-line question, plain English>

**Problem.** <what is broken, user-visible, no code names>

**Steps to reproduce.**
1. <observable action>
2. <observable action>
3. <where to look>

**Expected.** <what should happen>

**Actual.** <what happens instead — user-visible symptom>

**Root cause (plain English).** <mechanism described as if to a non-coder. Symbol names allowed only in parentheses after the plain-English version.>

**Evidence (footnotes).**
- `path/to/file.ts:42` — <what's there>
- `docker logs <thing>` — <observation>
- DB row id=… → status=…

**Hypothesis check.** I expected <X>; evidence shows <Y>. Delta: <one sentence>.

**Fix options (plain English — no code).**
1. <behavior change in one sentence>
2. <behavior change in one sentence>
<!-- Add "Investigate further — <named uncertainty or dependency risk>" ONLY when root cause uncertain OR a hidden coupling may regress. Never include "do nothing". -->

4. Do nothing; current behavior is acceptable.
```

If the report does not fit this skeleton, the investigation is incomplete or the question is unclear. Iterate before sending.
