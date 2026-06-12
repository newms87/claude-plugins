# Phases vs Epics

**One concept: `children[]`** (ISS-81). On `type: Epic` cards, `children[]` is ordered list of phase cards (UI label "Phases"). On non-epic, `children[]` is sub-cards (UI label "Children"). **Phases MUST be cards** — no in-card phase checklist.

## When to Split — count vertical slices, not hours

The axis is **decomposability, not elapsed time** (see the Card Taxonomy gate in SKILL.md). A "slice" = one independently-shippable, fully-testable vertical increment that lands as a single functional commit. Count the slices, then:

- **1 slice → Story.** One functional commit, kept as small as still-testable. No phase children.
- **A few slices → Feature.** Each child Story ships on its own green commit; the Feature is the capability they add up to.
- **A lot of slices, or multiple Features → Epic.** Decompose into phase children (Feature | Story | Bug | Chore).

**Interlock test (decides where decomposition STOPS).** If two pieces *cannot each ship as their own green functional commit* — landing one alone leaves the system broken/half-done — they are NOT separate slices. Collapse them into ONE Story and carry the size in `effort_level`. Interlock NEVER justifies an Epic; a "decide X" / "review Y" step is a Chore, not a phase.

**Combine adjacent phases (DX-512).** Three good phases beat seven mediocre ones. Every phase costs a dispatch: fresh worker, fresh context, fresh review, fresh commit. Before adding a phase, ask "does the combined unit still ship as one green functional commit?" — if yes, combine. Phase fan-out is a cost multiplier; treat it like adding a dependency, not ticking a checklist.

## CRITICAL: A Container (Epic OR Feature) Without Child Cards is INVALID

A container card — Epic OR Feature — with empty `children[]` is **never acceptable end-state**. Both are containers: never dispatched, status computed from children. Instant creation → create EVERY child card in SAME response. No "phases sketched in description, will split later," no "wait for user to confirm," no "user only asked for the container." A Feature carrying executable work in its own body / `ac[]` with no children is the same DEFECT as an empty Epic — all executable work lives in child Story/Bug/Chore cards, never in the Feature itself.

If user prompt looks like it asks for "just an epic / just a feature," it does NOT. Read as "container + every child card" — that's the unit of work. Asking user "want me split children now?" after writing the container is the violation; do NOT do that.

## Container Mechanics (Epic OR Feature)

These mechanics are IDENTICAL for both container types — wherever a step says "epic," a `type: Feature` container behaves the same: it is never dispatched, its status is computed from children, and its own lifecycle columns stay null. A Feature differs from an Epic only in scale (a few child Stories vs many), never in dispatch/status behavior.


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

**`danxbot_complete({status: "complete"})` on a container (`type: Epic` OR `type: Feature`) is FORBIDDEN.** A container's terminal state is DERIVED from child terminal states (rollup), never written directly — neither type is ever dispatched or completed in its own right. Planning-style dispatch whose candidate IS a container (split-into-children pattern) ends with `danxbot_complete({status: "complete"})` ONLY when every child already terminal — rare; planning typically split-and-handoff rather than split-and-rollup. Common case the planning dispatch should:

- Confirm every child card exists with `parent_id` linked + own AC + `waiting_on` chain stamped.
- Leave the container at derived `In Progress` state (or whatever rollup resolves).
- Call `danxbot_complete({status: "complete"})` — server's write-side guard rejects direct terminal transitions on container (Epic / Feature) cards. The DB contract ensures container status flows ONLY from children's derived states. Dispatch row finalizes normally; container card status remains server-derived.

This guard is defense-in-depth — rule above is contract you uphold. If you reach guard, you tripped the rule.
