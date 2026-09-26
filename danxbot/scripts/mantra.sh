#!/usr/bin/env bash
# The mantra — ships with the `danxbot` plugin. DX-3347.
#
# Fires on SessionStart, matcher "startup|resume|compact" ONLY (DX-3052
# problem 1602, plan PLN-11 rule R-12: the mantra is injected at session
# start, resume and compaction — never on every message, never on `clear`
# or `fork`). Prints `danxbot/mantra.md` verbatim, read fresh from disk every
# time so it can never go stale the way a carried-over post-compaction
# fragment can.
#
# THIS IS THE ONLY HOOK THAT PRINTS MANTRA, CONTRACT OR CRAFT TEXT. That
# text used to be three separate hooks (base's operating-contract.sh +
# craft-mandate.sh, danxbot's zero-context-mandate.sh), each re-injecting
# its own full copy on every SessionStart source AND a pointer on every
# single UserPromptSubmit — DX-3278 measured that combination at 3.7 KB on
# every message, craft-mandate's full-text UserPromptSubmit branch alone
# being 55% of it. All three are deleted; their content lives in
# `mantra.md` now, printed once here.
#
# Plain stdout, no `jq`: SessionStart's stdout is added to the model's
# context as plain text on exit 0 (confirmed against
# https://code.claude.com/docs/en/hooks, "the exceptions are
# UserPromptSubmit, UserPromptExpansion, SessionStart, and PostModelSwitch").
#
# Argv: $1 = "SessionStart" (any other value is a no-op — this hook is never
# wired to fire on anything else).

set -euo pipefail

EVENT="${1:-SessionStart}"
MANTRA_FILE="${CLAUDE_PLUGIN_ROOT}/mantra.md"

if [ "$EVENT" != "SessionStart" ]; then
  exit 0
fi

if [ ! -f "$MANTRA_FILE" ]; then
  # Fail loud rather than silently skipping — a missing file here means the
  # plugin install is corrupt, which is itself worth surfacing.
  printf '%s\n' "⚠ MANTRA LOAD FAILED: expected $MANTRA_FILE, not found. The plugin install may be corrupt."
  exit 0
fi

cat "$MANTRA_FILE"
