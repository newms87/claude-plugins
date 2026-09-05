#!/usr/bin/env bash
# current-time mandate — ships with the `base` plugin.
#
# Fires on SessionStart. Injects the always-on rule that the agent does
# NOT know the current wall-clock time and must read it before any
# date/time comparison or any answer that states "now" / elapsed.
#
# Argv: $1 = "SessionStart".

set -euo pipefail

EVENT="${1:-SessionStart}"

read -r -d '' MANDATE <<'EOF' || true
CURRENT-TIME MANDATE — always-on. You do NOT know the current date/time; the session context may be stale or absent. Before ANY date/time comparison, age/elapsed calculation ("N min ago", "is it stuck", "time since X"), or answer that states the current time, FIRST read the real clock (`date -u`). NEVER assume "now", and NEVER anchor "now" to a timestamp seen earlier in context (a prior tool result, a completed-at stamp, a previous message) — those are stale by an unknown amount. Check the clock, then compute.
EOF

printf '%s\n' "$MANDATE"
