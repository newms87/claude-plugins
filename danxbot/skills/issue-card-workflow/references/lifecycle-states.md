# Lifecycle States & Transitions

## Status Derivation Rules

Statuses are computed from lifecycle triggers via `deriveStatus()` in `src/issue/derive-status.ts`:

| Rule | Condition | Derived status |
|---|---|---|
| 1 | `cancelled_at !== null` | `Cancelled` |
| 2 | `completed_at !== null` | `Done` |
| 3 | `blocked.at !== null` | `Blocked` |
| 4 | `dispatch !== null` | `In Progress` |
| 5 | `ready_at !== null` | `ToDo` |
| 6 | `archived_at !== null` | `Backlog` |
| 7 | (fallthrough) | raw `status` field (`Review` on creation) |

Precedence: 1 > 2 > 3 > 4 > 5 > 6 > 7. First matching rule wins. **Agents NEVER write `status:` directly** — timestamp triggers + gate fields drive state.

## Rule 4 ("In Progress") has three causes — verify before declaring health, never trust the count

`dispatch !== null` collapses three distinct real states into one displayed status. An aggregate count of "N cards In Progress," or a dashboard "Agents Broken" banner, is a symptom pointer — not proof of health OR proof of a specific cause. Before declaring the system healthy, or diagnosing what's wrong, resolve EVERY `In Progress` card to one of:

1. **Container rollup** — an Epic/Feature parent derives `In Progress` because a child does (see Container Status below). No action; the container's own `dispatch` field is null, only the derivation cascades.
2. **Legitimate manual/operator pickup** — `dispatch.kind === 'manual'`. Owned by whoever picked it up; not the poller's concern, no self-heal applies.
3. **Genuinely stranded** — `dispatch` is non-null but the underlying process is dead (worker restart, crash, or a failed dispatch that cleared its own `dispatch_id` without the derived status recomputing). This is the only case that needs recovery.

**Mechanical check before saying "N In Progress is healthy" or before diagnosing why:** for EACH In Progress card, read `dispatch_id` / `started_at` / `dispatch_kind`, AND cross-reference the real dispatch-tracking table's running/queued rows against the worker's actual concurrent-dispatch capacity. A count of In Progress cards that exceeds worker slots, or that doesn't reconcile 1:1 against live dispatch rows, means some fraction is stranded — the aggregate number alone cannot tell you which fraction. Same discipline applies to an agent-profile "broken" flag / banner: clearing it is a fresh start, not a diagnosis — check the profile's strike history (which card, which failure reason) before assuming the same failure won't immediately re-trip it.

This corrects a real mistake: declaring "8 In Progress on one board + 2 on another = 10, all healthy, nothing stuck" from the counts alone, when only 1 card had a real live dispatch behind it — the other 9 were a mix of container rollups and stranded cards that looked identical in the aggregate.

## Status on Creation — ALWAYS start in Review

**Every newly created card MUST start with `status: "Review"`** — without exception. Review is the holding pen for un-audited cards. The per-card triage agent is the only mover from `Review` → `ToDo` (stamps `ready_at`).

This applies to:
- Human-typed cards via dashboard Create-Card button.
- Agent-created via `danx_issue_create` (pass `status: "Review"` explicitly).
- Cards in epic + phase fan-out (epic AND every phase start `Review`).
- Action-item cards spawned mid-retro.

**Why:** Card in `ToDo` is dispatchable next tick. If description half-written, AC vague, scope overlaps other in-flight work, poller wastes dispatch flailing. `Review` forces triage agent to read cold + decide: Approve (→ `ToDo` via `ready_at`), Cancel (→ `Cancelled` via `cancelled_at`), or Keep (refresh `expires_at`, +24h).

**Promotion to ToDo is SEPARATE action, never co-located with creation.** Even when certain card is ready, leave it derived `Review`. Promotion via:
- Triage agent ICE-scores Approve → stamps `ready_at = <now ISO>` (rule 5 → `ToDo`) — normal path.
- Human operator promotes via dashboard (PATCH writes `ready_at`).
- **Creating agent ONLY when:** (a) finished description + `ac[]` in same turn, (b) verified zero-context-test pass, (c) confirmed card genuinely dispatchable right now. Two-step (create-in-Review, stamp `ready_at`) is explicit + visible — NOT shortcut. Default: leave to triage agent.

**Interaction with `waiting_on`.** `waiting_on` is status-independent — card may carry dep-chain record at any status (Review, ToDo, In Progress, Blocked). Validator does NOT couple them. Sequential phase chains may stamp `waiting_on.by[]` at creation alongside `status: Review` — chain rides through Review → ToDo cleanly; no second-pass edit needed.

**Interaction with container status derivation (Epic OR Feature).** Poller propagates the parent container's triggers from children's derived-status union. When all children derive `Review`, the container also derives `Review` (rule 7 fallthrough). When the creating agent stamps `ready_at` on some children, the parent container gets its own `ready_at` stamped by poller (rule 5 → parent `ToDo`). Agent does NOT manually stamp a container's triggers — derivation owns them.

## Triage Lifecycle

The triage block on each card is owned by the **per-card triage agent** dispatched by poller. Poller picks one card per tick whose `triage.expires_at <= now` and dispatches `/danx-triage-card <PREFIX>-N`. One card per dispatch — bulk-orchestrator retired.

**Auto-triage is EXPLICIT opt-in per card (`triage_enabled`, default `false`).** The automatic dispatcher's eligibility query only ever selects cards with `triage_enabled: true` — a card created without an explicit `triage_enabled: true` sits in Review untouched by automatic triage forever (operator directive 2026-08-09, reverting DX-1928's true-default; auto-created cards must never silently enter the dispatch pipeline). Every `issue_create` passes the flag explicitly — see the "Auto-Triage Opt-In" section in SKILL.md. Operator-directed triage (`/danx-triage-card`, `POST /api/triage`, direct `issue_triage`) is NOT gated by this flag.

**Cadence per status (TTL the agent stamps on `triage.expires_at`):**

| Derived status | Triage decision | Trigger write | Default TTL |
|---|---|---|---|
| `Review` | ICE-score → Keep / Cancel / Approve / Park | Keep: refresh `expires_at` only. Cancel: stamp `cancelled_at` + retro. Approve: stamp `ready_at` (optionally populate `requires_human`). Park: stamp `archived_at`. | 24h |
| `Blocked` | Hard Gate audit → Demote OR Confirm | Demote: clear `blocked: null`. Confirm: refresh `expires_at` + write `reassess_hint`. | 3h |
| `Waiting On` | Re-check `waiting_on.by[]` — clear if every dep terminal | Clear: `waiting_on: null` (no trigger write; status-independent). | 1h |
| `ToDo` / `In Progress` | Not triaged | n/a | n/a |
| `Done` / `Cancelled` | Terminal — never re-triaged | n/a | n/a |

**ToDo dispatch sort:** untriaged first (`triage.expires_at === ""` — never scored) then triaged by `triage.ice.total` DESC. ICE = Impact × Confidence × Ease, each axis 1–5, total 1–125. Within each tier, FIFO by mtime. Poller's `listDispatchableYamls` enforces; agents don't rank — write good description, triage agent's ICE governs priority.

**`Action Items` is not a status.** Action-item cards carry `status: Review` so triage picks them up alongside the Review list; the DB record stores `status: Review`.

## Blocked vs Waiting On vs Requires Human

Three different "this card cannot dispatch right now" signals — NOT interchangeable; dashboard surfaces three distinct indicators; picker checks as independent gates.

| Signal | Field | When | Cleared by |
|---|---|---|---|
| **Blocked** | `blocked: {at, reason}` (derived `Blocked` via rule 3) | Card *itself* stuck — human must supply info / action agent cannot (credentials, deploy access, ambiguous spec needing design call, missing decision, write-only repo). | Human writes comment / clears `blocked: null` — derived status falls through next trigger. |
| **Requires Human** | `requires_human: {reason, steps[], set_by, set_at}` (status-independent) | Card needs human to act on system agent has zero reach into (3rd-party token rotation, external dashboard access, manual external infra deploy). | Human via dashboard "Mark Resolved" (PATCHes `requires_human: null`). |
| **Waiting On** | `waiting_on: {reason, timestamp, by[]}` (status-independent) | Card queued behind OTHER in-flight work (phase siblings, Action Items, separately-scoped task). | Picker dispatches moment every `by[]` blocker reaches Done / Cancelled. `waiting_on` record stays as durable dep-history. |

**All four dispatch gates may coexist** (blocked, waiting_on, requires_human, conflict_on[]): each models different real-world cause; picker AND-s them; dispatch only when every null/empty. Card may legitimately carry all four at once. Each cleared by different actor/event independently.

### Coexistence

`requires_human` fully independent of `blocked` + `waiting_on`; may coexist (rare). Example: card both `Blocked` (waiting clarifying comment) AND `requires_human` set (waiting token rotation as part of clearing block). Poller checks each gate independently; clearing all three required to dispatch.

### Whitelist/Blacklist for `requires_human`

Full whitelist + blacklist lives in `danxbot:requires-human` plugin skill (load via Skill tool before populating). Condensed form:

**Whitelist:** 3rd-party token rotation, external dashboard access, manual external infra deploy, anything agent has zero programmatic reach.

**Blacklist:** ambiguous spec, failing test, merge conflict, missing local dependency, clarifying question — those are `Blocked`, not `requires_human`.

### Termination contract for agent-set `requires_human`

When agent **sets** `requires_human` mid-dispatch (field flips `null` → populated), dispatch ends with `danxbot_complete({status: "complete", summary: "Set requires_human — see field"})`. Agent does NOT flip `status` terminal AND does NOT fill `retro` — human is next actor, field is only signal. Poller skips card every tick until human clears; fresh dispatch picks it up + continues.

Humans can also set `requires_human` via dashboard "Flag for human" (set_by: "human") when they want to park card on external action they'll perform.

## Reopen (Terminal → Dispatchable)

Reverse the terminal trigger. NEVER touch `status:`. NEVER touch `list_name`. Only timestamp triggers + gate fields drive state.

| Scenario | Trigger writes (atomic, same edit) |
|---|---|
| Reopen Done | `completed_at: null` + `ready_at: <now ISO>` |
| Reopen Cancelled | `cancelled_at: null` + `ready_at: <now ISO>` |
| Reopen back to Review | clear terminal trigger + leave `ready_at: null` (rule 7 falls through to raw `status: Review`) |

Forbidden in reopen edits (and every other): writing `status:` field directly via `issue_edit`. Use `issue_transition` to drive lifecycle. Status and display list are server-derived from trigger fields; agents touch only trigger timestamps. Use MCP tools only.

## Container Status is Computed, Not Edited

A **container type** (Epic OR Feature) has its status **derivation-owned by server** — computed from its children's derived statuses, NOT from its own lifecycle. Feature, like Epic, is a CONTAINER: never dispatched to a worker, status computed from children, its own lifecycle columns (`ready_at` / `completed_at` / `cancelled_at` / `blocked`) stay null. Story / Bug / Chore are **leaves** — a leaf NEVER rolls up from `children[]` even if it somehow has any; its status derives from its own lifecycle. The DB engine computes container status from children's derived statuses — union of child states propagates correctly. Agents NEVER manually stamp a container's triggers; call `issue_transition` on child cards instead; server recomputes container status automatically.

**Priority rules (first match wins) — same for Epic AND Feature:**

1. Any child derives `Blocked` → parent stamped `blocked: {at, reason}`.
2. Any child derives `In Progress` → parent derives `In Progress`.
3. Any child derives `ToDo` → parent stamped `ready_at`.
4. All non-cancelled children derive `Review` → parent derives `Review`.
5. All non-cancelled children derive `Done` → parent stamped `completed_at`.
6. All children derive `Cancelled` → parent stamped `cancelled_at`.

Cancelled children excluded from rules 4–5 — single non-cancelled child shifts answer. Rule 6 fires only EVERY child Cancelled. Mixed terminal states leave parent's current status untouched.

Parent rollup ignores orthogonal `requires_human` — checked only at dispatch, not propagated. Dashboard surfaces child-count subscript on epic children when any phase has `requires_human != null`.

**Implications for agents (container = Epic OR Feature):**
- When you finish a child card, call `danxbot_complete({status: "complete"})` — worker stamps the child's `completed_at`, poller propagates the parent container on next tick. Do NOT touch the container — edit overwritten.
- When a child stamps `blocked.at`, the container's `blocked` synthesized by poller. Operator triages from container view.
- The container stays at whatever derivation produces. Stamping `completed_at` on an Epic OR Feature with one child `In Progress` is no-op, cleared next tick.
- Parents with `waiting_on != null` skipped by parent-status derivation — parent's own dep-chain note takes precedence. Set parent's `waiting_on` explicitly when needed.

**Forbidden end-states for any turn creating a container (Epic OR Feature):**
- Container written, `children: []`, no child cards created.
- Container written, work / split listed only in description prose, no child cards created.
- Container written, "phases TBD" / "left for triage" / "will split next session" anywhere.
- **Feature written with executable work in its own body / `ac[]` but NO child cards.** A Feature is a container — work lives ONLY in child Story/Bug/Chore cards; a Feature that describes its own work is INVALID.

If about to end turn in any — STOP, write the child cards first. CRITICAL: a container (Epic OR Feature) without child cards is INVALID + workflow violation.
