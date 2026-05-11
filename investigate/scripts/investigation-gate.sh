#!/usr/bin/env bash
# Investigation gate hook (ships with the `investigate` plugin).
#
# Detects diagnostic triggers in the user prompt and injects a mandatory
# pre-response gate forcing Skill(investigate) before any tool call.
#
# Trigger patterns mirror the investigate skill's SKILL.md description so
# enforcement and skill content stay aligned. Edit one, edit both.

set -euo pipefail

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' | tr '[:upper:]' '[:lower:]')

if [ -z "$PROMPT" ]; then
    exit 0
fi

PATTERN='(^|[^a-z])(why|how does|how come|what.?s going on|what is going on|investigate|look into|dig into|figure out|trace|audit|find out|check on|is the [a-z]+ running|did .+ dispatch|did .+ deploy|did .+ run)([^a-z]|$)'

if echo "$PROMPT" | grep -qE "$PATTERN"; then
    GATE="INVESTIGATION TRIGGER DETECTED in user prompt. MANDATORY pre-response sequence — no exceptions:

1. BEFORE any Bash/Read/Grep/Glob tool call, invoke Skill tool with skill='investigate'.
2. Follow the skill's checklist: state question, write hypothesis, identify evidence sources, gather, report.
3. FORBIDDEN until skill loaded: 'Suspect:', 'Likely:', 'Probably:', OR-separated cause lists, paraphrased causation claims, pattern-matching commit messages into root cause.
4. If first instinct is 'this is a quick lookup, skip the skill' — that is the exact failure mode the gate exists to block. Load the skill anyway.

Bypassing this gate = repeating the documented failure. The skill load is mechanical, not discretionary."

    jq -n --arg ctx "$GATE" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
fi
