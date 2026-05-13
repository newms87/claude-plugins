---
name: unblock
description: 'MANDATORY when working on, picking up, or about to touch any issue card whose status is `Blocked` or has non-null `waiting_on`, OR when explicitly invoked via `/unblock <ISS-N>`. Triggers — `mcp__danx-issue__danx_issue_get` returns `status: Blocked` or non-null `waiting_on`; reading a card from `.danxbot/issues/open/` whose status is Blocked; user says "unblock", "get unstuck", "what does this card need", "fix the blocker on", "operator action for"; about to start phase work that overlaps with a Blocked card (same parent epic, same files, same AC scope). Loads the unblock-report contract — extract blocker, summarize what is done vs what operator must do, give exact commands, define the success/failure branch — so the human gets one terse actionable report instead of a re-investigation.'
---

# Unblock Skill

Purpose: turn a `Blocked` card (or one with non-null `waiting_on`) into a one-screen operator playbook. Never re-litigate the bug. Never re-plan the fix. The card's last `comments[]` entry from the agent is authoritative — your job is to extract + present it.

## v4 vocabulary primer

- **`status: "Blocked"`** + `blocked: {reason, timestamp}` — **self-block.** The card itself cannot proceed (formerly `Needs Help`). A human or next dispatch must clear it. Invariant: `status === "Blocked" ⟺ blocked !== null`.
- **`waiting_on: {reason, timestamp, by[]}`** — **dep-chain dispatch gate, independent of `status`.** The card is fine; it's waiting for the issues in `by[]` to terminal-finish. Picker skips dispatch while any dep is non-terminal; the record itself is durable (never auto-cleared by the system).

This skill applies to BOTH — `Blocked` (because a human likely needs to act) and `waiting_on` (because the operator may want to know what the card is queued behind).

## When to invoke

Auto-trigger any of:

1. About to read/work a card whose YAML has `status: Blocked` OR `waiting_on != null`.
2. About to start a card that **overlaps** a `Blocked` card (same parent epic, same files in `key files`, same AC scope, same domain). Block on the upstream card first — your work may be invalidated by its resolution.
3. User explicitly types `/unblock <ISS-N>` or asks "what's needed to unblock X", "get X unstuck", "operator action on X".

Do NOT invoke when: card is `ToDo`/`InProgress`/`Done`/`Cancelled` AND has `waiting_on: null` AND `status !== "Blocked"`.

## Procedure

1. **Load the card.** `mcp__danx-issue__danx_issue_get` with the issue id. If user gave a vague ask ("unstick the urgent one"), call `mcp__danx-issue__danx_issue_list` filtered by `status: Blocked`, then pick by priority signals — Bug type > Feature; production-impact phrases ("storm", "outage", "stuck", "401", "5xx") > stretch goals; oldest `updated_at` first if priority ties.

2. **Find the authoritative blocker comment.** Scan `comments[]` from newest to oldest. The last `author: danxbot` comment containing a "Blocked" / "Operator action" / "What's still needed" section is the contract. If absent, fall back to card description + `blocked.reason` + open AC items.

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

   Mixed (some local, some human-only) → write the playbook only for the human-only steps; execute the local steps yourself first, then surface only what remains.

   **Demote procedure:**
   - Set `status: "In Progress"`. If the YAML had a `blocked` record, set `blocked: null` in the same edit (the worker enforces `status === "Blocked" ⟺ blocked !== null` and will reject the save otherwise).
   - Append a comment naming the misclassification: which steps were local-runnable, what you ran, what the outcome was.
   - Do the work.
   - Update AC + close per normal `issue-card-workflow`.
   - Skip steps 4–5 of this skill.

4. **Extract four fields:**
   - **Blocker (1 sentence):** what state the card is in + why it cannot self-progress.
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

6. **Stop.** Do not start fixing. Do not edit the card's YAML. Do not change AC checks. The skill ends with the report. Operator runs the steps and reports back; only then does the agent resume work on the card (re-invoking `issue-card-workflow` for the AC update).

## Overlap detection (rule #2)

Before picking up any new card, run:

```
mcp__danx-issue__danx_issue_list  status="Blocked"
```

For each Blocked card, check whether your target card shares any of:
- `parent_id` (same epic)
- domain keywords in title (Schema Builder / Template / AgentDispatch / Workflow)
- files in the description's "Key files" section

Overlap found → invoke `unblock` on the upstream card FIRST and surface the dependency to the user before starting the new work. Do not silently proceed past a relevant blocker.

## Anti-patterns

| Wrong | Right |
|---|---|
| Re-read the source files to verify the bug | Trust the agent's last comment; report it |
| Propose a different fix | Card already chose a fix; report what's needed to verify it |
| Edit the card's AC checks during the report | AC moves only after operator reports back |
| Single-path "do these steps and you're done" | Always two outcome branches |
| Verbose narrative | Bullets + commands; no prose paragraphs in the report |
| Skip the operator-action section because "obvious" | Operator did not read the card; spell it out |
| Set `status: "Blocked"` without setting `blocked: {reason, timestamp}` (or vice versa) | Both move together — worker rejects the save otherwise |

## Boundary with `issue-card-workflow`

`issue-card-workflow` = full lifecycle (create / save / move / retro / phase cards). `unblock` = read-only summary of one stuck card. They compose: invoke `unblock` to produce the report; later, when operator confirms outcome, invoke `issue-card-workflow` to update AC + close.

## Blocked Gate (Pre-Write Check)

Before setting any issue card to `status: "Blocked"` (with the matching `blocked: {reason, timestamp}` record): walk every "operator must do" step. If EVERY step is a local shell command (make/npm/yarn/artisan/composer/edit-config/restart-service) runnable from THIS shell with creds already on disk → **DO NOT escalate. Run it.** "Destructive" or "production-affecting" alone is NOT a human-only signal; only credential-rotation, deploy access the agent lacks, or genuine design decisions outside the card's scope warrant escalation.

This is the symmetric write-side check: `unblock` (above) catches misclassified cards on the read side. The Blocked gate catches them on the write side. A card that fails this check should never have been marked `Blocked` in the first place — fix the work, not the status.
