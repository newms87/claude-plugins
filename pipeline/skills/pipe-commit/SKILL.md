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

0. **Dispatched worker (`DANXBOT_DISPATCH_ID` set)** — do not use this skill; `agent-finalize.sh` owns the terminal merge (CP4/DX-944).
1. Run `git status` and `git diff --name-only` in parallel to identify changed files
2. **Check for other agents' staged work** — see `dev:git-discipline` "Check for Other Agents' Staged Work"; not restated here.
3. Output a summary table (`File | Type | Description`, one row per changed file — use ✏️ M / ➕ A / 🗑️ D so a reviewer can spot an accidental deletion) and the **Overview** (see format below)
4. Commit with the safe single-command form — `git commit -- <file1> <file2> ... -m "..."` — never a separate `git add` (shared-index hazard: see `dev:git-discipline`)
5. **Push to remote** immediately after the commit succeeds — part of every commit, not optional. Push-failure / rejection handling → `dev:git-discipline`; not restated here.
6. Show commit and push result
7. **Sync the issue card** (if an issue card is assigned to the session) — see Issue Sync below

**Everything happens in one continuous response. Stage, commit, and push are always a single sequence.**

---

## Overview Format

Follow `base:convey` for the commit body. Budget **≤8 lines**:

- **Headline** (1 line, ≤12 words) — what now works/changes.
- **Behavior diff** (table, optional) — before/after axis when the change has a clear state delta.
- **Why** — 1 sentence, only if non-obvious from the headline.

Drop "What I did" / past-tense narration. Drop file paths — `git show --stat` already lists them.

---

## Issue Sync

**Only runs if an issue card (`<PREFIX>-N`) is assigned to the session.** If no card, skip this entirely.

Card state lives in the dashboard DB. `danxbot:issue-card-workflow`'s "Manual-session finalization" section owns the AC-checklist / quality-gate-verdict / retro / lifecycle-transition mechanics (checklist → gates → complete → retro) — not restated here; that is also the only place `issue_transition complete` gets called. Two artifacts below are pipe-commit's own, triggered by the commit event itself:

1. **Append a commit comment** — `mcp__danx-dashboard__issue_comment({id, action: 'add', text})`:
   ```markdown
   ## Phase N Commit

   **Commit:** <sha>
   **Completed:** [list of checklist items this commit satisfies]
   ```

2. **Update parent epic** (phase cards only, i.e. `parent_id` is non-null) — right after this commit, append a Phase Handoff comment to the epic (`mcp__danx-dashboard__issue_comment({id: <parent-id>, action: 'add', text})`) — the bridge between agents when context is destroyed:
   ```markdown
   ## Phase N Handoff

   **Built:** <what was implemented, commit SHA>
   **Discoveries:** <bugs found, assumptions invalidated, new constraints affecting remaining phases>
   **Corrections:** <description / phase-card edits made; or "none">
   **Next-agent context:** <reusable helpers + paths, gotchas, dependencies>
   ```
   Everything else about phase/epic mechanics (child linkage, epic AC checkoff, the "Notes from Phase N" handoff to the next phase card, epic completion) is owned by `danxbot:issue-card-workflow`'s `references/phases-epics.md`; not restated here.

**Do not transition the card to Done from this skill.** Completion is driven entirely by `danxbot:issue-card-workflow`'s "Manual-session finalization" sequence, only once ALL work is done.

---

## Continue the Pipeline

**After issue sync, immediately invoke `/pipe-finish` (mode A — post-commit report).** The pipeline is automatic — do not pause, do not wait for user input, do not treat the commit as the end of the workflow. The commit is step 4 of 5. `/pipe-finish` mode A is step 5: emits the `base:convey`-format post-commit report and re-invokes `pipe-start` for the next phase (or recurses into mode B at session end).

---

## Rules

- **NEVER include unrelated files** - Only commit files from your session work
- **NEVER skip the summary table** - Users need to see what's being committed
- **ALWAYS push to remote** after every successful commit — this is the default, not an exception
- **NEVER skip pre-commit hooks**
- **ALWAYS use HEREDOC** for commit messages to preserve formatting
- **Use imperative mood**: "Add feature" not "Added feature"
- **Keep summary under 70 characters**
- **Destructive git ops** (force-push, `--amend`) + push-failure recovery — see `dev:git-discipline`; not restated here.
- **Card-state invariants** (status literals, Retro comments, Trello tools) — see `danxbot:issue-card-workflow` General Rules; not restated here.
