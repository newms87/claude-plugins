#!/usr/bin/env bash
# Investigation gate hook (ships with the `investigate` plugin).
#
# Detects diagnostic triggers in the user prompt and injects a mandatory
# pre-response gate forcing Skill(investigate) before any tool call.
#
# Trigger patterns mirror the investigate skill's SKILL.md description so
# enforcement and skill content stay aligned. Edit one, edit both.

set -euo pipefail

# node, NOT jq. jq is not installed on every host these hooks run on — it is
# absent on the operator's Windows machine, where the missing binary made this
# hook parse nothing and emit nothing for its entire life. node ships with
# Claude Code, so it is the one interpreter a hook can depend on. The trailing
# `|| true` + empty-string catch keep a parse failure from aborting the turn.
INPUT=$(cat)
PROMPT=$(printf '%s' "$INPUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)?.prompt??""))}catch{process.stdout.write("")}})' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)

if [ -z "$PROMPT" ]; then
    exit 0
fi

# DX-3051 + DX-3235: a trigger word inside a relayed danxbot dashboard event (a
# card TITLE, e.g. "...audit: trim every skill") or inside a background sub-agent's
# task-notification report is the CARD's or the AGENT's text, not the operator's —
# this gate exists to catch operator intent, and firing on either kind of
# machine-authored text is reproduced (a title containing "audit" emitted the full
# investigation gate; so did a task-notification report using "why"/"audit").
# RELAY_MARKER (danxbot's plan-event-bridge.mjs) and TASK_NOTIFICATION_MARKER (the
# whole line reading exactly `<task-notification>`, which opens every real
# notification turn's text; whole-line so an inline mention still fires) are the only
# available signals: Claude Code's documented UserPromptSubmit hook schema
# (`prompt: str`, checked 2026-09-24 against https://code.claude.com/docs/en/hooks.md
# and the Agent SDK hook-input types) carries no message-source field. PROMPT is
# already lowercased above, and `<task-notification>` is already all-lowercase, so
# the marker check below matches unchanged. This is the ONLY consumer of this guard
# in this plugin, so it stays inline rather than a single-consumer "shared" file
# (see base/scripts/lib/prompt-guard.sh for the two-consumer case). Do not delete
# this as dead code — it is load-bearing for every relayed event and every task
# notification.
RELAY_MARKER='[danxbot-relayed-event]'
TASK_NOTIFICATION_MARKER='<task-notification>'
if printf '%s' "$PROMPT" | grep -qF -- "$RELAY_MARKER"; then
    exit 0
fi
if printf '%s' "$PROMPT" | grep -qxF -- "$TASK_NOTIFICATION_MARKER"; then
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

    # UserPromptSubmit adds plain stdout to the model's context — no JSON envelope.
    printf '%s\n' "$GATE"
fi
