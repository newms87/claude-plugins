---
name: unblock
description: 'MANDATORY when working on, picking up, or about to touch any issue card whose status is `Needs Help` or `blocked != null`, OR when explicitly invoked via `/unblock <ISS-N>`. Triggers — `mcp__danx-issue__danx_issue_get` returns `status: Needs Help` or non-null `blocked`; reading a card from `.danxbot/issues/open/` whose status is Needs Help; user says "unblock", "get unstuck", "what does this card need", "fix the blocker on", "operator action for"; about to start phase work that overlaps with a Needs Help card (same parent epic, same files, same AC scope). Loads the unblock-report contract — extract blocker, summarize what is done vs what operator must do, give exact commands, define the success/failure branch — so the human gets one terse actionable report instead of a re-investigation.'
---

# Unblock Skill

Purpose: turn a `Needs Help` (or `blocked`) card into a one-screen operator playbook. Never re-litigate the bug. Never re-plan the fix. The card's last `comments[]` entry from the agent is authoritative — your job is to extract + present it.

## When to invoke

Auto-trigger any of:

1. About to read/work a card whose YAML has `status: Needs Help` OR `blocked != null`.
2. About to start a card that **overlaps** a `Needs Help` card (same parent epic, same files in `key files`, same AC scope, same domain). Block on the upstream card first — your work may be invalidated by its resolution.
3. User explicitly types `/unblock <ISS-N>` or asks "what's needed to unblock X", "get X unstuck", "operator action on X".

Do NOT invoke when: card is `ToDo`/`InProgress`/`Done`/`Cancelled` AND not blocked.

## Procedure

1. **Load the card.** `mcp__danx-issue__danx_issue_get` with the issue id. If user gave a vague ask ("unstick the urgent one"), call `mcp__danx-issue__danx_issue_list` filtered by `status: Needs Help`, then pick by priority signals — Bug type > Feature; production-impact phrases ("storm", "outage", "stuck", "401", "5xx") > stretch goals; oldest `updated_at` first if priority ties.

2. **Find the authoritative "Needs Help" comment.** Scan `comments[]` from newest to oldest. The last `author: danxbot` comment containing a "Needs Help" / "Operator action" / "What's still needed" section is the contract. If absent, fall back to card description + open AC items.

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

   Human-only = ONLY: credential / secret rotation, deploy access, write-only repo, design decision, physical/OOB action (per `issue-card-workflow` "Hard Gate" table).

   Mixed (some local, some human-only) → write the playbook only for the human-only steps; execute the local steps yourself first, then surface only what remains.

   **Demote procedure:**
   - Set `status: "In Progress"`.
   - Append a comment naming the misclassification: which steps were local-runnable, what you ran, what the outcome was.
   - Do the work.
   - Update AC + close per normal `issue-card-workflow`.
   - Skip steps 4–5 of this skill.

4. **Extract four fields:**
   - **Blocker (1 sentence):** what state the card is in + why it cannot self-progress.
   - **Done:** commits shipped, ACs already `checked: true`, tests added.
   - **Operator must do:** numbered steps. Each step ≤2 lines. Include exact commands (env vars, artisan/make/yarn invocations, file paths, log greps).
   - **Outcome branches:** what success looks like, what failure looks like, what to report back. Always two branches — never single-path.

5. **Output format (this exact shape, no deviation) — ONLY if step 3 found genuine human-only blockers:**

   ```
   # <ISS-N> — <one-line title>

   **Status:** <what shipped, what's pending, commit refs if any>
   **Blocker:** <one sentence>

   ## What you do

   1. <step + exact command>
   2. <step + exact command>
   ...

   ## Outcomes

   - **<success branch>** → <what to tell agent / what agent does next>
   - **<failure branch>** → <what to capture / what to paste back>
   ```

6. **Stop.** Do not start fixing. Do not edit the card's YAML. Do not change AC checks. The skill ends with the report. Operator runs the steps and reports back; only then does the agent resume work on the card (re-invoking `issue-card-workflow` for the AC update).

## Overlap detection (rule #2)

Before picking up any new card, run:

```
mcp__danx-issue__danx_issue_list  status="Needs Help"
```

For each Needs Help card, check whether your target card shares any of:
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

## Boundary with `issue-card-workflow`

`issue-card-workflow` = full lifecycle (create / save / move / retro / phase cards). `unblock` = read-only summary of one stuck card. They compose: invoke `unblock` to produce the report; later, when operator confirms outcome, invoke `issue-card-workflow` to update AC + close.
