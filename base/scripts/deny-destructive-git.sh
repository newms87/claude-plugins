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

# Each alternative matches ONLY the destructive form:
#  - reset --hard        (soft/mixed keep the working tree, so they are allowed)
#  - clean with -f/-x/-d (clean -n / --dry-run is allowed)
#  - stash               (every form: push/save/create hide work an agent then
#                         forgets; the operator finds a stash weeks later)
#  - checkout/switch to a ref or -- <path>, which discards local modifications
#    (checkout -b / switch -c create a branch and are allowed)
PATTERN='git[[:space:]]+reset[[:space:]]+(--hard|.*[[:space:]]--hard)|git[[:space:]]+clean[[:space:]]+-[a-z]*[fxd]|git[[:space:]]+stash|git[[:space:]]+(checkout|switch)[[:space:]]+(--[[:space:]]|--force|-f[[:space:]])'

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
