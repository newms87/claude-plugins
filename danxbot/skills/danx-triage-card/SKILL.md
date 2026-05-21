---
name: danx-triage-card
description: 'Per-card triage agent. Single Claude session reads ONE card YAML, decides per status (Review / Blocked / Waiting On), writes TTL-stamped triage{} block back with Edit tool. Dispatched 1-card-per-tick by poller (Phase 4 / ISS-94). Replaces bulk-triage orchestrator.'
argument-hint: <PREFIX>-N card id
---

# Danx Triage Card

You triage **ONE** card per dispatch: read → decide (per status) → edit `triage{}` → re-read to confirm → `danxbot_complete({status})`.

## Quick Reference

See references/triage-paths.md for complete decision trees, ICE rubric, reassess-hint contract, out-of-scope gate, failure handling, conflict-check mode.

**Three in-scope paths:**

| YAML state | Path |
|---|---|
| `waiting_on != null` (any status) | **Waiting On** — re-check `waiting_on.by[]` TTL 1h |
| `waiting_on == null` AND `status === "Review"` | **Review** — ICE-score + Keep / Cancel / Approve / Park TTL 24h |
| `waiting_on == null` AND `status === "Blocked"` | **Blocked** — Hard Gate audit + Demote / Confirm TTL 3h |

Out-of-scope refuse: `waiting_on == null` AND `blocked == null` AND `status ∈ {ToDo, In Progress, Done, Cancelled}` — dispatchable / active / terminal cards don't triage.

## Workflow

1. **Read** — `Read .danxbot/issues/open/<id>.yml` (fall back to `closed/<id>.yml`).
2. **Decide** per status path (see references/triage-paths.md):
   - **Review** → Keep / Cancel / Approve / Park (validate `effort_level` on Keep/Approve)
   - **Blocked** → Hard Gate audit → Demote / Confirm-Block
   - **Waiting On** → re-check `waiting_on.by[]` → Unblock / Confirm-Block
3. **Edit** — update `triage{}` block (ALL edits):
   - `expires_at` = `(now + TTL).toISOString()`
   - `last_status` = one of Keep / Cancel / Approve / Park / Demote / Confirm-Block / Unblock
   - `last_explain` = 1–2 sentences (include ICE breakdown for Review / Keep / Approve)
   - `reassess_hint` = required for Blocked/Confirm + Waiting On/Confirm-Block; cleared for Demote/Unblock; empty for Review
   - `ice` = populated for Review/Keep/Approve (i × c × e, 1–5 each); zeros for all others
   - `history` = APPEND new entry `{timestamp, status, explain, expires_at, ice}`; cap 10; oldest drops overflow
4. **Re-read** — confirm YAML parses (no indentation breaks). Chokidar mirrors; malformed → `{_malformed: true}` in dashboard.
5. **Append comment** — ONE `## Triage — <date>` entry (author: "danxbot-triage", markdown: `**Status:** <from> → <to>`, `**Decision:** <Keep|Cancel|Approve|Park|Demote|Confirm-Block|Unblock>`, `**ICE:** <total> (<I>×<C>×<E>)` (Review/Keep/Approve only), `**Reassess hint:** <value>` (Blocked/Confirm + Waiting On/Confirm-Block only; DO NOT include for Review/Demote/Unblock), `**Explain:** <last_explain>`).
6. **Complete** — per decision:
   - Keep / Approve / Demote → `danxbot_complete({status: "ready"})`
   - Cancel → `danxbot_complete({status: "cancelled"})`
   - Park → `danxbot_complete({status: "archive"})`
   - Confirm-Block / Unblock → `danxbot_complete({status: "complete"})`

## ICE Rubric (Review only)

Each axis 1–5; `total = i × c × e` (1–125). MUST justify all three components in `last_explain`.

| Score | Impact | Confidence | Ease |
|---|---|---|---|
| 5 | Unblocks prod / blocks epic | All AC anchors verified | <1h, isolated |
| 4 | Major UX or perf | Most anchors verified, minor stale | 1–3h, contained |
| 3 | Cleanup or moderate feature | Some anchors stale | Half-day, some discovery |
| 2 | Nice-to-have | Anchors uncertain | Multi-session, cross-cutting |
| 1 | Speculative / vague | Card needs rewrite | Heavy refactor / rebuild |

## TTLs

| Status | TTL | Reason |
|---|---|---|
| Review | 24h | Static human input; daily re-eval |
| Blocked | 3h | Operator action expected; check fast |
| Waiting On | 1h | Blockers flip terminal any minute |

## Terminal Calls

Only `ready`, `cancelled`, `archive`, `complete` valid.

| Decision | Terminal status | Derived status |
|---|---|---|
| Keep / Approve / Demote | `ready` | `ToDo` |
| Cancel | `cancelled` | `Cancelled` |
| Park | `archive` | `Backlog` |
| Confirm-Block / Unblock | `complete` | unchanged |

## Boundaries

- One card only.
- Never edit other cards' `comments[]`, `ac[]`, `description`.
- Do NOT investigate underlying bugs — triage is "is this card ready to dispatch?" not "what is the work?"
- For Review: ICE is your judgment on CURRENT description; may `git log` for context; do NOT edit description or append notes.
- For Blocked: audit is read-only — if misclassification found, Demote + let next worker dispatch DO the steps.
