---
name: monitor-polling
description: 'MANDATORY before arming any `Monitor` tool call OR writing any `until <condition>; do sleep N; done` poll loop. Polling has real cost (process spawn + DB connection + chat notification per tick). Triggers: about to call Monitor, about to write a sleep loop watching backend job state (artisan, queue, LLM, agent dispatch, schema/template builder, octane, horizon, dispatch round-trip), about to poll remote API for status, about to use `tail -f | grep` to watch a stream, about to write "tell me when X is done" logic. Loads decision tree (Bash run_in_background vs Monitor vs tail-grep), interval floor table, and load-failure override as TodoWrite checklist.'
---

# Monitor & Poll-Loop Discipline

Polling cost real. Each iteration of `Monitor` or `until` loop spawns process, opens DB/network connection, emits chat notification consuming user attention + context window. Cheap per-tick locally feels free; on backend jobs not. Skill enforces hard floors → cost matches signal.

## When to Invoke

ANY of:
- About to call `Monitor` tool
- About to write `until <cond>; do sleep N; done` (foreground OR `run_in_background`)
- About to write "tell me when job X finishes" logic
- About to `tail -f <log>` watching specific pattern
- About to poll remote API status

## Iron Rule

**Floor for poll intervals waiting on backend jobs (artisan, queue worker, LLM call, agent dispatch, schema/template builder, octane, horizon, dispatch round-trip): 60 seconds. Period.**

15s + 30s forbidden. Each iteration:
- Cold-boots interpreter (`./vendor/bin/sail artisan` ≈ 1–3s PHP boot)
- Opens DB connections (already-fragile stack — `too many clients already` known failure)
- Emits chat notification → costs context tokens AND user focus
- Adds load to exact system you're waiting on

Multi-minute job polled every 15s = ~10× useful signal. Pure noise.

## Decision Tree — Run BEFORE Arming Anything

Answer literally before reaching for Monitor tool:

1. **"Tell me ONCE when X finishes"** → use `Bash` w/ `run_in_background: true` + `until <terminal-state>; do sleep <interval>; done` one-shot. NEVER use `Monitor`. One notification at completion, zero spam.

2. **"Tell me on STATE CHANGES only"** → `Monitor` w/ `prev`/`cur` diff. Emit only when `cur != prev`. Poll runs at floor interval, emissions bounded by real transitions.

3. **"Tell me every line of a stream"** (log tail, build output, console errors) → `Monitor` w/ `tail -f <file> | grep --line-buffered <pattern>`. Pattern alternation MUST cover every terminal state you'd act on, not just happy path.

4. **"I want progress feedback"** → narration, not signal. Not real requirement. Use Option 1.

Answer = "Option 1" → MUST NOT use `Monitor`. Reaching for `Monitor` when `Bash run_in_background` correct = failure mode this skill prevents.

## Interval Floor Table

| What you're polling | Minimum interval |
|---|---|
| Local trivial check (file exists, port open, lock file present) | 1–5s |
| Local process state (`docker ps`, `pgrep`, `ps`) | 10–15s |
| Local file content (small file, no boot, no DB) | 5–10s |
| Backend job state (`artisan`, queue length, DB query, container exec) | **60s** |
| LLM job / agent dispatch / multi-stage orchestrator | **60–120s** |
| Remote API (`gh`, Slack, OpenAI, Trello) | 30–60s (rate limits) |

Pick from table. Do NOT invent a number "because this one's different."

## Load-Failure Override

**Already seen the system you're polling fail under load this session → floor doubles.** `too many clients already` from PG, queue worker exhaustion, Horizon supervisor death, 429 from remote API — any means system fragile right now. Polling = adding load to sick system. 60s → 120s. 30s → 60s. In doubt → stop polling, check on demand.

## Coverage — Silence Is Not Success

`Monitor` filter only matches happy path → crash looks identical to "still running" + wait until timeout for nothing. Every Monitor command must, in one alternation, cover:

- Forward progress signal (line you'd celebrate)
- Every terminal failure signature you'd act on (`Traceback`, `Error`, `FAILED`, `Killed`, `OOM`, `assert`, language-specific panic markers)
- Process death (use `; echo "EXITED: $?"` after `tail -f` if relevant)

In doubt → broaden alternation. Extra noise beats missing crashloop.

## Notification Cost

Every `echo` line in `Monitor` script becomes chat message. Chat messages:
- Eat user's input tokens permanently rest of session
- Eat user's attention (they read each one)
- Risk hitting "too many events → monitor auto-stopped" guardrail

Emit ONLY lines user would act on. `tick: Running` repeated 30 times ≠ action signal — narration. Cut it.

## Mechanical Pre-Arm Checklist

Before EVERY `Monitor` call, write down:

1. **Need:** "Tell me once" / "tell me on changes" / "tell me every line"?
2. **Tool:** Decision tree route me to `Bash run_in_background`? Yes → NOT using `Monitor`.
3. **Interval:** What table row? What's my floor?
4. **Load override:** Seen this system fail under load this session? Yes → doubled?
5. **Coverage:** Filter emit on terminal failure modes, not just success?

Skipping check = how original failure happened. Check IS prevention.
