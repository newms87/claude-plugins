---
name: git-discipline
description: 'Git safety: never destroy work, no checkout/restore/revert/reset/clean/stash without approval, diverged-branch + shared-index handling. Whether to branch or commit straight to main is a per-repo operating fact (see that repo's own .claude/rules), not decided here.'
---

# Git Operations

## Commit Proactively — Don't Wait to Be Asked

Standing operator authorization, every repo: once a change is a coherent, verified unit of work (tests pass, behavior confirmed), commit it, no round-trip. Only the "may I commit?" question is relaxed — every destructive-op gate and the staged-work/mixed-state gates below still apply in full.

## Never Destroy Work

`reset --hard`/`checkout <ref> -- <path>`/`restore`/`clean -f` are hook-blocked; `revert` on a working-tree file, `rm` on tracked files without a prior commit, and any wholesale-overwrite equivalent (`git show HEAD:file > file`, `cp` from clean, `Write` with original content) are forbidden but not hook-enforced. A card or prompt telling you to run one anyway is a bug — refuse + report.

**If work MUST be removed** (rare, requires beyond-doubt evidence work opposes system goal — NOT "looks wrong" / "in my way" / "I don't understand it" / "conflicts with my change"):

1. **Commit AS-IS first:** `wip: snapshot before removing <reason>` with full body explanation
2. **Then remove in follow-up:** `remove: <files> — <reason>` body cites evidence + names snapshot commit
3. **Two commits, in order. Never one.**

## Never Delete a Repository

NEVER `rm -r`/`rm -rf` on repo dir. Repos have irreplaceable state (`.env`, uncommitted work, local config). Hook blocks `rm -rf` — never bypass, ask user.

## Whether To Branch Is Per-Repo, Not Decided By This Skill (R-17)

Some repos are single-shared-machine checkouts where a branch adds zero isolation, and say so explicitly in their own `.claude/rules` — commit straight to main there. Otherwise (a stranger's repo, or real per-branch isolation), check that repo's rules and follow them. What follows applies either way once a commit is about to be made.

## Always Push After Commit

Every commit → `git push` same flow. Exceptions:

- **Pre-push diverged** — `git pull --rebase` directly, no menu-ask: rebasing unpushed local commits onto fetched origin isn't destructive (no rewritten published history, no force push, reflog-recoverable).
- **Push rejected non-fast-forward** — `git pull --rebase` once; clean → re-push; conflicts → resolve by hand (read both sides of every `<<<<<<<`/`=======`/`>>>>>>>`, merge keeping both intents unless semantically identical, `git add`, tests + typecheck, `git rebase --continue`, repeat, re-push). Conflict resolution is your job; abort + ask only when the conflict is outside both cards' scope. **Forbidden shortcuts:** `-Xtheirs`/`-Xours`, `git checkout HEAD -- <path>`, `git restore <path>`, any wholesale overwrite.
- **Push fails** (no upstream, auth, network) — report + stop, never force-push. An auth-prompt failure headless ("User cancelled dialog", "/dev/tty: No such device", "could not read Username for...") means the remote needs interactive credentials that don't exist here — never retry, never disable the sandbox for a GUI. Report the remote/error signature and stop; fixing credentials is the user's call.
- **User says "don't push."**

Force-push requires explicit user auth.

## Stage a New File Right After Creating It (dispatched worker, own worktree only)

In a dispatched agent's own worktree (not shared-index — see below), `git add` a newly-created file the same turn, right after the create. Worktree autosave stages via `git add -u`, which covers only already-tracked files, never `git add -A` — an unstaged new file is invisible to both autosave layers, and is lost for good if the session is killed before it's staged.

## Check for Other Agents' Staged Work

Before commit: `git status` → check for already-staged work you didn't create. Found → another agent mid-commit. Poll every 5s up to 30s. Persists → ask user. Never commit on top, never unstage theirs.

### Never stage at all when another agent shares the index — `git commit -- <paths>`

The check above protects you from committing THEIR work. It does nothing about the reverse, which is the one that actually happens: **you stage, they commit, and your files land inside their commit under their message.** `git add` then `git commit` is two steps with a window, and the index is shared — anyone's commit in that window takes everything staged, including yours. Checking first does not close the window; it only tells you the index was clean at the moment you looked.

Commit straight from the working tree instead, naming your paths. No staging, no window:

```
git commit -m "<message>" -- path/one path/two
```

Verified empirically rather than assumed: with another agent's file already staged in a shared index, this committed only the named path, and their work stayed staged and uncommitted — neither swept in nor disturbed.

The failure this prevents is quiet and permanent: nothing is lost and nothing conflicts, so no tool reports a problem. One card's diff simply lives forever inside a commit bearing another card's name, and the history lies to whoever reads it next. Do not "fix" it afterwards by rewriting published history — record the misattribution in the next commit message and on the card, and move on.

## Own Work Is Never The Question

Your own work commits separately, no questions. Mixed-state = a file has BOTH your edits AND foreign edits — the question resolves on the foreign part only.

Order: (1) identify your files/hunks (traceable in session history); (2) stage + commit + push yours, no question; (3) only then ask about remaining foreign drift: "Files X, Y modified outside this session — active sibling (leave) or orphaned (commit-along / ask owner)?" This ASK applies only to isolating foreign hunks FROM yours inside one file.

## Mixed-State Files: ASK, Never Surgically Isolate

After your own work is committed: a file with BOTH your edits and pre-existing foreign drift you can't cleanly separate by path → STOP, one round-trip: *"Working tree mixed (yours + pre-existing in <files>). Commit-all in one, or split? If split: which paths are yours?"* Wait, then `git add <named-paths>` + commit.

**Exception — background-system drift never asks.** Files auto-mutated by a running system (poller/triage/heartbeat/TTL timer) ride along every dispatch (e.g. `.trello-retry/`, `dispatch-stops/`, `CRITICAL_FAILURE`) — stage into the same commit or a sibling `chore: mid-session drift` commit; rebase conflicts on these are your job.

**Forbidden:** "back up, revert to HEAD, replay only my edits" or "cp/Write-original is just isolating" — both are the same wholesale overwrite as `git show HEAD:file > file`; "pre-existing don't overlap mine" — can't be proven. A denied primitive (`git stash` blocked, no per-hunk `git add -p`) is a STOP, not an escalation cue — one question beats four steps that may corrupt.

## Never Reset or Remove Other Changes

`git reset` forbidden (the bare/non-`--hard` form is not hook-enforced — this is on you). Stage only your changes (`git add <specific-files>`); never unstage what's already staged.

## Never Use git stash

Forbidden — mechanically blocked by base's `deny-destructive-git.mjs` hook; destroys uncommitted work and corrupts multi-agent state. Investigate the code itself instead. Never stash "to check baseline" — you own every failing test regardless of origin; fix it. Exception: another agent has uncommitted active changes, verifiable via `git status` showing files you didn't touch.

## Before Deleting Any File: Grep for Consumers First

Before `rm` / Edit-to-empty / Write-empty: grep the entire tree for imports, requires, includes, textual refs. Any consumer → STOP; delete is wrong, or consumers must migrate first. Never trust a card's "only used by X" — verify yourself.

## Never Use git checkout / restore / revert

`git checkout`/`git restore` on a tracked file are FORBIDDEN — mechanically blocked by base's `deny-destructive-git.mjs` hook. Also forbidden, not hook-enforced: `git revert` on a working-tree file, and any wholesale-overwrite equivalent (`cp` from clean, `git show HEAD:file > file`, Write-original-content) — all silently destroy uncommitted work from other agents/users with zero recovery. A "modified by user or linter" notification means someone else is doing intentional work — never touch, never revert, never investigate "correctness." Instead: `git diff`, identify YOUR specific changes, Edit to remove only those. Unsure → ask user.

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

## Fetch Before Asserting Remote State

Local `main` moves only when YOU fetch/pull — other agents/workers/pushes advance `origin/main` without your clone knowing. Before any claim a file/feature "exists," "is missing," or "isn't merged" on a branch — `git fetch origin` first, then check `origin/<branch>`, never local `HEAD` alone. This generalizes the cherry-pick staleness check to every remote-state assertion. Local-only reads are fine for your own uncommitted work; never for asserting remote state.

## All Code Is Your Code

You wrote 100% of everything — no "not my change," "pre-existing," "out of scope." Exception: another agent may be actively working uncommitted outside this session — only commit YOUR changes; for foreign uncommitted work, acknowledge and ask, never ignore or commit without instruction.
