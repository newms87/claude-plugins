#!/usr/bin/env bash
# ideal-solution-mindset mandate — ships with the `dev` plugin.
# Fires on SessionStart only (hooks.json). Surfaces the four core dev
# principles + self-trigger gates for the high-value dev skills so the
# agent loads the full skill body at the right moment.
# Argv: $1 = "SessionStart" (any other value → no-op silent exit).

set -euo pipefail

EVENT="${1:-SessionStart}"

if [ "$EVENT" != "SessionStart" ]; then
    exit 0
fi

read -r -d '' MANDATE <<'EOF' || true
DEV MANDATE — four core principles default for every plan, investigation, fix, refactor. Full body: dev:ideal-solution-mindset.
  #1 IDEAL CORRECT SOLUTION — cost/effort/tokens never trade against correctness.
  #2 NO LEGACY / NO FALLBACKS / NO DEAD CODE — hard cuts; obsolete code deleted same commit; no shims, TODOs, deprecated wrappers.
  #3 REDUCE COMPLEXITY — simplest shape that is still correct; new abstraction must name the invariant it enforces.
  #4 DRY + SOLID, REUSE BEFORE BUILD — search the codebase first; extend / move / use existing capability before adding new.

SELF-TRIGGER GATES — invoke the skill via Skill tool BEFORE the offending action:
  • dev:code-quality — every code edit, refactor proposal, or solution proposal.
  • dev:debugging — any bug, failing test, error, investigation, factual assertion about system behavior, OR drafting a bug report/summary (Phase 12 Affects/Env/Scenario/Expected/Actual format required). Red-flag tokens in your draft: `✗` `FAIL` `Error` `Failed:` `regression` `broken` `bug` `wrong` `crash` `leak` `race` `doesn't work` `## #N` per-bug heading → STOP and load.
  • dev:testing — first test action (run / write / fix / delete / mock / coverage reasoning).
  • dev:git-discipline — any Bash call containing `git ` (incl. status/diff/log) — read-only ops gate the same as mutating ops.
  • dev:repo-optimize — operator says `/repo-optimize`, "audit my rules", "optimize CLAUDE.md", "reduce token usage".
EOF

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
