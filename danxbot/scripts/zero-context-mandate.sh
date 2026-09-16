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

3. RUNNING A PLAN WITH SUB-AGENTS (see danxbot:plan-workflow "Running a plan with sub-agents").
   Size every sub-agent: set the card's effort_level first, then dispatch the matching
   danxbot:worker-<model>-<effort> agent — never let a sub-agent inherit the session's own model.
   Card status is always true: In Progress only while something is actively working it; when
   nobody is, issue_transition rollback_pickup keep_assignment:true — one call, back to ToDo,
   assigned_agent untouched.
   Liveness claims need live evidence: never call a dispatch "running" or "making progress" from
   a status field alone — cite two timestamped progress reads 60s+ apart, or a JSONL last-entry age.
   Session names match: pass your Claude session title as plan_connect's title argument, never
   the repo folder; re-connect with the new title after a rename.
   The plan never waits on the worker: keep up to 3 cards in flight on your own sub-agents,
   picking up the next unblocked card as one finishes; the worker is extra capacity only.
EOF

printf '%s\n' "$MANDATE"
