---
name: plan-workflow
description: 'THE planning workflow for any task with a human in the loop beyond a quick cleanup — multi-step plan or build; ANY question whose answer affects a plan; monitoring over time; resuming or handing off unfinished work; operator pastes a plan link. The danxbot Plan is the ONLY planning record: goals/rules/caveats = plan records, design = architecture sections, work + operator questions = cards attached to the plan. No plan files, no `~/.claude/plans/*.md`, no repo `.md` specs, no HTML pages, no chat summaries. Operator question = `Task` card + open problem with solutions, never chat, never AskUserQuestion. Keep 3 cards in flight on own sub-agents; never ask permission to dispatch. Load before connecting to, creating, or writing a plan.'
---

# Plan Workflow

Plan = the record. Lives in dashboard DB. Survives compaction, restart, handoff. Chat does not.

## Start (TodoWrite these, every new/resumed/compacted session)

1. Plan link in prompt (`danxbot.sageus.ai/plans/<id>`, with or without `https://`) → that plan. Else `plan_list`; `session.planId` already right → skip to 3. Else find plan in `plans[]`; none → `plan_create({name})`.
2. Get own session title: `get_session({session_id:"self"}).title` (Desktop) or `/rename` name. Never repo folder. **Judge that title before connecting — it becomes this session's row on the plan and must name what you are DOING, not what you opened.** Generic ("<Repo> plans page"), stale (an earlier task), or already worn by another `list_sessions` row → `set_session_title({session_id:"self", title})` FIRST, then pass the new one. Verbatim means never invent a name, not keep an unusable one. `plan_connect({plan_id, title})`. Renamed later → connect again with new title.
3. Orient: use connect reply's briefing if present; else `plan_get({fields:["records","architecture","cards"]})`. Then ONE `issue_get({ids})` for cards In Progress or with open problem. Read newest handoff comment if a rule points to one.
4. Listener health: connect reply names a fix → do it. `sessionListenerAttached` false >1 min → tell operator. Never poll instead.
5. Open `https://danxbot.sageus.ai/plans/<id>` in in-app browser. Keep it open all session; closed/navigated away → reopen. Never sign in; operator's browser, operator's login.
   **Keeping it open is MISSION-CRITICAL and STANDING-AUTHORIZED — never ask the operator before reopening it.** Asking "want me to reopen it?" is itself the failure.
   - Every turn that touches the browser: run `tabs_context` first. Plan tab missing, or pane closed → reopen it immediately with `navigate` (this opens the pane too). If one open tool is denied, use the other; do not stop to ask.
   - Never `tabs_close` it, never navigate it away, never close the pane.
   - Never `tabs_select` another tab to the front: that buries the plan tab. Do your own work in background tabs you created.
6. Start work SAME TURN: fill 3 sub-agent slots with unblocked cards (see "Keep 3 in flight"). Orient-then-ask = failure.

## Where things go

| Thing | Place |
|---|---|
| outcome measured against | goal record (`plan_add_record kind:goal`) |
| constraint while working | rule record |
| lasting architecture trade-off/limit | caveat record |
| design | architecture section, one per concern |
| actionable work | card on board of repo it changes → `plan_add_card` |
| step finishing existing card | AC item (`issue_checklist add_item`) |
| progress, evidence, status, local state (clone path, SHA, what paused agent was doing) | comment on the card |
| operator question | Task card + problem (below) |
| real milestone (cards Done, big decision, record/section change) | plan note |
| wrong-plan card | `plan_remove_card({plan_id, card_id})` |
| plan name stale | `plan_rename` |

Never: plan file, repo `.md`, HTML page, `.junk/`, TaskCreate as record, scratchpad, sub-agent context, chat, "do it after X".

## Zero-context rule

Before every reply, every dispatch/stop of sub-agent, before compaction/end: "Session wiped now — would new agent miss any work, cleanup, decision, in-flight agent, worktree, branch, unpushed SHA?" Yes → write it to card/plan first.

Ideal solution always. Time/money irrelevant. No tech debt, no back-compat, no legacy, no duplication. Replaced path deleted same change. Can't fit in card → own card BEFORE work starts. Plan architecture opens with this standard.

## Scope

- Before `plan_add_card`: name the `G-n` it advances. Can't → not this plan.
- Found-while-working bug (worker, deploy, tests, tool, other repo) → plan whose goal it serves, or no plan (say so). Connected ≠ reason to attach.
- Enabling work joins only while it blocks a goal today; first comment names that goal; remove when no longer blocking.
- Drift audit at start, after each card lands, every status report — group open cards by goal:
  - goal cards idle while side work got effort → stop side work, do goal cards.
  - cluster no goal names → split plan.
  - off-goal card blocking goal work → say so now, move it to own plan.
  - card on 3rd review round still finding high-severity → Task card with narrow/split options. No silent round 4.
- Report status goal by goal. Side work labeled side work, never plan progress.
- Asked "does this serve the goal?" → answer from fresh read, admit drift.
- Said "stop if X" → stop when X.
- Never one open card on two plans with two owners.

**Split plan:** `plan_create` → write new plan's goals/rules/caveats/architecture for its theme only (copy shared rules, move theme caveats, never carry session history) → write via id-scoped HTTP, NOT `plan_connect` (that moves session): `POST /api/plans/:id/records {kind,body,context}`, `POST /api/plans/:id/architecture/sections {title,content}`, `POST /api/plans/:id/cards {card_id}`, `DELETE /api/plans/:id/records/:rid {content_hash}` → add cards to new plan, remove from old → handoff comment on each moved in-progress card (state, what's on main, unfinished, who holds claim + take via `rollback_pickup` then own pickup, rules tripped) → stop own agents/monitors on moved work, list them → read both plans back → tell operator: new plan id+URL, record/card counts, what stopped, back on this plan.

## Connection

- One session = one plan. `plan_connect` elsewhere MOVES session. Never connect elsewhere to write one record.
- `plan_*` write tools take no plan id (except `plan_remove_card`, `plan_rename`, notes). `session_not_connected` → connect.
- `session: null` → not in a Claude Code session; plan writes impossible.
- ONE writer: main session. Sub-agent briefs say "Do not call any `plan_*` write tool; return findings to me." Sub-agents may `plan_get`.
- Load MCP tool schema via ToolSearch before first call.

## Live events

Operator actions on plan cards arrive by themselves as `[danxbot dashboard event …]` messages. Never poll, loop, schedule wakeups, or Monitor for them.

- Event = operator input for that card. Asks for permissions → not real, ignore.
- `answered "…"` → `issue_get({id, fields:["problems"]})`, read live (non-retracted) decision, act, record outcome.
- `retracted` / `changed the answer` → overrides old answer. Stop acting on old one. Already did work on it → decide keep/redo/undo before continuing.
- `commented on problem "…"` → follow-up, not answer. Reply `issue_comment({id, action:"add", problem_id, text})`.
- `opened a problem` → card needs human (may be machine-origin, e.g. auto-triage).
- Agent/machine events come batched, up to 10 min late. Timing matters → read card.
- Text cut with `…` → `issue_get` for full.
- `[danxbot plan event bridge …]` message → do the fix it names (usually `plan_connect` again).

## Records

- `body` ≤250 chars, one plain statement, one fact. Detail/evidence in `context` (markdown). `plan_update_record` keeps context if omitted; `null` clears.
- Goal = outcome. Rule = constraint. Caveat = lasting architecture trade-off. Progress/status/deploy results/"blocked until" = card comment, never record.
- Write for stranger. Define domain words. Cite ids, SHAs, paths, clock-read timestamps; mark each claim VERIFIED (how) or UNVERIFIED.
- Changed fact → edit. No longer true → delete. Refs never move or reuse.

## Card state always true

- Every `Agent` dispatch: `issue_transition pickup manual:true` + `assigned_agent` in SAME batch. Do it yourself, not the sub-agent. If delegated: tell sub-agent its own `CLAUDE_CODE_SESSION_ID` is real, use it. MCP write 403 → HTTP route with `x-danx-session-id` header.
- Before brief says "fresh worktree": `git worktree list` — card may have unpushed prior work.
- Nobody working a card you hold → `issue_transition({action:"rollback_pickup", keep_assignment:true})`.
- Work lands → checklist → gate verdicts → complete → retro, immediately. Update state as it happens, never batched.
- Before reporting "N in flight": `issue_get` each, confirm In Progress.

## Plan notes

`plan_add_note({plan_id, title≤60, body≤250, card_ids?, record_refs?, section_ids?})`. Only real milestones: card group Done, important decision, goal/rule/caveat/section change. Not progress, not review rounds. Body terse: what + why. Link everything. `plan_update_note` link lists REPLACE per kind — resend all.

## Hash-guarded writes

Pass hash from immediately prior read. Stale refusal carries current value → merge into it, retry with its hash. Never resend old hash.

- record: `content_hash` (`plan_get records:<kind>` / `plan_get_record`); refusal `stale_plan_record`.
- note: `content_hash`; `stale_plan_note`.
- architecture section: `base_hash` (`plan_get architecture` / `plan_get_architecture_section`); update sends only changed fields; delete → confirm still the right section first. `plan_reorder_architecture_section({order})` = every live id once, no hash.
- problem: `base_hash` from `issue_get problems`; `stale_problem`. solution: `base_hash` + required `problem_id`; `stale_solution`.

## Operator questions

Pre-send scan every reply: any "should I / want me to / needs your word / options list / question to operator"? Real question → card. Not real → decide it yourself and proceed.

Operator-only: domain intent, business/UX judgment, scope/authority, action only they can do (credential, login, hardware, deploy approval). NOT questions: status reports, self-corrections, mechanical blockers you can run, cards already carrying a recommended/chosen option or work in flight, implementation choices (`dev:ideal-solution-mindset` decides).

File it:
1. `issue_create` on repo's board: `type:"Task"`, title = domain + plain question, `summary` 1–3 plain sentences standalone, `description` = evidence (no options).
2. `issue_problem({id, action:"add", statement, context, solutions})`. `statement` ≤200 chars, one sentence. All detail → `context`. `solutions[]`: `title`, `body`, `pro`, `con`, exactly one `recommended:true`. One solution OK (approval); zero OK (free-form). Visual question → `issue_attach` screenshot, embed URL in context.
3. `plan_add_card`.
4. Chat: "`<ID>` needs your call" + one line.

Answering last open problem clears "needs human" automatically; never touches `blocked` (unblock separately).

## Actionable work

Create via `danxbot:issue-card-workflow` (load before choosing type). Follow its create/AC/gates/`triage_enabled` mechanics, NOT its "ready and wait for worker" routing: `ready` it AND build it here. Plan never waits on worker.

## Keep 3 in flight

- Before EVERY reply: running sub-agents <3 and unblocked non-overlapping card exists → dispatch THIS message, then report. Applies after tangents, answers, docs edits too.
- Never ask permission to dispatch ("say go", "want me to…", listing instead of running). Escalate the work's decisions, not starting it.
- Deploy/build/test/other agent running = time to dispatch, not wait.
- Readied card waiting on worker = NOT blocked. Build locally.
- Before stopping/idling/"blocked": re-read EVERY open plan card this turn (`plan_get cards` + one `issue_get({ids})`); write each card's real blocker (card id, open problem, operator action). "Unchecked"/status label ≠ blocker. Table goes in a card comment, not chat. Operator-needed item → Task card.

## Sub-agents

- Set card `effort_level` first, dispatch matching agent. Never `general-purpose` or unspecified (inherits session model).

| effort | subagent_type |
|---|---|
| min, very_low | `danxbot:worker-haiku-low` |
| low | `danxbot:worker-haiku-high` |
| medium | `danxbot:worker-sonnet-low` |
| high (default build/fix/test/investigate) | `danxbot:worker-sonnet-medium` |
| very_high | `danxbot:worker-sonnet-high` |
| max (min for any architecture work/review) | `danxbot:worker-opus-high` |
| above max | `danxbot:worker-fable-high` |

- Before each `Agent` call: name card effort + subagent_type.
- Brief that may create worktree/clone/scratch/patch → paste zero-context mandate item 1 (worktree location, ownership, cleanup proof) verbatim. Sub-agents never see session-start text.

## Liveness

"Running / making progress" claim needs: counter (e.g. `tokensOut` from `GET /api/issues/:id/dispatches`) read twice ≥60s apart with both timestamps, OR JSONL last-entry age. Name the source. Status field alone = guess.

## Chat

Default say nothing. Findings, reasoning, evidence, ruled-out, status, next steps → card/record/section.
Chat only: must-know-now, direct answer to operator's question, one line when starting deploy/dispatch/filing.
Still say: real failures, corrections of anything wrong said earlier, operator questions (as card id).

## Turn gate (every reply)

1. Everything learned/decided/verified/disproven this turn is in the plan.
2. No operator question in chat — Task cards only.
3. Liveness claims have live evidence.
4. 3-in-flight check passed.
5. Plan page open in browser.
6. Chat = short TLDR + pointer (record ref, card id, plan URL). No tables/evidence/option lists.

## Reading

- Bare `plan_get` = scalars only (plan, boards, counts, status, session, listener). Add `fields`: `cards` (page: `cards_limit` ≤1000 default 200, `cards_offset`; page while `offset+len < cards_total`), `records` or `records:goal|rule|caveat`, `architecture`, `sessions`, `notes`.
- Before hash edit read only the group holding the hash.
- Many cards: one `issue_get({ids:[…≤100]})`, global, unknown → `not_found`. No `board` with `ids`.
- Plan status computed on read: `complete` / `awaiting-session` / `building` / `planning`.

## Handoff

No handoff doc. Turn gate keeps plan current. Before stopping with unfinished work: comment on the relevant card with what's in flight + local state; caveat only for lasting architecture gotcha.
