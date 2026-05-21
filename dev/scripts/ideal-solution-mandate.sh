#!/usr/bin/env bash
# ideal-solution-mindset mandate — ships with the `dev` plugin.
#
# Fires on SessionStart and UserPromptSubmit. Injects a brief reminder
# of the four core dev principles into every session so feature planning,
# bug fixes, investigations, and refactor proposals default to the
# correct shape — not the fastest patch.
#
# Full skill body lives at dev/skills/ideal-solution-mindset/SKILL.md.
# This hook does NOT duplicate the full body — it surfaces the principles
# + decision discipline so the agent loads the full skill when the
# response will be more than a one-liner code edit.
#
# Argv: $1 = "SessionStart" or "UserPromptSubmit".

set -euo pipefail

EVENT="${1:-SessionStart}"

if [ "$EVENT" = "UserPromptSubmit" ]; then
    cat >/dev/null
fi

read -r -d '' MANDATE <<'EOF' || true
IDEAL-SOLUTION MINDSET — the four core dev principles default for every plan, investigation, bug fix, refactor, and architectural decision. Applies in EVERY context — autonomous, dispatched, human-in-the-loop alike. Full skill: dev:ideal-solution-mindset.

  #1  IDEAL CORRECT SOLUTION. Cost / effort / token usage NEVER trade against correctness. "Approach A is faster to write" / "B touches another repo" / "C means extending shared infra" — disqualified reasons. Pick the architecturally correct shape and execute. The only real trade-offs are those the running system would experience differently (latency / freshness / security / capability gap).

  #2  NO LEGACY, NO FALLBACKS, NO DEAD CODE. Hard cuts, never migrations. Anything made obsolete by the change is deleted in the same commit. Out-of-scope callers that don't conform → fail loudly (typed error, hard assertion, removed entry-point). Forbidden: `if (legacyShape) {…} else {…}`, fallback values, shims, deprecated wrappers, dead exports, `// TODO remove`, commented-out blocks. Deprecated code is as bad as a bug.

  #3  REDUCE COMPLEXITY. Correct and simple usually coincide; complex usually means a worse model is hiding underneath. "What is the simplest shape that solves this? Is that shape also correct?" — climb the complexity ladder only as far as correctness requires. New file / class / abstraction must justify itself by naming the specific invariant it enforces.

  #4  DRY + SOLID — REUSE BEFORE YOU BUILD. Before adding any new helper / class / service / pattern, prove (by searching the codebase, not guessing) there isn't already something doing this job. Same capability, different name → use it. Same capability, partial coverage → extend cleanly. Same capability, wrong location → move it. Record what you searched for in the plan.

PRE-PLAN REFLECTION LOOP (run before declaring any plan ready): state goal · name ideal shape · reuse audit · legacy audit · complexity check · cost-only-objections audit. If any step changes the plan, restart. Plan is ready when one full pass produces no edits.

Red flags that mean STOP: "I'll just add a flag for now" · "It's faster to keep both shapes" · "This is getting complex but I think it's fine" · "I'll write a new helper for this" (before reuse audit in writing) · "I'll leave the old function — something might still call it" · "I'll come back and clean this up later".

Scope note: this mandate is PRINCIPLES-ONLY. When / whether to surface a decision to a human collaborator is owned by human-collaboration:human-loop, not by this skill. The four principles apply regardless of who consumes the resulting work.
EOF

DEBUG_MANDATE=""
TESTING_MANDATE=""
GIT_MANDATE=""

if [ "$EVENT" = "SessionStart" ] || [ "$EVENT" = "UserPromptSubmit" ]; then
    read -r -d '' DEBUG_MANDATE <<'EOF' || true

DEBUGGING — MANDATORY before any bug, error, investigation, or factual assertion about this system's behavior. Self-trigger gate: STOP before sending any response containing `✗`, `FAIL`, `Error`, `Failed:`, `regression`, `broken`, `bug`, `wrong`, `failure`, `leak`, `race`, `crash`, `doesn't work`, a numbered `## #N` bug heading. Confirm `dev:debugging` IS loaded THIS turn. If not, invoke via Skill tool BEFORE finalizing the draft. Load full skill for the Reproduce → Evidence → Hypothesis → Proof checklist + Phase 12 per-bug breakdown format (Affects / Env / Scenario / Expected / Actual) required for every bug discussed.
EOF

    read -r -d '' TESTING_MANDATE <<'EOF' || true

TESTING — MANDATORY on first test action (invoke runner, write test, fix failing test, delete test, create/update mocks, inspect coverage). Self-trigger gate: STOP before running any test command or touching test code. Confirm `dev:testing` IS loaded THIS turn. If not, invoke via Skill tool BEFORE the first tool call. Load full skill for the pre-run check (output-to-file), TDD, you-own-every-test, filter-first, no-skip, deterministic fixtures checklist.
EOF

    read -r -d '' GIT_MANDATE <<'EOF' || true

GIT-DISCIPLINE — MANDATORY before ANY `git` command (no exceptions for "read-only"). Self-trigger gate: STOP before composing any Bash call containing the token `git ` (with space). Confirm `dev:git-discipline` IS loaded THIS turn. If not, invoke via Skill tool BEFORE the Bash tool call. Load full skill for ABSOLUTE rules (never destroy work, never delete repos, never use git checkout/restore/revert) + allowed operations (status/diff/log anytime; pull --rebase on push rejection; nothing else without approval).
EOF
fi

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" --arg debug "$DEBUG_MANDATE" --arg testing "$TESTING_MANDATE" --arg git "$GIT_MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:($ctx + $debug + $testing + $git)}}'
