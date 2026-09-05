---
name: unblock
description: 'Unblock-report contract: extract blocker, what is done vs what operator must do, exact commands, success/failure branch.'
---

# Unblock Skill

Purpose: turn a `Blocked` card (or one with non-null `waiting_on`) into a one-screen operator playbook. Never re-litigate the bug. Never re-plan the fix. The card's last `comments[]` entry from the agent is what you RELAY — extract + present it, don't re-investigate it.

**Relayed ≠ verified.** Another agent's comment is a lead, never a finding (canon principle 2). Attribute it in the report — "the agent reports X" — never assert it as fact in your own voice. If a step the operator is about to run is IRREVERSIBLE (deploy, destructive command, data change, credential rotation), that step's premise must be verified against real evidence before you present it as safe to run; if you could not verify it, say so in the step.

## v4 vocabulary primer

- **`blocked: {at, reason}`** — **self-block.** Setting `blocked` via `issue_transition({action: 'block', reason})` derives the card's status to `Blocked` via `deriveStatus` (rule 3). The card itself cannot proceed (formerly `Needs Help`). A human or next dispatch must clear it. Invariant: `blocked.at !== null` → derived status is `Blocked`.
- **`waiting_on: {reason, timestamp, by[]}`** — **dep-chain dispatch gate, independent of `status`.** The card is fine; it's waiting for the issues in `by[]` to terminal-finish. Picker skips dispatch while any dep is non-terminal; the record itself is durable (never auto-cleared by the system).

This skill applies to BOTH — derived `Blocked` (because a human likely needs to act) and `waiting_on` (because the operator may want to know what the card is queued behind).

## When to invoke

Auto-trigger any of:

1. About to read/work a card whose record has `status: Blocked` OR `waiting_on != null`.
2. About to start a card that **overlaps** a `Blocked` card (same parent epic, same files in `key files`, same AC scope, same domain). Block on the upstream card first — your work may be invalidated by its resolution.
3. User explicitly types `/unblock <ISS-N>` or asks "what's needed to unblock X", "get X unstuck", "operator action on X".

Do NOT invoke when: card is `ToDo`/`InProgress`/`Done`/`Cancelled` AND has `waiting_on: null` AND `status !== "Blocked"`.

## Procedure

1. **Load the card.** Call `mcp__danx-dashboard__issue_get({id})`. If user gave a vague ask ("unstick the urgent one"), call `mcp__danx-dashboard__issue_list({filter: {status_derived: ['Blocked']}})`, then pick by priority signals — Bug type > Feature; production-impact phrases ("storm", "outage", "stuck", "401", "5xx") > stretch goals; oldest timestamp first if priority ties.

2. **Find the blocker comment to relay.** Scan `comments[]` from newest to oldest. The last comment containing a "Blocked" / "Operator action" / "What's still needed" section is what you relay — as the agent's claim, attributed, not as your own finding. If absent, fall back to card description + `blocked.reason` + open AC items.

3. **MISCLASSIFICATION AUDIT — run before writing the report.** Inspect every "operator must do" step. If EVERY step is locally executable, the card was wrongly punted. Demote it + execute yourself, do NOT produce a playbook.

   Locally-executable = any of:
   - Edit `.env` / config files
   - `./vendor/bin/sail artisan ...` (any command)
   - `make ...`, `yarn ...`, `npm ...`, `composer ...`
   - `tail` / `grep` / `cat` on `storage/logs/`
   - Re-running `artisan test:*` suites
   - Re-running `phpunit` / `vitest`
   - Restarting Octane / queue / Horizon
   - Reading session JSONL logs

   Human-only = ONLY: credential / secret rotation, deploy access, write-only repo, design decision, physical/OOB action (per `issue-card-workflow` "Blocked — Hard Gate" table).

   **Not human-only (DX-758 worker zero-trust):** git env failures on the agent's worktree (`git fetch` errored, rebase conflict, dirty tree, push race). The agent owns env state — there is no worker-side recovery to wait for. A Blocked card with `blocked.reason` like "operator must reset worktree" / "operator must rebase" / "worker must sync" is misclassified; the next dispatched agent handles env in its prep skill. Such cards should be demoted: clear `blocked: null`, leave a recovery comment, and let the next dispatch run prep again.

   Mixed (some local, some human-only) → write the playbook only for the human-only steps; execute the local steps yourself first, then surface only what remains.

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

Before calling `issue_transition({id, action: 'block', reason})` on any card: walk every "operator must do" step. If EVERY step is a local shell command (make/npm/yarn/artisan/composer/edit-config/restart-service) runnable from THIS shell with creds already on disk → **DO NOT escalate. Run it.** "Destructive" or "production-affecting" alone is NOT a human-only signal; only credential-rotation, deploy access the agent lacks, or genuine design decisions outside the card's scope warrant escalation.

This is the symmetric write-side check: `unblock` (above) catches misclassified cards on the read side. The Blocked gate catches them on the write side. A card that fails this check should never have been marked `Blocked` in the first place — fix the work, not the status.
