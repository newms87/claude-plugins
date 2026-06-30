#!/usr/bin/env bash
# inject-time — ships with the `base` plugin.
#
# Fires on UserPromptSubmit (every message) and PostToolUse (after every
# tool call). Injects the real wall-clock time PLUS the duration elapsed
# since this hook last fired, so the agent perceives time passing across a
# session instead of being blind to it between context snapshots.
#
# Format (matches the operator spec):
#   06/01/2026 20:11:11 +0        first fire / day rollover -> full date
#   20:11:16 +5s                  same day -> time-only + delta
#   21:32:16 +1h 21m              trailing 0s dropped when a larger unit present
#   06/02/2026 02:32:32 +5h 0m 16s
#
# State is per-session, keyed by session_id from the hook stdin JSON, so
# concurrent sessions keep independent deltas.
#
# NOT wired on Stop: a Stop hook that emits additionalContext re-wakes the
# turn ("conversation continues so Claude can act on the feedback"), which
# loops forever with no user input. UserPromptSubmit covers turn-end timing
# via the next message's stamp.
#
# Argv: $1 = hook event name (UserPromptSubmit | PostToolUse).
set -euo pipefail

EVENT="${1:-UserPromptSubmit}"
PAYLOAD="$(cat)"

SID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // "nosession"')"
STATE="/tmp/claude-time-hook-${SID}"

NOW="$(date +%s)"
DATE_KEY="$(date +%Y%m%d)"            # for date-change detection
FULL="$(date +'%m/%d/%Y %H:%M:%S')"   # MM/DD/YYYY HH:MM:SS
TIME="$(date +'%H:%M:%S')"            # HH:MM:SS

LAST_EPOCH=""
LAST_DATE=""
if [[ -f "$STATE" ]]; then
  read -r LAST_EPOCH LAST_DATE < "$STATE" || true
fi

# date prefix: full date on first fire or when the day rolls over, else time-only
if [[ -z "$LAST_DATE" || "$LAST_DATE" != "$DATE_KEY" ]]; then
  STAMP="$FULL"
else
  STAMP="$TIME"
fi

# duration suffix
if [[ -z "$LAST_EPOCH" ]]; then
  DUR="+0"
else
  D=$(( NOW - LAST_EPOCH ))
  (( D < 0 )) && D=0
  H=$(( D / 3600 ))
  M=$(( (D % 3600) / 60 ))
  S=$(( D % 60 ))
  if (( D < 60 )); then
    DUR="+${S}s"
  elif (( D < 3600 )); then
    DUR="+${M}m"; (( S > 0 )) && DUR="${DUR} ${S}s"
  else
    DUR="+${H}h ${M}m"; (( S > 0 )) && DUR="${DUR} ${S}s"
  fi
fi

printf '%s %s\n' "$NOW" "$DATE_KEY" > "$STATE"

jq -n --arg event "$EVENT" --arg ctx "${STAMP} ${DUR}" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
