---
name: issue-card-workflow
description: 'The one "work a card" workflow: claim, load context, TDD build, tick AC/checklists, run quality gates, complete. Used by both a dispatched danxbot worker and an operator-session sub-agent. Also covers card mechanics — transitions, problems (question vs action), comments, dependencies. LOAD BEFORE proposing card TYPE or slicing work into cards (epic/feature/story) — that decision, and the full creation/taxonomy/DB-schema/MCP-tool reference, live in references/card-creation-and-reference.md; load it too before any issue_create.'
---

# Issue Card Workflow

One card, from claim to merge — the same flow whether you are a dispatched danxbot
worker or an operator-session sub-agent working a card someone handed you by id.
**Dashboard Postgres DB is the sole source of truth**; the `mcp__danx-dashboard__issue_*`
(or `mcp__danx_dashboard__issue_*` in an operator session — resolve your actual tool
prefix from your own tool list once, at the start, never copy a prefix on faith) tools
are the entire surface for card state. Never read/write card state via file operations.

Creating a NEW card (type/effort/slicing/gates/triage) and detailed field/tool shapes
are a separate concern from WORKING one — see `references/card-creation-and-reference.md`.
Load it before any `issue_create`; this file does not repeat it.

## Context: what differs between the two callers

| | Dispatched worker | Operator-session sub-agent |
|---|---|---|
| Worktree | prepared by danxbot | creates its own isolated worktree (the Agent tool's `isolation: "worktree"`, or the repo's own worktree command); never works in the shared checkout |
| Claim | danxbot claims | `issue_transition({action:'pickup', manual:true, assigned_agent})` with its own identity |
| Quality gates | danxbot runs gate dispatches | runs the gate reviewer sub-agents itself and records `issue_quality_gate_verdict` |
| Merge | per your profile instruction | commits, pushes to main, removes its worktree, proves nothing unpushed |
| End | per your profile instruction | `issue_transition({action:'complete'})` + `issue_retro`, then reports to the orchestrator |

Dispatched-only mechanics (`danxbot_complete` statuses, `critical_failure`/halt, `agent-finalize.sh`,
the pre-synced worktree, database resets) are named here only as "per your profile instruction" —
they live in danxbot's own dispatched `work` profile instruction, never in this plugin (a plugin
reaches operator sessions too, and none of that is an operator's business to invoke).

## The flow (decision 175)

1. **Load the full context.** `issue_get({id, fields:["description","ac","comments","dependencies"]})`.
   Read the parent (Epic/Feature) if `parent_id` is set. If connected to a plan, read its
   architecture and note any overlapping sibling cards named in comments/dependencies.
2. **Claim it** before the first work action — see "Claiming" below.
3. **Build with TDD.** Sub-agents for complex work, inline for simple work — orchestrate rather
   than digging in yourself once a piece is genuinely independent. Always the correct, ideal
   build; never the fast or simpler one.
4. **Tick every AC and checklist item** (`issue_checklist`), get all tests passing, test in the
   browser where the change is user-facing.
5. **Run the quality gates through their gate reviewer sub-agents** (architecture-reviewer /
   code-reviewer / test-reviewer, or the equivalent your profile names) and record a verdict —
   `issue_quality_gate_verdict({id, gate, status, message: "<real finding, >=20 chars>"})` — per
   gate the card carries. A gate that genuinely doesn't apply is removed
   (`issue_quality_gate({action:'remove'})`), never rubber-stamped.
6. **Complete.** `issue_transition({action:'complete', summary})` then `issue_retro` (both REQUIRED,
   retro last — it 409s until terminal), then finish per your profile instruction.

No superfluous instructions beyond this — reminders live in MCP tool responses and the janitor,
not in this skill body.

**Never wait on a human you don't have to.** Decide unilaterally when the choice is reversible —
pick a reasonable default, do the work, and note the decision in a comment. When it genuinely
needs a human (irreversible, architectural, credentials, design intent you don't have), escalate
by opening a problem (below) — never `AskUserQuestion`, never a plan-mode pause, never sit idle
waiting for a reply.

### Question versus action — decide before you file (DX-3313)

Before filing, apply the test: **could I do this myself if I tried harder,
and is the only thing missing a decision?** Yes → `type: "question"`
(default). No — the blocker is access, credentials, hardware, a human's
authority, or a system genuinely out of reach → `type: "action"`.

| | Question | Action |
|---|---|---|
| `statement` | the question, one plain sentence | what is to be done — the deed itself, never phrased as a question |
| `summary` | optional, why it matters | **REQUIRED** — why it is needed, and why you cannot do it yourself (an action `add` with no summary is refused 400) |
| `solutions[]` | candidate answers, each with its own pro/con | the possible routes, each carrying its own steps |
| Ends when | a decision is recorded | the steps are actually done |

The why-I-cannot-do-this-myself sentence in `summary` is REQUIRED for an
action — it is the sentence that stops the operator reading your escalation
as laziness. Full parameter contract → `issue_problem`'s own `type` and
`summary` descriptions.

There is no separate "requires human" flag — a card needs a human exactly when
`open_problem_count > 0` (read via `issue_get({id, fields:['problems']})`). Escalation IS opening
the problem; there is no second step. Removing a card's last open problem is always allowed and is
how a card stops needing a human.

## Claiming a card (pickup)

A card in `ToDo` is an open dispatch request — leaving it there while you work it yourself races
a second worker onto the same card. Before your first work action:

1. `issue_transition({id, action:'pickup', manual:true, assigned_agent:'<your identity>'})`.
   **`manual:true` is mandatory for self-pickup** — it marks the card operator-owned so nothing
   auto-transitions it. Read `assigned_agent` back OUT OF THE RESPONSE: anything other than you
   (including `null`) means the claim did not land — re-issue it, and stop if it fails twice.
2. A manual hold is released only by an explicit transition from your session (`complete` /
   `cancel` / `block` / `rollback_pickup`) — nothing auto-clears it.
3. A sub-agent under YOUR control working a card is still YOUR card: pickup before you launch it,
   keep it `In Progress` the whole time, and you drive the terminal transition when it finishes.

## AC, checklists, comments, dependencies — the mechanics both callers use

- **AC / checklists** — `issue_get` returns each item's `check_item_id` under `checklists[].items[]`.
  Flip each as it's genuinely satisfied: `issue_checklist({action:'update_item', checklist_id,
  item_id, status:'passing'})`. `issue_transition complete` refuses (409 `unresolved_items`) while
  any item is `incomplete` — this is a hard gate, not bookkeeping.
- **Comments** — `issue_comment({id, action:'add', text})`, markdown with `##` headers. Narrative
  only; durable decisions and follow-up work go on a card (`issue_create`, `issue_retro`), never a
  comment alone.
- **Dependencies** — `issue_dependency({id, action:'add', kind:'depends_on'|'conflict_on',
  target_id})` for a related card you already know about; never a discovery scan.
- **Problems** — `issue_problem({id, action:'add', statement, type?, summary?, solutions?})` is the
  only way to escalate; see "Question versus action" above.
- **Retro** — `issue_retro({good, bad, correctable_danxbot_problem,
  correctable_danxbot_problem_description, action_item_ids[], commits[], tests[]})`. All of
  `tests[]` (empty array OK, omitting the key fails) and the `correctable_danxbot_problem` pair are
  REQUIRED on every call — answer honestly; a `true` starts an automated repair.
- Agents never write `status:` literals — every lifecycle change goes through `issue_transition`,
  which derives and stamps it.

## MCP server disconnected ≠ board unreachable

The dashboard MCP server drops connection fairly often (`CONNECTION_CLOSED`). That is not a loss of
board access — the same dashboard exposes a plain HTTP API (`src/issues/routes.ts` +
`src/issues/write/*.ts`) that does everything the MCP tools do. Never tell the operator the board is
unreachable on an MCP error alone; drive it over HTTP instead (bearer token from the per-target
dashboard token file).

## Issue-ref comments (default mode)

`// CARD-ID: <reason>` on any non-obvious decision the card's AC/description forced; grep
comment-anchored refs (`grep -rnE '(//|#|--|<!--|/\*|\*)[[:space:]]*[A-Z]+-[0-9]+' <files>`) and
load each referenced card's `description`/`ac`/`comments` BEFORE editing code that carries one.
Full protocol (writing/reading/lifecycle rules, examples) → `references/card-creation-and-reference.md`.

## General rules

- One card at a time when working as a dispatched worker — no orchestrator, no sub-agents in that
  path. An operator-session sub-agent orchestrates its own sub-agents per its own session's rules.
- `type:` ∈ `Epic`|`Feature`|`Story`|`Bug`|`Chore`; taxonomy/slicing/effort/gate/triage decisions
  at creation time → `references/card-creation-and-reference.md`.
- AC lives in `ac[]` (`issue_edit`), never inline in the description. Phases/sub-cards in
  `children[]`; each child is its own card, set via `issue_edit({parent_id})`.
- Never manually append `## Retro` in a comment — use `issue_retro`. Never escape markdown.
- Durable work-records (findings, designs, handoffs, specs meant to survive the session) live on a
  card — never a standalone repo `.md` or in-session TaskCreate/TaskList as a substitute.

See `references/lifecycle-states.md` for the full state machine, derivation rules, triage cadence
and gate contracts, `references/phases-epics.md` for the `children[]`/container mechanics, and
`references/card-creation-and-reference.md` for card-creation taxonomy, the DB schema and the full
MCP tool reference.
