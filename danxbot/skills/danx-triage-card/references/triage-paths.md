# Triage Paths & Decision Trees

Triage agent triages ONE card per dispatch. Three in-scope paths. Right path decided by `waiting_on` + `blocked` fields FIRST, then `status`.

| YAML state | Path |
|---|---|
| `waiting_on != null` (any status) | **Waiting On** — re-check `waiting_on.by[]` |
| `waiting_on == null` AND `status === "Review"` | **Review** — ICE-score |
| `waiting_on == null` AND `status === "Blocked"` | **Blocked** — Hard Gate audit |

Out-of-scope: `waiting_on == null` AND `blocked == null` AND `status ∈ {ToDo, In Progress, Done, Cancelled}` (dispatchable/active/terminal cards don't need triage).

## Status = Review

**Decide one of four outcomes:**

| Outcome | Action | YAML write | Terminal call |
|---|---|---|---|
| **Keep** | Promote to dispatch queue | `last_status: Keep`, `ice` populated (1–5 each), `expires_at = now + 24h` | `danxbot_complete({status: "ready"})` — worker stamps `ready_at` |
| **Cancel** | Obsolete/superseded/unwanted | `last_status: Cancel`, `ice` zeros, `retro.{good, bad}` filled, `expires_at = now + 24h` | `danxbot_complete({status: "cancelled"})` — worker stamps `cancelled_at` + renders `## Retro` |
| **Park** | On hold, revisit later (NEW, DX-739) | `last_status: Park`, `ice` zeros, `expires_at = now + 24h` | `danxbot_complete({status: "archive"})` — worker stamps `archived_at` (→ Backlog) |
| **Approve** | Implementable but direction needs sign-off | `requires_human: {reason, steps[], set_by: "agent", set_at: <ISO>}`, `last_status: Approve`, `ice` populated, `expires_at = now + 24h` | `danxbot_complete({status: "ready"})` — worker stamps `ready_at`; `requires_human` gate keeps picker off until human clears |

**Validate `effort_level`:** read `.claude/rules/danx-effort-policy.md`; compute level matching description scope; if unset or mismatched (scope grew/shrunk), overwrite.

**Distinguish Keep vs Approve vs Park vs Cancel:**
- Competent agent finish without asking human? → Keep.
- Implementable but direction needs sanity-check? → Approve.
- On hold, revisit later, not cancelled? → Park (new).
- No longer desired / superseded / duplicate? → Cancel.

## Status = Blocked

**Hard Gate audit:** Read most recent `author: danxbot` comment containing `## Blocked` / "operator must" section. For each "operator must" step, classify:
- **Locally executable** = edit config, `artisan`, `make`, `yarn`, `npm`, `composer`, log tail/grep, test re-run, restart Octane/queue/Horizon, session JSONL, git commands, code read.
- **Human-only** = ONLY: credential/secret rotation, deploy/SSM access, write-only repo, design/product decision, physical/OOB action (per `issue-card-workflow` "Hard Gate" table).

| Outcome | Action | YAML write | Terminal call |
|---|---|---|---|
| **Every step locally executable** — wrongly punted | **Demote** to ToDo | `last_status: Demote`, `last_explain: "<which steps local>"`, `reassess_hint: ""`, `expires_at = now + 3h` | `danxbot_complete({status: "ready"})` — worker stamps `ready_at` + clears `blocked` |
| **At least one step genuinely human-only** | **Confirm** Blocked | `last_status: Confirm-Block`, `last_explain: "<which human-only gates>"`, `reassess_hint: "<≤120 chars action-shaped check>"`, `expires_at = now + 3h` | `danxbot_complete({status: "complete"})` — no YAML write; triage{} mirrors via chokidar |
| **Mixed** (some local, some human-only) | Confirm, but note next worker dispatch should execute local steps before re-confirming | Same as Confirm + mention in `last_explain` | `danxbot_complete({status: "complete"})` |

**Rationalisation detector — refuse to Confirm if comment contains any of:**
- "operator-driven verification"
- "production-shaped infra"
- "honest way to verify"
- "intermittent — needs more samples"
- "needs to be tested in production / staging"

If found, Demote instead.

## Status = Waiting On

**Re-check `waiting_on.by[]`.** For each blocker id:
- Query the v2 DB via `mcp__danx_dashboard__issue_get({issue_id: "<PREFIX>-N"})`.
- Note its derived `status`. Terminal = `Done` or `Cancelled`. Non-terminal = anything else.

| Outcome | Action | YAML write | Terminal call |
|---|---|---|---|
| **Every blocker terminal** | **Unblock** (cleared) | `last_status: Unblock`, `last_explain: "<every blocker terminal; picker will dispatch>"`, `reassess_hint: ""`, `expires_at = now + 1h` | `danxbot_complete({status: "complete"})` — no YAML write |
| **At least one blocker non-terminal** | **Confirm-Block** waiting | `last_status: Confirm-Block`, `last_explain: "<naming still-pending blockers>"`, `reassess_hint: "<≤120 chars — e.g. 'Re-check ISS-91, ISS-92 — still in progress'>"`, `expires_at = now + 1h` | `danxbot_complete({status: "complete"})` — no YAML write |

**Edge case — blocker not found.** If both `Read` calls fail for a blocker id, treat as **Cancelled** (non-existent card cannot block). Note in `last_explain`: "Blocker <PREFIX>-N not found — treated as Cancelled."

**TTLs per status:**
- Review: 24h
- Blocked: 3h (human checks fast)
- Waiting On: 1h (blockers may flip terminal any minute)

## Per-Decision Terminal-Status Table

Only `complete`, `ready`, `cancelled`, `archive` valid from triage.

| Triage decision | Terminal status | YAML side-effect | Derived status |
|---|---|---|---|
| Keep | `ready` | worker stamps `ready_at = now` + clears `blocked` | `ToDo` |
| Approve | `ready` (after setting `requires_human`) | worker stamps `ready_at`; picker stays parked until human clears `requires_human` | gated `ToDo` |
| Cancel | `cancelled` | worker stamps `cancelled_at` + clears `dispatch` + renders `## Retro` | `Cancelled` |
| Park | `archive` | worker stamps `archived_at` + clears `ready_at` | `Backlog` |
| Demote | `ready` | worker stamps `ready_at` + clears `blocked` | `ToDo` |
| Confirm-Block | `complete` | none (terminal row finalizes; `triage{}` edit mirrors) | unchanged |
| Unblock | `complete` | none (same) | unchanged |
