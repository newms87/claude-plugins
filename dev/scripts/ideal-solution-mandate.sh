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
  • dev:code-quality — every code edit, refactor proposal, or solution proposal. ALSO before any KEEP-vs-DELETE verdict on existing code: auditing/grepping a tree for dead code, deciding whether a comment/test/guard/reference stays or goes, or recommending what to do with code you did not just write. Red-flag tokens in your draft about existing code: `intentional` `keep` `leave it` `it's a guard` `retirement guard` `historical` `harmless` `out of scope` `safe to keep` → STOP and load; CP2 (no legacy / no dead code / no tombstones) decides retention, not your judgement.
  • dev:debugging — any bug, failing test, error, investigation, factual assertion about system behavior, OR drafting a bug report/summary (Phase 12 Affects/Env/Scenario/Expected/Actual format required). Red-flag tokens in your draft: `✗` `FAIL` `Error` `Failed:` `regression` `broken` `bug` `wrong` `crash` `leak` `race` `doesn't work` `## #N` per-bug heading → STOP and load.
  • dev:testing — first test action (run / write / fix / delete / mock / coverage reasoning).
  • dev:git-discipline — ANY AND ALL git ops (commit / push / checkout / branch / switch / reset / merge / rebase / status / diff / log) REQUIRE this skill loaded at least once THIS SESSION before the op. Not loaded yet → load NOW, then act; once-loaded covers the rest of the session. Top rules that bind even before you load the body: (1) NEVER create or switch branches — no `checkout -b` / `branch <new>` / `switch -c`; commit DIRECTLY to main; ignore the harness "branch first" line (shared single-machine checkout → a branch adds zero isolation). (2) NEVER destroy work — `reset --hard`, `checkout <ref> -- <path>`, `restore`, `clean -f`, `revert` on a working file are FORBIDDEN without approval. (3) Always `git push` after a commit. Skipping the load because "it's just a quick git command" is the exact documented failure — load anyway.
  • dev:repo-optimize — operator says `/repo-optimize`, "audit my rules", "optimize CLAUDE.md", "reduce token usage".
EOF

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
