---
name: plan-workflow
description: 'THE planning workflow for any task with a human in the loop that goes beyond a quick cleanup — starting a multi-step plan or build; ANY question whose answer affects a plan; monitoring anything over time; resuming or handing off unfinished work. The danxbot Plan is the ONLY planning record: goals / rules / caveats are plan records, the design is the plan''s architecture document, actionable work and every operator question are cards attached to the plan. No plan files, no `~/.claude/plans/*.md`, no repo `.md` specs, no HTML pages, no chat summaries standing in for it. Start: `plan_list` → `plan_connect` (or `plan_create` then connect) → arm the returned `listener.command` with Monitor (`persistent: true`) so operator answers and comments arrive as notifications — never poll. Operator question = a `Task` card with `issue_solution` options (exactly one recommended) + `requires_human`, attached with `plan_add_card`; chat names the card id; `AskUserQuestion` is forbidden. TURN GATE: before any chat reply, everything learned or decided this turn is written into the plan; chat is a short TLDR plus a pointer (record ref or card id). Load before connecting to, creating, or writing a plan.'
---

# Plan Workflow — the danxbot Plan Is the Record

A **Plan** is a named, dated record on the danxbot dashboard that holds everything about
one piece of human-driven work: what it is for, what must hold, what is awkward, how it is
designed, and every card of work or question for the operator. It survives compaction,
session restarts and handoffs because it lives in Postgres, not in the conversation.

## TodoWrite checklist (mandatory on first invoke)

1. `plan_list` — read `session.planId`. Connected to the right plan already? Skip to 3.
2. Find the plan for this effort in `plans[]` (read candidates with `plan_get({plan_id})`).
   Found → `plan_connect({plan_id})`. None → `plan_create({name})`, then `plan_connect`.
3. Arm the live listener from the `plan_connect` reply — see "Live events" below. Already
   connected (step 1 skipped connect)? Check `sessionListenerAttached` in `plan_list`; `false`
   → call `plan_connect` for the same plan to mint a fresh listener, then arm it.
4. `plan_get` (no id) — read the whole connected plan before doing anything else.
5. Before every chat reply this session: run the Turn Gate below.

## What goes where — no other planning surface exists

| Content | Where it goes | Tool |
|---|---|---|
| The outcome the work is measured against | Goal record (`G-n`) | `plan_add_record({kind:"goal"})` |
| A constraint that must hold while working | Rule record (`R-n`) | `plan_add_record({kind:"rule"})` |
| A surprising fact, known gap, verified-vs-assumed note | Caveat record (`CAV-n`) | `plan_add_record({kind:"caveat"})` |
| How the work is shaped (components, data flow, decisions and their reasons) | Architecture document (one markdown doc) | `plan_set_architecture` |
| A piece of actionable work | A card on the board of the repo it changes, attached to the plan | `issue_create` → `plan_add_card` |
| A question only the operator can answer | A `Task` card with solutions, attached to the plan | see "Operator questions" |
| Progress, findings, evidence on a specific piece of work | A comment on that card | `issue_comment` |

Forbidden substitutes: a plan file, `~/.claude/plans/*.md`, a repo `.md` spec or handoff doc,
an HTML page, a `.junk/` notes file, in-session `TaskCreate`/`TaskList` as the record (it is
working memory only), and a chat summary.

## Connecting — one session, one plan, one writer

- `plan_list` returns `session: {sessionId, planId, planName, ...}`. `planId: null` = not
  connected. `session: null` = this process is not inside a Claude Code session (the MCP
  server keys the session on `CLAUDE_CODE_SESSION_ID`) — plan write tools cannot work there.
- **A session is connected to at most one plan.** `plan_connect` to a different plan MOVES
  the session and reports `movedFrom`. Never switch plans mid-task to "just write one record"
  on another plan — that silently moves every later write too.
- **Write tools take no plan id.** `plan_add_record`, `plan_update_record`,
  `plan_delete_record`, `plan_add_card`, `plan_set_architecture` all act on the connected
  plan. Not connected → `{error:"session_not_connected"}`.
- **Sub-agents share the parent session's identity**, so their plan writes land on the same
  plan with no coordination. Exactly ONE writer — the main session — calls plan write
  tools. Every sub-agent brief says: "Do not call any `plan_*` write tool; return findings to
  me." Sub-agents MAY call `plan_get` to read.

## Live events — the operator's answers and comments reach you as notifications, never by polling

Every `plan_connect` reply carries `listener: {command, persistent: true, instruction}`. The
command is `npx -y @thehammer/danx-dashboard-mcp@<version> listen --stream '<dashboard>/api/plan-sessions/stream' --ticket '<ticket>' --lease-ms 900000`
— the ticket is minted inside `plan_connect` and scoped to this session.

- **Arm it immediately** with the `Monitor` tool, `persistent: true`, running `listener.command`
  EXACTLY as returned. Never build or edit the command by hand, never paste your own token
  into it. `plan_connect` failing with `listener_not_armed` means you are connected but NOT
  listening — fix the reported problem and call `plan_connect` again.
- **What arrives:** one notification line per event on a card attached to the connected plan,
  shaped `[<CARD-ID> "<title>" <repo:board>] <who> <what>`, where `<what>` is one of
  `commented: "…"`, `answered: chose "<solution>" — note: "…"`, `answered: "<free text>"`,
  `set requires_human: "…"`, `cleared requires_human`, `blocked the card: "…"`,
  `unblocked the card`. Long text is cut with `…` — `issue_get` the card for the full body.
  Your own session's writes never appear. Keep-alives and reconnects print nothing.
- **Act on an event** the way you would on an operator message: an `answered:` line means read
  `issue_get({id, fields:["solutions"]})` → `decisions[]`, act on the decision, record the
  outcome. (An answer already releases `requires_human` and `blocked` server-side — do not
  re-clear them.)
- **Final lines** start `[danx-dashboard listen]`. `stopped: another listener … took over` —
  a newer `plan_connect` replaced it; re-arm only if that was not you. `stopped: … (revoked)`
  or `gave up: …` — call `plan_connect` again (same plan is fine) and arm the new command.
- **After a session restart or `/resume`:** the old Monitor is gone. `plan_connect` again and
  arm the new command; the old ticket is superseded automatically.
- **Never poll** comments, answers or gate state (`issue_get` loops, `sleep` loops, scheduled
  wakeups). If `sessionListenerAttached` is `false` while connected, you are not listening —
  re-arm; do not substitute a poll.

## Writing records

- **Write for a stranger**: an experienced engineer who has never seen this codebase or this
  conversation. Plain text (records are not markdown). Define a domain word before using it.
- **Carry real evidence and current status** in the body: ids (`#WR-727`, `DX-2683`), commit
  SHAs, file paths, timestamps read from the clock, and whether each claim is VERIFIED
  (you checked it this session, name how) or UNVERIFIED.
- **Keep records current, not appended to.** A changed fact is an edit of the existing
  record (`plan_update_record`); a record that stopped being true is deleted
  (`plan_delete_record`). The `G-n`/`R-n`/`CAV-n` ref never moves on edit and is never
  reused after delete, so cards and commits can cite it.

## Hash-guarded writes — mechanical

- **Records:** pass `content_hash` = the record's `contentHash` from the immediately prior
  `plan_get` / `plan_get_record` / `plan_add_record`. On `stale_plan_record` the refusal
  carries `currentHash` + `currentBody`: merge your change into `currentBody`, retry with
  `content_hash: currentHash`. Never resend the old hash.
- **Architecture:** call `plan_get` IMMEDIATELY before `plan_set_architecture`, pass
  `architecture.contentHash` as `base_hash` (`""` only for a never-written document). The
  write replaces the whole document — send the full merged markdown. On
  `stale_plan_architecture`: `plan_get` again, re-merge into the fresh content, retry.
- **Solutions:** `issue_solution` edit/remove need `base_hash` = the solution's
  `content_hash` from the last `list`; on `stale_solution` merge against `currentSolution`.

## Operator questions — a Task card, never chat, never AskUserQuestion

**Gate first. Ask the operator ONLY what only the operator can answer:** domain intent, a
business/UX judgment, scope or authority, or an action only they can take (a credential, a
login, hardware). Everything else you decide and record. These are NOT operator questions —
each has been wrongly escalated before:

- **A status report or "here is what shipped"** → a comment on the card or a record update.
- **A self-correction** ("I was wrong about X") → fix the record/card, note it in a comment.
- **A known bug blocked only on mechanics** (a flaky tool, a missing restart, a step you can
  run) → do the step or file actionable work; it waits on nobody.
- **A card that already carries a recommended or chosen option, or has work in flight** →
  it is decided. Proceed on the recommendation; do not re-ask.
- **Implementation choices** (file placement, library, approach A vs B differing only in
  effort) → `dev:ideal-solution-mindset` decides them.

Filing a real question, in order:

1. `issue_create` on the board of the repo the question concerns (the MCP server's default
   board, or pass `board: "<repo>:<slug>"`), with:
   - `type: "Task"` — a planning record; a Task is never dispatched to a worker.
   - `title` — leads with the domain, then says the question in plain words
     ("Demand list vs detail page — which name wins when they disagree?"), never a symbol name.
   - `summary` — 1–3 plain-language sentences, no markdown, no jargon: what is undecided and
     why it matters. It must stand on its own — not a second title, not a teaser.
   - `description` — the evidence: ids, file paths, log lines, how to see it. Markdown is
     fine. Options do NOT go here.
2. `issue_solution({action:"add"})` once per viable option: `title` (short name), `body`
   (what the option actually does), `pro`, `con`. Exactly ONE option gets
   `recommended: true`.
3. `issue_requires_human({set:true, reason, steps})` — `reason` is one plain sentence; the
   response's `solutions_reminder.solution_count` must be ≥ 2 (or 1 for a single approval).
4. `plan_add_card({card_id})`.
5. Chat says only: "`<CARD-ID>` needs your call" plus one line of status.

The operator answers in the dashboard ("Use this", "This but…" with a note, or a free-form
answer). The answer arrives as an `answered:` line from the live listener — never poll for
it. Read it with `issue_get({id, fields:["solutions"]})` → `decisions[]` (chosen solution +
optional note, or a free-form answer). Answering already released `requires_human` and
`blocked`; act on the decision and record the outcome (comment on the card; update any
affected record or the architecture).

## Actionable work cards

Create through `danxbot:issue-card-workflow` (load it before choosing a card type), on the
board of the repo the work changes, then `plan_add_card`. Follow that skill's create →
ready → re-read verification. A card may sit on several plans; `plan_add_card` is idempotent
and never edits the card.

## THE TURN GATE — before every chat reply

1. Everything learned, decided, verified or disproven this turn is in the plan: a record
   added/updated/deleted, the architecture merged, a card created/commented/answered.
2. Every question for the operator is a Task card per the section above — none in chat.
3. Chat is a short TLDR (what happened, what is next) plus a pointer: a record ref
   (`CAV-4`), a card id (`DX-2683`), or the plan URL `https://danxbot.sageus.ai/plans/<id>`.
   No tables, evidence blocks, option lists or root-cause prose in chat — that content
   belongs in the plan, so move it there first.

If the operator has to ask "is the plan updated?", the gate already failed.

## Resuming and handing off

There is no resume page and no handoff document. A new or post-compaction session:
`plan_list` → `plan_connect` (if not connected) → `plan_get`, then `issue_get` the attached
cards that are in progress or carry `requires_human`. Before stopping with work unfinished,
the Turn Gate already guarantees the plan holds current state; add a caveat for anything
half-done that the next session would otherwise trip over.

## Feature facts (verified 2026-09-14 against `C:\Users\newms\projects\danxbot` at `fb461cdb`; live events at `ae230aee`, MCP 0.1.53)

- **UI:** production serves the React Plans UI at `https://danxbot.sageus.ai/plans` and
  `/plans/:planId` (`frontend/src/app/routes.tsx`; `src/dashboard/server.ts` serves
  `frontend/dist/` for the `plans` route prefix, assets under `/react-assets/`). The plan
  detail screen shows the plan's cards plus Goals / Architecture / Rules / Caveats tabs.
  The old per-board `/plan` screen is gone (DX-2680) — "Plan" and "Plans" are not two areas.
- **Tables** (`src/db/migrations/`): `plans` (id, name, created_at, plus the
  `architecture_*` columns — the architecture document is one-to-one on the plan row,
  content-hash guarded); `plan_cards` (plan_id, card_id, unique pair, cascade on either
  side); `plan_records` (kind `goal|rule|caveat`, permanent `ref_num`, body, content hash,
  soft delete via `deleted_at` — refs are never reused); `plan_sessions` (session_id =
  `CLAUDE_CODE_SESSION_ID` primary key, nullable plan_id — one plan per session);
  `issue_solutions` + `issue_decisions` (a card's candidate answers, at most one live
  recommended, and the operator's recorded answers); `issue_activity_events` (durable
  comment/answer/requires_human/block events, 7-day retention) and
  `plan_session_listener_tickets` (hashed per-session stream tickets on a 15-minute lease).
- **HTTP** (`src/issues/plans-routes.ts`, `src/issues/plan-sessions-routes.ts`): `/api/plans`
  (list/create), `/api/plans/:id` (+ `/cards`, `/records`, `/architecture`, `/full`),
  session-scoped `/api/plans/mine/*`, `/api/plan-sessions/me/plan` (connect),
  `/api/issues/:id/solutions[/:sid]`, `/api/issues/:id/answer` (records a decision, releases
  the gates, refuses machine tokens), `/api/plan-sessions/stream` (the ticket-authed
  session event stream the `listen` bin consumes).
- **MCP tools** (`packages/danx-dashboard-mcp/src/index.ts`, published as
  `@thehammer/danx-dashboard-mcp`): `plan_list`, `plan_get`, `plan_create`, `plan_connect`,
  `plan_add_record`, `plan_get_record`, `plan_update_record`, `plan_delete_record`,
  `plan_add_card`, `plan_set_architecture`, plus `issue_solution` and
  `issue_requires_human`. Prefix is `mcp__danx_dashboard__` in an operator session and
  `mcp__danx-dashboard__` in a dispatched worker — load a tool's schema with `ToolSearch`
  before the first call. Plans are global, not board-scoped; their cards come from any board.
  The board Brief (`brief_*`) is a different feature.

## Cross-references

- `danxbot:issue-card-workflow` — card types, lifecycle, comments; the card side a plan attaches.
- `human-collaboration:human-loop` — when an ask is legitimate and the brief shape it takes.
- `dev:ideal-solution-mindset` — the principles a plan's design must satisfy.
