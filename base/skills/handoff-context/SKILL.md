---
name: handoff-context
description: Write a zero-context handoff before compaction / context exhaustion / session end so the next agent resumes instantly. Triggers — operator types /handoff-context, "hand off", "context is almost full", "about to compact", "wrap up so we can continue later"; agent notices context nearly exhausted mid-task. STOP-AND-WRITE contract: zero further investigation, write from current state only, every claim tagged VERIFIED / UNVERIFIED / UNKNOWN.
---

# handoff-context — Stop, Dump State, Hand Off

Context is about to be compacted or lost. The next agent (post-compaction you, or a fresh session) must resume **without re-deriving anything and without repeating dead ends**.

## RULE 0 — STOP IMMEDIATELY. ZERO further investigation.

The moment this skill loads: **no more Read, Grep, Glob, Bash probes, WebFetch, sub-agents, test runs, or "let me just confirm one thing."** Every additional tool call burns the context the handoff needs.

Write the handoff from **what you already know right now**. Gaps are not yours to close — they are the next agent's first task, and naming them precisely IS the deliverable.

| Instinct | Verdict |
|---|---|
| "One quick `git status` to be accurate" | VIOLATION. Write it as an UNKNOWN with the command the next agent should run. |
| "Let me re-read the file so the summary is right" | VIOLATION. Say what you believe + tag UNVERIFIED. |
| "I should finish this last edit first" | VIOLATION. Handoff first. An in-flight edit is a handoff line item, not a task to complete. |
| "I'll verify then hand off" | VIOLATION. That is how sessions die mid-verification with no handoff at all. |

Exception, single: writing the handoff file itself. Nothing else.

**Write section 1 (RESUME HERE) FIRST — before reading further into this skill.** This skill fires when context is nearly gone; if the budget dies mid-read, the load-bearing part is already on disk. Then come back and fill in the rest.

## RULE 1 — Two channels, both required

| Channel | Content | Why |
|---|---|---|
| **Durable file** | Full handoff, all sections | Survives compaction intact |
| **Chat tail** (last thing you emit) | ≤5-line recovery stub: file path + the ONE next action + the exact next command | Compaction keeps the tail; a path alone gets summarized into "a handoff file was written" and lost |

**Path:** take the session scratchpad dir **from your system prompt if it is listed there — do NOT probe the filesystem for it**; if no scratchpad is listed, use `/tmp/claude-handoff-<cwd-basename>.md`. **ONE stable path — overwrite in place on every re-invoke.** Never accumulate timestamped handoffs; multiple files means resuming from the wrong one.

If the session has a durable work-record surface (issue card, task tracker, PR body), mirror the handoff there too.

## RULE 2 — Confidence discipline. Never assume. Never bluff.

Every factual claim carries a tag. No exceptions, no blurring.

| Tag | Means | Requires |
|---|---|---|
| `[VERIFIED]` | Directly observed **this session** | Cite the proof — command output, `file:line` you actually read, test result, commit sha |
| `[UNVERIFIED]` | Believed, plausible, inferred — but not observed | State the proof that would settle it |
| `[UNKNOWN]` | Never looked / can't tell from here | State the probe the next agent should run |

- Confidence comes from **direct evidence and experiments only**. Reasoning-that-feels-right is `[UNVERIFIED]`.
- "It should work" / "probably fine" / "presumably already handled" → `[UNVERIFIED]` or `[UNKNOWN]`, never stated flat.
- An honest `[UNKNOWN]` is a **success**. A confident wrong claim sends the next agent down a fabricated path and costs far more than the gap.
- Explicitly flag anything needing more proof, deeper insight, or **human input** — the last gets its own line with a default assumption if unanswered.

## The handoff file — 8 sections, in this order

1. **RESUME HERE** — the single next action, its exact first command, and how you'd know it worked. Nothing above this.
2. **Goal & scope** — original request restated in full; what is explicitly out of scope. Assume the reader never saw the original prompt.
3. **Done** — each item with its proof tag + proof. Split verified-done from believed-done.
4. **RULED OUT** *(own heading — highest-value section)* — every dead end: what was tried **and the observed result that killed it**. Not "tried X, didn't work." Without this the next agent re-runs all of it.
5. **Open problems** — exact error text quoted verbatim, repro command, ranked hypotheses, candidate fixes, and **what evidence would decide between them**.
6. **Decisions & constraints — do not relitigate** — decisions made + rationale, operator preferences stated this session, rejected approaches, open questions each with a default assumption.
7. **Environment & key files** — commands known to work, ports, creds paths, the test command for this work, key files (path + why it matters + what changed), external docs already read **with their conclusion** so nobody re-fetches.
8. **Re-load before mutating** — literal `Skill(<name>)` calls the next agent must run before its first edit. Load mandates are pre-mutation gates; a post-compaction agent has forgotten them.

**No chronology section.** Cut narrative history entirely — state and next actions only. Do not compress sections 4 and 5 to save room; compress everything else first.

## Also capture — the parts that silently die in compaction

- **In-flight async**: background Bash jobs, dispatched sub-agents awaiting results, armed Monitor / ScheduleWakeup / cron, pending task-list items. These orphan across compaction and are invisible to the next agent.
- **Uncommitted state** *(from memory — do NOT run git to check)*: branch, files edited but uncommitted, whether anything was pushed, migrations run, services left running, temp/scratchpad paths.
- **Verify-before-you-continue block**: the 2–3 commands that re-confirm the handoff is still true (`git status`, `git log -1`, the test command + expected N/N). Instruct: any disagreement means the handoff is **stale** — reconcile before acting.

## Self-check gate — before emitting

- Could a fresh agent with **zero session memory** execute the RESUME HERE action without asking a single question? No → fix it.
- Is every claim tagged, and is every `[VERIFIED]` backed by evidence you actually saw this session?
- Are the dead ends listed with **why** they died?
- Did you resist every "let me just check one thing"?

## Anti-patterns

- Investigating, verifying, or finishing work after this skill loads.
- Vague next action ("continue working on the auth fix") with no command.
- Errors paraphrased instead of quoted.
- Confident assertions about state you did not directly observe.
- Dropping the failure/dead-end list to save space.
- Writing the file and stopping without the inline recovery stub.
