#!/usr/bin/env bash
# PreToolUse Bash deny hook — git commands that destroy UNCOMMITTED work.
#
# Background: on 2026-09-04, during a routine instance resize, an agent ran
# `git reset --hard origin/main` four times in a checkout shared by several
# concurrently-running agents. Each run silently destroyed every tracked file
# with uncommitted modifications. One agent's six-file deliverable was wiped
# mid-task and had to be re-done; `git fsck --dangling` found ZERO recoverable
# blobs, because nothing had been staged. There is no record of what else was
# in flight at those four moments, and there never can be — that irreversibility
# is the whole reason this hook exists.
#
# The agent had read the prohibition. It reasoned its way around it twice:
# "this is the operator's checkout, not a dispatch worktree" (the rule says
# banned everywhere) and "I branched first, so nothing is lost" (a branch
# preserves COMMITS; uncommitted work is not on any branch). Prose could not
# stop it. This can.
#
# Until now the only thing standing in the way was the interactive permission
# prompt — which does not fire in bypass-permissions mode, i.e. exactly when an
# agent is moving fastest with the least supervision. A PreToolUse deny fires
# in every permission mode.
#
# Rule: an agent NEVER destroys uncommitted work. The only sanctioned recovery
# primitive is COMMIT-FIRST — commit the mess, then rebase/merge/reset onto it.
# A commit is always recoverable; a discarded working tree is not.
#
# ALLOWED, deliberately (each is non-destructive of committed work and needed
# for normal recovery): `--abort` on rebase/merge/cherry-pick/revert; `git
# reset` without --hard (soft/mixed leave the working tree intact); `git
# checkout -b` / `git switch -c` (creating a branch); `git clean -n`/`--dry-run`.

set -euo pipefail

# node, NOT jq. jq is not installed on every host these hooks run on — it is
# absent on the operator's Windows machine, where its absence silently broke the
# sibling DB guard for that guard's entire life: it died at its first jq call
# and exited non-zero, which Claude Code treats as a hook ERROR rather than a
# block, so the command it was written to stop ran anyway. A guard that fails
# open is worse than none, because it is trusted. node ships with Claude Code,
# so it is the one interpreter a hook can actually depend on.
INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)?.tool_input?.command??""))}catch{process.stdout.write("")}})')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# `--abort` is the sanctioned way out of a conflicted rebase/merge/cherry-pick
# and destroys nothing that was not already in-flight. Cleared first so the
# patterns below never have to special-case it.
if echo "$COMMAND" | grep -qiE 'git[[:space:]]+(rebase|merge|cherry-pick|revert)[[:space:]]+--abort'; then
  exit 0
fi

# `git restore --staged <path>` only moves changes out of the index — it never
# touches the working tree, exactly like `git reset` without `--hard` (already
# allowed below). Cleared here, before PATTERN, the same way `--abort` is
# cleared above, so the general `restore` alternative in PATTERN can treat
# every OTHER form of restore (bare, `--worktree`, `--source=<ref>`) as
# destructive without having to carve this one shape back out of a single
# regex alternative.
if echo "$COMMAND" | grep -qiE 'git[[:space:]]+restore[[:space:]].*--staged' \
   && ! echo "$COMMAND" | grep -qiE 'git[[:space:]]+restore[[:space:]].*--(worktree|source)'; then
  exit 0
fi

# Each alternative matches ONLY the destructive form. DX-3094 — every bullet
# below is followed by a `FORM:`/`ALLOWED-FORM:` example; base/tests/deny-destructive-git.test.mjs
# reads these lines straight out of this file and runs each example through
# this real script, so a bullet that claims coverage PATTERN does not actually
# have fails the test instead of drifting silently (the 2026-09-04 comment/
# PATTERN mismatch this rewrite fixes).
#  - reset --hard        (soft/mixed keep the working tree, so they are allowed)
#    FORM: git reset --hard origin/main
#    ALLOWED-FORM: git reset origin/main
#    ALLOWED-FORM: git reset --soft HEAD~1
#  - clean with -f/-x/-d (clean -n / --dry-run is allowed)
#    FORM: git clean -fd
#    ALLOWED-FORM: git clean -n
#    ALLOWED-FORM: git clean --dry-run -fd
#  - stash               (every form: push/save/create hide work an agent then
#                         forgets; the operator finds a stash weeks later)
#    FORM: git stash
#    FORM: git stash push
#  - checkout/switch with the discard marker right after the verb
#    FORM: git checkout -- file.txt
#    FORM: git checkout --force other-branch
#    FORM: git switch -f other-branch
#    ALLOWED-FORM: git checkout -b new-branch
#    ALLOWED-FORM: git switch -c new-branch
#  - checkout with a STARTING POINT named before the discard marker — the
#    shape DX-3094 found uncaught, and the one that actually ran in the
#    2026-09-21 incident (DX-3091/DX-3089)
#    FORM: git checkout origin/main -- file.txt
#    FORM: git checkout HEAD~1 -- src/agent/launcher.ts
#  - restore, the newer plain-verb equivalent of `checkout -- <path>` that the
#    refusal message below already tells an agent not to reach for — added
#    here so the pattern actually backs that claim (DX-3094 AC2)
#    FORM: git restore file.txt
#    FORM: git restore --worktree file.txt
#    FORM: git restore --source=HEAD~1 file.txt
#    ALLOWED-FORM: git restore --staged file.txt
PATTERN='git[[:space:]]+reset[[:space:]]+(--hard|.*[[:space:]]--hard)|git[[:space:]]+clean[[:space:]]+-[a-z]*[fxd]|git[[:space:]]+stash|git[[:space:]]+(checkout|switch)[[:space:]]+(--[[:space:]]|--force|-f[[:space:]])|git[[:space:]]+checkout[[:space:]]+[^[:space:]-][^[:space:]]*[[:space:]]+--([[:space:]]|$)|git[[:space:]]+restore([[:space:]]|$)'

MATCH=$(echo "$COMMAND" | grep -oiE "$PATTERN" | head -1 || true)

if [ -z "$MATCH" ]; then
  exit 0
fi

REASON="BLOCKED: \"$MATCH\" destroys UNCOMMITTED work irreversibly. Nothing recovers it — not the reflog (which only tracks commits), not \`git fsck\` (unstaged changes are never written to the object database). On 2026-09-04 this exact command wiped a concurrently-running agent's six-file deliverable in a shared checkout, with zero recoverable blobs afterward.

DO NOT reason your way around this. The two rationalisations that failed before: \"this is the main checkout, not a dispatch worktree\" — the rule is every path, every repo; and \"I branched first\" — a branch preserves COMMITS, and uncommitted work is on no branch.

DO NOT route around it either: \`rm -rf\` on the files, a fresh clone over the top, \`git restore\`, \`git worktree remove --force\`, or asking another agent or session to run it for you are all the same act and equally forbidden.

USE COMMIT-FIRST INSTEAD — the only sanctioned primitive. \`git add -A && git commit -m \"wip(autosave): <why>\"\` then rebase, merge, or reset onto that commit. A commit is always recoverable. If you need someone else's in-flight changes out of your way, commit them on a branch and say so in your report; never discard them.

If you believe this is a true false positive, STOP and tell the operator what you were trying to do and why — do not retry with a reworded command. Allowed and not blocked: \`--abort\` on rebase/merge/cherry-pick/revert, \`git reset\` without --hard, \`git checkout -b\` / \`git switch -c\`, and \`git clean -n\`."

REASON="$REASON" node -e 'process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: process.env.REASON,
  },
}))'
