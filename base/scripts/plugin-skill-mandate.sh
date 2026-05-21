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

   • base:tool-discipline / base:process-kill / base:sub-agent-delegation / base:bash-exit-capture / base:monitor-polling
       - any kill / pkill / SIGTERM / SIGKILL → process-kill FIRST
       - any Agent / Task sub-agent dispatch → sub-agent-delegation FIRST
       - any chained bash with long-running step → bash-exit-capture FIRST
       - any Monitor / `until ...; do sleep` poll loop → monitor-polling FIRST
       - any file op (cat/head/tail/sed/awk over Read/Edit/Write) → tool-discipline FIRST
       - any trailing `&` / `nohup` / `setsid` / `disown` in a Bash command (workers, dev servers, build watches, deploys, anything that outlives the Bash tool call) → tool-discipline FIRST (use `run_in_background: true` instead of shell `&`)


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
