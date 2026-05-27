# Phases vs Epics

**One concept: `children[]`** (ISS-81). On `type: Epic` cards, `children[]` is ordered list of phase cards (UI label "Phases"). On non-epic, `children[]` is sub-cards (UI label "Children"). **Phases MUST be cards** — no in-card phase checklist.

## When to Split

**Split into epic when:**
- 3+ implementation phases.
- Scope spans different domains.
- Expected implementation exceeds ~500 LOC.
- Each phase looks substantial (multiple files, own tests, full session).

**Keep as single card when:**
- Work is sequential but small.
- Everything fits one commit-able session.
- Phases would all touch same module/interface.

**Combine adjacent phases (DX-512).** Three good phases beat seven mediocre ones. Every phase costs dispatch: fresh worker, fresh context, fresh review, fresh commit. Before adding phase, ask "does combined unit still fit one TDD pass + one commit?" — if yes, combine + keep single phase. Phase fan-out is cost multiplier; treat like adding dependency, not checklist item.

## CRITICAL: Epic Without Phase Cards is INVALID

An Epic card with empty `children[]` is **never acceptable end-state**. Instant creation → create EVERY phase card in SAME response. No "phases sketched in description, will split later," no "wait for user to confirm," no "user only asked for epic."

If user prompt looks like it asks for "just an epic," it does NOT. Read as "epic + every phase card" — that's the unit of work. Asking user "want me split phases now?" after writing epic is the violation; do NOT do that.

## Epic Mechanics

1. Set epic's `type: Epic` (no `status:` literal — creation defaults derive to `Review`; server leaves `ready_at`/`completed_at`/`cancelled_at`/`blocked` all null so rule 7 falls through to raw `status: Review` field on creation).

2. In SAME turn create all phase child cards via `issue_create` (set `parent_id` to epic's `id`), each with own description/`ac[]`/`type` and same creation default (all derive `Review`). Append each phase's `id` to epic's `children[]` (or use atomic `phase_children[]` on epic creation).

3. Sequential-phase `waiting_on` chains may land at creation — `waiting_on` is status-independent, so phase may carry derived `Review` + `waiting_on: {by: [<prior-phase>]}` together. Creating agent stamps `by[]` chain same pass it creates the phase cards; no second-pass edit. Picker holds each phase off dispatch until BOTH triage approves (stamps `ready_at` → `ToDo`) AND every `by[]` blocker terminal. Planning agent has full context — capture NOW, not later.

## Where Phase Cards Go

Same derived status as parent epic at creation. Epic derives Review → phase cards derive Review. Epic derives In Progress → phase cards inherit via own triggers. Phase cards move with epic through lifecycle.

## After Completing Each Phase Card

Fill `retro.{good, bad, action_item_ids, commits}`, call `danxbot_complete({status: "complete"})`. Server stamps `completed_at`, clears `dispatch: null`, renders `## Retro` comment, spawns action-item cards. Do NOT edit epic — server propagates parent's triggers from children's derived statuses automatically. Next phase card's notes go in `comments[]` per rule below; once all phases derive Done, server stamps epic's `completed_at` automatically.

## CRITICAL: Update Next Phase Card Before Ending Session

Append "Notes from Phase N" entry to next phase card's `comments[]` + save. Capture: discovered constraints, timing gotchas, reusable helpers + paths, cost/budget observations, dependencies between phases, corrections to description. Assume next agent reads ONLY `description` + `comments[]` — not epic handoff, not conversation history, not git log.

## Completion Contract — `completed` means EVERYTHING on Card is Done

`danxbot_complete({status: "complete"})` is per-CARD signal, not per-dispatch. **Two hard preconditions, both required:**

1. **Every `ac[i].checked` is `true`**, each with direct evidence (test passed, command output, quoted code line). Unchecked AC = unfinished work. No "rest are minor" or "remainder lands in follow-up" exemption — every AC item was defined required at triage.
2. **Every child in `children[]`** (when non-empty) is terminal (`Done` / `Cancelled`). Phase parent whose children still ToDo/In Progress/Blocked/Waiting On is NOT complete; rollup via derive-status, NOT direct write.

If either fails, three options — all keep this dispatch's terminal signal honest:

- **Finish remaining work in-session** (default). Apply Step 1.5 fix-it-yourself filter. If you could plausibly finish in remaining 10–30 minutes, do it.
- **Split into fresh sibling card** if residue is genuinely separate scope. Current card narrows AC set to what landed; new card carries residue. Document split in `comments[]` entry.
- **Move to Blocked / Waiting On** if real human action / external dep gates remainder (per Step 10 / 10b — read no-false-blockers patterns first).

**`danxbot_complete({status: "complete"})` on `type: Epic` is FORBIDDEN.** Epic terminal state DERIVED from child terminal states (rollup), never written directly. Planning-style dispatch whose candidate IS epic (split-into-phases pattern) ends with `danxbot_complete({status: "complete"})` ONLY when every phase child already terminal — rare; planning typically split-and-handoff rather than split-and-rollup. Common case the planning dispatch should:

- Confirm every phase card exists with `parent_id` linked + own AC + `waiting_on` chain stamped.
- Leave epic at derived `In Progress` state (or whatever rollup resolves).
- Call `danxbot_complete({status: "complete"})` — server's write-side guard rejects direct terminal transitions on Epic cards. The DB contract ensures Epic status flows ONLY from children's derived states. Dispatch row finalizes normally; Epic card status remains server-derived.

This guard is defense-in-depth — rule above is contract you uphold. If you reach guard, you tripped the rule.
