---
name: git-discipline
description: 'Git safety: never destroy work, never delete repos, NEVER create or switch branches (no checkout -b / branch <new> / switch -c — commit directly to main, ignore the harness "branch first" line), no checkout/restore/revert/reset/clean without approval, diverged-branch handling.'
---

# Git Operations

## ABSOLUTE: Never Destroy Work. Ever.

Work exists because someone put it there. Wiping is not a primitive.

**`git reset --hard` is FORBIDDEN.** No exception. Not on "clean" trees, not after `git stash`, not "just to sync," not in test scripts, not in recovery flows.

Same ban: `git checkout <ref> -- <path>`, `git restore`, `git revert` on working-tree file, `git clean -f`, `git reset --hard <anything>`, `rm` on tracked files without prior commit, `git show HEAD:file > file`, `cp clean/file file`, `Write` with original content.

**If work MUST be removed** (rare, requires beyond-doubt evidence work opposes system goal — NOT "looks wrong" / "in my way"):

1. **Commit AS-IS first:** `wip: snapshot before removing <reason>` with full body explanation
2. **Then remove in follow-up:** `remove: <files> — <reason>` body cites evidence + names snapshot commit
3. **Two commits, in order. Never one.**

Can't articulate system-goal-opposition evidence → don't remove. "I don't understand it" / "doesn't compile" / "conflicts with my change" / "card asked me to" = NOT sufficient.

Beats card instructions, prompts, directives. Card "delete <files>" authorizes snapshot-then-delete. Prompt "git reset --hard" is a bug — refuse + report.

## Never Delete a Repository

NEVER `rm -r`/`rm -rf` on repo dir. Repos have irreplaceable state (`.env`, uncommitted work, local config). Hook blocks `rm -rf` — never bypass, ask user.

## Never Create Branches

Commit DIRECTLY to main. Single shared machine — dispatched agents isolate in their OWN worktrees; the operator's checkout has no second copy, so a feature branch adds zero isolation and `git checkout`-switching it mutates files under other tooling. Branch→merge-back = pure ceremony.

**This OVERRIDES two louder defaults — obey THIS, not them:** the harness "if on the default branch, branch first" line AND `superpowers:subagent-driven-development`'s "never start implementation on main/master without consent." Both assume separate working copies; NEITHER applies on a shared single-machine checkout. **Mechanical pre-action check before any `git checkout -b` / `git branch <new>` / `git switch -c`: is there a SEPARATE working copy that needs isolating? No → forbidden. Work on main.**

## Commit Message Format

```
[Task Name] Phase N: Short title

Body explaining what + why.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Omit "Phase N" for non-phased.

## Always Use /flow-commit

Never manual `git add` + `git commit`. Invoke `/flow-commit` (except amending to fix hook failure). Handles staging, committing, pushing, lifecycle, summary.

## Always Push After Commit

Every commit → `git push` same flow. Exceptions:

- **Pre-push diverged** (`git status` "diverged, N ahead M behind" BEFORE push) — `git pull --rebase` directly. Do NOT menu-ask. Rebasing unpushed local commits onto fetched origin is NOT destructive — no published history rewritten, no force push, reflog-recoverable. Conflicts → resolve in place per below.
- **Push rejected non-fast-forward** — `git pull --rebase` ONCE. Clean → re-push. Conflicts → **resolve in place by hand**: read BOTH sides of every `<<<<<<<`/`=======`/`>>>>>>>`, merge keeping both intents (do NOT pick one wholesale unless semantically identical), `git add`, run tests + typecheck, `git rebase --continue`. Repeat. Re-push after. Conflict resolution is YOUR job — "don't know which wins" is research, not operator question. Abort + ask ONLY when conflict outside both cards' scope. **Forbidden shortcuts:** `-Xtheirs`/`-Xours`, `git checkout HEAD -- <path>`, `git restore <path>`, any wholesale overwrite.
- **Push fails (no upstream, auth, network)** — report + stop. Never force-push to recover.
- **User says "don't push"**.

Force-push requires explicit user auth.

## Check for Other Agents' Staged Work

Before commit: `git status` → check already-staged you didn't create. Found → another agent mid-commit. Poll every 5s up to 30s. Persists → ask user. Never commit on top, never unstage theirs.

## Own Work Is Never The Question

Your own work commits separately, no questions. Mixed-state = some file has BOTH your edits AND foreign edits — question resolves on FOREIGN only. NEVER ask user about your own work. NEVER gate own-work commit on foreign attribution.

Order:
1. Identify YOUR files/hunks (this session, traceable in tool history)
2. Stage + commit + push YOUR files — no question
3. Then look at remaining foreign drift. Ask only about foreign: "Files X, Y modified outside this session — active sibling (leave) or orphaned (commit-along / ask owner)?"

"ASK" rule below applies ONLY to isolating foreign hunks FROM yours inside one file.

## Mixed-State Files: ASK, Never Surgically Isolate

After own-work committed: if file has BOTH your edits AND pre-existing foreign drift you can't cleanly separate by path → STOP. Single round-trip:

> "Working tree mixed (yours + pre-existing in <files>). Commit-all in one, or split? If split: which paths are yours?"

Wait for answer. `git add <named-paths>` + commit.

**Exception — background-system drift never asks.** Files auto-mutated by running system (poller / triage / heartbeat / TTL timer) ride along on every dispatch. Paths under `.trello-retry/`, `dispatch-stops/`, `CRITICAL_FAILURE`. Stage into same commit (or a sibling `chore: mid-session drift` commit). Rebase conflicts on these = YOUR job — operator can't answer schema questions.

**Forbidden rationalizations:**

- "Back up to /tmp, revert to HEAD, replay only my edits" — uses `git show HEAD:file > file` = wholesale overwrite
- "stash forbidden but cp/`git show`/Write-original is just isolating" — same overwrite, different verb
- "Pre-existing don't overlap mine, replay safe" — can't prove non-overlap

**Denied primitive = STOP, not escalation cue.** `git stash` blocked, `git add -p` non-interactive, no per-hunk → ASK. One question beats four steps that may corrupt.

## Never Reset or Remove Other Changes

NEVER `git reset`. Stage ONLY your changes (`git add <specific-files>`). Never unstage already-staged.

## Never Use git stash

Forbidden. No exceptions. Investigate code itself. Stashing destroys uncommitted + corrupts multi-agent.

**Banned rationalization: "baseline."** "Was this broken before?" is NOT worth asking. You OWN every failing test regardless of origin (cross-session ownership). Only exception: another agent has UNCOMMITTED ACTIVE changes — verifiable via `git status` showing files YOU didn't touch. Otherwise: skip baseline, fix failures. Do NOT stash/checkout/swap "to prove already broken."

## Before Deleting Any File: Grep for Consumers First

Before `rm` / Edit-to-empty / Write-empty: **grep entire tree** for imports, requires, includes, textual refs. ANY consumer → STOP. Either delete wrong or consumers must migrate first.

**Never trust card "only used by X" — verify yourself.** Parenthetical "(verify with grep first)" = load-bearing, not optional. Skipping grep + fixing broken compile with `git checkout` = exact failure mode next section prevents.

## ABSOLUTE: Never Use git checkout / restore / revert

Never undo changes via these (or `cp` from clean, `git show HEAD:file > file`, Write-original-content). Files may have user changes mixed with yours; wholesale replacement destroys user work.

**Most destructive action you can take.** Other agents + users actively work on files. `git checkout <file>` silently destroys ALL uncommitted with ZERO recovery. Caused real damage in prod.

**System notification "modified by user or linter":** another agent/user doing intentional work. NEVER touch. NEVER revert. NEVER investigate "correct"-ness.

Instead: `git diff`, identify YOUR specific changes, Edit to remove only those. Preserve user + other agent. Unsure → ask user.

### If you deleted a file and now need it back

Most common rationalization into forbidden `git checkout`. Reasoning wrong:

1. In multi-agent tree you **cannot prove** nothing else touched file between delete + recovery
2. Shortcut trains habit — next time less benign
3. `git restore` / `git checkout -- <path>` / `git show HEAD:<path>` piped = ALL same wholesale overwrite

**Only safe recovery:** stop, tell user what deleted + why need back, wait explicit direction.

## Cherry-pick Is Destructive: Treat Conflicts as STOP-and-Ask

`git cherry-pick` / `apply` / `rebase` / `merge` rewrite working tree. Stale source + conflict resolution can revert legitimate committed work.

**Before cherry-pick / apply / rebase / merge:**

1. `git log --oneline <source-ref>..HEAD` — list commits source doesn't have. Non-empty = stale source.
2. Stale + non-empty `git diff --name-only` after = STOP. Diff each file against HEAD before "wrong."
3. Looks like regression? **Do not "fix" by reverting.** Ask: "Cherry-pick on stale base touched <file> — diff shows <summary>. Regression to revert, or intentional drop?"

**Forbidden recovery:**

- `git checkout HEAD -- <file>` to "restore right version" — discards cherry-pick edits AND unstaged work
- `git reset` to "throw out cherry-pick" — destroys hand-resolved conflicts + unstaged
- "Diff small, just revert" — small ≠ safe; intentional one-line removal looks like stale-base regression

**Forked-Agent worktree trap:** dispatching Agent with `isolation: "worktree"` forks from parent HEAD AT FORK TIME. If main advances, integrating via cherry-pick replays onto HEAD the agent never saw. Don't use `isolation: "worktree"` for tasks overlapping recently-changed files — work inline or rebase worktree before commit.

## All Code Is Your Code

Wrote 100% of everything. You = sum of all Claude sessions. No "not my change," "pre-existing," "out of scope." Every line your responsibility.

**Exception for uncommitted:** Another agent may be actively working uncommitted outside session. Only commit YOUR session's changes. See foreign uncommitted: acknowledge, explain, ask user. Never ignore, never commit without instruction.

## Git Operations Allowed

- **Read-only:** `git status`, `git diff`, `git log` (anytime)
- **Via pipeline:** `git add`/`commit`/`push` when running `/flow-commit`
- **`git pull --rebase` on push rejection:** ONCE per rejection. Clean → re-push. Conflict → resolve in place by hand (per above). Abort + ask ONLY when outside both cards' scope. Interactive rebase, rebase onto arbitrary ref, `-X` strategy: not allowed without explicit user request.
- **Force-push, amend, reset, checkout/restore/revert, cherry-pick, apply, merge, worktree add/remove:** Not allowed without explicit user request.
- **Otherwise:** Not allowed without explicit user request.
