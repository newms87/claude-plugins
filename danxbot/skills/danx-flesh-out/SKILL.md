---
name: danx-flesh-out
description: 'Per-card flesh-out agent. Single Claude session takes half-baked card (one-sentence title + thin description) and produces fully fleshed-out card — probes repo via Read/Grep/Glob, rewrites description to pass zero-context-test bar, populates ac[] with verifiable items, splits into phase children via danx_issue_create when scope warrants, and stamps triage{} block when card status is Review. Read-only on repo; writes YAML in place. Dispatched 1-card-per-call by dashboard Create-Card button (DX-348 Phase 2).'
argument-hint: <PREFIX>-N card id
---

# Danx Flesh-Out

You flesh out **ONE** card: read YAML → probe repo → rewrite `description` → populate `ac[]` → optional epic split → optional triage stamp → save → `danxbot_complete({status: "ready"})`.

## Quick Reference

See references/overview.md for full contract + probe rules + YAML edit checklist + comment format + failure handling.

**In-scope cards (per dashboard Create-Card flow):**
- `status: Blocked` AND `blocked.reason` starts `"Awaiting flesh-out"` — flesh-out, parse ` start as <Review|ToDo>` token from sentinel, clear block on save.
- `status: Review` AND short/thin `description` AND empty `ac[]` — flesh-out (do NOT stamp `triage{}`; existing Review).
- `status: ToDo` AND short/thin `description` AND empty `ac[]` — flesh-out (do NOT stamp `triage{}`; ToDo skips triage).

**Refuse paths (defense-in-depth):**
- `status: In Progress / Done / Cancelled` → card already launched, don't re-flesh mid-flight.
- `status: Blocked` AND `blocked.reason` doesn't start `"Awaiting flesh-out"` → non-sentinel self-block, human action required.
- `waiting_on != null` OR `requires_human != null` → parked cards out of scope.
- `children[]` non-empty → epic already split, refuse to orphan phases.

## Workflow

1. **Read** — `Read .danxbot/issues/open/<id>.yml` (fall back to `closed/<id>.yml`).
2. **Probe** (5–10 min, read-only) — `Read` / `Grep` / `Glob` / git bash only. No executions, no code edits, no tracker calls.
3. **Rewrite** — `description` per zero-context-test (Goal / Context / Solution / Key Files). Exact file paths, gotchas, verify command.
4. **AC populate** — 3–8 verifiable items (imperative-verb prefix). Forbidden shapes: "Active sessions run /reload-plugins", "operator verifies in their environment", "manual UI smoke", "post-terminal-save auto-flip".
5. **Epic split** (optional) — if 3+ phases / spans domains / >500 LOC: set `type: Epic`, create phase YAMLs via `danx_issue_create`, stamp `children[]` + `waiting_on` chains.
6. **Triage stamp** (optional, Review only) — `triage.{expires_at, last_status, last_explain, ice, history}` per ICE rubric (Impact×Confidence×Ease, each 1–5).
7. **Append comment** — ONE `## Flesh-out — <date>` entry (author: "danxbot-flesh-out", markdown body).
8. **Save** — `Edit` / `Write` YAML, re-read to confirm parsing. Chokidar mirrors.
9. **Complete** — `danxbot_complete({status: "ready"})` (default) OR `"review"` (sentinel target).

**FORBIDDEN:** Never `complete` (DX-734 / DX-735 half-baked-done bug). Never `loop` or `ScheduleWakeup`. Never write `status:` direct.

## In-Scope vs Refuse

**Flesh-out:** half-baked Review/ToDo cards OR DX-544 sentinel-blocked cards.

**Refuse:** In Progress / Done / Cancelled (mid-flight) OR non-sentinel self-blocks OR parked via `waiting_on`/`requires_human` OR epic already split with empty `children[]`.

## Boundaries

- One card only (plus phase children if split).
- Read-only probe (no code execution).
- No tracker calls (`mcp__trello__*` forbidden).
- No subagents.
- Do NOT implement the work — flesh-out is spec rewrite, not code change.
- Do NOT alter `parent_id`, `blocked` (except DX-544 clear), `waiting_on`, `requires_human`, `retro`, `dispatch`.

**Re-read after save.** Confirm YAML parses (no indentation breaks). Malformed → `{_malformed: true, raw: <text>}` in dashboard → recover before calling `danxbot_complete`.
