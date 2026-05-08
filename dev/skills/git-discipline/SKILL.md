---
name: git-discipline
description: 'MANDATORY before any git operation. Loads safety rules (no destructive ops without approval, no checkout/restore/revert, never delete repos, push after commit) as TodoWrite checklist. Triggers — about to run git stash/checkout/restore/revert/reset/clean; about to commit; about to delete files.'
---

# Git Operations

## CRITICAL: Never Delete a Repository

NEVER run `rm -r`, `rm -rf`, or ANY deletion command on repo directory. Repos contain irreplaceable local state: `.env` files with credentials, uncommitted work, local config. Deleting permanent — re-cloning doesn't recover gitignored files or session work.

Hook blocks `rm -rf` → hook correct. Never bypass with alternative commands. Ask user instead.

## Never Create Branches

Commit directly to main. Other agents share working tree. Branches disrupt their work + pointless overhead when committing to main.

## Commit Message Format

```
[Task Name] Phase N: Short title

Body explaining what changed and why.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Omit "Phase N" for non-phased work.

## Always Use /flow-commit

Never manually run `git add` + `git commit`. Always invoke `/flow-commit` via Skill tool (except amending previous commit to fix hook failure). `/flow-commit` handles staging, committing, pushing, Trello lifecycle, summary output. Manual commits bypass all of this.

## Always Push After Commit

Every commit followed by `git push` in same flow. Push not optional + not gated on separate user request — `/flow-commit` runs automatically. Only exceptions:

- **Push fails** (rejected, no upstream, network) — report failure + stop. Never force-push to recover.
- **User explicitly says "don't push"** for this commit.

Force-push (`--force`, `--force-with-lease`) still requires explicit user auth — see Git Operations Allowed below.

## Check for Other Agents' Staged Work

Before committing, run `git status` → check for already-staged files you didn't create. Found → another agent may be mid-commit. Poll every 5 seconds, up to 30 seconds. Staged files persist → ask user.

Never commit on top of another agent's staged work. Never unstage their files.

## Mixed-State Files: ASK, Never Surgically Isolate

`git status` shows file modified that contains BOTH your edits AND pre-existing uncommitted drift → STOP. Single round-trip:

> "Working tree mixed (yours + pre-existing in <files>). Commit-all in one commit, or split? If split: which paths are yours?"

Wait for answer. Then `git add <named-paths>` + commit.

**Forbidden rationalizations** — every one ends in destroyed user work:

- "I'll back up to /tmp, revert file to HEAD, replay only my edits, commit, restore backup" → uses `git show HEAD:file > file` = wholesale overwrite (see next section). Banned.
- "stash forbidden, but cp/`git show`/Write-original-content is just 'isolating my hunks'" → same wholesale overwrite, different verb. Banned.
- "Pre-existing edits don't overlap mine, replay safe" → cannot prove non-overlap; another agent may have written between your snapshot + your replay.

**Denied primitive = STOP signal, not escalation cue.** `git stash` blocked, `git add -p` non-interactive, no per-hunk staging available → ASK. Each additional surgical step multiplies blast radius. One question to the user beats four steps that may corrupt their tree.

## Never Reset or Remove Other Changes

NEVER use `git reset`. When committing, stage ONLY your changes (`git add <specific-files>`). Never reset staging area. Never unstage already-staged files.

## Never Use git stash

Forbidden. No exceptions. Understand failure → investigate code itself. Stashing destroys uncommitted work + can corrupt multi-agent sessions.

## Before Deleting Any File: Grep for Consumers First

Before running `rm`, Edit-to-empty, Write-empty-string, any file removal: **grep entire source tree** for imports, requires, includes, textual references to file. ANY consumer exists → STOP — either delete wrong, or consumers must migrate first.

**Never trust card description or prior agent's note claiming "only used by X" — verify yourself.** Parenthetical "(verify with grep first)" on delete card = load-bearing, not optional. Skipping grep + fixing broken compile with `git checkout` = exact failure mode next section prevents.

Cost of grep: few seconds. Cost of unverified delete that breaks consumer: either forbidden `git checkout` recovery (silently destroys whatever else touched file between delete + recovery) or broken tree user has to clean up.

## ABSOLUTE: Never Use git checkout, git restore, or git revert

NEVER use these to undo changes. Includes `cp` from clean source, `git show HEAD:file > file`, Write tool with original content — any mechanism that overwrites file wholesale. Files may contain user changes mixed with yours; wholesale replacement destroys user work.

**Single most destructive action you can take.** Other agents + users actively working on files in repo. `git checkout <file>` silently destroys ALL their uncommitted work in file with ZERO recovery. Other agent won't know work destroyed. Caused real damage in production sessions.

**When system notifications say file "modified by the user or a linter":** Another agent or user doing intentional work. NEVER touch file. NEVER revert. NEVER investigate whether changes "correct." Assume mission-critical work must not be interrupted.

Instead: Run `git diff`, identify YOUR specific changes, use Edit to remove only those. Preserve all user + other agent changes. Unsure what's yours → ask user.

### If you deleted a file and now need it back

**Most common rationalization path into forbidden `git checkout`.** Reasoning: "Just deleted file, nothing else could have touched it, restoring from HEAD harmless." Reasoning wrong:

1. In multi-agent working tree you **cannot prove** nothing else touched file between delete + recovery. Another agent may have created new version, or renamed it into place, in window between `rm` + `git checkout`.
2. Even if nothing else touched, shortcut trains habit. Next time reach for `git checkout` to recover, situation less benign + same shortcut.
3. `git restore` and `git checkout -- <path>` and `git show HEAD:<path>` piped to file = ALL same action from this rule's perspective — wholesale overwrite. Rule not about command name; about overwrite.

**Only safe recovery:** stop, tell user what deleted + why need back, wait explicit direction. Don't run any recovery command without user's action verb.

## CRITICAL: All Code Is Your Code

Wrote 100% of everything in every repo — committed, uncommitted, tracked, untracked. You = sum of all Claude sessions past + present. No "not my change," "pre-existing," "someone else did this," "out of scope." Every line code your responsibility even without context from session that wrote it.

**Exception for uncommitted changes:** Another agent (another version of you) may be actively working on uncommitted changes outside session context. Only commit changes from YOUR current session. See uncommitted changes not from this session: acknowledge, explain what they are, ask user what to do — never ignore, never deflect, never commit without explicit instruction.

## Git Operations Allowed

**Read-only:** `git status`, `git diff`, `git log` (anytime)

**Via pipeline:** `git add` + `git commit` + `git push` when executing `/flow-commit` (automatically allowed)

**Force-push, amend, rebase, reset, checkout/restore/revert:** Not allowed without explicit user request

**Otherwise:** Not allowed without explicit user request
