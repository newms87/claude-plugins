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

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Patterns that destroy or globally reset database state.
# - migrate:fresh / migrate:refresh / migrate:reset / migrate:rollback — Laravel destructive migrations
# - db:wipe — Laravel drop-all-tables
# - DROP DATABASE / DROP SCHEMA — raw SQL
# - dropAllTables / dropAllViews / dropAllTypes — schema builder destructive APIs
PATTERN='(artisan[[:space:]]+(migrate:fresh|migrate:refresh|migrate:reset|migrate:rollback|db:wipe)|DROP[[:space:]]+DATABASE|DROP[[:space:]]+SCHEMA)'

MATCH=$(echo "$COMMAND" | grep -oiE "$PATTERN" | head -1 || true)

if [ -z "$MATCH" ]; then
  exit 0
fi

REASON="BLOCKED: destructive database operation detected (\"$MATCH\"). Resetting / refreshing / wiping / dropping the database is NEVER permitted for any agent in any situation — not even on a testing database. This is a HUMAN-ONLY operation. You have just attempted an illegal action. DO NOT try to accomplish the same effect by another route (raw psql DROP, TRUNCATE loops, delete-then-migrate, recreating the docker volume, etc.) — every workaround is also forbidden. If the database genuinely must be reset, STOP and report to the human operator that you need them to do it manually. Continue your task without resetting the database."

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
