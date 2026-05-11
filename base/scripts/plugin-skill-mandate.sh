#!/usr/bin/env bash
# Plugin skill load mandate — ships with the `base` plugin.
#
# Fires on SessionStart and UserPromptSubmit. Injects an unambiguous
# mandate forcing the agent to invoke the matching skill via the Skill
# tool BEFORE the first mutating action of any task whose triggers
# match an installed plugin's domain.
#
# Background: skill descriptions in the available-skills list are
# necessary but insufficient. Past sessions have skipped skills because
# the trigger was paraphrased, the task "felt small," or the agent
# thought it knew the rule already. Every one of those was a workflow
# violation. This hook makes the load mandate explicit and unbypassable
# at the prompt-injection layer.
#
# Argv: $1 = "SessionStart" or "UserPromptSubmit" (selects the hook
# event name in the JSON envelope so the harness routes the
# additionalContext correctly).

set -euo pipefail

EVENT="${1:-SessionStart}"

# Drain stdin (UserPromptSubmit hooks receive the prompt JSON; we don't
# need to inspect it for this universal mandate, but we must not block
# the pipe).
if [ "$EVENT" = "UserPromptSubmit" ]; then
    cat >/dev/null
fi

read -r -d '' MANDATE <<'EOF' || true
PLUGIN SKILL LOAD MANDATE — installed plugin skills are LOAD-FIRST, NOT LOAD-IF-CONVENIENT.

This is not a suggestion. Skill descriptions in the available-skills list are necessary but insufficient — past sessions have skipped skills because the trigger was paraphrased, the task "felt small," or the agent thought it knew the rule already. Every one of those was a workflow violation. Treat the rules below as overriding any default impulse to "just do the simple thing first."

(1) BEFORE the first substantive tool call of any task that matches a trigger below, you MUST invoke the matching skill via the Skill tool. Substantive = Edit/Write, MCP mutation tool, git commit/push, anything that mutates real state. Read-only orientation (Read/Glob/Grep/Bash ls) is allowed first; the skill is loaded BEFORE the first mutating action.

(2) Hard MANDATORY triggers — match any one and load the skill immediately. Only triggers for INSTALLED plugins apply (skills not in the available-skills list cannot be loaded — skip those triggers):

   • danxbot:issue-card-workflow
       - touching <repo>/.danxbot/issues/ (read OR write OR create)
       - calling mcp__danx-issue__*
       - picking up an ISS-N
       - any user request that contains "epic", "phase", "split into phases", "make a card for", "create a card", "issue card", "ticket"
       - ANY plan to write a YAML under .danxbot/issues/
       - SPECIAL: creating a type:Epic card without spawning every phase card in the SAME turn is a violation. "Epic for X" means "epic + every phase card" — atomic unit.

   • danxbot:unblock
       - picking up a Needs Help / Blocked card
       - user says "unblock", "get unstuck", "fix the blocker on", "what does this card need"

   • base:tool-discipline / base:process-kill / base:sub-agent-delegation / base:bash-exit-capture / base:monitor-polling
       - any kill / pkill / SIGTERM / SIGKILL → process-kill FIRST
       - any Agent / Task sub-agent dispatch → sub-agent-delegation FIRST
       - any chained bash with long-running step → bash-exit-capture FIRST
       - any Monitor / `until ...; do sleep` poll loop → monitor-polling FIRST
       - any file op (cat/head/tail/sed/awk over Read/Edit/Write) → tool-discipline FIRST

   • dev:debugging
       - bug, error, test failure, unexpected behavior
       - "investigate", "look into", "why is X", "what's happening with Z"
       - ANY factual ASSERTION about codebase state beyond a direct file quotation
       - SELF-DRAFT TRIGGER (fires on YOUR OWN response, not just user phrasing). Before finalizing any reply that contains ANY of these tokens / shapes, you MUST have invoked `dev:debugging` THIS turn:
           ✗  FAIL  Failed:  Error  regression  broken  bug  wrong  failure
           leak  race  crash  silently dropped  doesn't work  is failing
           not working  mid-<X>-crash  per-bug `## #N — <name>` headings
           "what is broken" / "what failed" / "what's left broken" sections
           failure summaries from a test run / pipeline / job
         "User only asked me to summarize / report / explain / list / break it down" is NOT an exemption. Bug-talking IS the trigger regardless of who initiated it.

   • dev:testing
       - first test-related action of the session (run/write/fix/inspect/reason about a test)
       - any vitest/pytest/jest/phpunit/etc. invocation

   • dev:git-discipline
       - any git op (stash/checkout/restore/revert/reset/clean → BEFORE the command)
       - any commit
       - any file delete

   • pipeline:pipe-plan
       - before EnterPlanMode
       - before checking off any AC item
       - before declaring a phase complete
       - before any commit closing a phase
       - card path unclear after initial investigation (complex-card escape hatch)

   • pipeline:pipe-start
       - before every implementation phase
       - after planning, before writing code
       - after /next-phase

   • danxbot:danxbot
       - touching <repo>/.danxbot/
       - reading <repo>/.danxbot/issues/, .danxbot/workspaces/, .danxbot/config/
       - running make launch-worker / make deploy
       - investigating a stuck dispatch
       - explaining "where does the agent run", "how does X talk to Y"

   • investigate:investigate
       - read-only diagnostic tasks ("investigate", "audit", "check on") with NO fix work

(3) NO rationalization. The following are violations, not reasoning:
   - "I already know the schema/rule" — schema knowledge ≠ lifecycle knowledge.
   - "Just one card / just one command / just a quick check" — exactly when the trap fires.
   - "User only asked for X" — load the skill, then act on X.
   - "Skill is overkill for this" — if a skill exists for the domain, use it.
   - "I'll load it after I orient" — orient first is allowed; act before loading is not.

(4) The skill description list is necessary but insufficient. Always prefer to LOAD the skill when in doubt; the cost of an unneeded skill load is one tool call. The cost of a skipped skill is a workflow violation.

(5) "I forgot to load the skill" is never an explanation. Do not pattern-match around it; do not promise to load it next time. Load it now and re-do whatever step needed it.
EOF

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
