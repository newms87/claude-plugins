---
name: danx-start
description: Process all ToDo issue cards sequentially using the autonomous workflow.
---

# Danx Start Team

Process every card with `status_derived: ToDo` using the workflow from `/danx-next`.

## Resume self-check (read first, every dispatch — ISS-135)

Before processing ANY card, call `mcp__danx-dashboard__issue_get({id})`. If `status_derived` is terminal (`Done` / `Cancelled`) AND every AC item is checked AND retro is filled — the prior session already finished that card. Call `danxbot_complete({status: "complete", summary: "Prior session already completed; verified terminal state on resume."})` and stop. **Do not redo work.** Do not flip status. Do not re-save. The full per-card contract lives in the `danx-next` skill's Step 1.1 — load it via the Skill tool when in doubt.

This guards against the May-7 incident: an orphan-resumed agent that re-runs `/danx-start` from scratch against a card whose prior session already shipped the work creates duplicate retro comments and duplicate `danxbot_complete` calls. The self-check is a 30-second read that costs zero tokens of redo.

## /loop and ScheduleWakeup — FORBIDDEN in a dispatch

**A scheduled wakeup can NEVER fire in a dispatch. Arming one ends the
dispatch permanently.** A dispatched agent is spawned as `claude -p` with
stdin ignored (`src/agent/spawn-docker-mode.ts` — `stdio: ["ignore",
"ignore", "pipe"]`), so the process is structurally incapable of receiving
a wakeup. `ScheduleWakeup` will still answer:

> Next wakeup scheduled for … Nothing more to do this turn — the harness
> re-invokes you when the wakeup fires or a task-notification arrives.

**That promise is false here.** You end your turn, the process prints its
result and exits 0, and nothing wakes you. The worker records
`exited without danxbot_complete — abandoned`, the card stays claimed, and
every token you spent is wasted.

This is measured, not theoretical: 6 of 6 abandoned dispatches audited on
2026-09-05 ended exactly this way, tens of millions of tokens between them.
Each agent was following this section as it was previously written — it
used to ALLOW "monitoring a long-running test", which is the single
instruction that killed them. That is why the allowance is gone.

**FORBIDDEN — no exceptions, this card's AC included:**

- `ScheduleWakeup`, `/loop`, or any "I'll check back in N minutes".
- Starting work in the background and ending your turn to wait for it —
  `Bash{run_in_background: true}`, a detached test runner, a watcher
  process. If your last message would say "waiting for X to finish", you
  are about to abandon the card.
- `TaskOutput` polling that outlives your turn. Blocking on it is fine;
  ending the turn because it timed out is the same abandonment.

**Instead, when this card's AC genuinely depends on a long-running job:**

1. **Wait in the FOREGROUND, bounded.** Run it with an explicit
   `timeout` inside your turn. You keep control, you see the result, and
   you can act on it. This covers almost every real case.
2. **If it cannot finish inside the dispatch's runtime budget, release the
   card non-terminally** — `issue_transition({action: "rollback_pickup"})`
   — and say in a card comment what is running and what the next dispatch
   should check. The next tick picks the card up and continues. **A
   released card is recoverable; an abandoned one is not.**
3. **Never** complete a card by asserting a result you did not observe.

**ALSO FORBIDDEN (the original ISS-135 / ISS-136 cases):**

- Waiting for a human to reply (use `status: Blocked` instead — the
  operator opens the card, answers, moves it back).
- Waiting for the next card to land (the poller dispatches; you exit when
  this card is done).
- "Let me check on this in N minutes" for anything outside this card's
  scope.

**If you have ALREADY armed one this dispatch**, you are not stuck: disarm
it (`ScheduleWakeup({stop: true})`) and finish the turn normally by
calling `danxbot_complete`, or release the card with `rollback_pickup` if
the work is genuinely unfinished. The failure is ending the turn WITHOUT
one of those two — never the arming itself. Do not "wait and see whether it
fires": it will not.

## Steps

1. Call `mcp__danx-dashboard__issue_list({filter: {status_derived: ['ToDo'], dispatchable_derived: true}})` to get all dispatchable ToDo cards.
2. Empty → report "No cards to process" and stop.
3. Report how many cards are queued + list their titles.
4. For each card id, invoke the `/danx-next` workflow (Steps 1-11 from that skill) using the card's `id`. The first step inside `/danx-next` is the same Resume self-check above — terminal-state cards short-circuit there. Step 10 handles Blocked moves, Step 10b handles Waiting On moves.
5. After each card, re-list via `mcp__danx-dashboard__issue_list` — epic-splitting may have added phase cards.
6. Loop until list is empty.

## Report Summary

When all cards processed:
- Total cards processed
- Cards completed vs failed vs blocked (counted by terminal `status`)
- Key issues encountered

## Signal Completion

`danxbot_complete({status: "complete", summary: "Processed N cards — X done, Y blocked, Z failed"})` at the end.
