#!/usr/bin/env node
// PreToolUse Bash deny hook — destructive database operations are NEVER permitted for any agent.
//
// Background: on 2026-05-15 an autonomous issue-worker (harry) ran
//   docker exec -w /var/www/html/.danxbot/worktrees/harry gpt-manager-laravel.test-1 \
//     php artisan migrate:fresh --drop-views --drop-types
// without --database / --env scoping. The worktree .env is a symlink to the
// primary repo .env (DB_DATABASE=laravel), so migrate:fresh dropped every table
// in the primary development database. Months of historical data lost.
//
// Rule: agents NEVER reset, refresh, drop, wipe, or roll back databases.
// This is a HUMAN-ONLY operation. No exceptions — not "just the test DB", not
// "to make tests pass", not "to apply a new migration". If the database needs
// to be reset, the agent stops and asks the human operator to do it.
//
// This hook blocks the destructive command AND prints a reminder to the agent
// that it has just attempted an illegal operation. The agent must not try to
// accomplish the same effect by another route (raw psql DROP, TRUNCATE loops,
// delete-then-migrate, container volume recreation, etc.).
//
// DX-3226 — rewritten from a bash script that ran one regex over the RAW
// command TEXT. That blocked `grep -rn "DROP DATABASE" .` and
// `echo "never run DROP DATABASE here"` — searching for the string, or writing
// it into text, was refused as though the database were being dropped. Both
// reproduced against the live hook.
//
// WHY THIS IS NOT THE DX-3223 FIX. That card fixed the sibling git hook by
// matching only in COMMAND POSITION. Copying that here would break this guard
// outright, because SQL is never in command position — it is always inside an
// argument:
//
//   psql -c "DROP DATABASE laravel"   →  argv[0]="psql"  args=["-c","DROP DATABASE laravel"]
//   grep -rn "DROP DATABASE" .        →  argv[0]="grep"  args=["-rn","DROP DATABASE","."]
//
// Structurally identical. A command-position rule stops seeing the real `psql`
// case and silently stops denying genuine DROPs — the exact 2026-05-15 failure.
//
// The signal that separates them is WHICH PROGRAM is being invoked: one that
// will execute the text, or one that will only search or print it. So this hook
// keeps scanning arguments, and decides on argv[0]:
//
//   - argv[0] is a known INERT text tool  → its arguments are text. Skip.
//   - anything else                        → scan its arguments. Deny on a match.
//
// That direction is deliberate and is the opposite of the obvious design.
// Listing database CLIENTS and denying only those looks tidier, and fails by
// letting an unlisted client execute a DROP unblocked. This fails by giving an
// unlisted text tool a false positive — irritating, immediately visible, and
// recoverable. Given the incident in this file's own header, only one of those
// is an acceptable way to be wrong. Unrecognised means DENY.
//
// `simpleCommands()` unwraps `sudo`, `env`, `xargs`, `sh -c`, `docker exec`,
// `wsl.exe` and `$( … )` before any of this runs, so a destructive command
// stays caught however it is wrapped.
//
// Each bullet below is followed by a `FORM:`/`ALLOWED-FORM:` example;
// tests/deny-destructive-db.test.mjs reads those lines straight out of this
// file and runs each one through the real hook, so a bullet claiming coverage
// this file does not have fails the test instead of drifting silently. (The
// bash predecessor shipped with no test at all — the only guard in its group
// without one, which is why its false positives went unnoticed for so long.)
//  - Laravel destructive migrations, as a real `artisan` invocation
//    (migrate:rollback is allowed — reversible during migration dev work)
//    FORM: php artisan migrate:fresh
//    FORM: php artisan migrate:refresh
//    FORM: php artisan migrate:reset
//    FORM: php artisan db:wipe
//    FORM: sail artisan migrate:fresh --drop-views
//    ALLOWED-FORM: php artisan migrate:rollback
//    ALLOWED-FORM: php artisan migrate
//  - raw SQL that drops a whole database or schema, in any argument of a
//    command that is not a known text tool
//    FORM: psql -c "DROP DATABASE laravel"
//    FORM: mysql -e "drop schema app"
//    ALLOWED-FORM: grep -rn "DROP DATABASE" .
//    ALLOWED-FORM: echo "never run DROP DATABASE here"
//    ALLOWED-FORM: git commit -m "docs: explain why DROP DATABASE is banned"

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandName, simpleCommands } from "./lib/shell-commands.mjs";

// Programs that only search, print or transform text, and can never execute
// SQL or a framework command. Anything NOT here is treated as capable of
// executing what it is handed — see the fail-closed reasoning above.
const INERT_TEXT_TOOLS = new Set([
  "grep", "egrep", "fgrep", "rg", "ag", "ack",
  "echo", "printf", "cat", "head", "tail", "less", "more",
  "sed", "awk", "cut", "sort", "uniq", "wc", "tr", "tee",
  "diff", "strings", "jq", "yq", "find", "ls",
  // git never executes SQL or artisan; a commit message, tag or note that
  // quotes a destructive command is prose.
  "git",
]);

const DESTRUCTIVE_ARTISAN_SUBCOMMANDS = new Set([
  "migrate:fresh",
  "migrate:refresh",
  "migrate:reset",
  "db:wipe",
]);

// Whole-database / whole-schema drops. Deliberately NOT anchored to a
// statement start: SQL arrives mid-string constantly (`-c "BEGIN; DROP ..."`).
const DESTRUCTIVE_SQL = /\bdrop\s+(database|schema)\b/i;

/**
 * Decide whether ONE real invocation is destructive. Returns a short human
 * label for the matched form, or null.
 */
function deniedForm(argv) {
  const program = commandName(argv[0]);
  if (INERT_TEXT_TOOLS.has(program)) return null;

  const words = argv.map((w) => w.text);

  // A real `artisan` invocation: either the program itself (`./artisan x`) or
  // an argument naming it (`php artisan x`, `sail artisan x`, and the same
  // wrapped in docker exec / sudo, which simpleCommands has already unwrapped).
  for (let i = 0; i < words.length; i += 1) {
    const isArtisanHere = i === 0 ? program === "artisan" : commandName({ text: words[i] }) === "artisan";
    if (!isArtisanHere) continue;
    const sub = (words[i + 1] ?? "").toLowerCase();
    if (DESTRUCTIVE_ARTISAN_SUBCOMMANDS.has(sub)) return `artisan ${sub}`;
  }

  // Raw SQL in any argument of a command that might execute it.
  for (const word of words.slice(1)) {
    const hit = word.match(DESTRUCTIVE_SQL);
    if (hit) return hit[0];
  }

  return null;
}

export function findDestructiveDbCommand(command, toolName = "Bash") {
  for (const { argv } of simpleCommands(command, toolName)) {
    if (!argv || argv.length === 0) continue;
    const hit = deniedForm(argv);
    if (hit) return hit;
  }
  return null;
}

export function denyReason(match) {
  return `BLOCKED: destructive database operation detected ("${match}"). Direct destructive commands are NEVER permitted at the Bash boundary. DO NOT try to accomplish the same effect by another route (raw psql DROP, TRUNCATE loops, delete-then-migrate, recreating the docker volume, chmod-ing or editing the sanctioned script, copying its body into your own command, etc.) — every workaround is also forbidden and will be blocked. The sanctioned path for resetting the WORKTREE'S OWN database is the \`danxbot:db-reset\` skill — invoke it via the Skill tool. The skill loads the contract and points you at \`<worktree>/.danxbot/safe-reset-db.sh\`, the only command authorized to reset a worktree DB (safe because Phase 1 / DX-571 guarantees the worktree role cannot reach primary). If no \`safe-reset-db.sh\` exists at that path for this consumer repo, STOP and report to the human operator — do not invent a workaround. Continue your task without bypassing this guard.`;
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
  const match = findDestructiveDbCommand(command, input.tool_name);
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
