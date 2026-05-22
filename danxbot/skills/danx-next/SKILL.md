---
name: danx-next
description: 'Pull top ToDo card and run full autonomous card-processing workflow. Orchestrator: decide unilaterally or escalate Blocked, never wait on human.'
---

# Danx Next Card

You process ONE card: **read YAML → plan → implement → quality gates → verify → commit → terminal state → `danxbot_complete`**.

## Top-Level Flow

0. Verify on latest `origin/main` (references/step-procedures.md § Step 0).
1. Read the YAML the dispatch prompt named.
1.1. **Resume self-check** — terminal state + checked ACs + filled retro → call `danxbot_complete`, stop. Don't redo.
1.5. **You Fix What You Find** rule — internalize before proceeding (references/step-procedures.md § Step 1.5).
2. Plan (references/step-procedures.md § Step 2).
3. Evaluate scope; epic-split if needed (references/step-procedures.md § Step 3.0–3.2).
4. Implement TDD (references/step-procedures.md § Step 4).
5. Quality gates (references/step-procedures.md § Step 5).
6. Verify ACs (references/step-procedures.md § Step 6).
7. Commit (references/step-procedures.md § Step 7a or 7b).
8. Definition-of-Done gate (references/step-procedures.md § Step 8).
9. Move to Done / Blocked / Waiting On (references/step-procedures.md § Step 9 / 10 / 10b).
10. `danxbot_complete` (references/step-procedures.md § Step 11).

Config references: `.claude/rules/danx-repo-config.md` for repo commands. Never hardcode IDs.

## YAML Schema

See references/yaml-schema.md for the complete schema table. Quick points:

- **`status`** is **DERIVED** from lifecycle triggers — agents NEVER write. Pickup auto-flipped via `dispatch != null` → rule 4 → `In Progress`. Approve → `ready_at` (rule 5 → `ToDo`). Complete → worker stamps `completed_at` (rule 2 → `Done`). Cancel → `cancelled_at` (rule 1 → `Cancelled`). Block → `blocked.at` (rule 3 → `Blocked`). Direct `status:` write FORBIDDEN.
- **No save verb.** Edit/Write the YAML; chokidar mirrors to Postgres + tracker.
- **`retro`** filled on terminal save; worker auto-renders `## Retro` comment. `commits[]` is owned-repo only (DX-559 gate). `action_item_ids[]` is LAST RESORT.
- **`blocked`** vs **`waiting_on`** — blocked = THIS card stuck (human needed); waiting_on = queued behind OTHER work (no human). Both dispatch gates; status-independent. `conflict_on[]` + `requires_human` are two more independent gates.

## Detailed Steps

All step procedures (0–11) live in **references/step-procedures.md**. Each step reads the YAML, makes decisions, edits the YAML, and advances. Step 11 terminal call gates on all six prereqs holding.

**Key gates:**
- **Step 1.1:** Resume detection + validation (never trust prior claims).
- **Step 1.5:** Fix-it-yourself filter (last resort for action items / Blocked).
- **Step 8:** Definition-of-Done (zero unchecked ACs).
- **Step 11:** Pre-call gate (all six prereqs before `danxbot_complete`).

**Terminal statuses (Step 11):**
- `complete` → worker stamps `completed_at` → rule 2 → `Done`.
- `failed` → worker stamps `blocked: {at, reason}` → rule 3 → `Blocked`.
- `cancelled` → worker stamps `cancelled_at` → rule 1 → `Cancelled`.
- `critical_failure` → halts poller via CRITICAL_FAILURE flag.

Do NOT emit text after `danxbot_complete` — the `summary` arg IS the report; conversation stream discarded within 5s.

## Boundaries

- One card per dispatch.
- No `AskUserQuestion` / plan-mode pause — decide unilaterally + document OR escalate Blocked.
- Read + edit YAML in place; no tracker calls.
- Never write `status:` literals.
- Never append `## Retro` to `comments[]` — worker auto-renders.
- `/loop` ONLY for in-card async (triggered builds/tests); never wait for human, never wait for next card.
