---
name: danx-next
description: 'Pull top ToDo card and run full autonomous card-processing workflow. Orchestrator: decide unilaterally or escalate by opening a problem, never wait on human.'
---

# Danx Next Card

You process ONE card: **read card (`issue_get`) → plan → implement → quality gates → verify → commit → terminal state → `danxbot_complete`**.

## Top-Level Flow

0. Verify on latest `origin/main` (references/step-procedures.md § Step 0).
1. Get the card body: if the dispatch prompt inlines a `## Card snapshot` block (DX-1675 — the worker inlines the current card body on a fresh work dispatch), use that block as the card body and SKIP the initial `issue_get`; otherwise (resume — no snapshot block) read the card via `mcp__danx-dashboard__issue_get` for the id the dispatch prompt named. Re-read via `issue_get` only when you need fresher than the snapshot (the snapshot is current at dispatch time; the DB stays canonical).
1.1. **Resume self-check** — terminal state + checked ACs + filled retro → call `danxbot_complete`, stop. Don't redo.
1.5. **You Fix What You Find** rule — internalize before proceeding (references/step-procedures.md § Step 1.5).
2. Plan (references/step-procedures.md § Step 2).
3. Evaluate scope; epic-split if needed (references/step-procedures.md § Step 3.0–3.2).
4. Implement TDD (references/step-procedures.md § Step 4).
5. Quality gates (references/step-procedures.md § Step 5).
6. Verify ACs (references/step-procedures.md § Step 6).
7. Commit (references/step-procedures.md § Step 7a or 7b).
8. Definition-of-Done gate (references/step-procedures.md § Step 8).
9. Move to Done / Blocked hold or Needs You escalation / Waiting On (references/step-procedures.md § Step 9 / 10 / 10b).
10. `danxbot_complete` (references/step-procedures.md § Step 11).

Config references: `.claude/rules/danx-repo-config.md` for repo commands. Never hardcode IDs.

## DB Schema

All cards are in the DB, accessed via MCP tools (`mcp__danx-dashboard__issue_*`). Quick points:

- **`status` / `status_derived`** is **DERIVED** from lifecycle triggers, never written directly via `issue_edit` — six-rule precedence table + exact rule numbers: `danxbot:issue-card-workflow` → references/lifecycle-states.md § "Status Derivation Rules". Mechanically: Pickup → `issue_transition({action: 'pickup'})` stamps `started_at` → `In Progress`. Approve → `issue_transition({action: 'ready'})` stamps `ready_at` → `ToDo`. Complete → `issue_transition({action: 'complete', summary})` stamps `completed_at` → `Done`. Cancel → `issue_transition({action: 'cancel'})` stamps `cancelled_at` → `Cancelled`. **Block is NOT one of the six status rules** — `issue_transition({action: 'block', reason})` stamps a separate dispatch-gate field (`blocked.at`) that leaves whichever status rule already applies untouched. Direct `status:` write FORBIDDEN.
- **Use MCP tools for all mutations.** Call `issue_edit` for prose, `issue_transition` for lifecycle, `issue_comment` for comments, `issue_problem`/`issue_solution` for human escalation, `issue_retro` for terminal retro.
- **`retro`** filled on terminal via `issue_retro({good, bad, action_item_ids[], commits[], tests[]})` (`tests[]` REQUIRED). Server auto-renders `## Retro` comment. `commits[]` is owned-repo only (DX-559 gate). `action_item_ids[]` is LAST RESORT.
- **`blocked`** vs **open problems** vs **`waiting_on`** — blocked = THIS card held until its own blocker is resolved (a hold, not a human escalation; never in Needs You; resolve it yourself where you can, then `unblock`); an **open problem** (`issue_problem({action: 'add', ...})`) is the ONLY way a card reaches Needs You — a card needs a human exactly when `open_problem_count > 0`, computed automatically, nothing to set or clear directly (there is no separate `requires_human` tool or flag); waiting_on = queued behind OTHER work (no human). All three are dispatch gates, status-independent. `conflict_on[]` is one more independent gate.

## Detailed Steps

Full procedures for Steps 0–11 live in **references/step-procedures.md**.

**Key gates:**
- **Step 1.1:** Resume detection + validation (never trust prior claims).
- **Step 1.5:** Fix-it-yourself filter (last resort for action items / Blocked / Escalate).
- **Step 8:** Definition-of-Done (zero unchecked ACs).
- **Step 11:** Pre-call gate (all six prereqs before `danxbot_complete`).

**Step 11 — two-step termination (DX-835):** `danxbot_complete` never moves the card — it only finalizes the dispatch row. Call `issue_transition` (or `issue_problem` for an escalation) FIRST, THEN `danxbot_complete`. Canonical table (Done/Cancelled/Blocked/Needs-a-human) + the required post-Step-A verification: `danxbot:issue-card-workflow` § "DX-835 — two-step termination is MANDATORY". One row that table doesn't carry, dispatch-specific: an **env-broken** dispatch stays In Progress on the card and calls `danxbot_complete({status:'critical_failure', summary})` — this halts dispatch (see `danxbot:halt-flag`).

Do NOT emit text after `danxbot_complete` — the `summary` arg IS the report; conversation stream discarded within 5s.

## Boundaries

- One card per dispatch.
- No `AskUserQuestion` / plan-mode pause — decide unilaterally + document OR escalate by opening a problem (never a bare block — blocked does not reach the operator).
- Read + edit cards exclusively via `mcp__danx-dashboard__issue_*` tools; no tracker calls.
- Never write `status:` literals.
- Never append `## Retro` to `comments[]` — worker auto-renders.
- **Never `/loop`, `ScheduleWakeup`, or background-then-end-turn.** A dispatch is `claude -p` with stdin ignored, so a wakeup can never fire — arming one and ending your turn abandons the card and wastes every token spent. Wait in the FOREGROUND with an explicit `timeout`; if the job outlives the dispatch budget, release the card via `issue_transition({action: "rollback_pickup"})` with a comment saying what is running. Full contract: `danxbot:danx-start`.
