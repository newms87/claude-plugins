---
name: pipe-commit
description: 'Stage and commit changes with a summary table.'
---

# Commit Workflow

`/pipe-commit` IS the confirmation. Never ask "Ready to commit?" — just do it.

---

## Step 0 — Pipeline Preflight (MANDATORY)

Before any other action, verify in the CURRENT phase's turn window:

1. `/pipe-review` (or the `pipe-review` skill) was invoked AND every finding was addressed (fixes committed/staged, or explicitly classified out-of-scope/rationalization-rejected).
2. `/pipe-quality` was invoked.

**If either is missing, ABORT with this exact text and stop:**

```
Phase pipeline incomplete. Missing: [code-review | quality-check].
Run those before /pipe-commit.
```

Then wait for the user. Do NOT stage, do NOT commit, do NOT proceed to Step 1.

**This gate applies even under `/danx-start`, `/danx-next`, or any "all phases pre-approved" mode.** Pre-approval covers RUNNING the pipeline, not skipping it.

**Single legitimate bypass:** the user passes `--skip-pipeline` in `/pipe-commit`'s arguments AND the commit body explains why (emergency hotfix, revert, doc-only typo, etc.). Without both, never bypass.

**Detection mechanism:** scan the recent conversation turns for explicit invocations of `pipe-review` / `pipe-quality` skills (their `Skill` tool calls or `<command-name>` markers) within the current phase boundary. The phase boundary is the most recent `/pipe-start`, `/next-phase`, or session start, whichever is later. Honor-system self-attestation is ALSO required — if you can't quote a specific tool call or marker, the gate is missing.

The point of this step is to invert the cost: skipping the pipeline must be MORE work (arguing with this gate, getting `--skip-pipeline` user-auth) than following it.

---

## Steps

1. Run `git status` and `git diff --name-only` in parallel to identify changed files
2. **Check for other agents' staged work** — if `git status` shows staged files that are NOT yours, another agent may be mid-commit. Poll `git status` every 5 seconds up to 30 seconds. If the staged files clear (committed by the other agent), proceed. If they persist after 30 seconds, ask the user.
3. Output the **Summary Table** and **Overview** (see format below)
4. Run a single chained command: `git add <file1> <file2> ... && git commit -m "..."`
5. **Push to remote** — run `git push` immediately after the commit succeeds. Push is part of every commit, not an optional follow-up. If push fails (rejected, no upstream, network), report the failure and stop — do NOT force-push, do NOT retry blindly, do NOT amend.
6. Show commit and push result
7. **Update issue YAML** (if an issue card is assigned to the session) — see Issue Sync below

**Everything happens in one continuous response. Stage, commit, and push are always a single sequence.**

---

## Summary Table Format

**Output as actual markdown (not in a code block):**

| File | Type | Description |
|------|------|-------------|
| `path/to/file.php` | ✏️ M | Brief description |
| `path/to/new.ts` | ➕ A | Brief description |
| `path/to/old.vue` | 🗑️ D | Why removed |

## Overview Format

2-3 sentences covering:
- What feature/fix/refactor was implemented
- Why these changes were made

---

## Issue Sync

**Only runs if an issue card (`ISS-N`) is assigned to the session.** If no card, skip this entirely.

The session card lives at `<repo>/.danxbot/issues/open/<id>.yml`. Every "sync" action below is a direct YAML edit via `Edit` / `Write`. The chokidar watcher mirrors every file change to the DB on the file event, and the post-completion auto-sync pushes the YAML state to the tracker when the dispatch ends. There is no agent-facing save verb to call — agents edit the YAML in place and let the worker do the mirroring.

After every commit:

1. **Check off completed AC items** — For each `ac[i]` that this commit satisfies, edit the YAML and set `ac[i].checked: true`. Match by exact `title` text (the `check_item_id` may be empty for items added in this session — the worker assigns it on next poll). Same shape for `phases[i].status: Complete` and any Progress-style checklist tracked as `phases[]`. The chokidar watcher mirrors the edit to the DB on the file event.

2. **Append a commit comment** — Append a new entry to `comments[]` (NO `id` field — the worker assigns it on push):
   ```yaml
   - author: danxbot
     timestamp: "<ISO-8601 UTC, e.g. 2026-05-04T12:34:56Z>"
     text: |
       ## Phase N Commit

       **Commit:** <sha>
       **Completed:** [list of checklist items checked off]
   ```
   The chokidar watcher mirrors the edit to the DB.

3. **Update card status** based on current state:
   - Still has remaining phases or unchecked AC → leave `status: In Progress`
   - All phases done, all acceptance criteria met → set `status: Done` AND fill `retro.{good, bad, action_items, commits}` (see step 5 below). The worker auto-renders ONE `## Retro` comment, spawns one fresh issue per `retro.action_items[]` string, and moves the file `open/` → `closed/` on its next poll. Do NOT manually post a retro comment, do NOT manually create action-item issues, do NOT move the file yourself.
   - Never set `status: Done` prematurely — only when ALL work is complete.

   The chokidar watcher mirrors the edit to the DB; the post-completion auto-sync pushes the terminal status to the tracker when `danxbot_complete` fires.

**Do NOT set `status: Done` just because a commit happened.** The card moves to Done only when every acceptance criteria item and every progress/phase item is checked off / Complete.

4. **Update parent epic** (phase cards only) — If the card's `parent_id` is non-null (or the title contains `>` for phase-card pattern like `Epic > Phase N`):

   **a. Read the epic:** `mcp__danx-issue__danx_issue_get({id: "<parent-id>"})` — returns the epic YAML.

   **b. Check off epic items:** Edit the epic YAML — mark the completed phase on its `phases[]` (set the matching entry's `status: Complete`). Also set `ac[i].checked: true` for any epic-level AC items this phase satisfies — epic AC items map to specific phases and must be marked complete as the work is verified, not deferred until the epic is fully done.

   **c. Append a Phase Handoff comment** to the epic's `comments[]`. This is the bridge between agents — it ensures no knowledge is lost when context is destroyed. Structure:
   ```yaml
   - author: danxbot
     timestamp: "<ISO>"
     text: |
       ## Phase N Handoff

       **Built:** <what was implemented, commit SHA>
       **Discoveries:** <bugs found, assumptions invalidated, new constraints affecting remaining phases>
       **Corrections:** <description / phase-card edits made; or "none">
       **Next-agent context:** <reusable helpers + paths, gotchas, dependencies>
   ```

   **d. Re-read the epic description and remaining phase cards.** If anything is wrong, outdated, or missing context from what you learned during this phase, edit the YAML(s) now (`description` field on the epic; per-phase YAML for sibling phase cards). The epic must always be zero-context ready for the next agent.

   **e. Persist the epic edits.** The chokidar watcher mirrors the change to the DB on the file event; no save call needed.

   **f. Update the next phase card.** Read each child id from the epic's `children[]` until you find the next phase still in `ToDo` / `In Progress` with unchecked work. `mcp__danx-issue__danx_issue_get({id: "<next-iss-n>"})`, then Edit the next phase's YAML to append a "Notes from Phase N" entry to its `comments[]` covering anything that could cause the next agent to waste time or make mistakes: discovered constraints, timing gotchas, reusable helpers and their paths, cost/budget observations, dependencies between phases. The chokidar watcher mirrors the edit to the DB. The next agent has ZERO context — it reads only the YAML description and `comments[]`.

   **g. Check if epic is complete.** If every entry in the epic's `phases[]` is `status: Complete` AND every `ac[i].checked: true`, set the epic's `status: Done` and fill its `retro.*` (see step 5). Do not leave the epic In Progress or ToDo when all phases are Done. Edit the YAML directly — the post-completion auto-sync pushes terminal state to the tracker; the worker handles the retro comment + `open/` → `closed/` move on its next poll.

5. **Filling `retro` on terminal save** (Done / Cancelled / Blocked). The worker auto-renders the retro comment AND auto-spawns a fresh issue per `retro.action_items[]` entry on terminal save. So:

   - `retro.good`: short bullets — what worked.
   - `retro.bad`: short bullets — what didn't.
   - `retro.action_items`: a `string[]`. Each string becomes a NEW draft issue card on the worker's next poll — title-only, lands in the equivalent of "Action Items" / `ToDo`. Apply the Step 1.5 "fix it yourself" filter from `danx-issue` skill before adding any string here — most retros should have empty `action_items: []`. **`action_items[]` strings cannot contain `→` (rejected by tracker).**
   - `retro.commits`: list of commit SHAs from this card's lifecycle.

   Do NOT manually append a `## Retro` comment to `comments[]`. Do NOT manually create separate issue YAMLs for `retro.action_items[]` — the worker spawns them.

6. **Spawning unrelated discovery cards mid-card** (rare — use only when you find something genuinely OUTSIDE the current card's scope that is too large to fix in-session per Step 1.5). Two paths:

   **a. Inline via `retro.action_items[]`** (preferred, deferred to terminal save) — append the discovery as a single string to the current card's `retro.action_items[]`. The worker spawns it on terminal save.

   **b. Immediate spawn** — call `mcp__danx-issue__danx_issue_create({type, title, description, ac?, ...})`. The tool allocates `ISS-N`, builds the canonical YAML, pushes via `tracker.createCard`, and writes `<id>.yml`. Returns `{created: true, id: "ISS-N", path, external_id}` or `{created: false, errors: [...]}`. No draft YAML required.

---

## Continue the Pipeline

**After issue sync, immediately invoke `/pipe-report`.** The pipeline is automatic — do not pause, do not wait for user input, do not treat the commit as the end of the workflow. The commit is step 4 of 5. `/pipe-report` is step 5.

---

## Rules

- **NEVER use `git add .` or `git add -A`** - Always stage specific files by name
- **NEVER include unrelated files** - Only stage files from your session work
- **NEVER skip the summary table** - Users need to see what's being committed
- **ALWAYS push to remote** after every successful commit — this is the default, not an exception
- **NEVER force-push** (`--force`, `--force-with-lease`) unless explicitly asked
- **NEVER use `--amend`** unless explicitly asked
- **NEVER skip pre-commit hooks**
- **ALWAYS use HEREDOC** for commit messages to preserve formatting
- **Use imperative mood**: "Add feature" not "Added feature"
- **Keep summary under 70 characters**
- **NEVER manually move issue YAML files** between `open/` and `closed/` — terminal `status` triggers the worker move on its next poll
- **NEVER manually post `## Retro` comments** — `retro.{good, bad, action_items, commits}` fields drive the rendered comment + spawned action-item cards
- **NEVER call `mcp__trello__*` tools from agent path** — the danxbot worker is the sole writer to the backend tracker; the agent path is YAML + `mcp__danx-issue__*` only
