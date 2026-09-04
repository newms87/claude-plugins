---
name: danx-ideate
description: Launch the ideator agent to explore the repo, build knowledge, and generate feature cards.
---

# Danx Ideate

Launch the ideator agent to brainstorm features and generate draft cards. Use `mode: "bypassPermissions"`.

## Scope

Current repo only.

| Invocation | Scope |
|------------|-------|
| `/danx-ideate` | Current repo |

## /loop and ScheduleWakeup — narrow contract

Ideation is a single-shot dispatch (explore → score → draft → complete).
You have NO legitimate reason to arm `/loop` or `ScheduleWakeup` in this
skill. The contract below applies anyway because every dispatched-agent
skill shares it (ISS-135 / ISS-136).

**ALLOWED:**

- Polling an async pipeline whose result IS part of this card's AC (e.g.
  dispatch a build, `/loop` every 5 min until it finishes, then verify the
  artifact and proceed).
- Monitoring a long-running test whose pass/fail is the AC under test.
- Watching for the next state of an external system you triggered AS PART
  OF THIS CARD's WORK.

**FORBIDDEN:**

- Waiting for a human to reply (use `status: Blocked` instead — the
  operator opens the card, answers, moves it back).
- Waiting for the next card to land (the poller dispatches; you exit when
  this card is done).
- "Let me check on this in N minutes" for anything outside this card's
  scope.
- Arming `/loop` and then calling `danxbot_complete` in the same dispatch.
  Loop owns completion timing — if you call complete, disarm the loop
  first; if a loop is active, do not call complete.

**RULE:** when you call `danxbot_complete`, every `ScheduleWakeup` armed
during this dispatch must be disarmed (or have already fired and exited).
Active loop + complete signal = workflow violation; the next resume will
re-fire the loop after the dispatch is logically over.

## Steps

1. Launch the ideator subagent via `Task` with `mode: "bypassPermissions"`.
2. The ideator:
   - Reads `docs/features.md` (its persistent feature notes).
   - Explores the codebase.
   - Updates the Feature Inventory with current status of features.
   - ICE-scores every non-Complete feature.
   - Brainstorms + prioritizes new feature ideas.
   - Checks for duplicates via `issue_list({filter: {type: 'Feature'}})` (search by title / keywords).
   - Generates 3-5 prioritized feature drafts.
   - For each draft, calls `issue_create({type: 'Feature'|'Bug', title: "...", description: "...", ac: [...], triage_enabled: true})` with the draft content.
     - `triage_enabled: true` is EXPLICIT and intentional here: ideator drafts exist to be evaluated by the automatic triage pipeline. The server default is `false` (explicit-only — nothing is auto-triaged without opting in), so omitting it would strand every draft in Review untriaged.
     - Do NOT set `id` (server assigns the next `<PREFIX>-N`).
     - Do NOT set `parent_id`, `children`, `dispatch`, `status`, `triage`, `comments`, `retro` — server sets defaults.
   - Captures the returned `id` from each successful creation.
   - Saves discoveries back to `docs/features.md`.

3. Report what the ideator produced:
   - Features discovered or recategorized.
   - ICE scores and top priorities.
   - Cards created (with titles + assigned `id`s).
   - Knowledge docs updated (if any).

4. **Signal completion (MANDATORY):** `danxbot_complete({status: "complete", summary: "..."})`. Worker finalizes the dispatch row + SIGTERMs the Claude process. Never exit without it.

## Validation

If `issue_create` returns `{ok: false, body: {error}}`, the request failed schema validation. Read `body.error`, fix the draft fields, and retry. Do NOT delete the draft idea — the data structure (not a file) is the durable record until an `id` is assigned.
