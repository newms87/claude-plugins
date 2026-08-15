---
name: pipe-commit
description: 'Stage and commit changes with summary table.'
---

# Commit Workflow

`/pipe-commit` IS the confirmation. Never ask "Ready to commit?" — just do it. Never gate on pipe-review / pipe-quality having run.

---

## Order of Operations

Commit + push FIRST. Code review AFTER as a separate commit. Why: durability, reviewers see pushed code, diff history shows cost per round. Commit-on-instruction is unconditional.

---

## Steps

1. Run `git status` and `git diff --name-only` in parallel to identify changed files
2. **Check for other agents' staged work** — if `git status` shows staged files that are NOT yours, another agent may be mid-commit. Poll `git status` every 5 seconds up to 30 seconds. If the staged files clear (committed by the other agent), proceed. If they persist after 30 seconds, ask the user.
3. Output the **Summary Table** and **Overview** (see format below)
4. Run a single chained command: `git add <file1> <file2> ... && git commit -m "..."`
5. **Push to remote** — run `git push` immediately after the commit succeeds. Push is part of every commit, not an optional follow-up. If push fails (rejected, no upstream, network), report the failure and stop — do NOT force-push, do NOT retry blindly, do NOT amend.
6. Show commit and push result
7. **Sync the issue card** (if an issue card is assigned to the session) — see Issue Sync below

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

Follow `base:convey` for the commit body. Budget **≤8 lines**:

- **Headline** (1 line, ≤12 words) — what now works/changes.
- **Behavior diff** (table, optional) — before/after axis when the change has a clear state delta.
- **Why** — 1 sentence, only if non-obvious from the headline.

Drop "What I did" / past-tense narration. Drop file paths — `git show --stat` already lists them.

---

## Issue Sync

**Only runs if an issue card (`<PREFIX>-N`) is assigned to the session.** If no card, skip this entirely.

The card lives in the dashboard DB — there is NO YAML file. Every "sync" action below is an `mcp__danx-dashboard__issue_*` tool call; those tools write the DB directly (it IS the store — no mirror, no file event, no save verb to call after). Read current card state with `mcp__danx-dashboard__issue_get({id})`. Lifecycle (status) changes go through `issue_transition`; prose / AC changes through `issue_edit`; comments through `issue_comment`; retro through `issue_retro`. Agents touch card state ONLY through these tools — never via `Edit`/`Write`/`Read` of any file. Match `danxbot:issue-card-workflow` terminology.

After every commit:

1. **Check off completed AC items** — For each `ac[i]` that this commit satisfies, set its `checked: true` and call `mcp__danx-dashboard__issue_edit({id, ac})` with the full updated `ac[]` array. Match by exact `title` text. Phases are child cards, NOT an in-card checklist — to mark a phase done, complete its child card (step 4).

2. **Append a commit comment** — Call `mcp__danx-dashboard__issue_comment({id, action: 'add', text})`. The server stamps author + timestamp. Body:
   ```markdown
   ## Phase N Commit

   **Commit:** <sha>
   **Completed:** [list of checklist items checked off]
   ```

3. **Drive card lifecycle** based on current state:
   - Still has remaining phases or unchecked AC → leave the card In Progress (no transition call).
   - All phases done, all acceptance criteria met → fill the retro via `mcp__danx-dashboard__issue_retro` (see step 5 below), THEN call `mcp__danx-dashboard__issue_transition({id, action: 'complete', summary})`. The server stamps `completed_at`, recomputes `status_derived` to `Done`, and auto-renders ONE `## Retro` comment. Do NOT write `status: "Done"` via `issue_edit` — `complete` is the only path.
   - Never complete the card prematurely — only when ALL work is done.

**Do NOT transition to Done just because a commit happened.** The card moves to Done only when every acceptance criteria item is checked off and every phase child card is complete.

4. **Update parent epic** (phase cards only) — If the card's `parent_id` is non-null (or the title contains `>` for phase-card pattern like `Epic > Phase N`):

   **a. Read the epic:** `mcp__danx-dashboard__issue_get({id: <parent-id>})`.

   **b. Check off epic AC:** The phase is reflected as done automatically once this session's child card is completed (step 3) — the epic has no per-phase status array to check off; phase-done derives from the child card's own status. Set `ac[i].checked: true` for any epic-level AC items this phase satisfies and persist via `mcp__danx-dashboard__issue_edit({id: <parent-id>, ac})` — epic AC items map to specific phases and must be marked complete as the work is verified, not deferred until the epic is fully done.

   **c. Append a Phase Handoff comment** to the epic via `mcp__danx-dashboard__issue_comment({id: <parent-id>, action: 'add', text})`. This is the bridge between agents — it ensures no knowledge is lost when context is destroyed. Body:
   ```markdown
   ## Phase N Handoff

   **Built:** <what was implemented, commit SHA>
   **Discoveries:** <bugs found, assumptions invalidated, new constraints affecting remaining phases>
   **Corrections:** <description / phase-card edits made; or "none">
   **Next-agent context:** <reusable helpers + paths, gotchas, dependencies>
   ```

   **d. Re-read the epic description and remaining phase cards.** If anything is wrong, outdated, or missing context from what you learned during this phase, update it now via `mcp__danx-dashboard__issue_edit({id, description})` (the epic; or the sibling phase child cards by their ids). The epic must always be zero-context ready for the next agent.

   **e.** (No separate persist step — `issue_edit` / `issue_comment` already wrote the DB.)

   **f. Update the next phase card.** Read each child id from the epic's `children[]` (`mcp__danx-dashboard__issue_get`) until you find the next phase still in `ToDo` / `In Progress` with unchecked work. Then call `mcp__danx-dashboard__issue_comment({id: <next-child-id>, action: 'add', text})` to append a "Notes from Phase N" entry covering anything that could cause the next agent to waste time or make mistakes: discovered constraints, timing gotchas, reusable helpers and their paths, cost/budget observations, dependencies between phases. The next agent has ZERO context — it reads only the card's description and comments.

   **g. Check if epic is complete.** If every phase child card is complete AND every epic `ac[i].checked: true`, fill the epic's retro via `mcp__danx-dashboard__issue_retro` (step 5) and call `mcp__danx-dashboard__issue_transition({id: <parent-id>, action: 'complete', summary})`. Do not leave the epic In Progress or ToDo when all phases are Done.

5. **Filling `retro` on terminal** (Done / Cancelled / Blocked). Call `mcp__danx-dashboard__issue_retro({id, good, bad, action_item_ids, commits})` BEFORE the terminal `issue_transition`. The server auto-renders the `## Retro` comment. Fields:

   - `good`: short bullets — what worked.
   - `bad`: short bullets — what didn't.
   - `action_item_ids`: a `string[]` of valid `<PREFIX>-N` card ids (LAST RESORT — create the card first via `issue_create`, then push its id here). Apply the "fix it yourself" filter before adding any id — most retros should have empty `action_item_ids: []`.
   - `commits`: list of commit SHAs from this card's lifecycle (owned-repo only).

   Do NOT manually append a `## Retro` comment via `issue_comment` — `issue_retro` renders it.

6. **Spawning unrelated discovery cards mid-card** (rare — use only when you find something genuinely OUTSIDE the current card's scope that is too large to fix in-session). Call `mcp__danx-dashboard__issue_create({type, title, description, ac?, ...})`. The tool allocates `<PREFIX>-N` in the DB and returns `{ok: true, body: {id, ...}}` or `{ok: false, body: {error, ...}}`. To reference it from this card's retro, push its id into `action_item_ids[]` (step 5).

---

## Continue the Pipeline

**After issue sync, immediately invoke `/pipe-finish` (mode A — post-commit report).** The pipeline is automatic — do not pause, do not wait for user input, do not treat the commit as the end of the workflow. The commit is step 4 of 5. `/pipe-finish` mode A is step 5: emits the `base:convey`-format post-commit report and invokes `/next-phase` (or recurses into mode B at session end).

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
- **NEVER write `status:` literals** via `issue_edit` — lifecycle moves go through `issue_transition({action})` only; the server derives `status`
- **NEVER manually post `## Retro` comments** — `issue_retro({good, bad, action_item_ids, commits})` drives the rendered comment
- **NEVER call `mcp__trello__*` tools from agent path** — the danxbot worker is the sole writer to the backend tracker; the agent path is `mcp__danx-dashboard__issue_*` only
