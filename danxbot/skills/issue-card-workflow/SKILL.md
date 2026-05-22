---
name: issue-card-workflow
description: 'Issue card YAML schema + lifecycle: status derivation, mcp__danx-issue__* tools, comment/retro/blocked/waiting_on contracts, epic-atomic rule.'
---

# Issue Card Workflow

Universal rules for issue cards at `<repo>/.danxbot/issues/{open,closed}/<id>.yml`. Worker mirrors state to backend tracker (Trello) for human visibility (~60s). **Local YAML is sole source of truth.**

## Source of Truth & Tracker Contract

**Local YAML** (title, description, status, AC, children, comments, retro, blocked, waiting_on) lives canonically in `<repo>/.danxbot/issues/{open,closed}/<id>.yml`. Poller dispatches off local YAML. Danxbot agent path reads + writes YAML.

**Backend tracker (Trello) is one-way mirror with two narrow inbound exceptions:**

Outbound (every tick): every YAML field pushed to tracker so humans see current state. Tracker view is *projection* of YAML; nothing tracker shows is authoritative.

Inbound (narrow):
1. **New cards:** tracker card with no local YAML → hydrated to fresh YAML next tick. After, YAML is source forever.
2. **New comments:** human-authored tracker comments pulled into `comments[]` so agent sees them. Author detection avoids echo loops.

**Everything else from tracker ignored.** Human dragging card between lists, editing title, ticking AC has zero effect on YAML. Next tick re-asserts YAML state. Want status change → edit YAML via `Edit` / `Write`; chokidar mirrors to DB on file event; worker's per-tick mirror pushes to tracker.

One-way + narrow inbound = unambiguous semantics. Two-way sync would create merge conflicts.

**Agent path is YAML + `mcp__danx-issue__*` MCP tools only.** Agent never calls tracker SDK directly. Worker is sole tracker writer (~60s cycle).

## YAML Schema

Full schema at references/yaml-schema.md. Key fields:

- **`status`** — **DERIVED from lifecycle triggers, agents NEVER write.** Computed by `deriveStatus()` from timestamps + gates. Pickup → `dispatch != null` (rule 4 → `In Progress`). Approve → `ready_at` (rule 5 → `ToDo`). Complete → worker stamps `completed_at` (rule 2 → `Done`). Cancel → `cancelled_at` (rule 1 → `Cancelled`). Block → `blocked.at` (rule 3 → `Blocked`). Direct write FORBIDDEN.
- **`dispatch`** — poller-managed, don't touch.
- **`children[]`** — ordered list of child ids. On Epic = phase cards (UI "Phases"). On non-epic = sub-cards (UI "Children"). Phases MUST be cards, no in-card checklist.
- **`ac[]`** — Acceptance Criteria. New items have `check_item_id: ""` (worker assigns).
- **`retro`** — fill on Done/Cancelled/Blocked. Worker auto-renders `## Retro` comment. `commits[]` owned-repo ONLY (DX-559 gate). `action_item_ids[]` = LAST RESORT.
- **`blocked`** — self-block trigger. `null` = card proceeds. Non-null = `{at, reason}` = card stuck, human acts. Agents never write `status: "Blocked"` — stamp trigger, derivation projects.
- **`waiting_on`** — dep-chain gate, status-independent. Card queued behind OTHER in-flight work (phase sibling, Action Items, separate task). `null` = nothing queues. `{reason, timestamp, by[]}` = by[] is IMMEDIATE blocker(s) only (never transitive). Picker skips while any blocker non-terminal; auto-unblocks on terminal. **Waiting On ≠ Blocked** — Blocked is THIS card stuck (human), Waiting On is queued behind OTHER work.
- **`requires_human`** — orthogonal gate, status-independent. `null` = no human needed. Non-null = `{reason, steps[], set_by, set_at}` = card needs human on system with zero agent reach (3rd-party token, vendor portal, external infra). Cleared by human via dashboard only.

## MCP Tools

| Tool | Purpose |
|---|---|
| `danx_issue_create({type, title, description, parent_id?, ac?, ...})` | Allocate next `<PREFIX>-N`, build canonical YAML, write `open/<id>.yml`. Returns `{created: true, id, ...}` or `{created: false, errors[]}`. Only mutation tool agents need (beyond Edit/Write). |
| `danx_issue_list({status?, type?, parent_id?})` | **Preferred for multi-card scan/discovery** — status sweeps, sibling lookups, parent→children, "find all blocked". Returns `[{id, title, status, type, parent_id}]`. Use BEFORE hand-globbing dir. |
| `danx_issue_close({id})` | Explicit terminal close — sets `status: Cancelled` if not terminal, fills retro, moves to `closed/`. |

**Single-card read:** `Read .danxbot/issues/open/<id>.yml` directly (fall back to `closed/` if not found). YAML is source of truth; path deterministic.

**Edit semantics:** Edit YAML directly via `Edit` (preferred — preserves other agents' edits) or `Write` (full rewrite). Chokidar mirrors to Postgres on file event; post-completion auto-sync pushes to tracker on `danxbot_complete` fire. Worker's per-tick mirror (~60s) is steady-state safety net. **No agent-facing save verb** — agents edit in place, worker mirrors.

**Terminal file moves:** worker stamps `completed_at` or `cancelled_at` on `danxbot_complete` calls, then moves file `open/` → `closed/` on next poll as part of auto-sync. `blocked.at` populated keeps YAML in `open/` (non-terminal). **Never move file yourself.**

## Lifecycle & Status Derivation

See references/lifecycle-states.md for complete state machine, derivation rules, triage cadence, and gate contracts.

## Phases vs Epics

See references/phases-epics.md for split criteria, epic mechanics, phase creation, and completion contract.

## General Rules

- One card at a time; no orchestrator, no subagents
- Don't block on tracker sync — worker retries next poll; YAML is canonical
- `type: Bug` or `type: Feature` or `Epic` — required
- Comments = markdown with `##` headers
- AC lives in `ac[]` — never inline. Phases/sub-cards in `children[]` as `<PREFIX>-N`; each child has own YAML.
- `retro.action_item_ids[]` = only valid `<PREFIX>-N` format. Create card first, push id.
- Connected repo cards reference that repo's architecture (not danxbot paths).
- NEVER call `mcp__trello__*` from agent.
- NEVER manually move YAML files `open/` ↔ `closed/` — terminal trigger fires worker move.
- NEVER write `status:` literals — field is derived from triggers.
- NEVER append `## Retro` to `comments[]` — worker auto-renders.
- NEVER escape markdown — use formatting (`##`, fenced blocks, tables).
