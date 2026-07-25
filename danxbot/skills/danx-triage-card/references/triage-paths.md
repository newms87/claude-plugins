# Triage Paths & Decision Trees

Triage agent triages ONE card per dispatch. Three in-scope paths. Right path decided by `waiting_on` + `blocked` fields FIRST, then `status`.

| Card state | Path |
|---|---|
| `waiting_on != null` (any status) | **Waiting On** — re-check `waiting_on.by[]` |
| `waiting_on == null` AND `status_derived === "Review"` | **Review** — ICE-score |
| `waiting_on == null` AND `status_derived === "Blocked"` | **Blocked** — Hard Gate audit |

Out-of-scope: `waiting_on == null` AND `blocked == null` AND `status_derived ∈ {ToDo, In Progress, Done, Cancelled}` (dispatchable/active/terminal cards don't need triage).

## Status = Review

### Investigation Gate (MANDATORY, before ICE-scoring)

Real investigation, not a description re-read. Every one of these three checks runs before you write an ICE score — this is the load-bearing step; a Keep/Approve verdict reached without it is not a valid triage.

1. **Already implemented?** Identify the concrete files/functions/routes the card's description or AC names or clearly implies. `Grep`/`Read` them. If the described behavior already exists in the current code — fully or substantially — that is a **Cancel** (superseded by reality), not a Keep, however well-written the card is. Cite the file:line that proves it either way.
2. **Still relevant?** Re-check the premise against the CURRENT architecture, not the architecture the card was written against. `git log`/`git blame` the relevant area if the card references something that may have since changed direction. A card can be internally coherent and still describe a world that no longer exists (an inverted decision, a retired subsystem, a superseding redesign already shipped).
3. **Duplicate or already-decided sibling?** Search for a same/near-identical-title card (`mcp__danx_dashboard__issue_list({q: "<distinctive phrase from the title>"})`), including `-IMPORTED` / `-IMPORTED-2`-style variant ids of the same underlying card. If a sibling covering the same ground is already `Cancelled` or `Done`, that disposition almost always transfers — Cancel this one too and say why in `reason`, unless you find concrete evidence the sibling's cancellation reasoning does NOT apply here.

A card that passes all three (not implemented, still relevant, no superseding sibling) earns real Confidence in the ICE score. A card that fails any one of them is a Cancel candidate regardless of how good its Impact/Ease would otherwise look — a well-written description of unnecessary work is still unnecessary work.

**Ordering check (MANDATORY, separate from the three above — run before picking a verdict):** If this card should not be worked before a sibling/prerequisite card completes, do NOT encode that via a Keep-and-revisit-later judgment call — `issue_triage({verdict:'keep'})` gives zero ordering guarantee (see the Keep row below: it only refreshes the re-triage TTL). Instead check `issue_get`'s edges for an existing `depends_on` on the prerequisite; if missing, add it now via `issue_dependency({id, action:'add', kind:'depends_on', target_id: <prerequisite>})` BEFORE deciding the verdict. Once the edge exists, the card is safe to Approve (or leave as Keep) — `waiting_on` holds the picker off regardless of triage verdict or status.

**Decide one of four outcomes:**

| Outcome | Action | MCP triage call | Terminal call |
|---|---|---|---|
| **Keep** | Leave in Review, refresh re-triage TTL (NOT a promotion) | `issue_triage({verdict: "keep", ice: {i,c,e}, reason})` — server refreshes `triage_expires_at` only; `ready_at` is untouched, card stays `Review` | `danxbot_complete({status: "complete"})` |
| **Cancel** | Obsolete/superseded/unwanted | `issue_triage({verdict: "cancel", reason})` + `issue_retro({good, bad})` — server stamps `cancelled_at` + renders `## Retro` | `danxbot_complete({status: "complete"})` |
| **Park** | On hold, revisit later (NEW, DX-739) | `issue_triage({verdict: "defer", reason})` — server stamps `archived_at` (→ Backlog) | `danxbot_complete({status: "complete"})` |
| **Approve** | Implementable but direction needs sign-off | `issue_requires_human({set: true, reason, steps[]})` + `issue_triage({verdict: "approve", ice, reason})` — server stamps `ready_at`; `requires_human` gate keeps picker off until human clears | `danxbot_complete({status: "complete"})` |

`danxbot_complete` is ALWAYS `status: "complete"` on a successful triage run, regardless of verdict — DX-835 already moved the card via `issue_triage` above; `danxbot_complete` only reports whether the dispatch itself succeeded. Using `"ready"`/`"cancelled"`/`"archive"` here (pre-DX-835 contract) makes the worker stamp the DISPATCH row `failed`, poisoning the auto-triage breaker's failure count for a run that actually succeeded (DX-1810).

**Validate `effort_level`:** read `.claude/rules/danx-effort-policy.md`; compute level matching description scope; if unset or mismatched (scope grew/shrunk), overwrite.

**Distinguish Keep vs Approve vs Park vs Cancel:**
- Investigation confirms not-yet-done, still relevant, no superseding sibling, AND a competent agent can finish without asking human? → Keep.
- Investigation confirms it's real + relevant, but direction needs sanity-check? → Approve.
- Investigation inconclusive or genuinely on hold, revisit later, not cancelled? → Park (new).
- Investigation finds it's already implemented, no longer relevant, or duplicates/is-superseded-by an already-Cancelled/Done sibling? → Cancel.

## Status = Blocked

**Hard Gate audit:** Read most recent `author: danxbot` comment containing `## Blocked` / "operator must" section. For each "operator must" step, classify:
- **Locally executable** = edit config, `artisan`, `make`, `yarn`, `npm`, `composer`, log tail/grep, test re-run, restart Octane/queue/Horizon, session JSONL, git commands, code read.
- **Human-only** = ONLY: credential/secret rotation, deploy/SSM access, write-only repo, design/product decision, physical/OOB action (per `issue-card-workflow` "Hard Gate" table).

| Outcome | Action | MCP triage call | Terminal call |
|---|---|---|---|
| **Every step locally executable** — wrongly punted | **Demote** to ToDo | `issue_transition({action: "unblock"})` + `issue_triage({verdict: "keep", reason})` — server stamps `ready_at` + clears `blocked` | `danxbot_complete({status: "complete"})` |
| **At least one step genuinely human-only** | **Confirm** Blocked | `issue_triage({verdict: "keep", reason})` | `danxbot_complete({status: "complete"})` — triage recorded; card remains Blocked |
| **Mixed** (some local, some human-only) | Confirm, but note next worker dispatch should execute local steps before re-confirming | `issue_triage({verdict: "keep", reason})` noting local steps needed | `danxbot_complete({status: "complete"})` |

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

| Outcome | Action | MCP triage call | Terminal call |
|---|---|---|---|
| **Every blocker terminal** | **Unblock** (cleared) | `issue_transition({action: "unblock"})` + `issue_triage({verdict: "keep", reason})` | `danxbot_complete({status: "complete"})` — picker will dispatch next tick |
| **At least one blocker non-terminal** | **Confirm-Block** waiting | `issue_triage({verdict: "keep", reason})` | `danxbot_complete({status: "complete"})` — card remains Waiting On |

**Edge case — blocker not found.** If both `Read` calls fail for a blocker id, treat as **Cancelled** (non-existent card cannot block). Note in `last_explain`: "Blocker <PREFIX>-N not found — treated as Cancelled."

**TTLs per status:**
- Review: 24h
- Blocked: 3h (human checks fast)
- Waiting On: 1h (blockers may flip terminal any minute)

## Per-Decision Terminal-Status Table

Only `complete`, `ready`, `cancelled`, `archive` valid from triage.

| Triage decision | Terminal status | Server side-effect | Derived status |
|---|---|---|---|
| Keep | *(no transition — stays Review)* | server refreshes `triage_expires_at` only (re-triage TTL); `ready_at` untouched | `Review` (unchanged) |
| Approve | `ready` (after setting `requires_human`) | server stamps `ready_at`; picker stays parked until human clears `requires_human` | gated `ToDo` |
| Cancel | `cancelled` | server stamps `cancelled_at` + clears `dispatch` + renders `## Retro` | `Cancelled` |
| Park | `archive` | server stamps `archived_at` + clears `ready_at` | `Backlog` |
| Demote | `ready` | server stamps `ready_at` + clears `blocked` | `ToDo` |
| Confirm-Block | `complete` | triage recorded; card status unchanged | unchanged |
| Unblock | `complete` | server clears `waiting_on: null` (same) | unchanged |
