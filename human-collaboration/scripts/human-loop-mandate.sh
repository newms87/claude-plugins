#!/usr/bin/env bash
# Human-loop mandate hook (ships with the `human-collaboration` plugin).
#
# Detects diagnostic triggers (questions with `?`) in the user prompt and injects
# a mandatory pre-response gate forcing Skill(human-loop) before any tool call.
#
# Trigger: question mark in user prompt activates diagnostic mode (STOP all work).

set -euo pipefail

# node, NOT jq. jq is not installed on every host these hooks run on — it is
# absent on the operator's Windows machine, where the missing binary made this
# hook parse nothing and emit nothing for its entire life. node ships with
# Claude Code, so it is the one interpreter a hook can depend on. The trailing
# `|| true` + empty-string catch keep a parse failure from aborting the turn.
INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)?.prompt??""))}catch{process.stdout.write("")}})' 2>/dev/null || true)

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

    # UserPromptSubmit adds plain stdout to the model's context — no JSON envelope.
    printf '%s\n' "$GATE"
fi
