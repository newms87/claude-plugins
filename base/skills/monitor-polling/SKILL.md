---
name: monitor-polling
description: Polling discipline — Bash run_in_background vs Monitor vs tail-grep decision tree, interval floors, cost-aware ticks.
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

## Decision tree

Before Monitor/poll loop:

1. **"Tell me ONCE when X finishes"** → Bash + `run_in_background: true` + `until <done>; do sleep <interval>; done`. Never Monitor.
2. **"Tell me on STATE CHANGES"** → Monitor w/ prev/cur diff. Emit only on change.
3. **"Tell me every line"** → Monitor + `tail -f | grep --line-buffered <pattern>`. Cover every terminal state.
4. **"I want progress"** → Narration, not signal. Use option 1.

Option 1 → don't use Monitor.

## Interval floors

| Target | Min |
|---|---|
| Local check (file, port, lock) | 1–5s |
| Local process (docker ps, pgrep) | 10–15s |
| Local file (small, no DB) | 5–10s |
| Backend job (artisan, queue, DB exec) | **60s** |
| LLM/dispatch/orchestrator | **60–120s** |
| Remote API (gh, Slack, OpenAI, Trello) | 30–60s |

Don't invent. Pick from table.

## Load override

Seen system fail under load this session → floor doubles. 60s→120s, 30s→60s. `too many clients`, queue exhaustion, 429 → system fragile. Polling adds load. Stop polling, check on demand.

## Coverage — not just happy path

Monitor filter must cover:
- Forward progress signal
- Every failure you'd act on (Traceback, Error, FAILED, Killed, OOM, assert, panic)
- Process death (append `; echo "EXITED: $?"`)

Broaden filter. Extra noise > missing crash.

## Notification cost

Every `echo` in Monitor = chat message. Eats tokens + attention. Emit ONLY actionable lines. `tick: Running` ×30 = narration, not signal.

## Pre-arm checklist

Before EVERY Monitor:
1. Need: once / changes / every line?
2. Tool: Decision tree says Bash? → don't use Monitor.
3. Interval: table row? doubled for load?
4. Coverage: terminal failures covered?

Skip = failure. Check = prevention.
