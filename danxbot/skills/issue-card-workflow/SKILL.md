---
name: issue-card-workflow
description: 'Issue card lifecycle: status derivation, mcp__danx_dashboard__issue_* tools, comment/retro/blocked/waiting_on contracts, epic-atomic rule.'
---

# Issue Card Workflow

Universal rules for issue cards. **Dashboard Postgres DB is sole source of truth.** Agent path uses MCP tools (`mcp__danx_dashboard__issue_*`); worker mirrors to backend tracker (Trello) for human visibility (~60s).

## DX-835 — two-step termination is MANDATORY

Card lifecycle (`completed_at` / `blocked_at` / `cancelled_at`) is the AGENT's explicit responsibility, written via `mcp__danx_dashboard__issue_transition`. `mcp__danxbot__danxbot_complete` finalizes the dispatch row ONLY; it does NOT move cards. Every issue-bound terminal flow is two calls in order:

| Outcome | Step A (card) | Step B (dispatch) |
|---|---|---|
| Done | `issue_transition({id, action:'complete', summary})` | `danxbot_complete({status:'complete', summary})` |
| Cancelled | `issue_transition({id, action:'cancel'})` | `danxbot_complete({status:'complete', summary})` |
| Blocked | `issue_transition({id, action:'block', reason})` | `danxbot_complete({status:'failed', summary})` |

Skipping Step A leaves the card stuck mid-state — `dispatch_id` cleared (worker side), but no lifecycle stamp. Verify via `issue_get` after Step A: `completed_at` / `cancelled_at` / `blocked_at` non-null + `status_derived` matches expected, BEFORE Step B.

## Source of Truth & Tracker Contract

**Dashboard DB** (via `mcp__danx_dashboard__issue_*` MCP tools) is the canonical source for title, description, status, AC, children, comments, retro, blocked, waiting_on, requires_human. Agents read + write via MCP only. Poller dispatches off the v2 dashboard DB via the dashboard HTTP API; agents read + write exclusively via MCP tools.

**Backend tracker (Trello) is one-way mirror with two narrow inbound exceptions:**

Outbound (every tick): every DB field pushed to tracker so humans see current state. Tracker view is *projection* of DB; nothing tracker shows is authoritative.

Inbound (narrow):
1. **New cards:** tracker card with no DB record → hydrated to fresh record next tick. After, DB is source forever.
2. **New comments:** human-authored tracker comments pulled into `comments[]` so agent sees them. Author detection avoids echo loops.

**Everything else from tracker ignored.** Human dragging card between lists, editing title, ticking AC has zero effect on DB. Next tick re-asserts DB state. Want status change → call `mcp__danx_dashboard__issue_transition` or `mcp__danx_dashboard__issue_edit`; worker's per-tick mirror pushes to tracker.

One-way + narrow inbound = unambiguous semantics. Two-way sync would create merge conflicts.

**Agent path is MCP tools only.** All card reads + writes go through `mcp__danx_dashboard__issue_*` MCP tools. Worker mirrors DB state to tracker for human visibility (~60s cycle).

## DB Schema

Full schema available via `mcp__danx_dashboard__issue_get`. Key fields:

- **`status` / `status_derived`** — **DERIVED from lifecycle triggers, agents NEVER write.** Computed by server from timestamps + gates. Pickup → via `issue_transition({action: 'pickup'})` (rule 4 → `In Progress`). Approve → `issue_transition({action: 'ready'})` (rule 5 → `ToDo`). Complete → `issue_transition({action: 'complete', summary})` (rule 2 → `Done`). Cancel → `issue_transition({action: 'cancel'})` (rule 1 → `Cancelled`). Block → `issue_transition({action: 'block', reason})` (rule 3 → `Blocked`). Direct write FORBIDDEN.
- **`dispatch`** — worker-managed, agents don't touch.
- **`children[]`** — ordered list of child ids. On Epic = phase cards (UI "Phases"). On non-epic = sub-cards (UI "Children"). Phases MUST be cards, no in-card checklist. Set via `issue_edit({parent_id})` on child cards.
- **`ac[]`** — Acceptance Criteria. Server assigns `check_item_id` on create. Agents populate via `issue_edit({ac})`.
- **`retro`** — fill on Done/Cancelled/Blocked via `issue_retro({good, bad, action_item_ids[], commits[]})`. Server auto-renders `## Retro` comment. `commits[]` owned-repo ONLY (DX-559 gate). `action_item_ids[]` = LAST RESORT.
- **`blocked`** — self-block trigger. Null = card proceeds. Non-null = `{at, reason}` = card stuck, human acts. Set via `issue_transition({action: 'block', reason})`. Agents never write `status: "Blocked"` — call transition, server projects.
- **`waiting_on`** — dep-chain gate, status-independent. Card queued behind OTHER in-flight work (phase sibling, Action Items, separate task). Null = nothing queues. `{reason, timestamp, by[]}` = by[] is IMMEDIATE blocker(s) only (never transitive). Picker skips while any blocker non-terminal; auto-unblocks on terminal. Set via `issue_dependency({action: 'add', kind: 'depends_on'})`. **Waiting On ≠ Blocked** — Blocked is THIS card stuck (human), Waiting On is queued behind OTHER work.
- **`requires_human`** — orthogonal gate, status-independent. Null = no human needed. Non-null = `{reason, steps[], set_by, set_at}` = card needs human on system with zero agent reach (3rd-party token, vendor portal, external infra). Set via `issue_requires_human({id, set: true, reason, steps[]})`. Cleared by human via dashboard only.

## MCP Tools Reference

| Tool | Purpose |
|---|---|
| `mcp__danx_dashboard__issue_create({type, title, description, parent_id?, ac?, effort_level?, phase_children?})` | Allocate next `<PREFIX>-N` in DB. Epic creation optionally includes `phase_children[]` to create child cards atomically. Returns `{ok: true, body: {id, ...}}` or `{ok: false, body: {error, ...}}`. |
| `mcp__danx_dashboard__issue_list({status_derived?, type?, parent_id?, dispatchable_derived?, assigned_agent?, include_closed?})` | **Preferred for multi-card scan/discovery** — status sweeps, sibling lookups, parent→children, "find all blocked". Returns list of card objects. Use BEFORE hand-globbing. |
| `mcp__danx_dashboard__issue_get({id})` | Single card read. Returns full card object from DB. |
| `mcp__danx_dashboard__issue_edit({id, title?, description?, ac?, effort_level?, parent_id?})` | Prose-only updates (no status/lifecycle stamps). Agents never write `status` directly. |
| `mcp__danx_dashboard__issue_transition({id, action: 'ready'\|'pickup'\|'complete'\|'cancel'\|'block'\|'unblock'\|'archive'\|'reopen', reason?, summary?})` | Lifecycle transitions. Server stamps timestamps + recomputes `status_derived`. |
| `mcp__danx_dashboard__issue_triage({id, verdict: 'approve'\|'cancel'\|'keep'\|'defer', ice?: {i,c,e}, reason, ttl_seconds?})` | Single atomic triage call. Server routes per verdict. |
| `mcp__danx_dashboard__issue_comment({id, action: 'add'\|'edit'\|'delete', comment_id?, text?})` | Comment lifecycle (add/edit/delete). Server stamps author + timestamp. |
| `mcp__danx_dashboard__issue_dependency({id, action: 'add'\|'remove', kind?: 'depends_on'\|'conflict_on', target_id?, reason?, dependency_id?})` | Manage card dependencies. |
| `mcp__danx_dashboard__issue_requires_human({id, set: true, reason, steps[]} \| {id, set: false})` | Set/clear the `requires_human` gate. Server stamps `set_by`/`set_at`. |
| `mcp__danx_dashboard__issue_retro({id, good, bad, action_item_ids[], commits[]})` | Populate retro on terminal. |

### MCP Error Handling

All tools return `{ok: true|false, status, body}`. On error, `body` contains structured error:
- `{error: "<reason>", failed_gate?, non_terminal_phases?, offending_keys?}`

Agents read `result.body.error` (NOT `result.errors[]`) and route per the message. Each tool's own MCP description names the invariant it encodes (e.g., `issue_transition` rejects non-terminal phases on `complete`). Reference that mechanism, not paraphrases.

## Lifecycle & Status Derivation

See references/lifecycle-states.md for complete state machine, derivation rules, triage cadence, and gate contracts.

## Card Taxonomy — Epic / Feature / Story / Bug / Chore

**Primary axis = scope / decomposability, NEVER elapsed time.** Measure scope by *how many independently-shippable, fully-testable vertical slices the work splits into* — each slice = one functional commit. Perceived scope (# files / classes / methods + complexity) sets the count; the clock never does.

| Type | Definition |
|---|---|
| **Story** | One vertical, fully-testable slice that ships as a **single functional commit**. Kept as small as possible while still a working, testable increment. The atomic unit. |
| **Feature** | A **few** related Stories that together deliver one stakeholder-facing capability. |
| **Epic** | **A lot** of Stories, or **multiple Features** — a large initiative decomposed into many independently-shippable slices. |
| **Bug** | A defect; restores intended behavior (no new value). Sized like a Story (one functional commit). |
| **Chore** | Necessary work with no direct user-facing value — deps, docs, tooling, refactor, a "decide X" / "review Y" call. Sized like a Story. |

**Mechanical gate — count the slices BEFORE you pick a type:**

> Count the independently-shippable, fully-testable vertical slices the work splits into — each slice = one functional commit. **1 slice → Story** (make it as small as still-testable). **A few slices → Feature. Many slices, or multiple Features → Epic.** Interlocking pieces that *cannot each ship as their own green functional commit* are NOT separate slices — they collapse into ONE Story (carry the size in `effort_level`, never by promoting to Epic). The trigger is slice-count / decomposability, measured by perceived scope — **never elapsed time.** File-count, LOC, test-count, and number-of-files-touched are NOT slice signals — a 30-file change that ships as 4 green commits is a 4-slice **Feature**, not an Epic. Promote to Epic only when the slice count itself is large (≫ a handful) or it splits into multiple Features; if you catch yourself reaching for Epic because the work "feels big," re-count slices first.

**Pre-`issue_create` mechanical check (MANDATORY):** Before writing `type` in the payload, name each slice as "slice N: <verb> X — ships as commit cN that passes its tests standalone." If you can't list ≥2 such slices, the type is **Story** + carry size in `effort_level`. If your draft says `type: "Feature"` or `"Epic"` and you have <2 named green-commit slices, downgrade. Investigation+fix+tests for one defect = one interlocking unit = one slice = Story, regardless of effort. Skipping this check because "the work feels too big for Story" is the exact failure the gate exists to block — re-run it, then write `type`.

**Allowed parent→child type matrix:** Epic → Feature | Story | Bug | Chore (never Epic). Feature → Story | Bug | Chore. Story / Bug / Chore are atomic — no type-children. (Epic-child types are enforced mechanically by `phase_children[]`; the rest is this gate.)

See references/phases-epics.md for the split walkthrough, epic mechanics, phase creation, and completion contract.

## General Rules

- One card at a time; no orchestrator, no subagents
- Call MCP tools only for all card operations
- `type:` ∈ `Epic` | `Feature` | `Story` | `Bug` | `Chore` — required (pick via the Card Taxonomy gate above)
- Comments = markdown with `##` headers (set via `issue_comment`)
- AC lives in `ac[]` (set via `issue_edit`) — never inline. Phases/sub-cards in `children[]` as `<PREFIX>-N`; each child has own DB record.
- `retro.action_item_ids[]` = only valid `<PREFIX>-N` format. Create card first, push id (via `issue_retro`).
- Connected repo cards reference that repo's architecture (not danxbot paths).
- NEVER call `mcp__trello__*` from agent.
- NEVER read/write card state via file operations — use MCP tools exclusively.
- NEVER write `status:` literals via `issue_edit` — use `issue_transition` for lifecycle changes.
- NEVER manually append `## Retro` to comments — use `issue_retro` tool.
- NEVER escape markdown — use formatting (`##`, fenced blocks, tables).
- **NEVER write cards/epics/plans as a standalone `.md` "spec" doc as a substitute for filing them.** "Write up the cards" / "make cards" = CREATE them in the tracker (MCP, or `POST /api/issues` dashboard API). If create-tooling is unavailable, STOP and ask which path to use — do NOT default to a parallel `.md`. A spec doc nobody actions fragments the source of truth, burns tokens, and goes stale. Standalone docs only when the user explicitly asks for a doc/hand-off.
