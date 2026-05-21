#!/usr/bin/env bash
# Human-loop mandate hook (ships with the `human-collaboration` plugin).
#
# Detects diagnostic triggers (questions with `?`) in the user prompt and injects
# a mandatory pre-response gate forcing Skill(human-loop) before any tool call.
#
# Trigger: question mark in user prompt activates diagnostic mode (STOP all work).

set -euo pipefail

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty')

if [ -z "$PROMPT" ]; then
    exit 0
fi

if echo "$PROMPT" | grep -q '?'; then
    GATE="QUESTION DETECTED in user prompt. MANDATORY: Load Skill(human-loop) immediately.

Diagnostic mode overrides ALL behaviors:
1. STOP all work — no tool calls except Read for context
2. STOP all pipelines — paused until explicit action verb
3. ANSWER the question — text only
4. WAIT for explicit direction — user decides next

NEVER assume question implies action. NEVER use tool calls without fresh verb."

    jq -n --arg ctx "$GATE" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
fi
