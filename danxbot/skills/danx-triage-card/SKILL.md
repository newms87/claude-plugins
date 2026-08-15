---
name: danx-triage-card
description: 'Per-card triage agent: reads ONE card, decides per status (Review/Blocked/Waiting On), records a confidence score via MCP.'
argument-hint: <PREFIX>-N card id
---

# Danx Triage Card

You triage **ONE** card per dispatch: read → investigate → decide (per status) → act via MCP → `danxbot_complete({status})`.

## Quick Reference

See references/triage-paths.md for complete decision trees, Confidence Rubric, Master Plan check, out-of-scope gates, failure handling, conflict-check mode.

**Path selection — `waiting_on` first, then `blocked`, then `status_derived`. `blocked` is an orthogonal GATE, not a derived status — `status_derived` never reads `blocked_at` (see "Status = Blocked" below), so it must be checked independently of status, not as a status value.**

| DB state | Path |
|---|---|
| `waiting_on != null` (any status) | **Waiting On** — re-check `waiting_on.by[]` |
| `waiting_on == null` AND `blocked != null` AND `blocked.reason` starts with `"Triage: "` | **Out of scope** — confidence-gate checkpoint (stamped by Review-path routing below); a human clears it via the dashboard, not you |
| `waiting_on == null` AND `blocked != null` (any other reason, or empty) | **Blocked** — Hard Gate audit + Demote / Confirm-Block |
| `waiting_on == null` AND `blocked == null` AND `status_derived === "Review"` | **Review** — Confidence-score + Master Plan check |

Out-of-scope refuse: `waiting_on == null` AND `blocked == null` AND `status_derived ∈ {ToDo, In Progress, Done, Cancelled}` — dispatchable / active / terminal cards don't triage. (Plus the `"Triage: "`-prefixed Blocked case above.)

## Workflow

**This is NOT a lightweight pattern-match on the description text. Review triage is a real investigation** — you have full repo read access (`Read`/`Grep`/`Glob`/`Bash`/`git log`) and are expected to use it before every confidence score.

1. **Read** — call `mcp__danx-dashboard__issue_get({id})` to load the card from DB.
2. **Investigate (Review path only, MANDATORY before scoring)** — see references/triage-paths.md "Investigation Gate":
   - Grep/read the actual source files the card's description/AC name or imply. Confirm whether the work is **already implemented** (partially or fully) — cite file:line either way.
   - Check whether the premise is **still true** against the CURRENT codebase/architecture (a card can be well-written and totally obsolete — code moves faster than the backlog).
   - Check for a **duplicate or already-decided sibling** — same/near-identical title, an `-IMPORTED-N` variant of the same id, or a sibling card that was already Cancelled/Done covering the same ground. A duplicate of an already-cancelled card scores 0, full stop, regardless of how good the description reads in isolation.
   - Check whether the card **conforms to the Master Plan** — read `.claude/rules/danx-master-plan.md` (always force-loaded into context, no extra call needed); where it points at deeper content, `Read`/`Grep` the referenced `.claude/master-plan/<slug>.md` page(s) on demand. Does the card fit something the plan describes, or at least not contradict it? A card that actively conflicts with the plan is a doubt, not a Master-Plan-silent card — silence is NOT itself a doubt (see Confidence Rubric below).
   - Skipping this step because the description "looks complete" or "looks like clearly good/bad work" is exactly the failure this gate exists to catch — a plausible-sounding card and an already-obsolete one read identically from the description alone.
3. **Decide** per status path (see references/triage-paths.md):
   - **Review** → assign ONE Confidence score, 0–5 — the server (not you) computes the outcome (Cancel / Park / Keep+Block / Approve) by comparing your score to the board's configured thresholds. You never pick the outcome; you only score how much value the card would add.
   - **Blocked** → Hard Gate audit → Demote / Confirm-Block (unchanged from before — see references/triage-paths.md "Status = Blocked")
   - **Waiting On** → re-check `waiting_on.by[]` → Unblock / Confirm-Block (unchanged — see references/triage-paths.md "Status = Waiting On")
4. **Act:**
   - **Review** → call `mcp__danx-dashboard__issue_triage({id, confidence, reason})`:
     - `confidence` = integer 0–5, **relevance/utility ONLY** — never effort, ease, or implementation cost (see Confidence Rubric below).
     - `reason` = substantive, evidence-backed reasoning (NOT a 1-2 sentence label) — MUST include: what you checked (files/functions read), what you found (implemented already? still relevant? duplicate? Master-Plan fit?), and the specific evidence behind the score. A `reason` that could have been written without reading any code is a rejected triage, redo it.
     - Read the response's `body.issue.triage_last_status` — one of `cancel` / `defer` / `keep` / `approve` — to know which band the server picked. That is what you report in your comment (step 5) as the Decision.
   - **Blocked / Waiting On** → no `issue_triage` call (there is no confidence question for an operator-escalation or dependency-wait audit — see references/triage-paths.md for the exact transition calls, unchanged from before).
5. **Append comment** — call `mcp__danx-dashboard__issue_comment({id, action: 'add', text: "## Triage — <date>\n..."})` with markdown body containing `**Status:** <from> → <to>`, `**Decision:** <Cancel|Park|Keep|Approve|Demote|Confirm-Block|Unblock>`, `**Confidence:** <0-5>` (Review only), `**Investigation:** <files/functions checked + what you found, including the Master Plan check>`, `**Reason:** <reason>`.
6. **Complete** — `danxbot_complete({status: "complete", summary})` ALWAYS, regardless of outcome. The card's fate is already fully driven by step 4 (`issue_triage` for Review, the noted transition calls for Blocked/Waiting On) — DX-835 split card lifecycle from dispatch finalization; the worker no longer infers card moves from `danxbot_complete.status`. `danxbot_complete`'s status is ONLY "did this dispatch itself succeed" — a triage agent that read the card and recorded a real, evidenced decision succeeded, no matter which outcome it reached. Calling it with `status: "ready"` / `"cancelled"` / `"archive"` (the pre-DX-835 contract) makes the worker stamp the DISPATCH row `failed` (only literal `"complete"` counts as dispatch success, `src/mcp/danxbot-server.ts` `isCompleteSuccess` / `src/worker/dispatch.ts:2701`) — a fully successful triage run then reads as a failure and feeds the auto-triage breaker's failure count (DX-1904/DX-1809), tripping unrelated backoffs for zero reason. Use `status: "failed"` (with a real ≥30-char reason) ONLY when the dispatch itself couldn't complete — e.g. the card was unreadable, an MCP call errored, you genuinely could not reach a decision.

## Confidence Rubric (Review only)

**One integer, 0–5. RELEVANCE/UTILITY ONLY — never effort, ease, or implementation cost.** The server, not you, turns this into Cancel/Park/Keep/Approve by comparing it to the board's configured thresholds (defaults: `0` → Cancel, `1–2` → Park+Block, `3–4` → Keep+Block, `5` → Approve — thresholds are board-configurable, DX-2080, so treat these as illustrative, not fixed).

**Default posture is inverted from a naive "prove it's good" read: default to HIGH confidence unless investigation surfaces a SPECIFIC, EVIDENCED doubt — the card is already built, no longer useful, or doesn't conform to anything in the Master Plan. A confidence of 5 means "this would add meaningful value."**

| Score | Meaning |
|---|---|
| 5 | **Default outcome of a clean investigation.** This would add meaningful value — not already implemented, still relevant, no superseding sibling, and conforms to (or is unaddressed by) the Master Plan. No specific, evidenced doubt found. |
| 3–4 | Investigation surfaced a real but only partially evidenced doubt on one axis (e.g. some anchors couldn't be verified against current code, or the Master Plan is ambiguous about it) — not enough to conclude it's wrong, but not a clean 5. |
| 1–2 | Investigation surfaced a SPECIFIC, EVIDENCED doubt (cite file:line / plan section) — e.g. partially already implemented, premise partly stale, or partially conflicts with the Master Plan — but not conclusive enough to call it dead. |
| 0 | Investigation CONFIRMS (cite file:line / plan section / sibling id) at least one of: already fully implemented, no longer relevant / superseded, duplicates an already-Cancelled/Done sibling, or directly contradicts the Master Plan. |

A score below 5 with no cited file:line (or Master Plan section) evidence in `reason` is a malformed triage — the investigation step is what earns anything less than the default 5, not a vibe.

## Boundaries

- One card only.
- Never edit other cards' `comments[]`, `ac[]`, `description` — triage owns only the triage decision.
- Do NOT *solve* the underlying work — triage is "is this card ready to dispatch, and is it still worth dispatching?", not "here is the fix." Reading code to verify relevance/implementation-status is IN scope and mandatory (see Investigation Gate above); writing the fix, or drafting the solution, is NOT.
- For Review: investigation is mandatory (Investigation Gate above) — read code, `git log` for history/authorship context, check for duplicate/superseded siblings, check the Master Plan — before scoring; do NOT edit description.
- For Blocked: audit is read-only — if misclassification found, Demote (via `issue_transition`) + let next dispatch DO the steps.
- MCP error handling: if `issue_triage` returns `{ok: false, body: {error}}`, read `body.error` and re-route. Common errors: `confidence` missing/non-integer/out of `0–5` range, empty `reason`, card already terminal (409), or an approve-band confidence on a container card (Epic/Feature — DX-1992, containers derive status from children and reject `approve`). Surface the error and abort the triage attempt.
