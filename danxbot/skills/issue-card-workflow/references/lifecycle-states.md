# Lifecycle States & Transitions

## Status Derivation Rules

Statuses are computed from lifecycle triggers via `deriveStatus()` in `src/issues/derive/status.ts` (dashboard mirror: `dashboard/src/composables/derive-status.ts`):

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
- Agent-created via `issue_create` — the server always starts a card in Review; there is NO `status` parameter to pass (`issue_create` rejects unknown keys).
- Cards in epic + phase fan-out (epic AND every phase start `Review`).
- Action-item cards spawned mid-retro.

**Why:** Card in `ToDo` is dispatchable next tick. If description half-written, AC vague, scope overlaps other in-flight work, poller wastes dispatch flailing. `Review` forces triage agent to read cold + decide: Approve (→ `ToDo` via `ready_at`), Cancel (→ `Cancelled` via `cancelled_at`), Defer (→ `Backlog` via `archived_at` + `ready_at: null`, and escalates), or Keep (escalates to the operator via an open problem, stays derived-Review — DX-2782/DX-2830, no TTL to refresh any more).

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
| `Review` | Score `confidence` 0-5 → server picks Cancel / Defer(Park) / Keep / Approve | Cancel: stamps `cancelled_at` (terminal). Defer: stamps `archived_at` + `ready_at: null`, plus opens a problem (see below). Keep: no column stamp, stays derived-Review, opens a problem (see below). Approve: stamps `ready_at`. **Keep and Defer no longer stamp `blocked_at` (DX-2782/DX-2830 retired that) — both instead open a problem stating `"Triage: <reason>"` with exactly three solutions (`Approve and ready` / `Defer` / `Cancel`, one `recommended: true` — `Approve and ready` for Keep, `Defer` for Defer). Opening the problem is what puts the card in the operator's Needs You view (`open_problem_count > 0`); answering it auto-applies the outcome via the normal `issue_transition` actions. A freeform answer just closes the problem with no side effect.** | n/a — no TTL. `triage_expires_at` is dropped outright (DX-2820); the open-problem exclusion holds a Review card out of auto-triage eligibility for as long as the problem stays open, with no time window. |
| `Blocked` | Hard Gate audit → Demote OR Confirm | Demote: clear `blocked: null`. Confirm: refresh `expires_at` + write `reassess_hint`. | 3h |
| `Waiting On` | Re-check `waiting_on.by[]` — clear if every dep terminal | Clear: `waiting_on: null` (no trigger write; status-independent). | 1h |
| `ToDo` / `In Progress` | Not triaged | n/a | n/a |
| `Done` / `Cancelled` | Terminal — never re-triaged | n/a | n/a |

**ToDo dispatch sort:** untriaged first (`triage.expires_at === ""` — never scored) then triaged by `triage.ice.total` DESC. ICE = Impact × Confidence × Ease, each axis 1–5, total 1–125. Within each tier, FIFO by mtime. Poller's `listDispatchableYamls` enforces; agents don't rank — write good description, triage agent's ICE governs priority.

**`Action Items` is not a status.** Action-item cards carry `status: Review` so triage picks them up alongside the Review list; the DB record stores `status: Review`.

## Blocked vs Waiting On vs an Open Problem (needs a human)

Three different "this card cannot dispatch right now" signals — NOT interchangeable; dashboard surfaces three distinct indicators; picker checks each as an independent gate.

| Signal | Field | When | Cleared by |
|---|---|---|---|
| **Blocked** | `blocked: {at, reason, by}` (derived `Blocked` via rule 3) | Dispatch paused on THIS card (card-specific tool failure, a hold with a named release condition, an ambiguous spec/decision an agent can settle itself). Does NOT by itself mean a human is needed — `block` only holds dispatch, it never asks a human, and the agent (or a later dispatch) can often resolve it itself. | Whoever resolves the blocker calls `issue_transition({action: 'unblock'})` — derived status falls through to the next trigger. Answering a problem never clears a `blocked` card. |
| **Open Problem** (needs a human) | `problems` field group; `open_problem_count` scalar (status-independent) | A human must decide or act: a decision only the operator can make, or an action on a system the agent has zero reach into (3rd-party token rotation, external dashboard access, manual external infra deploy). **The only thing that puts a card in the operator's Needs You view is `open_problem_count > 0`.** There is no separate flag — escalate via `issue_problem({action: 'add', statement, solutions?})`. | Automatically when the operator answers the card's last open problem (a card with several problems stays in Needs You until every one is answered), or when the last open problem is removed (`issue_problem remove` — always allowed, even as the last one). |
| **Waiting On** | `waiting_on: {reason, timestamp, by[]}` (status-independent) | Card queued behind OTHER in-flight work (phase siblings, Action Items, separately-scoped task). | Picker dispatches moment every `by[]` blocker reaches Done / Cancelled. `waiting_on` record stays as durable dep-history. |

**All three dispatch gates may coexist** (blocked, an open problem, waiting_on, plus `conflict_on[]`): each models a different real-world cause; picker AND-s them; dispatch only when every one is clear. A card may legitimately carry all of them at once. Each is cleared by a different actor/event independently.

### Coexistence

An open problem is fully independent of `blocked` and `waiting_on`; all may coexist (rare). Example: a card both `Blocked` (a card-specific tool failure the next agent re-checks) AND carrying an open problem (rotate a token) at the same time. Answering the problem clears it but leaves `blocked` untouched; the agent that resolves the tool failure calls `unblock` separately. Poller checks each gate independently; every one has to clear before the card dispatches.

### Whitelist/Blacklist for escalating to a human

Full whitelist + blacklist for what warrants opening a problem (vs a self-resolvable `Blocked`) lives in the `issue-blocker` skill's Field Selection section — check there before deciding. Condensed form:

**Escalate (open a problem):** a decision only the operator can make (domain intent, business/UX judgement, scope/authority), 3rd-party token rotation, external dashboard access, manual external infra deploy, anything the agent has zero programmatic reach into.

**Don't escalate — use `Blocked`, or just fix it:** an ambiguous spec the agent can settle, a failing test, a merge conflict, a missing local dependency, a clarifying question the agent can answer itself — those stay `Blocked` at most, never an open problem.

### Termination contract for escalating mid-dispatch

Opening a problem IS the whole escalation — there is no separate "set requires_human" step (DX-2830 deleted `issue_requires_human` and the `requires_human_reason`/`requires_human_set_by`/`requires_human_set_at`/`issue_requires_human_steps` columns entirely; DX-2801's mid-dispatch pickup-state gate on this was cancelled into DX-2830, so `issue_problem add` works on any non-terminal card regardless of pickup state). When an agent escalates mid-dispatch:

1. `issue_problem({id, action: 'add', statement, solutions?})` — zero solutions is valid; the operator then answers free-form.
2. The dispatch still ends with `danxbot_complete({status: "complete", summary})` — same as any other finished turn. Do NOT flip `status` terminal and do NOT fill `retro` — the human is the next actor, the open problem is the only signal needed.
3. The poller skips the card every tick while `open_problem_count > 0` — pickup, auto-triage eligibility, and dispatch all exclude it unconditionally, no TTL.
4. Once the operator answers the card's last open problem (or an agent removes it), a fresh dispatch picks the card up and continues — read `issue_get({id, fields: ["problems"]})` for the operator's `decisions[]` first.

Humans can also open a problem via the dashboard directly when they want to park a card on something they'll do themselves — same shape, no agent action required.

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

Parent rollup ignores an open problem on a child — checked only at dispatch, not propagated. Dashboard surfaces a child-count subscript on epic children when any phase has `open_problem_count > 0`.

**Implications for agents (container = Epic OR Feature):**
- When you finish a child card, call `issue_transition({id, action: 'complete', summary})` FIRST, THEN `danxbot_complete({status: 'complete'})` (DX-835 — `danxbot_complete` finalizes the DISPATCH row only and does NOT move the card). The poller propagates the parent container on the next tick. Do NOT touch the container — edit overwritten.
- When a child stamps `blocked.at`, the container's `blocked` synthesized by poller. Operator triages from container view.
- The container stays at whatever derivation produces. Stamping `completed_at` on an Epic OR Feature with one child `In Progress` is no-op, cleared next tick.
- Parents with `waiting_on != null` skipped by parent-status derivation — parent's own dep-chain note takes precedence. Set parent's `waiting_on` explicitly when needed.

**Forbidden end-states for any turn creating a container (Epic OR Feature):**
- Container written, `children: []`, no child cards created.
- Container written, work / split listed only in description prose, no child cards created.
- Container written, "phases TBD" / "left for triage" / "will split next session" anywhere.
- **Feature written with executable work in its own body / `ac[]` but NO child cards.** A Feature is a container — work lives ONLY in child Story/Bug/Chore cards; a Feature that describes its own work is INVALID.

If about to end turn in any — STOP, write the child cards first. CRITICAL: a container (Epic OR Feature) without child cards is INVALID + workflow violation.
