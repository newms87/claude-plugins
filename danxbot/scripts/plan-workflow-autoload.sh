#!/usr/bin/env bash
# Auto-loads the danxbot:plan-workflow skill's full body on every SessionStart
# (startup, resume, clear AND compact — no matcher) by reading it straight off
# disk and injecting it as context, instead of relying on the agent to remember to
# call the Skill tool itself.
#
# Why: the mantra's one-line skill pointer (danxbot/mantra.md, DX-3347) already
# names danxbot:plan-workflow as a load-before-mutating trigger, but that is only
# a POINTER telling the agent to go call Skill(danxbot:plan-workflow) — it is not
# the skill itself. In practice a resumed/compacted session repeatedly skipped
# or delayed that call and then
# orchestrated a plan from a stale or half-remembered picture of its own mechanics
# (the mechanical pickup gate, up-to-3-cards-in-flight, verifying card state before
# reporting it), which is exactly the class of failure this skill exists to prevent.
# Reading the real file fresh every SessionStart also means this can never go stale
# the way a carried-over, truncated, post-compaction fragment can: it is always the
# literal, current, on-disk skill body.
#
# DX-3347: this no longer fires on UserPromptSubmit at all (it used to emit a
# one-line pointer every turn — 421 bytes/message, measured DX-3278 comment
# 6976). R-12 restricted every per-message reminder to a tiny mantra printed
# only at session start/resume/compaction; this skill's own SessionStart
# full-body injection already satisfies that cadence for plan-workflow
# specifically, so the per-turn pointer had nothing left to add. Its
# suppression helper (lib/prompt-guard.sh) is deleted along with it.
#
# DX-3275 / PLN-11 R-10: before a plan is connected, the danxbot plugin's
# ONLY session-start text is `mantra.sh`'s short nudge — this verbatim
# skill-body dump stays silent (no output at all, on ANY source, including
# `clear`) until the session's connection record exists. Detection is the
# same local file stat `mantra.sh` and `plan-connect-mantra.mjs` use
# (`scripts/lib/plan-connection.mjs`, a check against
# `~/.config/danxbot/plan-sessions/<session>.json`) — never a second,
# independent way of answering the same question.
set -euo pipefail

EVENT="${1:-SessionStart}"
SKILL_FILE="${CLAUDE_PLUGIN_ROOT}/skills/plan-workflow/SKILL.md"
CONNECTION_LIB="${CLAUDE_PLUGIN_ROOT}/scripts/lib/plan-connection.mjs"

if [ "$EVENT" != "SessionStart" ]; then
  exit 0
fi

PAYLOAD="$(cat)"

CONNECTED="0"
if [ -f "$CONNECTION_LIB" ]; then
  CONNECTED="$(printf '%s' "$PAYLOAD" | node "$CONNECTION_LIB" 2>/dev/null || true)"
fi

if [ "$CONNECTED" != "1" ]; then
  # Not connected: stay completely silent. `mantra.sh` (same cadence
  # decision, DX-3052 problem 1602) owns the one nudge the plugin shows
  # before a plan is connected — this hook adding its own text here would
  # duplicate it.
  exit 0
fi

if [ ! -f "$SKILL_FILE" ]; then
  # Fail loud rather than silently skipping the load — a missing file here means
  # the plugin install is broken, which is itself worth surfacing.
  printf '%s\n' "⚠ danxbot:plan-workflow AUTO-LOAD FAILED: expected skill file not found at $SKILL_FILE. The plugin install may be corrupt — call Skill(danxbot:plan-workflow) manually and report this if it also fails."
  exit 0
fi

# Strip the YAML frontmatter (everything between the first two '---' lines): the
# frontmatter's `description` is for the skill picker, not useful as injected
# context, and printing it verbatim would look like a broken skill invocation.
BODY="$(awk '/^---$/{n++; next} n>=2' "$SKILL_FILE")"

printf '%s\n' "danxbot:plan-workflow AUTO-LOAD ATTEMPTED (full text below, read fresh from disk this SessionStart — this SHOULD satisfy the Skill(danxbot:plan-workflow) load requirement for this turn). If the block below is short (~2KB) rather than the full skill body, the harness truncated this SessionStart output and only a preview reached you — call Skill(danxbot:plan-workflow) explicitly to get the complete text before relying on it. This is re-attempted on every session start, resume, clear and compact."
printf '\n'
printf '%s\n' "$BODY"
