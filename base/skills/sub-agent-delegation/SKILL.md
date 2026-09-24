---
name: sub-agent-delegation
description: Sub-agent dispatch checklist — synthesis ratio, isolation justification, raw-passthrough detection; sub-agents synthesize, never proxy reads.
---

# Sub-Agent Delegation Rules

EXPANDS canon principle 1 (orchestrate by default) with the dispatch mechanics.
The principle itself lives in the always-injected operating contract and is not restated here.

Sub-agents exist for synthesis, judgment, parallelism, context isolation — NOT raw data passthrough.

## Forbidden pattern

```
Orch → SubAgent → Read(path) → return body verbatim
Orch → SubAgent → mcp__X(args) → return JSON verbatim
```

Sub-agent paid tokens to fetch. Orchestrator pays tokens re-reading result. Same bytes, triple cost, zero synthesis.

## Pre-dispatch check — answer all four

1. **What does sub-agent return that orchestrator can't produce itself?** No → don't dispatch.
2. **Is output materially smaller than input?** No (≈ raw read/tool body) → don't dispatch.
3. **Does sub-agent need isolated context** (fan-out, parallel branches)? No → keep inline.
4. **Does this brief re-open anything THIS SESSION already settled with evidence?** List those decisions and write them into the brief as fixed constraints. Never hand one back as a choice ("decide from evidence", "pick one", "evaluate both") — the sub-agent has none of your history, so your brief is the only guard, and a measured-and-rejected option offered as an option gets implemented and shipped as "the only solution". Can't recall what was measured? Re-read before dispatching.

Q1-3 all no → sub-agent is passthrough. Cut it. Q4 unanswered → the brief is a regression risk.

**Scope of Q1-3 — they stop PASSTHROUGH, they do not license staying inline.** Their only target is wrapping a Read or a tool fetch in an agent that returns the same bytes. They are NOT a general exemption from canon principle 1: investigation-shaped and multi-file work is dispatched by DEFAULT, and Q3's "keep inline" answers the passthrough case only. A probe or experiment that consumes a large surface and returns a small verdict PASSES Q2 — that is the shape Q2 is asking for, not the shape it rejects.

## Fixes

- **Orch reads/calls directly.** If path or tool accessible to orch, use it inline.
- **Sub-agent synthesizes.** Return condensed artifact: extracted facts, verdict, diff, checklist — not raw input.
- **Pre-stage filesystem.** Static payload → known path at dispatch, orch reads directly. Don't wrap fetch in sub-agent.

## Tool design implication

Tool's only job = "fetch static blob" → stage on disk, agent reads via Read. Fetch tool + fetch sub-agent = latency/tokens/indirection for zero capability. Mutable ops stay tools; pure-fetch becomes filesystem.

## ALWAYS parallelize independent work — fan out, don't serialize

When a task decomposes into INDEPENDENT sub-tasks — multiple reviews of the same artifact, several non-overlapping fixes, independent file edits or investigations — dispatch them as parallel sub-agents in ONE message (multiple Agent/Task tool calls in a single response), NOT one at a time. Serializing work that has no ordering dependency is pure wasted wall-clock. Sub-agents are the mechanism that makes the parallelism possible; reach for them whenever independent work exists, not only for synthesis.

**Hard cap: 5 concurrent sub-agents (5 parallel items).** More than 5 independent items → batch them: run 5, collect results, then run the next set. The cap is for INDEPENDENT work ONLY — never parallelize genuinely dependent steps (step B needs step A's output).

**The cap is a CEILING, not permission to sit below it.** Operator, 2026-09-19, finding two agents running with unblocked cards open: *"Why are you not running more agents in parallel?"* — and, on the stale number this file used to carry: *"hard cap is 5 on this machine"*. Running under the cap while independent work waits is the same waste as serializing it. The only legitimate reasons to be below the cap are that the remaining work is genuinely dependent, genuinely waiting on a human, or would collide — and if it is collision, say which files, because an unexplained gap reads as forgetting.

**A file collision is a reason to SEQUENCE two specific agents, never a reason to idle a slot.** The right response to "these two would both edit `Foo.tsx`" is to dispatch one of them *plus something else*, not to run one and wait. Partition by file and keep the slot full.

**Use sub-agents to APPLY fixes, not just to review.** When findings (or any work) split into independent, non-overlapping fixes, fan THEM out to parallel sub-agents too (≤5) — never serialize independent fixes.

**Guardrails (all still hold):**
- **Non-overlapping files/state only.** Two agents must NEVER edit the same file concurrently — partition the work by file/module first; overlap → keep those items serial.
- **Synthesis-not-passthrough still applies** (the pre-dispatch check above): each parallel sub-agent returns a condensed artifact, not raw bytes. If a "sub-agent" would only echo what you could produce yourself, run it inline instead — fan-out is for genuinely independent *work*, not for wrapping trivial edits.
- **The parent runs the test suite ONCE, after all edits land** — never run tests inside parallel sub-agents (no parallel test runs).

### Canonical case — POST code-trio quality gates
The three POST code gates (`code-test-quality` / `code-architecture` / `code-quality`) are independent read-only reviews of the SAME diff with zero ordering dependency. Dispatch their reviewer sub-agents (`architecture-reviewer` + `code-quality-reviewer`) in ONE batch (≤5), run the inline `code-test-quality` review alongside them, collect ALL findings, fix ONCE (independent fixes fanned out, ≤5), then sign off each gate. Do NOT run the three gate reviews one at a time — that was the observed failure this rule exists to prevent.

## Sub-agents must clean up their own subprocesses before reporting done

A dispatched sub-agent that starts a dev server, a Docker container, a database, a browser/Playwright instance, or any other long-lived process to do its work is responsible for tearing every one of them down before it finishes — not leaving them for the orchestrator or the operator to discover later. This is a REQUIREMENT to put in the dispatch prompt itself, not an assumption:

- **State it explicitly in every dispatch brief** that starts or might start a subprocess: "tear down every process/container you start before reporting done, and say in your final report what you tore down."
- **A sub-agent's own final report is evidence, not proof.** "Docker container torn down" in a report means the agent attempted cleanup — it does not mean the orchestrator can skip checking when several agents ran concurrently on the same host, since concurrent agents can collide with (or accidentally survive past) each other's teardown.
- **This satisfies `process-kill`'s Iron Rule trivially for the agent itself**: a sub-agent killing a process IT spawned in its own run, whose PID it captured at spawn, is exactly the one case that rule permits without asking. It does NOT license killing anything the agent merely *suspects* is a stray leftover from a sibling agent — that's still governed by `process-kill`'s full discipline (proof block, no pattern-matching, ask first).

## Completed dispatches still occupy the task list until explicitly stopped

An `Agent()` spawn that has delivered its final report and shows as "completed" in a task notification is NOT automatically removed from the operator's live task list — it stays resumable (and visibly "running" to the operator, e.g. in a task-count they can see) until something explicitly stops it. In a long session with many sequential or parallel dispatches, this accumulates fast — 15 dispatches over a few hours becomes 15+ lingering entries even though every one of them is done and idle.

- **After consuming a dispatched agent's final report and folding its findings into your own work, stop it** (the harness's task-stop mechanism) unless you have a specific reason to keep it resumable (e.g. you expect to send it a follow-up in the same conversation).
- **If the operator asks "why do I have N running tasks," don't assume something is actually still executing** — check each one's real status first (most will report as idle/completed-but-registered), stop the ones genuinely done, and only then explain the count. Conflating "shows in the task list" with "is consuming resources right now" is a real distinction the operator's own question is usually probing for.

## Reading a result is NOT the same as the spawn ending — verify termination

A background `Agent()` spawn is a real process the harness tracks independently of whether you've consumed its output. Receiving the completion notification and reading its returned text does **NOT** guarantee the underlying task object is closed — a spawn can keep showing as a live background task (visible in the operator's `/exit` confirmation dialog, invisible to you in normal conversation and in `TaskList`, which only lists your own `TaskCreate` todos, never `Agent()` spawns) long after you believe you've "finished with it."

**Observed failure (2026-07, danxbot session):** delegated 5 independent fix items to sub-agents mid-session, read their results, narrated "reviewed both agents' diffs before committing," and moved on. Those 5 spawns were still alive as background tasks at session `/exit` — an hour+ later — with zero indication anywhere in the ongoing conversation. Only the operator's own exit-confirmation screen (which enumerates literally every live background task tied to the session) surfaced them. Asked directly, the agent's first instinct was to deny they were its own and blame a separate session — they were its own, from earlier in the same conversation, mid-compaction.

**Rule:** after a dispatched `Agent()` call's result is consumed (read, synthesized, acted on), treat the spawn as still theoretically live until you have explicit confirmation it terminated. If the harness exposes no direct "is this task still running" check, say so honestly rather than assuming completion — "I read its output" is evidence the agent *produced* a result at some point, not evidence the process *exited*. When in doubt or when an operator reports something you don't recognize (background tasks, unexpected state), the correct first move is to actually check available tooling (`TaskList`, any task-status tool) before asserting "that's not mine" — confident denial without checking is worse than "let me verify."

## Time-box every dispatch — a stall is a signal to act, never to keep waiting

**There is no platform-level timeout on a background `Agent()`/`Task()` dispatch, and Anthropic has closed the feature request for one as "not planned"** (a hung subagent on a stdio/IPC deadlock blocks its caller forever, with no error surfaced). Community reports of the failure mode this produces are not rare or session-specific: agents stuck "Running" for 30+ hours burning six figures of tokens with nothing to show, sessions that freeze entirely when blocking on several agents' output at once, and pipelines that silently deadlock for hours because a subagent's own long-running work was invisible to the harness. **The orchestrator is the only backstop that exists — treat that as a standing fact of the platform, not a bug to route around once.**

- **State an explicit time-box in every dispatch prompt itself**, not just in your own head: "If this exceeds roughly N minutes, stop and report whatever partial progress/findings you have rather than continuing silently." N scales with the task (a targeted fix: ~15-20 min; a broad audit or full-suite-adjacent job: budget roughly half of what you'd tolerate waiting, per the same logic as budgeting a full test-suite wait). A dispatch with no stated ceiling is a dispatch that can run until the platform's own multi-hour failure mode kicks in.
- **Never self-background inside a dispatched agent's own work** (`&`, `nohup`, `disown`, piping a long command to `tail -f` and treating the pipe's return as completion). This is invisible to the harness — no completion notification can ever fire for it — and is the single most common cause of a *silent, permanent* stall rather than a merely slow one. This is `tool-discipline`'s rule too; restate it in dispatch briefs for agents that might not have that skill loaded, especially anything that runs a long build, test suite, or server.
- **Never block-wait on multiple agents at once** (e.g. calling a blocking task-output read with `block: true` across several dispatches in sequence or in one call). This is a documented way to freeze the entire session, not just the wait — fire-and-forget instead, and let completion notifications arrive on their own schedule.
- **Overdue silence is itself the signal to act, not a reason to keep waiting.** If a dispatch has clearly run well past the time-box you gave it with no notification, don't let it keep running "just in case it's almost done" — resume it with a direct status-check message (does it need to report partial progress now?), or stop it outright and re-dispatch with a narrower scope. Observed on this plan (2026-09-17): a sub-agent reported "waiting for its own nested reviews to complete" and then went idle without them — recoverable in minutes once nudged directly, but only because it was caught quickly rather than left to run unmonitored; the same pattern left unattended is exactly how the multi-hour community reports happened.
- **For genuinely large fan-outs (dozens of agents, not a handful),** reach for the `Workflow` tool instead of nested ad hoc `Agent()` dispatches — it runs the orchestration as a script outside the conversation's own context and turn loop, which sidesteps this whole class of conversational stall rather than mitigating it after the fact.

## Never background a full test suite as routine verification — targeted tests only

**State this in every dispatch brief that touches tests, as a hard constraint, not a suggestion:
run ONLY the tests for the files this change actually touched (or their direct dependents),
never the full suite, as the normal verification step.** A full-suite run is orders of magnitude
slower than what the change needs to prove, and — combined with the time-box rule above — an
agent that starts one and then hits its time-box either abandons it mid-run (the exact stall
this section exists to prevent) or blocks on it and blows the time-box entirely.

- **Reserve a full-suite run for a real reason stated up front**: confirming a genuinely
  cross-cutting refactor (e.g. a shared type or a widely-imported utility) didn't regress
  something outside the obviously-touched files, or a final pre-merge sanity pass on a large
  card — never as the default "let's just run everything to be safe" instinct.
- **A backgrounded full-suite run is a live liability, not a safety net, once its own dispatch
  ends.** Observed on this plan (2026-09-17): a sub-agent backgrounded a full `npm test` run
  inside its own worktree, then finished and reported back to the orchestrator before that run
  completed. The orchestrator (correctly, by its own worktree-cleanup checklist) later removed
  that now-merged worktree — out from under the still-running background test process, which
  then crashed on every subsequent poll (`MODULE_NOT_FOUND` against a `node_modules` path that no
  longer existed) while the harness's own task panel kept showing it as "Running" for 1h40m+ with
  no way to tell, from the panel alone, that it was already dead. Nobody was waiting on it, it
  was consuming a background-task slot for nothing, and it looked like an active multi-hour hang
  to anyone glancing at the task list — the exact community-reported failure class this skill's
  time-box section already documents, self-inflicted by the orchestrator's own dispatch choice
  rather than a platform bug this time.
- **Before ending your own turn, you own every background task you started** — a
  `run_in_background` call you never awaited or reported on is not "someone else's problem" once
  your turn ends; either wait for it (inside your time-box) and report its real result, or state
  explicitly in your final report that it is still running and unconsumed, so the orchestrator
  knows to treat it as live cleanup work rather than assuming it quietly finished on its own.
- **Your own `run_in_background` Bash command notifies you once when it ends** — waiting on it
  costs one turn. **A background sub-agent you dispatch does not:** its completion notice goes to
  the root session, so a sub-agent that stops to wait for it is never woken. When you need a
  child agent's result, dispatch it with `run_in_background: false`.
- **Every wake-up report states what is now established**, not just "still waiting": new output,
  elapsed time, files touched — or "nothing new since the last report". A bare "still waiting"
  reads identically to a hung agent.
- **The orchestrator's own worktree-cleanup step must check for exactly this** before removing a
  card's worktree: a background task still running against that path turns a routine cleanup
  into the same crash-and-orphan failure. A quick real check (is anything still writing to that
  directory / to the output file a backgrounded test run was piping to) costs far less than the
  stale "Running" entry it prevents.
