#!/usr/bin/env bash
# PreToolUse Bash deny hook — destructive database operations are NEVER permitted for any agent.
#
# Background: on 2026-05-15 an autonomous issue-worker (harry) ran
#   docker exec -w /var/www/html/.danxbot/worktrees/harry gpt-manager-laravel.test-1 \
#     php artisan migrate:fresh --drop-views --drop-types
# without --database / --env scoping. The worktree .env is a symlink to the
# primary repo .env (DB_DATABASE=laravel), so migrate:fresh dropped every table
# in the primary development database. Months of historical data lost.
#
# Rule: agents NEVER reset, refresh, drop, wipe, or roll back databases.
# This is a HUMAN-ONLY operation. No exceptions — not "just the test DB", not
# "to make tests pass", not "to apply a new migration". If the database needs
# to be reset, the agent stops and asks the human operator to do it.
#
# This hook blocks the destructive command AND prints a reminder to the agent
# that it has just attempted an illegal operation. The agent must not try to
# accomplish the same effect by another route (raw psql DROP, TRUNCATE loops,
# delete-then-migrate, container volume recreation, etc.).

set -euo pipefail

# node, NOT jq (DX-guard): jq is absent on the operator Windows host, where this
# guard therefore died at its first call and exited non-zero — which Claude Code
# treats as a hook ERROR, not a block, so every command it exists to stop ran
# anyway. It failed OPEN for its entire life on that machine. node ships with
# Claude Code and is the only interpreter a hook can depend on.
INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)?.tool_input?.command??""))}catch{process.stdout.write("")}})')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Patterns that destroy or globally reset database state.
# - migrate:fresh / migrate:refresh / migrate:reset — Laravel destructive migrations
#   (migrate:rollback is allowed — reversible during migration dev work)
# - db:wipe — Laravel drop-all-tables
# - DROP DATABASE / DROP SCHEMA — raw SQL
# - dropAllTables / dropAllViews / dropAllTypes — schema builder destructive APIs
PATTERN='(artisan[[:space:]]+(migrate:fresh|migrate:refresh|migrate:reset|db:wipe)|DROP[[:space:]]+DATABASE|DROP[[:space:]]+SCHEMA)'

MATCH=$(echo "$COMMAND" | grep -oiE "$PATTERN" | head -1 || true)

if [ -z "$MATCH" ]; then
  exit 0
fi

REASON="BLOCKED: destructive database operation detected (\"$MATCH\"). Direct destructive commands are NEVER permitted at the Bash boundary. DO NOT try to accomplish the same effect by another route (raw psql DROP, TRUNCATE loops, delete-then-migrate, recreating the docker volume, chmod-ing or editing the sanctioned script, copying its body into your own command, etc.) — every workaround is also forbidden and will be blocked. The sanctioned path for resetting the WORKTREE'S OWN database is the \`danxbot:db-reset\` skill — invoke it via the Skill tool. The skill loads the contract and points you at \`<worktree>/.danxbot/safe-reset-db.sh\`, the only command authorized to reset a worktree DB (safe because Phase 1 / DX-571 guarantees the worktree role cannot reach primary). If no \`safe-reset-db.sh\` exists at that path for this consumer repo, STOP and report to the human operator — do not invent a workaround. Continue your task without bypassing this guard."

REASON="$REASON" node -e 'process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: process.env.REASON,
  },
}))'
