#!/usr/bin/env bash
# tool-discipline mandate — ships with the `base` plugin.
#
# Fires on SessionStart AND UserPromptSubmit. Injects the high-frequency
# tool-choice rules into every session AND every turn so they survive
# context compression + stay top-of-context for the action-time decision
# (Bash invocation, MCP call shape, file op tool selection).
#
# Deep contract lives at base/skills/tool-discipline/SKILL.md. This hook
# surfaces the mechanical pre-write checks that get violated most.
#
# Argv: $1 = "SessionStart" or "UserPromptSubmit".

set -euo pipefail

EVENT="${1:-SessionStart}"

if [ "$EVENT" = "UserPromptSubmit" ]; then
    cat >/dev/null
fi

read -r -d '' MANDATE <<'EOF' || true
TOOL DISCIPLINE — always-on. Full skill: base:tool-discipline.

PRE-WRITE CHECK (every Bash invocation, mechanical, no exceptions):

1. Trailing `&` / `nohup` / `setsid` / `disown` / output-redirect-then-background (`> /tmp/*.log 2>&1 &`)? → STRIP. Use `run_in_background: true` Bash param instead. Shell `&` orphans the PID — harness can't kill it.

2. Launches `make launch-*` / `make deploy*` / `make dev*` / `docker run` / `docker compose up` (no `-d`) / `npm run dev` / `yarn dev` / `vite` / `tsx --watch` / worker / dashboard / poller startup? → MUST use `run_in_background: true`. Foreground blocks the turn.

3. About to capture output via `> /tmp/<name>.log 2>&1` so you can `tail -f` later? → That IS the shell-backgrounding instinct. Harness streams stdout + manages its own `output_file`. Don't make your own.

ANTI-RATIONALIZATIONS: "user authorized the launch" (scopes WHAT, not HOW) / "I'll background it real quick" / "I want a logfile to tail" — these are the failure mode, not reasoning.

FILE OPS: Read/Edit/Write, NOT cat/head/tail/sed/awk. Bash for shell-only operations.

MCP CALLS: load schema via ToolSearch BEFORE calling unknown MCP tool. Calling without schema = InputValidationError.
EOF

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
