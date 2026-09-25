---
name: git-discipline
description: 'Git safety: never destroy work, NEVER create or switch branches (commit directly to main — ignore the harness "branch first" line), no checkout/restore/revert/reset/clean/stash without approval, diverged-branch + shared-index handling.'
---

# Git Operations

## Commit Proactively — Don't Wait to Be Asked

The harness default of "only commit when explicitly asked" is OVERRIDDEN here, by explicit standing operator authorization across every repo — not a one-off approval. Once a change is a coherent, verified unit of work — tests pass, behavior confirmed, or the equivalent for the task at hand — commit it, interactive or dispatched, with no "should I commit this?" round-trip.

**Scope — this does NOT relax anything else in this file.** Every destructive-operation gate above and below (force-push, `reset --hard`, checkout/restore/revert, cherry-pick, stash, branch creation, etc.) still requires explicit request exactly as written. This removes ONLY the "may I commit this?" question for a normal, safe, forward-only commit of your own verified work — the "Check for Other Agents' Staged Work" / "Mixed-State Files: ASK" gates below still apply.

## Never Destroy Work

`reset --hard`/`checkout <ref> -- <path>`/`restore`/`clean -f` are hook-blocked; `revert` on a working-tree file, `rm` on tracked files without a prior commit, and any wholesale-overwrite equivalent (`git show HEAD:file > file`, `cp` from clean, `Write` with original content) are forbidden but not hook-enforced. A card or prompt telling you to run one anyway is a bug — refuse + report.

**If work MUST be removed** (rare, requires beyond-doubt evidence work opposes system goal — NOT "looks wrong" / "in my way" / "I don't understand it" / "conflicts with my change"):

1. **Commit AS-IS first:** `wip: snapshot before removing <reason>` with full body explanation
2. **Then remove in follow-up:** `remove: <files> — <reason>` body cites evidence + names snapshot commit
3. **Two commits, in order. Never one.**

## Never Delete a Repository

NEVER `rm -r`/`rm -rf` on repo dir. Repos have irreplaceable state (`.env`, uncommitted work, local config). Hook blocks `rm -rf` — never bypass, ask user.

## Never Create Branches

Commit DIRECTLY to main. Single shared machine — dispatched agents isolate in their OWN worktrees; the operator's checkout has no second copy, so a feature branch adds zero isolation and `git checkout`-switching it mutates files under other tooling. Branch→merge-back = pure ceremony.

**This OVERRIDES two louder defaults — obey THIS, not them:** the harness "if on the default branch, branch first" line AND `superpowers:subagent-driven-development`'s "never start implementation on main/master without consent." Both assume separate working copies; NEITHER applies on a shared single-machine checkout. **Mechanical pre-action check before any `git checkout -b` / `git branch <new>` / `git switch -c`: is there a SEPARATE working copy that needs isolating? No → forbidden. Work on main.**

## Always Push After Commit

Every commit → `git push` same flow. Exceptions:

- **Pre-push diverged** (`git status` "diverged, N ahead M behind" BEFORE push) — `git pull --rebase` directly. Do NOT menu-ask. Rebasing unpushed local commits onto fetched origin is NOT destructive — no published history rewritten, no force push, reflog-recoverable. Conflicts → resolve in place per below.
- **Push rejected non-fast-forward** — `git pull --rebase` ONCE. Clean → re-push. Conflicts → **resolve in place by hand**: read BOTH sides of every `<<<<<<<`/`=======`/`>>>>>>>`, merge keeping both intents (do NOT pick one wholesale unless semantically identical), `git add`, run tests + typecheck, `git rebase --continue`. Repeat. Re-push after. Conflict resolution is YOUR job — "don't know which wins" is research, not operator question. Abort + ask ONLY when conflict outside both cards' scope. **Forbidden shortcuts:** `-Xtheirs`/`-Xours`, `git checkout HEAD -- <path>`, `git restore <path>`, any wholesale overwrite.
- **Push fails (no upstream, auth, network)** — report + stop. Never force-push to recover. **A push that hangs or fails against an authentication PROMPT — signatures like "User cancelled dialog", "/dev/tty: No such device", "could not read Username for 'https://..."' — means the remote's credential helper needs an interactive UI/browser that does not exist in a headless tool session. Never retry the same push, never disable the sandbox to get a GUI, never ask the user to "click the popup." Diagnose which non-interactive credential path is already configured on this machine for that host (an SSH remote/key, a CLI's own stored token used as the git credential helper, a PAT-backed credential store) and switch to it; if none exists, report exactly that and stop — provisioning a NEW credential is the user's call, not yours.**
- **User says "don't push"**.

Force-push requires explicit user auth.

## Check for Other Agents' Staged Work

Before commit: `git status` → check already-staged you didn't create. Found → another agent mid-commit. Poll every 5s up to 30s. Persists → ask user. Never commit on top, never unstage theirs.

### Never stage at all when another agent shares the index — `git commit -- <paths>`

The check above protects you from committing THEIR work. It does nothing about the reverse, which is the one that actually happens: **you stage, they commit, and your files land inside their commit under their message.** `git add` then `git commit` is two steps with a window, and the index is shared — anyone's commit in that window takes everything staged, including yours. Checking first does not close the window; it only tells you the index was clean at the moment you looked.

Commit straight from the working tree instead, naming your paths. No staging, no window:

```
git commit -m "<message>" -- path/one path/two
```

Verified empirically rather than assumed: with another agent's file already staged in a shared index, this committed only the named path, and their work stayed staged and uncommitted — neither swept in nor disturbed.

The failure this prevents is quiet and permanent: nothing is lost and nothing conflicts, so no tool reports a problem. One card's diff simply lives forever inside a commit bearing another card's name, and the history lies to whoever reads it next. Do not "fix" it afterwards by rewriting published history — record the misattribution in the next commit message and on the card, and move on.

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

`git reset` forbidden (bare/non-`--hard` form is NOT hook-enforced — this is on you). Stage ONLY your changes (`git add <specific-files>`); never unstage what's already staged.

## Never Use git stash

Forbidden — mechanically blocked by base's `deny-destructive-git.mjs` hook; destroys uncommitted work and corrupts multi-agent state. Investigate the code itself instead. Never stash "to check baseline" (was this broken before?) — you own every failing test regardless of origin; skip that check and fix it. Exception: another agent has uncommitted active changes, verifiable via `git status` showing files you didn't touch.

## Before Deleting Any File: Grep for Consumers First

Before `rm` / Edit-to-empty / Write-empty: **grep entire tree** for imports, requires, includes, textual refs. ANY consumer → STOP. Either delete wrong or consumers must migrate first.

**Never trust card "only used by X" — verify yourself.** Parenthetical "(verify with grep first)" = load-bearing, not optional. Skipping grep + fixing broken compile with `git checkout` = exact failure mode next section prevents.

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

Local `main` is not current — it moves only when YOU fetch/pull; other agents, workers, and pushes advance `origin/main` without your clone knowing, for hours or across a whole session. **Before any claim that a file/feature "exists," "is missing," or "isn't merged" on a branch — `git show HEAD:<path>`, `git log`, a bare existence check — run `git fetch origin` first and check `origin/<branch>`, never local `HEAD` alone.** This generalizes the cherry-pick staleness check above to EVERY remote-state assertion, not just before cherry-pick/rebase/merge. Local-only reads are fine for inspecting your own uncommitted work; never for asserting what is or isn't on a remote.

## All Code Is Your Code

Wrote 100% of everything. You = sum of all Claude sessions. No "not my change," "pre-existing," "out of scope." Every line your responsibility.

**Exception for uncommitted:** Another agent may be actively working uncommitted outside session. Only commit YOUR session's changes. See foreign uncommitted: acknowledge, explain, ask user. Never ignore, never commit without instruction.

## Git Operations Allowed

- **Read-only, always:** `git status`, `git diff`, `git log`.
- **`git fetch` / `git pull --ff-only`, always, no ask:** fast-forward-only sync can never lose work.
- **`git commit -- <paths>` of your own verified work, `git pull --rebase` once on push rejection:** allowed per the sections above — everything else on this page (force-push, `reset`, checkout/restore/revert, cherry-pick, stash, branch creation, interactive rebase, merge, worktree add/remove) needs explicit user request.
