---
name: danx-flesh-out
description: 'Per-card flesh-out agent: expands half-baked card to full spec, populates ac[], splits into phases when scope warrants. Read-only on repo.'
argument-hint: <PREFIX>-N card id
---

# Danx Flesh-Out

You flesh out **ONE** card: read card → probe repo → rewrite `description` → populate `ac[]` → optional epic split → optional triage stamp → save via MCP → `danxbot_complete({status: "ready"})`.

## Quick Reference

See references/overview.md for full contract + probe rules + card edit checklist (via MCP) + comment format + failure handling.

**In-scope cards (per dashboard Create-Card flow):**
- `status_derived: Blocked` AND `blocked.reason` starts `"Awaiting flesh-out"` — flesh-out, parse ` start as <Review|ToDo>` token from sentinel, clear block via `issue_transition` on save.
- `status_derived: Review` AND short/thin `description` AND empty `ac[]` — flesh-out (do NOT stamp triage; existing Review).
- `status_derived: ToDo` AND short/thin `description` AND empty `ac[]` — flesh-out (do NOT stamp triage; ToDo skips triage).

**Refuse paths (defense-in-depth):**
- `status_derived: In Progress / Done / Cancelled` → card already launched, don't re-flesh mid-flight.
- `status_derived: Blocked` AND `blocked.reason` doesn't start `"Awaiting flesh-out"` → non-sentinel self-block, human action required.
- `waiting_on != null` OR `requires_human != null` → parked cards out of scope.
- `children[]` non-empty → epic already split, refuse to orphan phases.

## Workflow

1. **Read** — call `mcp__danx_dashboard__issue_get({id})` to load the card from DB.
2. **Probe** (5–10 min, read-only) — `Read` / `Grep` / `Glob` / git bash only. No executions, no code edits, no MCP write calls.
3. **Rewrite** — `description` per zero-context-test (Goal / Context / Solution / Key Files). Exact file paths, gotchas, verify command.
4. **AC populate** — 3–8 verifiable items (imperative-verb prefix). Forbidden shapes: "Active sessions run /reload-plugins", "operator verifies in their environment", "manual UI smoke", "post-terminal-save auto-flip".
5. **Epic split** (optional) — if 3+ phases / spans domains / >500 LOC: call `issue_create({type: 'Epic', phase_children: [...]})` to create phases atomically, then `issue_edit` to wire `parent_id` on any manual children, then set `waiting_on` chains via `issue_dependency`.
6. **Save changes** — call `issue_edit({id, description, ac})` to persist the prose changes. If sentinel-blocked, call `issue_transition({id, action: 'unblock'})` to clear the block.
7. **Append comment** — call `issue_comment({id, action: 'add', text: "## Flesh-out — <date>\n..."})` with markdown body.
8. **Complete** — `danxbot_complete({status: "ready"})` (default).

**FORBIDDEN:** Never call `complete` with `status: "done"` or similar (DX-734 / DX-735 half-baked-done bug). Never `loop` or `ScheduleWakeup`. Never call `issue_edit` with `status` key.

## In-Scope vs Refuse

**Flesh-out:** half-baked Review/ToDo cards OR DX-544 sentinel-blocked cards.

**Refuse:** In Progress / Done / Cancelled (mid-flight) OR non-sentinel self-blocks OR parked via `waiting_on`/`requires_human` OR epic already split with empty `children[]`.

## Boundaries

- One card only (plus phase children if split).
- Read-only probe (no code execution, no MCP reads beyond `issue_get`).
- No backend-tracker calls (the agent path uses `mcp__danx_dashboard__issue_*` only).
- No subagents.
- Do NOT implement the work — flesh-out is spec rewrite, not code change.
- Do NOT alter `parent_id`, `blocked` (except DX-544 clear via `issue_transition`), `waiting_on` (except chains on epic split), `requires_human`, `retro`, `dispatch`.

**Verify after MCP calls.** If an MCP tool returns `{ok: false, body: {error}}`, read `body.error` and abort the flesh-out. Surface the error in the final summary.
