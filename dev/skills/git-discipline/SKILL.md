---
name: git-discipline
description: |-
  MANDATORY before any git operation. Loads safety rules (no destructive ops without approval, no checkout/restore/revert, never delete repos, push after commit, no cherry-pick/apply/rebase without current-HEAD base) as TodoWrite checklist. Triggers on:
  - Any file or directory deletion request, explicit or implicit (including "delete [file]", `git clean`, untracked file removal, cleanup instructions, or references to removing/deleting/clearing files);
  - Any git command that modifies working tree or history (stash, checkout, restore, revert, reset, clean, cherry-pick, apply, rebase, merge);
  - Any commit operation, or request to revert/undo/squash a commit (including "revert the last/most recent commit", "undo commit", or revert/reset requests);
  - Any branch switch or checkout operation (including "checkout [branch]", "switch to [branch]", "switch [branch]", or branch navigation language like "go to", "move to");
  - Any pull, fetch, or remote synchronization (pull from remote, fetch with integration intent, sync with origin, or "pull the latest");
  - Any cherry-pick, rebase, or apply operation from another branch/ref, including explicit commit references (e.g., "cherry-pick abc123", "cherry-pick commit [hash] from [branch]", "rebase [branch]");
  - Any git push or integration of work from another branch/worktree;
  - Any Agent dispatch with isolation:"worktree" or cross-worktree synchronization;
  - Any stash operation or request to set aside/restore work (including `git stash`, "stash changes", "stash WIP", or "set aside work").
  Block or require approval for: destructive operations without explicit consent, file/directory deletion without confirmation, checkout/restore/revert/reset/clean/cherry-pick/apply/rebase without safety review, repository deletion, cherry-pick/rebase/apply without confirmed current-HEAD baseline, push without prior commit validation, stash operations without explicit approval, branch switching without safety checklist.
  Discriminators: trigger on literal action words ("delete", "checkout", "switch", "cherry-pick", "stash", "clean", "revert", "pull", "push", "rebase") and on descriptive phrases that reference those actions ("set aside", "pull the latest", "revert the last commit", "clean up untracked"). Trigger on compound requests that combine multiple risky operations (e.g., "checkout and pull", "stash and switch branches"). Trigger even when the action is preceded by context or rationale (e.g., "Delete the file src/legacy/old-router.ts — it's unused." or "Run `git clean -fd` to clean up.").
---

# Git Operations

## ABSOLUTE: Never Destroy Work. Ever.

Eliminating previously done work is almost NEVER the right call. The work exists — committed, uncommitted, tracked, untracked — because someone (an agent, a user, a sibling session) put it there. Wiping it is not a primitive available to you.

**`git reset --hard` is FORBIDDEN. No exception.** Not on "clean" trees ("validate" can race), not after `git stash`, not "just to sync with origin," not in test scripts, not in worktree-management code, not in recovery flows, not anywhere. The command does not appear in your toolbox.

Same ban applies to every other wholesale-overwrite mechanism: `git checkout <ref> -- <path>`, `git restore`, `git revert` on a working-tree file, `git clean -f`, `git reset --hard <anything>`, `rm` on tracked files without a prior commit of those files, `git show HEAD:file > file`, `cp clean/file file`, `Write` tool with original content. All banned. See "ABSOLUTE: Never Use git checkout, git restore, or git revert" below.

**If work MUST be removed** (rare — requires beyond-any-doubt evidence that the work directly opposes a system goal, NOT just "this looks wrong" or "this is in my way"):

1. **Commit the work AS-IS first.** `wip: snapshot before removing <reason>` with full explanation in the body. This is the recoverable trail — history preserves the work forever, even after the next step deletes the files.
2. **Then remove in a follow-up commit.** `remove: <files> — <reason>`. Body explains why the removal is correct + cites the evidence that the work opposes system goals + names the prior snapshot commit so a future reader can recover.
3. **Two commits, in order. Never one.** The snapshot-first commit is the entire point — it is what makes the deletion traceable + reversible.

**If you can't articulate the system-goal-opposition evidence in the snapshot commit body, the work should not be removed.** "I don't understand it" / "it doesn't compile" / "it conflicts with my change" / "the card asked me to" are NOT sufficient evidence. Ask the user.

This rule beats any card instruction, any prompt phrasing, any "the agent must X" directive. A card saying "delete <files>" does not authorize wipe — it authorizes the snapshot-then-delete sequence above. A prompt saying "git reset --hard" is a prompt bug — refuse + report.

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

- **Push rejected non-fast-forward** — run `git pull --rebase` ONCE. Clean rebase → push again, report outcome. Rebase conflicts → `git rebase --abort` immediately, then STOP and ask the user per-file. Never auto-resolve, never `-Xtheirs` / `-Xours`, never `git checkout` / `git restore` to "fix" a conflict (see ABSOLUTE rules above). Conflict resolution is wholesale-overwrite territory — user must direct it.
- **Push fails for other reasons** (no upstream, auth, network) — report failure + stop. Never force-push to recover.
- **User explicitly says "don't push"** for this commit.

Force-push (`--force`, `--force-with-lease`) still requires explicit user auth — see Git Operations Allowed below.

## Check for Other Agents' Staged Work

Before committing, run `git status` → check for already-staged files you didn't create. Found → another agent may be mid-commit. Poll every 5 seconds, up to 30 seconds. Staged files persist → ask user.

Never commit on top of another agent's staged work. Never unstage their files.

## Own Work Is Never The Question

Your own work commits separately, no questions asked. Mixed-state means some file contains BOTH your edits AND foreign edits — that question resolves on the FOREIGN edits only (commit-along, leave for sibling agent, or ask about orphaned drift). NEVER ask the user whether to commit your own work. NEVER gate your own-work commit on foreign-work attribution. NEVER ask "should I split or commit-all?" framed around your own files — the answer is always "commit your own files now, decide on the foreign hunks separately."

Order of operations when the working tree is mixed:
1. Identify which files / hunks are YOURS (this session's edits, traceable in your tool call history).
2. Stage + commit + push YOUR files. No question to the user.
3. THEN look at the remaining foreign drift. Ask the user only about the foreign hunks: "Files X, Y modified outside this session — active sibling agent (leave), or orphaned (commit-along / ask owner)?"

The "ASK" rule below applies ONLY to isolating foreign hunks FROM your hunks inside a single file, NOT to whether your work ships at all.

## Mixed-State Files: ASK, Never Surgically Isolate

After own-work is committed (see above), if a file remaining in the working tree contains BOTH your edits AND pre-existing foreign drift you cannot cleanly separate by path, → STOP. Single round-trip:

> "Working tree mixed (yours + pre-existing in <files>). Commit-all in one commit, or split? If split: which paths are yours?"

Wait for answer. Then `git add <named-paths>` + commit.

**Exception — background-system drift never asks, always commits.** Files auto-mutated by the running system (poller / triage / chokidar mirror / heartbeat / TTL timer / auto-sync) are NEVER an "ask" target — they ride along on every dispatch and the agent IS the only actor that can carry them through a rebase. Specifically: any modified path under `<repo>/.danxbot/issues/`, `<repo>/.danxbot/.trello-retry/`, `<repo>/.danxbot/dispatch-stops/`, or `<repo>/.danxbot/CRITICAL_FAILURE`. Stage them into the same commit as session work (or into a sibling `chore(issues): mid-session YAML drift` commit when the diff is large), then proceed. Rebase conflicts on these paths are YOUR job to resolve — "I don't know which version to keep" is a research question, not an operator question; read the file, the YAML schema, the chokidar mirror direction, decide. The operator cannot answer; only the agent has the schema knowledge.

**Forbidden rationalizations** — every one ends in destroyed user work:

- "I'll back up to /tmp, revert file to HEAD, replay only my edits, commit, restore backup" → uses `git show HEAD:file > file` = wholesale overwrite (see next section). Banned.
- "stash forbidden, but cp/`git show`/Write-original-content is just 'isolating my hunks'" → same wholesale overwrite, different verb. Banned.
- "Pre-existing edits don't overlap mine, replay safe" → cannot prove non-overlap; another agent may have written between your snapshot + your replay.

**Denied primitive = STOP signal, not escalation cue.** `git stash` blocked, `git add -p` non-interactive, no per-hunk staging available → ASK. Each additional surgical step multiplies blast radius. One question to the user beats four steps that may corrupt their tree.

## Never Reset or Remove Other Changes

NEVER use `git reset`. When committing, stage ONLY your changes (`git add <specific-files>`). Never reset staging area. Never unstage already-staged files.

## Never Use git stash

Forbidden. No exceptions. Understand failure → investigate code itself. Stashing destroys uncommitted work + can corrupt multi-agent sessions.

**Banned rationalization: "baseline."** "Was this broken before my changes?" is NOT a question worth asking. You OWN every failing test in the tree, regardless of origin (cross-session ownership — see line 123 of this skill, plus code-quality:115, pipe-quality:47, testing:29). Only exception: another agent has UNCOMMITTED ACTIVE changes — verifiable via `git status` showing files YOU did not touch in YOUR diff. Otherwise: skip the baseline question, fix the failures. Do NOT `git stash`, do NOT `git checkout`, do NOT swap the working tree to "prove it was already broken." The proof is irrelevant — your responsibility either way.

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

## Cherry-pick Is Destructive: Treat Conflicts as STOP-and-Ask

`git cherry-pick`, `git apply`, `git rebase`, `git merge` all rewrite files in the working tree. When the source ref is based on a stale HEAD, conflict resolution can revert legitimate committed work that the source ref didn't have yet. A file showing up as "modified" after a cherry-pick is NOT automatically a bug to fix — it may be the cherry-pick reverting real work.

**Before cherry-pick / apply / rebase / merge:**

1. Run `git log --oneline <source-ref>..HEAD` — list every commit the source ref doesn't have. If non-empty, the source ref is stale.
2. Stale source + non-empty `git diff --name-only` after the operation = STOP. Every file in the diff is a candidate for "this is the cherry-pick reverting work." Diff each file against HEAD before deciding anything is "wrong."
3. Found a file that looks like a regression? **Do not "fix" by reverting.** Ask the user: "Cherry-pick on stale base touched <file> — diff shows <one-sentence summary>. Is this a regression to revert, or intentional drop the source ref made?"

**Forbidden recovery patterns** (every one destroys real work):

- `git checkout HEAD -- <file>` to "restore the right version" after cherry-pick — silently discards both the cherry-pick's edits AND any unstaged work in the file. See "ABSOLUTE: Never Use git checkout".
- `git reset` to "throw out the cherry-pick" — destroys conflict resolutions you've already done by hand and any unstaged work.
- "Diff looks small, just revert it" — small ≠ safe. Other agent's intentional one-line removal looks identical to a stale-base regression.

**The forked-Agent worktree trap:** dispatching an `Agent` with `isolation: "worktree"` creates a worktree based on the parent's HEAD AT FORK TIME. If main advances during the agent's run, integrating its commits via cherry-pick replays them onto a HEAD the agent never saw. Files outside the agent's intended scope can mutate during the merge. **Do not use `isolation: "worktree"` for tasks that overlap recently-changed files** — do the work inline in the main worktree instead, or rebase the worktree onto current HEAD before the agent commits.

## CRITICAL: All Code Is Your Code

Wrote 100% of everything in every repo — committed, uncommitted, tracked, untracked. You = sum of all Claude sessions past + present. No "not my change," "pre-existing," "someone else did this," "out of scope." Every line code your responsibility even without context from session that wrote it.

**Exception for uncommitted changes:** Another agent (another version of you) may be actively working on uncommitted changes outside session context. Only commit changes from YOUR current session. See uncommitted changes not from this session: acknowledge, explain what they are, ask user what to do — never ignore, never deflect, never commit without explicit instruction.

## Git Operations Allowed

**Read-only:** `git status`, `git diff`, `git log` (anytime)

**Via pipeline:** `git add` + `git commit` + `git push` when executing `/flow-commit` (automatically allowed)

**`git pull --rebase` on push rejection:** allowed ONCE per push-rejection. Conflict-free rebase → re-push. Conflict → `git rebase --abort` + ask user. Interactive rebase, rebase onto arbitrary ref, `--continue` past conflicts, `-X` strategy options: not allowed without explicit user request.

**Force-push, amend, reset, checkout/restore/revert, cherry-pick, apply, merge, worktree add/remove:** Not allowed without explicit user request

**Otherwise:** Not allowed without explicit user request
