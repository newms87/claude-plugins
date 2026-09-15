---
name: plan-workflow
description: 'THE planning workflow for any task with a human in the loop that goes beyond a quick cleanup — starting a multi-step plan or build; ANY question whose answer affects a plan; monitoring anything over time; resuming or handing off unfinished work. The danxbot Plan is the ONLY planning record: goals / rules / caveats are plan records, the design is the plan''s architecture sections, actionable work and every operator question are cards attached to the plan. No plan files, no `~/.claude/plans/*.md`, no repo `.md` specs, no HTML pages, no chat summaries standing in for it. Start: `plan_list` → `plan_connect` (or `plan_create` then connect); operator answers and comments on the plan''s cards then arrive on their own as relayed dashboard-event messages (the plugin''s plan event bridge, which starts when the session connects) — nothing to arm, never poll. Operator question = a `Task` card with an open problem (`issue_problem` add) carrying `issue_solution` options (exactly one recommended) — opening the problem IS what puts it in front of the operator, nothing else to set — attached with `plan_add_card`; chat names the card id; `AskUserQuestion` is forbidden. SCOPE GATE: every card on a plan names the goal it advances; work found along the way that serves no goal goes to the plan that owns it, and a plan whose open work drifts off its goals is split. ZERO-CONTEXT RULE: nothing lives only in the session — every item of work, follow-up, cleanup, in-flight agent and uncommitted local state is an AC item, its own card, or a plan record, so a brand-new agent could take over with nothing missed; always the ideal, correct, zero-tech-debt solution. TURN GATE: before any chat reply, everything learned or decided this turn is written into the plan; chat is a short TLDR plus a pointer (record ref or card id). Load before connecting to, creating, or writing a plan.'
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
3. Set this plan session's title to match your Claude session title, never the repo folder —
   `PATCH /api/plan-sessions/:sessionId {"title": "<Claude session title>"}` (read the title with
   the Desktop session tool, `get_session` with `self`). See "Running a plan with sub-agents".
4. `plan_get({fields:["records","architecture","cards"]})` (no id) — read the connected plan
   before doing anything else. A BARE `plan_get` returns only cheap scalars (`plan`, `boards`,
   `cardCount`, `bucketCounts`, session state, `available_field_groups`) — see "Reading a plan".
5. Before every chat reply this session: run the Turn Gate below.

## What goes where — no other planning surface exists

| Content | Where it goes | Tool |
|---|---|---|
| The outcome the work is measured against | Goal record (`G-n`) | `plan_add_record({kind:"goal"})` |
| A constraint that must hold while working | Rule record (`R-n`) | `plan_add_record({kind:"rule"})` |
| A surprising fact, known gap, verified-vs-assumed note | Caveat record (`CAV-n`) | `plan_add_record({kind:"caveat"})` |
| How the work is shaped (components, data flow, decisions and their reasons) | Architecture sections (each independently editable, hash-guarded markdown) | `plan_add_architecture_section` / `plan_update_architecture_section` |
| A piece of actionable work | A card on the board of the repo it changes, attached to the plan | `issue_create` → `plan_add_card` |
| A card attached to the wrong plan | Remove the membership (the card itself is untouched) | `plan_remove_card({plan_id, card_id})` |
| A plan whose name no longer fits | Rename it | `plan_rename({plan_id, name})` |
| A question only the operator can answer | A `Task` card with solutions, attached to the plan | see "Operator questions" |
| Progress, findings, evidence on a specific piece of work | A comment on that card | `issue_comment` |

Forbidden substitutes: a plan file, `~/.claude/plans/*.md`, a repo `.md` spec or handoff doc,
an HTML page, a `.junk/` notes file, in-session `TaskCreate`/`TaskList` as the record (it is
working memory only), and a chat summary.

## The mantra — zero-context continuity and the ideal solution

The danxbot plugin injects this on every session start (`danxbot/scripts/zero-context-mandate.sh`).
This section is the procedure for applying it to a plan.

**Nothing lives only in the session.** Plan every piece of work as if this session will be wiped
and a brand-new agent with zero context takes over. That agent must find everything that still
has to happen:
- each follow-up, cleanup, verification, deploy and publish step;
- each open decision and deferred finding;
- each stopped or in-flight sub-agent, and what it was doing;
- all uncommitted or unpushed local state: clone paths, worktrees, branches, local SHAs.

| Kind of item | Where it goes |
|---|---|
| A step that finishes an existing card | An AC item on that card (`issue_checklist` `add_item`) |
| Work outside any existing card's scope (a cleanup, a follow-up fix, a deferred gap) | Its own card attached to the plan it serves, with `depends_on` edges where ordering matters |
| A lasting goal, rule, caveat or design fact | A plan record or architecture section |
| Status, evidence, local state of in-flight work (clone path, local SHA, what a paused agent was about to do) | A comment on the card |

Never a vessel for any of these: chat, `TaskCreate`/`TaskList`, the session scratchpad (wiped
between sessions), a sub-agent's context, or "I'll do it once X finishes".

**Mechanical check.** Run it before every chat reply, before dispatching or stopping a sub-agent,
and before compaction or ending the session: *"If this session were wiped right now, would a
zero-context agent miss a single item of work or cleanup?"* Any yes → write that item to its card
or plan first, then continue.

- **Incident, 2026-09-14.** A handoff said a card's worktree was stale scratch, when stopped agents
  had left 25 uncommitted files in it.
- **Same session.** Three parallel builders' clone paths, local commit SHAs and phase-2 merge order
  existed only in the orchestrating session's context.

**Always the ideal, correct solution.** Time and money are irrelevant: go slow to go fast, and leave
no rakes behind. Every plan's architecture opens with this standard, and every card is scoped to
leave none of the following when it finishes:
- tech debt;
- backwards compatibility;
- legacy, deprecated or obsolete code;
- duplicated code (DRY and SOLID always).

A replaced path is deleted in the same change. Anything that cannot land in that card becomes its
own card **before** the work starts, never a note to self.

## Scope — a plan serves its goals and nothing else

**Incident (plan 2 "danxbot planning integration", 2026-09-14).** The goals were the Plans UI and
agent-driven planning. Over one day the session attached every problem it tripped over to the
connected plan: worker dispatch bugs, deploy disk, test-suite failures, npm tokens. By evening
36 of 48 cards were worker reliability, one of them had taken ten review rounds, and a rule
tied to that one card was holding every production deploy. Meanwhile the two cards that WERE
the goal sat untouched in ToDo, and status reports described worker progress as plan progress.
The operator had to ask "do all these cards accomplish the goal?" to surface it. The fix was a
split into two plans. Everything below exists so that question never has to be asked again.

### The scope gate — before `plan_add_card`, and before attaching any `issue_create`
1. **Name the goal.** Write down which `G-n` this card moves toward done. If you cannot name
   one, the card does NOT go on this plan.
2. **"Found while working this plan" is not membership.** A bug in the worker, the deploy
   pipeline, a test suite, a tool or another repo gets its own card on the plan whose goals it
   serves. If no such plan exists, create one or leave the card off every plan and say so.
   Being connected to a plan is never the reason a card joins it.
3. **Enabling work joins only when it blocks a goal today.** A deploy fix or a flaky test belongs
   on this plan only while it stands between a goal and done. In that case its first comment
   names the goal it unblocks. When it stops blocking, remove it (`plan_remove_card`).

### Keep checking — the drift audit
Run it when you start work, after any card lands, and every time you report status. Sort the
plan's open cards by the goal each one advances.

| What the audit shows | What you do |
|---|---|
| Every open card names a goal | Carry on |
| Goal cards untouched while other cards got the effort | Stop the other work. Ready or pick up the goal cards first |
| Cards cluster around a theme no goal names | Split the plan (below) |
| A card outside the goals is blocking goal work (a deploy hold, a shared rule) | Name the block in chat now, then move that card to its own plan |
| One card reaches its third review round and still turns up new high-severity findings | File a Needs Help Task card with solutions on narrowing or splitting it. Never start round 4 silently |

### Splitting a plan — mechanical
1. `plan_create` the new plan, named after its theme.
2. Write the new plan's goals, rules, caveats and architecture about **that theme only**.
   - **Copy** rules that govern both plans, such as git, deploy and test-environment rules.
   - **Move** caveats that belong to the new theme: add them there, delete them here.
   - **Never carry across** records about the old plan's subject, or session history.
3. **Write without moving your session.** MCP write tools act only on the connected plan, and
   `plan_connect` to the other plan moves your session, and with it the events you hear. Use the id-scoped
   routes instead:
   - `POST /api/plans/:id/records {kind, body, context}`
   - `POST /api/plans/:id/architecture/sections {title, content}`
   - `POST /api/plans/:id/cards {card_id}`
   - `DELETE /api/plans/:id/records/:rid {content_hash}`
   - `plan_remove_card({plan_id, card_id})`, or `DELETE /api/plans/:id/cards/:card_id`
4. Add each moved card to the new plan, then remove it from the old one. A card sits on both
   plans only when it truly advances a goal on each.
5. On every in-progress card you move, leave a handoff comment covering:
   - its current state and what is already on main;
   - what is started but not finished;
   - who holds the claim, and how to take it (`rollback_pickup`, then your own pickup);
   - any rule it is currently tripping.
6. Stop every sub-agent, monitor and background task you were running for the moved work, and
   list them in chat. A builder left running pushes into work someone else now owns.
7. Read both plans back before reporting: card counts, records, sections.
8. Tell the operator:
   - the new plan's id and URL;
   - its goal, rule, caveat and card counts;
   - what you stopped;
   - that you are back on this plan's goals.

### Dos and don'ts
**Do**
- Report status goal by goal: what moved toward done, and what is blocking each goal. Label
  anything else plainly as outside this plan.
- Keep goal cards flowing before chasing side problems. Ready buildable goal cards for the
  worker instead of letting them wait behind infrastructure work.
- When the operator asks whether the work serves the goal, answer from a fresh read of the
  goals and cards, never from memory. Admit the drift if there is any.
- When you said you would stop and check scope "if X happens", stop the moment X happens.

**Don't**
- Attach a card to the connected plan just because you are connected to it.
- Let a rule written for one side problem silently block goal work, as a deploy hold did in
  the incident.
- Present side work as plan progress.
- `plan_connect` to another plan to write one record there.
- Keep the same open card on two plans with two different owners working it.

## Connecting — one session, one plan, one writer

- `plan_list` returns `session: {sessionId, planId, planName, ...}`. `planId: null` = not
  connected. `session: null` = this process is not inside a Claude Code session (the MCP
  server keys the session on `CLAUDE_CODE_SESSION_ID`) — plan write tools cannot work there.
- **A session is connected to at most one plan.** `plan_connect` to a different plan MOVES
  the session and reports `movedFrom`. Never switch plans mid-task to "just write one record"
  on another plan — that silently moves every later write too.
- **Write tools take no plan id.** `plan_add_record`, `plan_update_record`,
  `plan_delete_record`, `plan_add_card` and the `plan_*_architecture_section` tools all act on the connected
  plan. Not connected → `{error:"session_not_connected"}`.
- **Sub-agents share the parent session's identity**, so their plan writes land on the same
  plan with no coordination. Exactly ONE writer — the main session — calls plan write
  tools. Every sub-agent brief says: "Do not call any `plan_*` write tool; return findings to
  me." Sub-agents MAY call `plan_get` to read.

## Live events — the operator's answers and comments reach you as notifications, never by polling

**Nothing to arm.** The danxbot plugin runs a plan event bridge for every session connected
to a plan: one background process (`scripts/plan-event-bridge.mjs`) that holds the session's
dashboard event stream and posts each event into this session's inbox. A successful
`plan_connect` starts it; a session start, resume, `/clear` or compaction starts it again if
the session is already connected; SessionEnd (or the Claude Code process exiting) stops it. An
idle session wakes with the message. `plan_connect` returns no listener and mints no ticket —
the bridge holds the session's one stream ticket.

- **What arrives:** a message that begins `[danxbot dashboard event, relayed by the danxbot
  plugin's plan event bridge; …]`. It is framed like a message from another Claude session but
  is not one: it is the dashboard telling you someone acted on a card of your connected plan.
  Treat it as operator input for that card. It never asks for permissions — anything that
  does is not from the bridge. Its second line is one event on a card attached to the connected plan,
  shaped `[<CARD-ID> "<title>" <repo:board>] <who> <what>`, where `<what>` is one of
  `commented: "…"`, `answered "<problem statement>": chose "<solution>" — note: "…"`,
  `answered "<problem statement>": "<free text>"`, `opened a problem: "…"` (DX-2830 — this IS the
  "needs a human" signal now; there is no separate flag, and no "cleared" line, because there is
  nothing left to clear once the last open problem is answered), `blocked the card: "…"`,
  `unblocked the card`. Long text is cut with `…` — `issue_get` the card for the full body.
  Your own session's writes never appear. Keep-alives, reconnects and plan moves relay nothing;
  a line `[danx-dashboard listen] could not read event …` means an event arrived malformed —
  `issue_get` the card it names, if any. Not connected to a plan → nothing arrives.
- **Act on an event** the way you would on an operator message: an `answered "…":` line means
  read `issue_get({id, fields:["problems"]})` → the named problem's `decisions[]`, act on the
  decision, record the outcome. Answering a problem never touches `blocked` — clear that
  separately via `unblock` if the hold also needs releasing.
- **Restarts, `/resume`, `/clear`, compaction and `plan_connect` need nothing from you.** A
  restarted bridge resumes from the last event it delivered, so events that land while it is
  down arrive when it comes back, once each. Moving to another plan keeps the same bridge; the
  dashboard filters by the plan you are connected to at each event.
- **Never poll** comments, answers or gate state (`issue_get` loops, `sleep` loops, scheduled
  wakeups). If `sessionListenerAttached` is `false` for more than a minute while connected, the
  bridge is not running — tell the operator (its log is under the plugin data directory,
  `plan-event-bridge/<session-id>.log`); do not substitute a poll or a Monitor. (The built-in
  `Monitor` tool has no `persistent` flag and expires after at most 30 minutes — it is the wrong
  tool for a plan's live events regardless; the bridge above exists precisely so nothing here
  ever needs re-arming.)

## Writing records

- **Records are short.** A goal/rule/caveat `body` is ONE plain statement of at most **250
  characters** — the server refuses anything longer. Evidence, history, examples and detail go in
  the record's markdown `context` (`plan_add_record({kind, body, context})`; `plan_update_record`
  keeps context when omitted, `null` clears it). One fact per record, never a numbered list.
- **Kinds mean different things.** A GOAL is an outcome the work is measured against. A RULE is a
  constraint that must hold while the plan is worked. A CAVEAT is a lasting trade-off or limitation
  of the ARCHITECTURE. Progress, status, deploy results, "blocked until X" notes and session
  dialog are NEVER records — they are comments on the card they concern (create the card if the
  work has none).
- **Card states are always true.** A card is In Progress only while something is actively
  working it: this session, a sub-agent, or a worker dispatch. Before a local sub-agent works a
  card, `pickup manual:true` with `assigned_agent` (read it back). Buildable work goes to the
  danxbot worker by `ready` (isolated worktrees, every quality gate). Shipped work is completed
  (checklist → gate verdicts → complete → retro) the moment it lands. The moment nobody is
  working a card, `issue_transition rollback_pickup` then `ready` — `rollback_pickup` clears
  `assigned_agent`, so restore the claim with `POST /api/issues/:id/assigned-agent {"name":
  "<agent>"}` if the same agent should keep it. Update a card's state as the work happens, never
  in a batch at the end.
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
- **Architecture is sections, not one document (DX-2726).** `plan_add_architecture_section({title,
  content})` appends one; `plan_update_architecture_section({section_id, base_hash, title?,
  content?})` edits only what changed; `plan_delete_architecture_section({section_id, base_hash})`
  soft-deletes; `plan_reorder_architecture_section({order})` takes EVERY live section id once and
  needs no hash. `base_hash` = the section's `contentHash` from the immediately prior `plan_get` /
  `plan_get_architecture_section`. On `stale_plan_architecture_section` the refusal carries
  `currentHash` + `currentTitle` + `currentContent`: merge into those, retry with `currentHash` —
  for a delete, first confirm it is still the section you meant to remove. One section per
  concern, so an edit to one never stales a concurrent edit to another.
- **Problems and solutions (DX-2735/DX-2830):** `issue_problem` edit/remove need `base_hash` =
  the problem's `content_hash` from the last `issue_problem({action:"list"})` or `issue_get({fields:["problems"]})`; on `stale_problem` merge against `currentProblem`. `issue_solution`
  edit/remove need `base_hash` = the solution's `content_hash` from that same problem read (each
  problem carries its own `solutions[]`), plus the REQUIRED `problem_id`; on `stale_solution`
  merge against `currentSolution`.

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
2. `issue_problem({id, action:"add", statement, solutions})` — `statement` restates the question
   in one plain sentence; `solutions[]` carries one entry per viable option (`title`, `body` =
   what the option actually does, `pro`, `con`), exactly ONE with `recommended: true`. This one
   call both opens the problem and creates its options — opening it IS what puts the card in
   front of the operator (DX-2830: a card needs a human exactly when it has an open problem;
   there is no separate flag to set). A single-solution problem is a valid approval question;
   zero solutions is valid when only a free-form answer fits.
3. `plan_add_card({card_id})`.
4. Chat says only: "`<CARD-ID>` needs your call" plus one line of status.

The operator answers in the dashboard ("Use this", "This but…" with a note, or a free-form
answer). The answer arrives as a relayed `answered "<statement>": ...` event line — never poll
for it. Read it with `issue_get({id, fields:["problems"]})` → the problem's `decisions[]`
(chosen solution + optional note, or a free-form answer). Answering the last open problem is
what makes the card stop needing a human — automatic, nothing to clear directly; it never
touches `blocked`. Act on the decision and record the outcome (comment on the card; update any
affected record or the architecture).

## Actionable work cards

Create through `danxbot:issue-card-workflow` (load it before choosing a card type), on the
board of the repo the work changes, then `plan_add_card`. Follow that skill's create →
ready → re-read verification. A card may sit on several plans; `plan_add_card` is idempotent
and never edits the card.

## Running a plan with sub-agents

Standing operator directives, 2026-09-15. Apply these to every sub-agent and worker dispatch a
planning session launches — not just to the plan record.

### Size every sub-agent before you dispatch it

Decide how much reasoning the task needs and set that as `effort_level` on the card it serves,
before dispatching. Then launch the model/effort pair the ladder maps to — never let a sub-agent
inherit the session's own model.

| Card effort | Model / effort | Dispatch via |
|---|---|---|
| min, very_low | haiku / low | `danxbot:worker-haiku-low` |
| low | haiku / high | `danxbot:worker-haiku-high` |
| medium | sonnet / low | `danxbot:worker-sonnet-low` |
| high | sonnet / medium | `danxbot:worker-sonnet-medium` — the default for most build, fix, test and investigation work |
| very_high | sonnet / high | `danxbot:worker-sonnet-high` |
| max | opus / high | `danxbot:worker-opus-high` — the minimum for any architecture agent, including architecture-gate reviewers |
| above max | opus/fable, high | `danxbot:worker-fable-high` — extra-complex stories only |

Danxbot's own effort ladder includes `haiku / minimal` for `min` card effort, but Claude Code sub-agents have no `minimal` effort level, so from a planning session both `min` and `very_low` dispatch as `danxbot:worker-haiku-low`.

Most work is card effort `high`: cards have precise acceptance criteria, tests and quality
gates, so Sonnet at medium effort rarely gets it wrong. Bulk, mechanical or "turk" edits go to
Haiku. Architecture work is Opus at minimum.

**Mechanism.** The Agent tool's per-call `model` parameter wins over agent frontmatter, but
effort can only be set through an agent definition's `effort` frontmatter — there is no per-call
effort parameter. So dispatch through the plugin's `worker-<model>-<effort>` agent definitions
(each pre-sets both fields), not by passing `model` alone and hoping effort follows. Plugin
agents are namespaced by plugin name — once this plugin is installed, invoke them as
`subagent_type: "danxbot:worker-<model>-<effort>"`, not the bare filename.

**Mechanical check.** Before every `Agent(...)` call, name the card's `effort_level` and the
`subagent_type` the ladder row maps it to. A plain `general-purpose` call or an unspecified
`subagent_type` silently inherits the session's own model.

### Liveness claims need live evidence

`status: running` on a dispatch row does not prove an agent is working. Before telling the
operator a dispatch is running or making progress, do one of:
- read a progress counter (e.g. `tokensOut` from `GET /api/issues/:id/dispatches`) twice, at
  least 60 seconds apart, and report both timestamps and values; or
- read the dispatch's session JSONL (the row carries `jsonlPath` on the worker host) and state
  how long ago its last entry was.

Always name which source you read.

**Incident, 2026-09-15.** A planning session told the operator three worker dispatches were
"still producing output" after one read of the dashboard rows, never having seen the JSONL. The
operator had to ask where that came from.

### Session names match

A planning session's name on the plan must equal its Claude session title, never the repo
folder — several sessions can share one repo. Until card DX-2816 automates it, set it yourself
at connect time (TodoWrite checklist step 3): `PATCH /api/plan-sessions/:sessionId {"title":
"<Claude session title>"}`. Read the Claude title with the Desktop session tool, `get_session`
with `self`.

## THE TURN GATE — before every chat reply

1. Everything learned, decided, verified or disproven this turn is in the plan: a record
   added/updated/deleted, the architecture merged, a card created/commented/answered.
2. Every question for the operator is a Task card per the section above — none in chat.
3. Any claim this turn that a dispatch or sub-agent is running or making progress cites two
   timestamped reads at least 60 seconds apart, or a named JSONL last-entry age — never a status
   field alone. See "Liveness claims need live evidence" above.
4. Chat is a short TLDR (what happened, what is next) plus a pointer: a record ref
   (`CAV-4`), a card id (`DX-2683`), or the plan URL `https://danxbot.sageus.ai/plans/<id>`.
   No tables, evidence blocks, option lists or root-cause prose in chat — that content
   belongs in the plan, so move it there first.

If the operator has to ask "is the plan updated?", the gate already failed.

## Reading a plan — ask only for what you need (DX-2727)

- **Bare `plan_get` is small:** `{plan, boards, cardCount, bucketCounts, session,
  sessionListenerAttached, available_field_groups}` — no cards, records or architecture.
  Use it when you only need the plan's identity or your connection state.
- **`fields` opts in, each group returning exactly what it names:** `cards` (one page of member
  cards — `cards_limit` 1..1000, default 200, and `cards_offset`, default 0; the response
  carries `cards_total` and `cards_offset`, so keep paging with a larger `cards_offset` while
  `cards_offset + cards.length < cards_total`; either paging param without `fields` including
  `cards` is a 400), `records` (every
  goal/rule/caveat keyed by kind) or `records:goal` / `records:rule` / `records:caveat` (one
  kind only), `architecture` (`{sections:[...]}` with each section's `contentHash`), `sessions`
  (every session connected to the plan). An unknown group name is a 400 naming the allowed set.
- **Before a hash-guarded edit** read only the group that carries the hash: `records:<kind>`
  for a record, `architecture` (or `plan_get_architecture_section`) for a section.
- **Read many cards in ONE call:** `issue_get({ids:["DX-1","ENG-7",...], fields:[...]})` resolves
  every id globally (across boards) and returns `{issues, not_found}` — an unknown id lands in
  `not_found` instead of failing the call. Pass exactly one of `id` / `ids`, at most 100 distinct
  ids per call (more is a 400 — split the list). `board` is refused alongside `ids`, because a
  batch read is never board-scoped.

## Resuming and handing off

There is no resume page and no handoff document. A new or post-compaction session:
`plan_list` → `plan_connect` (if not connected) → `plan_get({fields:["records","architecture","cards"]})`,
then ONE `issue_get({ids:[...]})` for the attached cards that are in progress or carry an open
problem. Before stopping with work unfinished,
the Turn Gate already guarantees the plan holds current state; add a caveat for anything
half-done that the next session would otherwise trip over.

## Feature facts (verified 2026-09-15 against danxbot `origin/main` at `4acb85f2` — includes
DX-2830 "requires_human is retired" (`6060c8bc`) and DX-2782 auto-triage-via-problem
(`d6a8ff31`); MCP package `@thehammer/danx-dashboard-mcp` at `0.1.69`)

- **UI:** production serves the React Plans UI at `https://danxbot.sageus.ai/plans` and
  `/plans/:planId` (`frontend/src/app/routes.tsx`; `src/dashboard/server.ts` serves
  `frontend/dist/` for the `plans` route prefix, assets under `/react-assets/`). The plan
  detail screen shows the plan's cards plus Goals / Architecture / Rules / Caveats tabs.
  The old per-board `/plan` screen is gone (DX-2680) — "Plan" and "Plans" are not two areas.
- **Tables** (`src/db/migrations/`): `plans` (id, name, created_at); plan architecture
  sections (title, markdown content, sort order, per-section content hash, soft delete —
  DX-2726); `plan_cards` (plan_id, card_id, unique pair, cascade on either
  side); `plan_records` (kind `goal|rule|caveat`, permanent `ref_num`, body, content hash,
  soft delete via `deleted_at` — refs are never reused); `plan_sessions` (session_id =
  `CLAUDE_CODE_SESSION_ID` primary key, nullable plan_id — one plan per session);
  `issue_problems` + `issue_solutions` + `issue_decisions` (DX-2735/DX-2830 — a card's open
  questions, each one's candidate answers with at most one live recommended, and the operator's
  recorded answers; a card needs a human exactly when it has a live, undecided row in
  `issue_problems` — `open_problem_count`, computed, not a stored flag); `issue_activity_events`
  (durable comment/`solution_answered`/`problem_added`/blocked/unblocked events, 7-day retention
  — there is no `requires_human_set`/`requires_human_cleared` kind any more, retired by DX-2830)
  and `plan_session_listener_tickets` (hashed per-session stream tickets on a 15-minute lease).
- **HTTP** (`src/issues/plans-routes.ts`, `src/issues/plan-sessions-routes.ts`,
  `src/issues/routes.ts`): `/api/plans` (list/create/rename, paged with `limit`/`offset`/`sort`/
  `q`), `/api/plans/:id` (+ `/cards`, `/records`, `/full`),
  `/api/plans/mine/architecture/sections[/:sid|/reorder]`, `/full` and `/mine` both take
  `?fields=cards,records|records:<kind>,architecture,sessions` (bare = scalars only) plus
  `cards_limit`/`cards_offset` paging for the cards group, `GET /api/issues/batch?ids=...` (the
  global batch card read behind `issue_get({ids})`, at most 100 ids — all DX-2727),
  session-scoped `/api/plans/mine/*`, `/api/plan-sessions/me/plan` (connect),
  `/api/issues/:id/problems[/:pid]` (list/add/edit/remove — DX-2830 replaced the flat
  `/api/issues/:id/solutions[/:sid]` route with this problem-scoped one),
  `/api/issues/:id/problems/:pid/solutions[/:sid]`, `/api/issues/:id/problems/:pid/answer`
  (records a decision; refuses machine tokens; releases the "needs a human" state automatically
  once no open problem remains; never touches `blocked`), `/api/plan-sessions/stream` (the
  ticket-authed session event stream the `listen` bin consumes).
- **MCP tools** (`packages/danx-dashboard-mcp/src/index.ts`, published as
  `@thehammer/danx-dashboard-mcp`): `plan_list`, `plan_get`, `plan_create`, `plan_connect`,
  `plan_add_record`, `plan_get_record`, `plan_update_record`, `plan_delete_record`,
  `plan_add_card`, `plan_remove_card` and `plan_rename` (both take an explicit `plan_id`,
  idempotent / immediate — DX-2740), `plan_get_architecture_section`,
  `plan_add_architecture_section`, `plan_update_architecture_section`,
  `plan_delete_architecture_section`, `plan_reorder_architecture_section` (DX-2726; the old
  whole-document `plan_set_architecture` is gone), plus `issue_problem` and `issue_solution`
  (DX-2735/DX-2830 — `issue_requires_human` is GONE, deleted along with the `requires_human`
  column set; there is nothing left to set or clear, only problems to open and answer). Prefix
  is `mcp__danx_dashboard__` in an operator session and `mcp__danx-dashboard__` in a dispatched
  worker — load a tool's schema with `ToolSearch` before the first call. Plans are global, not
  board-scoped; their cards come from any board. The board Brief (`brief_*`) is a different
  feature.
- **Showing the operator a plan or card (DX-2724):** open the plan URL
  (`https://danxbot.sageus.ai/plans/<id>`) — or a card's dashboard URL — in the OPERATOR'S OWN
  browser and let them authenticate there themselves. Agents never sign in to the dashboard and
  never hold or use dashboard user credentials.

## Cross-references

- `danxbot:issue-card-workflow` — card types, lifecycle, comments; the card side a plan attaches.
- `human-collaboration:human-loop` — when an ask is legitimate and the brief shape it takes.
- `dev:ideal-solution-mindset` — the principles a plan's design must satisfy.
