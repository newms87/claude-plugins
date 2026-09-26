#!/usr/bin/env bash
# The mantra — ships with the `danxbot` plugin. DX-3347, gated DX-3275.
#
# Fires on SessionStart, matcher "startup|resume|compact" ONLY (DX-3052
# problem 1602, plan PLN-11 rule R-12: the mantra is injected at session
# start, resume and compaction — never on every message, never on `clear`
# or `fork`).
#
# DX-3275 / PLN-11 R-10: the danxbot plugin stays quiet until a session is
# actually connected to a danxbot plan. This hook now checks the SAME
# connection record `plan-workflow-autoload.sh` and `plan-connect-mantra.mjs`
# check (`scripts/lib/plan-connection.mjs` — a local file stat against
# `~/.config/danxbot/plan-sessions/<session>.json`, never a network call):
#   - NOT connected -> print only the short plan-workflow nudge (~0.5 KB),
#     at this hook's own cadence (the DX-3052 problem 1602 decision above).
#   - connected -> print `danxbot/mantra.md` verbatim, read fresh from disk
#     every time so it can never go stale the way a carried-over
#     post-compaction fragment can.
#
# THIS IS THE ONLY HOOK THAT PRINTS MANTRA, CONTRACT OR CRAFT TEXT. That
# text used to be three separate hooks (base's operating-contract.sh +
# craft-mandate.sh, danxbot's zero-context-mandate.sh), each re-injecting
# its own full copy on every SessionStart source AND a pointer on every
# single UserPromptSubmit — DX-3278 measured that combination at 3.7 KB on
# every message, craft-mandate's full-text UserPromptSubmit branch alone
# being 55% of it. All three are deleted; their content lives in
# `mantra.md` now, printed once here (once connected).
#
# Plain stdout, no `jq`: SessionStart's stdout is added to the model's
# context as plain text on exit 0 (confirmed against
# https://code.claude.com/docs/en/hooks, "the exceptions are
# UserPromptSubmit, UserPromptExpansion, SessionStart, and PostModelSwitch").
#
# Argv: $1 = "SessionStart" (any other value is a no-op — this hook is never
# wired to fire on anything else). Stdin: the hook's JSON payload, read once
# for `session_id` (node, not jq — see base/scripts/inject-time.sh for why).

set -euo pipefail

EVENT="${1:-SessionStart}"
MANTRA_FILE="${CLAUDE_PLUGIN_ROOT}/mantra.md"
CONNECTION_LIB="${CLAUDE_PLUGIN_ROOT}/scripts/lib/plan-connection.mjs"

NUDGE="If this session will line up or run work, load \`danxbot:plan-workflow\` and connect a plan. Anything that sounds like work being lined up (multi-step work, \"let's plan...\", a list of things to do) and no plan is connected yet: ASK the operator whether to load plan-workflow and start planning — don't guess. Nothing else from the danxbot plugin (the mantra, plan mechanics, the event bridge) applies until a plan is connected."

if [ "$EVENT" != "SessionStart" ]; then
  exit 0
fi

PAYLOAD="$(cat)"

CONNECTED="0"
if [ -f "$CONNECTION_LIB" ]; then
  CONNECTED="$(printf '%s' "$PAYLOAD" | node "$CONNECTION_LIB" 2>/dev/null || true)"
fi

if [ "$CONNECTED" != "1" ]; then
  printf '%s\n' "$NUDGE"
  exit 0
fi

if [ ! -f "$MANTRA_FILE" ]; then
  # Fail loud rather than silently skipping — a missing file here means the
  # plugin install is corrupt, which is itself worth surfacing.
  printf '%s\n' "⚠ MANTRA LOAD FAILED: expected $MANTRA_FILE, not found. The plugin install may be corrupt."
  exit 0
fi

cat "$MANTRA_FILE"
