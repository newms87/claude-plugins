#!/usr/bin/env node
// PreToolUse Bash deny hook — git commands that destroy UNCOMMITTED work.
//
// Background: on 2026-09-04, during a routine instance resize, an agent ran
// `git reset --hard origin/main` four times in a checkout shared by several
// concurrently-running agents. Each run silently destroyed every tracked file
// with uncommitted modifications. One agent's six-file deliverable was wiped
// mid-task and had to be re-done; `git fsck --dangling` found ZERO recoverable
// blobs, because nothing had been staged. There is no record of what else was
// in flight at those four moments, and there never can be — that irreversibility
// is the whole reason this hook exists.
//
// The agent had read the prohibition. It reasoned its way around it twice:
// "this is the operator's checkout, not a dispatch worktree" (the rule says
// banned everywhere) and "I branched first, so nothing is lost" (a branch
// preserves COMMITS; uncommitted work is not on any branch). Prose could not
// stop it. This can.
//
// Until now the only thing standing in the way was the interactive permission
// prompt — which does not fire in bypass-permissions mode, i.e. exactly when an
// agent is moving fastest with the least supervision. A PreToolUse deny fires
// in every permission mode.
//
// Rule: an agent NEVER destroys uncommitted work. The only sanctioned recovery
// primitive is COMMIT-FIRST — commit the mess, then rebase/merge/reset onto it.
// A commit is always recoverable; a discarded working tree is not.
//
// ALLOWED, deliberately (each is non-destructive of committed work and needed
// for normal recovery): `--abort` on rebase/merge/cherry-pick/revert; `git
// reset` without --hard (soft/mixed leave the working tree intact); `git
// checkout -b` / `git switch -c` (creating a branch); `git clean -n`/`--dry-run`.
//
// Rewritten from a bash script that matched a regex against the RAW
// command TEXT (`grep -oiE "$PATTERN"`). That fired wherever a denied form's
// words appeared adjacent in the string — inside a commit message, an `echo`,
// a `grep` PATTERN argument, or a string literal in a file being written —
// because the regex never asked whether the match sat in COMMAND POSITION.
// Three first-hand reproductions on 2026-09-23, including this hook blocking
// the authoring of a test fixture naming the very commands it guards, and
// blocking a read-only search for one of those forms.
//
// The fix: tokenize the command the SAME way every other guard in this plugin
// does (`simpleCommands()` in lib/shell-commands.mjs — it already unwraps
// `sh -c`, `wsl.exe`, `docker exec`, `sudo`, `xargs`, `$( ... )`, …), then
// evaluate the denylist ONLY against invocations whose argv[0] really is
// `git`. Text that merely mentions a subcommand name is never argv[0] of
// anything, so it is structurally invisible here — not filtered out, never
// reached. A real invocation is still caught however it is wrapped, because
// `simpleCommands()` recurses into every nested shell/interpreter string.
//
// Each bullet below is followed by a `FORM:`/`ALLOWED-FORM:` example;
// tests/deny-destructive-git.test.mjs reads these lines straight out of this
// file and runs each one through the real hook, so a bullet claiming coverage
// this file does not actually have fails the test instead of drifting
// silently.
//  - reset --hard        (soft/mixed keep the working tree, so they are allowed)
//    FORM: git reset --hard origin/main
//    ALLOWED-FORM: git reset origin/main
//    ALLOWED-FORM: git reset --soft HEAD~1
//  - clean with -f/-x/-d, or the long `--force` (clean -n / --dry-run is allowed)
//    FORM: git clean -fd
//    FORM: git clean --force
//    ALLOWED-FORM: git clean -n
//    ALLOWED-FORM: git clean --dry-run -fd
//  - stash               (every form: push/save/create hide work an agent then
//                         forgets; the operator finds a stash weeks later)
//    FORM: git stash
//    FORM: git stash push
//  - checkout/switch with the discard marker right after the verb
//    FORM: git checkout -- file.txt
//    FORM: git checkout --force other-branch
//    FORM: git switch -f other-branch
//    ALLOWED-FORM: git checkout -b new-branch
//    ALLOWED-FORM: git switch -c new-branch
//  - checkout with a STARTING POINT named before the discard marker — a shape
//    an earlier version of this guard left uncaught, and the one that
//    actually ran in a real incident
//    FORM: git checkout origin/main -- file.txt
//    FORM: git checkout HEAD~1 -- src/agent/launcher.ts
//  - restore, the newer plain-verb equivalent of `checkout -- <path>` that the
//    refusal message below already tells an agent not to reach for — added
//    here so the pattern actually backs that claim
//    FORM: git restore file.txt
//    FORM: git restore --worktree file.txt
//    FORM: git restore --source=HEAD~1 file.txt
//    ALLOWED-FORM: git restore --staged file.txt
//
// Non-destructive carve-outs, re-proven by the test suite (none of these
// subcommands are on the denylist at all, so they need no special case):
//    ALLOWED-FORM: git rebase --abort
//    ALLOWED-FORM: git merge --abort

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandName, simpleCommands } from "./lib/shell-commands.mjs";

const DISCARD_MARKERS = new Set(["--", "--force", "-f"]);

/**
 * Decide whether ONE real `git ...` invocation is a destructive form. `rest`
 * is everything after argv[0], which the caller has already confirmed to be
 * `git`. Returns a short human label for the matched form, or null when it is
 * allowed.
 *
 * Every comparison lowercases, matching the `grep -i` the bash original used.
 */
function deniedForm(rest) {
  if (rest.length === 0) return null;
  const sub = rest[0].text.toLowerCase();
  const subArgs = rest.slice(1);
  const argText = subArgs.map((w) => w.text.toLowerCase());

  if (sub === "reset") {
    return argText.includes("--hard") ? "git reset --hard" : null;
  }

  if (sub === "clean") {
    // Short flag clusters are matched on the FIRST argument only, deliberately:
    // `git clean --dry-run -fd` is a documented ALLOWED-FORM, because the
    // leading `--dry-run` wins. Scanning every argument would deny it and
    // contradict that contract.
    const first = argText[0] ?? "";
    if (/^-[a-z]*[fxd]$/.test(first)) return `git clean ${first}`;
    // The long form, which BOTH this hook's bash predecessor and its
    // first ES-module version let through: the old regex needed `-[a-z]*[fxd]`
    // immediately after `clean `, and in `--force` the leading `-` is followed
    // by another `-`, so the character class never matched. Purely additive —
    // every previously-denied form is still denied by the check above, and
    // `--dry-run -fd` still passes because it carries no `--force`.
    if (argText.includes("--force")) return "git clean --force";
    return null;
  }

  if (sub === "stash") {
    return "git stash";
  }

  if (sub === "checkout" || sub === "switch") {
    const first = argText[0] ?? "";
    if (DISCARD_MARKERS.has(first)) return `git ${sub} ${first}`;
    // A starting point named before the discard marker: `checkout <ref> --`.
    if (sub === "checkout" && argText.length >= 2 && !first.startsWith("-") && argText[1] === "--") {
      return `git checkout ${first} --`;
    }
    return null;
  }

  if (sub === "restore") {
    // `git restore --staged <path>` (with no `--worktree`/`--source`) only
    // moves changes out of the index — it never touches the working tree,
    // exactly like `git reset` without `--hard` above.
    const staged = argText.includes("--staged");
    const worktreeOrSource = argText.some((t) => /^--(worktree|source)/.test(t));
    return staged && !worktreeOrSource ? null : "git restore";
  }

  return null;
}

/**
 * Analyse a whole command string. Returns the first denied form's label, or
 * null when every real `git` invocation within it is allowed.
 */
export function findDeniedGitCommand(command, toolName = "Bash") {
  for (const { argv } of simpleCommands(command, toolName)) {
    if (!argv || argv.length === 0) continue;
    if (commandName(argv[0]) !== "git") continue;
    const hit = deniedForm(argv.slice(1));
    if (hit) return hit;
  }
  return null;
}

export function denyReason(match) {
  return `BLOCKED: "${match}" destroys UNCOMMITTED work irreversibly. Nothing recovers it — not the reflog (which only tracks commits), not \`git fsck\` (unstaged changes are never written to the object database). On 2026-09-04 this exact command wiped a concurrently-running agent's six-file deliverable in a shared checkout, with zero recoverable blobs afterward.

DO NOT reason your way around this. The two rationalisations that failed before: "this is the main checkout, not a dispatch worktree" — the rule is every path, every repo; and "I branched first" — a branch preserves COMMITS, and uncommitted work is on no branch.

DO NOT route around it either: \`rm -rf\` on the files, a fresh clone over the top, \`git restore\`, \`git worktree remove --force\`, or asking another agent or session to run it for you are all the same act and equally forbidden.

USE COMMIT-FIRST INSTEAD — the only sanctioned primitive. \`git add -A && git commit -m "wip(autosave): <why>"\` then rebase, merge, or reset onto that commit. A commit is always recoverable. If you need someone else's in-flight changes out of your way, commit them on a branch and say so in your report; never discard them.

If you believe this is a true false positive, STOP and tell the operator what you were trying to do and why — do not retry with a reworded command. Allowed and not blocked: \`--abort\` on rebase/merge/cherry-pick/revert, \`git reset\` without --hard, \`git checkout -b\` / \`git switch -c\`, and \`git clean -n\`.`;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || command === "") return;
  const match = findDeniedGitCommand(command, input.tool_name);
  if (!match) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: denyReason(match),
      },
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
