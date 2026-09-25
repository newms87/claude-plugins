---
name: unblock
description: 'Unblock-report contract: extract blocker, what is done vs what operator must do, exact commands, success/failure branch.'
---

# Unblock Skill

Purpose: turn a `Blocked` card (or one with non-null `waiting_on`) into a one-screen operator playbook. Never re-litigate the bug. Never re-plan the fix. The card's last `comments[]` entry from the agent is what you RELAY — extract + present it, don't re-investigate it.

**Relayed ≠ verified.** Another agent's comment is a lead, never a finding (canon principle 2). Attribute it in the report — "the agent reports X" — never assert it as fact in your own voice. If a step the operator is about to run is IRREVERSIBLE (deploy, destructive command, data change, credential rotation), that step's premise must be verified against real evidence before you present it as safe to run; if you could not verify it, say so in the step.

## Vocabulary

- **`blocked: {at, reason}`** — a hold (`issue_transition({action:'block', reason})`, derives status `Blocked` via rule 3). Never itself puts the card in front of a human. Cleared via `unblock`; answering a problem never clears it.
- **Open problem** — the only way a card reaches a human (`open_problem_count > 0`, computed automatically). Read via `issue_get({id, fields:["problems"]})`; each carries its own `solutions[]`; the count drops to zero once the last open one is answered/removed.
- **`waiting_on: {reason, timestamp, by[]}`** — dep-chain dispatch gate independent of `status`; picker skips dispatch until every id in `by[]` terminal-finishes; durable, never auto-cleared.

This skill covers both cases: derived `Blocked` (can an agent resolve it, or does a human genuinely have to act?) and `waiting_on` (what is the card queued behind?).

## When to invoke

Auto-trigger any of:

1. About to read/work a card whose record has `status: Blocked` OR `waiting_on != null`.
2. About to start a card that **overlaps** a `Blocked` card (same parent epic, same files in `key files`, same AC scope, same domain). Block on the upstream card first — your work may be invalidated by its resolution.
3. User explicitly types `/unblock <ISS-N>` or asks "what's needed to unblock X", "get X unstuck", "operator action on X".

Do NOT invoke when: card is `ToDo`/`InProgress`/`Done`/`Cancelled` AND has `waiting_on: null` AND `status !== "Blocked"`.

## Procedure

1. **Load the card.** Call `mcp__danx-dashboard__issue_get({id})`. If user gave a vague ask ("unstick the urgent one"), call `mcp__danx-dashboard__issue_list({filter: {status_derived: ['Blocked']}})`, then pick by priority signals — Bug type > Feature; production-impact phrases ("storm", "outage", "stuck", "401", "5xx") > stretch goals; oldest timestamp first if priority ties.

2. **Find the blocker comment to relay.** Scan `comments[]` from newest to oldest. The last comment containing a "Blocked" / "Operator action" / "What's still needed" section is what you relay — as the agent's claim, attributed, not as your own finding. If absent, fall back to card description + `blocked.reason` + open AC items.

3. **MISCLASSIFICATION AUDIT — run before writing the report.** Inspect every "operator must do" step against the canonical classification in `danx-triage-card/references/triage-paths.md`, "Hard Gate — Locally-Executable vs Human-Only". If EVERY step is locally executable, the card was wrongly punted. Demote it + execute yourself, do NOT produce a playbook.

   Mixed (some local, some human-only) → write the playbook only for the human-only steps; execute the local steps yourself first, then surface only what remains.

   **Human-only steps on a card with no open problem** → the operator has never seen them: a blocked card does not reach a human on its own. Say so in the report's **Blocker** line. The escalation the card is missing is `issue_problem` add (the human-only step as the statement, options as solutions, one recommended).

   **Demote procedure:**
   - Call `issue_transition({id, action: 'unblock'})` to clear the block. The server derives status away from `Blocked` once `blocked.at` is null.
   - Append a comment via `issue_comment` naming the misclassification: which steps were local-runnable, what you ran, what the outcome was.
   - Do the work.
   - Update AC + close per normal `issue-card-workflow` via appropriate MCP calls.
   - Skip steps 4–5 of this skill.

4. **Extract four fields:**
   - **Blocker (1 sentence):** what state the card is in + why it cannot self-progress. Attributed ("the agent reports …") unless you verified it yourself.
   - **Done:** commits shipped, ACs already `checked: true`, tests added.
   - **Operator must do:** numbered steps. Each step ≤2 lines. Include exact commands (env vars, artisan/make/yarn invocations, file paths, log greps).
   - **Outcome branches:** what success looks like, what failure looks like, what to report back. Always two branches — never single-path.

5. **Output format — `base:convey` scaffold, instantiated for unblock reports** (this exact shape, no deviation) — ONLY if step 3 found genuine human-only blockers:

   ```
   ## <ISS-N> — <one-line title> (≤12 words)

   **Goal.** <one sentence — what the operator needs to do, plain English>

   **Status.**
   | Shipped | Pending | Commits |
   |---|---|---|
   | <what's done> | <what's left> | <sha refs if any> |

   **Blocker.** <one sentence — exactly why the agent cannot self-progress>

   **What you do.**
   1. <step + exact command>
   2. <step + exact command>

   **Outcomes.**
   - ✅ **<success branch>** → <what to tell agent / what agent does next>
   - ❌ **<failure branch>** → <what to capture / what to paste back>
   ```

   Unblock budget under convey: **≤20 lines.** Convey owns the structure (headline + goal + tables); this skill owns the unblock-specific section names (Status / Blocker / What you do / Outcomes).

6. **Stop.** Do not start fixing. Do not edit the card. Do not change AC checks. The skill ends with the report. Operator runs the steps and reports back; only then does the agent resume work on the card (re-invoking `issue-card-workflow` for the AC update).

## Overlap detection (rule #2)

Before picking up any new card, call `mcp__danx-dashboard__issue_list({filter: {status_derived: ['Blocked']}})`.

For each Blocked card, check whether your target card shares any of:
- `parent_id` (same epic)
- domain keywords in title (Schema Builder / Template / AgentDispatch / Workflow)
- files in the description's "Key files" section

Overlap found → invoke `unblock` on the upstream card FIRST and surface the dependency to the user before starting the new work. Do not silently proceed past a relevant blocker.

## Anti-patterns

| Wrong | Right |
|---|---|
| Re-investigate the bug from source, or assert the agent's comment as fact in your own voice | Relay the agent's last comment ATTRIBUTED as its claim; verify only the premise of a step the operator will act on irreversibly |
| Propose a different fix | Card already chose a fix; report what's needed to verify it |
| Edit the card's AC checks during the report | AC moves only after operator reports back |
| Single-path "do these steps and you're done" | Always two outcome branches |
| Verbose narrative | Bullets + commands; no prose paragraphs in the report |
| Skip the operator-action section because "obvious" | Operator did not read the card; spell it out |
| Stamp `blocked.at` without `blocked.reason` (or vice versa) | Both fields move together — `deriveStatus` reads `blocked.at`, the operator reads `blocked.reason` |

## Boundary with `issue-card-workflow`

`issue-card-workflow` = full lifecycle (create / save / move / retro / phase cards). `unblock` = read-only summary of one stuck card. They compose: invoke `unblock` to produce the report; later, when operator confirms outcome, invoke `issue-card-workflow` to update AC + close.

## Blocked Gate (Pre-Write Check)

Before calling `issue_transition({id, action: 'block', reason})` on any card: this is the symmetric write-side check to the Misclassification Audit above — run the same Hard Gate classification before stamping `blocked`, not after. A card that fails it should never have been marked `Blocked` in the first place — fix the work, not the status. See `danx-next/references/step-procedures.md` Step 10 for the full procedure.
