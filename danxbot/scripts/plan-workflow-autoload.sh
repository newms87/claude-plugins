#!/usr/bin/env bash
# Auto-loads the danxbot:plan-workflow skill's full body on every SessionStart
# (startup, resume, clear AND compact — no matcher, same as zero-context-mandate.sh
# and danxbot-skill-mandate.sh in this same hook group) by reading it straight off
# disk and injecting it as context, instead of relying on the agent to remember to
# call the Skill tool itself.
#
# Why: the PLUGIN SKILL LOAD MANDATE (base plugin) already lists danxbot:plan-workflow
# as a load-before-mutating trigger, but that is only a POINTER telling the agent to
# go call Skill(danxbot:plan-workflow) — it is not the skill itself. In practice a
# resumed/compacted session repeatedly skipped or delayed that call and then
# orchestrated a plan from a stale or half-remembered picture of its own mechanics
# (the mechanical pickup gate, up-to-3-cards-in-flight, verifying card state before
# reporting it), which is exactly the class of failure this skill exists to prevent.
# Reading the real file fresh every SessionStart also means this can never go stale
# the way a carried-over, truncated, post-compaction fragment can: it is always the
# literal, current, on-disk skill body.
#
# This intentionally does NOT fire on UserPromptSubmit with the full body — dumping
# ~14k tokens of skill text into every single turn is exactly the "clutter the
# context window and distract the agent" anti-pattern the operator rejected when
# DX-2888 was redesigned into DX-2885's quieter, out-of-band nudge. A one-line
# pointer on UserPromptSubmit is enough to keep the mechanics top-of-mind between
# SessionStarts without re-paying that cost on every turn.
set -euo pipefail

EVENT="${1:-SessionStart}"
SKILL_FILE="${CLAUDE_PLUGIN_ROOT}/skills/plan-workflow/SKILL.md"

if [ "$EVENT" = "UserPromptSubmit" ]; then
  INPUT="$(cat 2>/dev/null || true)"
  # DX-3051 + DX-3235: a relayed danxbot dashboard event, or a background
  # sub-agent's task-notification report, is not new operator intent — this
  # skill's mechanics are already in context from SessionStart, so
  # re-asserting even the short pointer on either kind of machine-authored
  # turn is pure per-event tax with nothing new to say. Shared with
  # zero-context-mandate.sh (this plugin's only other UserPromptSubmit
  # consumer of this guard) via lib/prompt-guard.sh — see that file's header
  # for why this is NOT shared across plugin boundaries. Do not delete this
  # as dead code.
  source "${CLAUDE_PLUGIN_ROOT}/scripts/lib/prompt-guard.sh"
  PROMPT="$(extract_user_prompt "$INPUT")"
  if is_machine_authored_prompt "$PROMPT"; then
    exit 0
  fi
  printf '%s\n' "danxbot:plan-workflow SHOULD have been auto-loaded in full at this session's last SessionStart (see that block above/earlier in context) — its mechanics (TodoWrite checklist, mechanical pickup gate, up-to-3-cards-in-flight, Turn Gate) apply. If that block looks short (~2KB) rather than the full skill body, the harness truncated it — call Skill(danxbot:plan-workflow) now for the complete text before relying on it."
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
