---
name: danx-triage-card
description: 'Per-card triage agent: reads ONE card, decides per status (Review/Blocked/Waiting On), writes triage verdict via MCP.'
argument-hint: <PREFIX>-N card id
---

# Danx Triage Card

You triage **ONE** card per dispatch: read → decide (per status) → call `issue_triage` MCP tool → `danxbot_complete({status})`.

## Quick Reference

See references/triage-paths.md for complete decision trees, ICE rubric, reassess-hint contract, out-of-scope gate, failure handling, conflict-check mode.

**Three in-scope paths:**

| DB state | Path |
|---|---|
| `waiting_on != null` (any status) | **Waiting On** — re-check `waiting_on.by[]` TTL 1h |
| `waiting_on == null` AND `status_derived === "Review"` | **Review** — ICE-score + Keep / Cancel / Approve / Park TTL 24h |
| `waiting_on == null` AND `status_derived === "Blocked"` | **Blocked** — Hard Gate audit + Demote / Confirm TTL 3h |

Out-of-scope refuse: `waiting_on == null` AND `blocked == null` AND `status_derived ∈ {ToDo, In Progress, Done, Cancelled}` — dispatchable / active / terminal cards don't triage.

## Workflow

1. **Read** — call `mcp__danx_dashboard__issue_get({id})` to load the card from DB.
2. **Decide** per status path (see references/triage-paths.md):
   - **Review** → Keep / Cancel / Approve / Park (validate `effort_level` on Keep/Approve)
   - **Blocked** → Hard Gate audit → Demote / Confirm-Block
   - **Waiting On** → re-check `waiting_on.by[]` → Unblock / Confirm-Block
3. **Triage** — call `mcp__danx_dashboard__issue_triage({id, verdict, ice?, reason, ttl_seconds})` with:
   - `verdict` = one of `'keep'` / `'cancel'` / `'approve'` / `'defer'` — server routes per verdict
   - `ice` = `{i, c, e}` (1–5 each) for Review/Keep/Approve; omit for others
   - `reason` = 1–2 sentences (include ICE breakdown for Review / Keep / Approve)
   - `ttl_seconds` = 86400 (Review), 10800 (Blocked), 3600 (Waiting On)
4. **Append comment** — call `mcp__danx_dashboard__issue_comment({id, action: 'add', text: "## Triage — <date>\n..."})` with markdown body containing `**Status:** <from> → <to>`, `**Decision:** <Keep|Cancel|Approve|Park|Demote|Confirm-Block|Unblock>`, `**ICE:** <total> (<I>×<C>×<E>)` (Review/Keep/Approve only), `**Reason:** <reason>`.
5. **Complete** — per decision (server auto-routes):
   - Keep / Approve / Demote → `danxbot_complete({status: "ready"})`
   - Cancel → `danxbot_complete({status: "cancelled"})`
   - Park (defer) → `danxbot_complete({status: "archive"})`
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
- Never edit other cards' `comments[]`, `ac[]`, `description` — triage owns only the triage verdict.
- Do NOT investigate underlying bugs — triage is "is this card ready to dispatch?" not "what is the work?"
- For Review: ICE is your judgment on CURRENT description; may `git log` for context; do NOT edit description.
- For Blocked: audit is read-only — if misclassification found, Demote (via `issue_triage`) + let next dispatch DO the steps.
- MCP error handling: if `issue_triage` returns `{ok: false, body: {error}}`, read `body.error` and re-route. Common errors: wrong verdict for status, non-existent target. Surface the error and abort the triage attempt.
