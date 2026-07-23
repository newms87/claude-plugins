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

**This is NOT a lightweight pattern-match on the description text. Review triage is a real investigation** — you have full repo read access (`Read`/`Grep`/`Glob`/`Bash`/`git log`) and are expected to use it before every Keep/Approve/Cancel verdict.

1. **Read** — call `mcp__danx_dashboard__issue_get({id})` to load the card from DB.
2. **Investigate (Review path only, MANDATORY before scoring)** — see references/triage-paths.md "Investigation Gate":
   - Grep/read the actual source files the card's description/AC name or imply. Confirm whether the work is **already implemented** (partially or fully) — cite file:line either way.
   - Check whether the premise is **still true** against the CURRENT codebase/architecture (a card can be well-written and totally obsolete — code moves faster than the backlog).
   - Check for a **duplicate or already-decided sibling** — same/near-identical title, an `-IMPORTED-N` variant of the same id, or a sibling card that was already Cancelled/Done covering the same ground. A duplicate of an already-cancelled card is a Cancel, full stop, regardless of how good the description reads in isolation.
   - Skipping this step because the description "looks complete" or "looks like clearly good/bad work" is exactly the failure this gate exists to catch — a plausible-sounding card and an already-obsolete one read identically from the description alone.
3. **Decide** per status path (see references/triage-paths.md):
   - **Review** → Keep / Cancel / Approve / Park (validate `effort_level` on Keep/Approve) — decision must follow FROM the investigation, not just the description
   - **Blocked** → Hard Gate audit → Demote / Confirm-Block
   - **Waiting On** → re-check `waiting_on.by[]` → Unblock / Confirm-Block
4. **Triage** — call `mcp__danx_dashboard__issue_triage({id, verdict, ice?, reason, ttl_seconds})` with:
   - `verdict` = one of `'keep'` / `'cancel'` / `'approve'` / `'defer'` — server routes per verdict
   - `ice` = `{i, c, e}` (1–5 each) for Review/Keep/Approve; omit for others
   - `reason` = substantive, evidence-backed reasoning (NOT a 1-2 sentence label) — for Review/Keep/Approve/Cancel this MUST include: what you checked (files/functions read), what you found (implemented already? still relevant? duplicate?), and the ICE breakdown with the file:line evidence behind each axis. A `reason` that could have been written without reading any code is a rejected triage, redo it.
   - `ttl_seconds` = 86400 (Review), 10800 (Blocked), 3600 (Waiting On)
5. **Append comment** — call `mcp__danx_dashboard__issue_comment({id, action: 'add', text: "## Triage — <date>\n..."})` with markdown body containing `**Status:** <from> → <to>`, `**Decision:** <Keep|Cancel|Approve|Park|Demote|Confirm-Block|Unblock>`, `**ICE:** <total> (<I>×<C>×<E>)` (Review/Keep/Approve only), `**Investigation:** <files/functions checked + what you found>`, `**Reason:** <reason>`.
6. **Complete** — per decision (server auto-routes):
   - Keep / Approve / Demote → `danxbot_complete({status: "ready"})`
   - Cancel → `danxbot_complete({status: "cancelled"})`
   - Park (defer) → `danxbot_complete({status: "archive"})`
   - Confirm-Block / Unblock → `danxbot_complete({status: "complete"})`

## ICE Rubric (Review only)

Each axis 1–5; `total = i × c × e` (1–125). MUST justify all three components in `last_explain` **with the code evidence you found in the Investigation step** — "Confidence" is not a vibe, it is a direct function of what you actually verified against the repo.

| Score | Impact | Confidence | Ease |
|---|---|---|---|
| 5 | Unblocks prod / blocks epic | Every AC anchor verified against current code (cite file:line); confirmed not already done, confirmed no duplicate | <1h, isolated |
| 4 | Major UX or perf | Most anchors verified against code, minor drift noted | 1–3h, contained |
| 3 | Cleanup or moderate feature | Some anchors verified, some assumed from description alone | Half-day, some discovery |
| 2 | Nice-to-have | Anchors NOT checked against code, or checked and found partially stale | Multi-session, cross-cutting |
| 1 | Speculative / vague, OR investigation found it's already implemented / obsolete / a duplicate | Card needs rewrite, or investigation could not confirm relevance | Heavy refactor / rebuild |

A Confidence score above 2 with no cited file:line evidence in `last_explain` is a malformed triage — the investigation step is what earns Confidence 3+, not the description's own polish.

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
- Do NOT *solve* the underlying work — triage is "is this card ready to dispatch, and is it still worth dispatching?", not "here is the fix." Reading code to verify relevance/implementation-status is IN scope and mandatory (see Investigation Gate above); writing the fix, or drafting the solution, is NOT.
- For Review: investigation is mandatory (Investigation Gate above) — read code, `git log` for history/authorship context, check for duplicate/superseded siblings — before ICE-scoring; do NOT edit description.
- For Blocked: audit is read-only — if misclassification found, Demote (via `issue_triage`) + let next dispatch DO the steps.
- MCP error handling: if `issue_triage` returns `{ok: false, body: {error}}`, read `body.error` and re-route. Common errors: wrong verdict for status, non-existent target. Surface the error and abort the triage attempt.
