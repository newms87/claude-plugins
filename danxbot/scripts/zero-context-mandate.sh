#!/usr/bin/env bash
# Danxbot zero-context continuity + ideal-solution mantra.
# SessionStart (no matcher, so it re-injects after every compaction) gets the full text;
# UserPromptSubmit gets a one-line pointer. Plain stdout only: jq is not installed in the hook runtime.
set -euo pipefail

EVENT="${1:-SessionStart}"

if [ "$EVENT" = "UserPromptSubmit" ]; then
  printf '%s\n' "DANXBOT MANTRA still in force: every piece of work, follow-up and cleanup lives on a card (AC item or its own card) or in the plan, never only in this session; ideal and correct solution, zero tech debt, go slow to go fast, leave no rakes."
  exit 0
fi

read -r -d '' MANDATE <<'EOF' || true
DANXBOT MANTRA — ZERO-CONTEXT CONTINUITY + THE IDEAL SOLUTION. Always on, every session, every agent.

1. NOTHING LIVES ONLY IN THIS SESSION.
   Operate as if this session will be wiped at any moment and a brand-new agent with zero context takes over.
   Every piece of work that should happen now or later — each follow-up, cleanup, verification step, deploy step,
   decision, open question, deferred finding, stopped or in-flight agent, and uncommitted or unpushed local state
   (clone path, worktree, branch, local SHA) — must be written down where that agent will find it:
   - an AC item on the card it belongs to (issue_checklist add_item), or
   - its own card attached to the plan it serves (issue_create + plan_add_card), or
   - a plan record or architecture section, when it is a lasting goal, rule, caveat or design fact, or
   - a comment on the card, for status and evidence.
   Never: chat, TaskCreate/TaskList, the session scratchpad (wiped between sessions), your own memory,
   or "I'll remember to do that after X finishes".

   MECHANICAL CHECK — run it before every chat reply, before dispatching or stopping any sub-agent, and before any
   compaction or session end: "If this session were wiped right now, would a zero-context agent miss a single item
   of work or cleanup?" Any YES → write that item to its card or plan now, then continue.

2. ALWAYS THE IDEAL, CORRECT SOLUTION. Time and money to get there are irrelevant.
   Go slow to go fast. Leave no rakes behind.
   Zero tech debt · zero backwards compatibility · zero legacy code · zero deprecated or obsolete code ·
   zero duplicated code · DRY and SOLID at all times.
   A replaced path is deleted in the same change. A shortcut you would have to come back and fix is a rake: plan it
   out of existence instead. Every plan states this standard, and every card is scoped so that finishing it leaves
   none of these behind; anything that cannot land in the same card becomes its own card before the work starts.
   (Engineering detail for code: the base CRAFT mandate. Operating principles: the base OPERATING CONTRACT.)
EOF

printf '%s\n' "$MANDATE"
