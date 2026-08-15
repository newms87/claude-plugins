# Triage Paths & Decision Trees

Triage agent triages ONE card per dispatch. Path is decided by `waiting_on` + `blocked` FIRST, then `status_derived` — `blocked` is a gate that can sit on top of ANY status, it is NOT itself a status value (`status_derived` never reads `blocked_at`, see "Status = Blocked" below).

| Card state | Path |
|---|---|
| `waiting_on != null` (any status) | **Waiting On** — re-check `waiting_on.by[]` |
| `waiting_on == null` AND `blocked != null` AND `blocked.reason` starts with `"Triage: "` | **Out of scope** — a confidence-gate checkpoint stamped by the Review-path routing below; a human clears it via the dashboard |
| `waiting_on == null` AND `blocked != null` (any other reason) | **Blocked** — Hard Gate audit |
| `waiting_on == null` AND `blocked == null` AND `status_derived === "Review"` | **Review** — Confidence-score |

Out-of-scope: `waiting_on == null` AND `blocked == null` AND `status_derived ∈ {ToDo, In Progress, Done, Cancelled}` (dispatchable/active/terminal cards don't need triage). On any out-of-scope match (including the `"Triage: "`-prefixed Blocked case above): make no `issue_triage`/`issue_transition` call, `danxbot_complete({status: "complete", summary: "out of scope: <reason>"})`, stop.

## Status = Review

### Investigation Gate (MANDATORY, before scoring)

Real investigation, not a description re-read. Every one of these four checks runs before you assign a confidence score — this is the load-bearing step; a score reached without it is not a valid triage.

1. **Already implemented?** Identify the concrete files/functions/routes the card's description or AC names or clearly implies. `Grep`/`Read` them. If the described behavior already exists in the current code — fully or substantially — that is a specific, evidenced doubt (score 0-2 depending on how completely it's already covered), however well-written the card is. Cite the file:line that proves it either way.
2. **Still relevant?** Re-check the premise against the CURRENT architecture, not the architecture the card was written against. `git log`/`git blame` the relevant area if the card references something that may have since changed direction. A card can be internally coherent and still describe a world that no longer exists (an inverted decision, a retired subsystem, a superseding redesign already shipped).
3. **Duplicate or already-decided sibling?** Search for a same/near-identical-title card (`mcp__danx-dashboard__issue_list({q: "<distinctive phrase from the title>"})`), including `-IMPORTED` / `-IMPORTED-2`-style variant ids of the same underlying card. If a sibling covering the same ground is already `Cancelled` or `Done`, that disposition almost always transfers — score this one the same way and say why in `reason`, unless you find concrete evidence the sibling's disposition does NOT apply here.
4. **Conforms to the Master Plan?** Read `.claude/rules/danx-master-plan.md` (force-loaded rule, always in context for triage dispatches — no extra call). Where the index references deeper content, `Read`/`Grep` the matching `.claude/master-plan/<slug>.md` page(s) on demand. Does the card fit something the plan describes? A card the plan is simply silent on is NOT itself a doubt — only an ACTUAL conflict with the plan (the plan describes a different direction, or explicitly excludes this) counts as evidence against.

A card that passes all four (not implemented, still relevant, no superseding sibling, conforms to or is unaddressed by the Master Plan) earns the default score of 5. A card that fails any one of them, with cited evidence, is scored below 5 — the lower the score, the more conclusive and evidenced the doubt (see Confidence Rubric in SKILL.md).

**Ordering check (MANDATORY, separate from the four above — run before scoring):** If this card should not be worked before a sibling/prerequisite card completes, do NOT encode that via a mid-range confidence score hoping the card "sits and gets revisited" — confidence bands below Approve now BLOCK the card (`blocked_at` stamped) for a HUMAN to clear via the dashboard, they are not a scheduling mechanism, and they carry zero ordering guarantee against a sibling. Instead check `issue_get`'s edges for an existing `depends_on` on the prerequisite; if missing, add it now via `issue_dependency({id, action:'add', kind:'depends_on', target_id: <prerequisite>})` BEFORE scoring. Once the edge exists, the card is safe to score high (or low, on its own merits) — `waiting_on` holds the picker off regardless of triage confidence or status.

**Validate `effort_level`:** read `.claude/rules/danx-effort-policy.md`; compute level matching description scope; if unset or mismatched (scope grew/shrunk), overwrite. Do this regardless of what score you land on — it is bookkeeping on the card, not part of the confidence decision.

**If you expect an Approve-band score:** call `mcp__danx-dashboard__issue_requires_human({set: true, reason, steps[]})` BEFORE `issue_triage`, same as before — every Approve still needs a human sign-off before the card is picked up for autonomous work, independent of how the score was computed. If the server's actual routing lands somewhere else (e.g. your 5 nonetheless resolves to Keep under a board's stricter thresholds), the `requires_human` flag on a non-`ToDo` card is inert — harmless, not wrong.

## Status = Blocked

**Hard Gate audit (unchanged):** Read most recent `author: danxbot` comment containing `## Blocked` / "operator must" section. For each "operator must" step, classify:
- **Locally executable** = edit config, `artisan`, `make`, `yarn`, `npm`, `composer`, log tail/grep, test re-run, restart Octane/queue/Horizon, session JSONL, git commands, code read.
- **Human-only** = ONLY: credential/secret rotation, deploy/SSM access, write-only repo, design/product decision, physical/OOB action (per `issue-card-workflow` "Hard Gate" table).

There is no confidence question here — a Hard Gate audit is a mechanical classification of escalation steps, not a value judgment on the card, so it does NOT call `issue_triage`. Only the transition, if any, changes the card.

| Outcome | Action | Terminal call |
|---|---|---|
| **Every step locally executable** — wrongly punted | **Demote**: `issue_transition({action: "unblock"})` — clears `blocked_at`/`blocked_reason`, card reverts to whatever status it held before the block (its own `ready_at`/etc. are untouched by `unblock`) | `danxbot_complete({status: "complete"})` |
| **At least one step genuinely human-only** | **Confirm**: leave the block exactly as-is (no MCP mutation) | `danxbot_complete({status: "complete"})` — triage recorded in the comment only; card remains Blocked |
| **Mixed** (some local, some human-only) | Confirm (as above), but note in the comment that the next worker dispatch should execute the local steps before re-confirming | `danxbot_complete({status: "complete"})` |

**Rationalisation detector — refuse to Confirm if the escalation comment contains any of:**
- "operator-driven verification"
- "production-shaped infra"
- "honest way to verify"
- "intermittent — needs more samples"
- "needs to be tested in production / staging"

If found, Demote instead.

## Status = Waiting On

**Re-check `waiting_on.by[]`.** For each blocker id:
- Query the v2 DB via `mcp__danx-dashboard__issue_get({id: "<PREFIX>-N"})`.
- Note its derived `status`. Terminal = `Done` or `Cancelled`. Non-terminal = anything else.

As with Blocked, this is a mechanical re-check of dependency state, not a value judgment — it does NOT call `issue_triage`.

| Outcome | Action | Terminal call |
|---|---|---|
| **Every blocker terminal** | **Unblock**: `issue_transition({action: "unblock"})` | `danxbot_complete({status: "complete"})` — picker will dispatch next tick |
| **At least one blocker non-terminal** | **Confirm-Block**: leave as-is (no MCP mutation) | `danxbot_complete({status: "complete"})` — card remains Waiting On |

**Edge case — blocker not found.** If `issue_get` fails for a blocker id, treat as **Cancelled** (non-existent card cannot block). Note in the comment: "Blocker <PREFIX>-N not found — treated as Cancelled."

## Terminal-Call Summary

| Path | Decision | MCP call(s) | `danxbot_complete` |
|---|---|---|---|
| Review | (any) | `issue_triage({id, confidence, reason})` — read `body.issue.triage_last_status` for the outcome the server picked | `{status: "complete"}` always |
| Blocked | Demote | `issue_transition({action: "unblock"})` | `{status: "complete"}` |
| Blocked | Confirm-Block | none | `{status: "complete"}` |
| Waiting On | Unblock | `issue_transition({action: "unblock"})` | `{status: "complete"}` |
| Waiting On | Confirm-Block | none | `{status: "complete"}` |
| Out of scope | — | none | `{status: "complete", summary: "out of scope: <reason>"}` |
| Dispatch itself failed (unreadable card, MCP error, no decision reached) | — | — | `{status: "failed"}` (real ≥30-char reason) |

`danxbot_complete` is ALWAYS `status: "complete"` on a successful triage run, regardless of outcome — DX-835 already moves the card via the MCP call(s) above; `danxbot_complete` only reports whether the dispatch itself succeeded. Using `"ready"`/`"cancelled"`/`"archive"` here (pre-DX-835 contract) makes the worker stamp the DISPATCH row `failed`, poisoning the auto-triage breaker's failure count for a run that actually succeeded (DX-1810).
