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

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
