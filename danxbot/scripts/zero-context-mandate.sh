#!/usr/bin/env bash
# Danxbot zero-context continuity + ideal-solution mantra.
# SessionStart (no matcher, so it re-injects after every compaction) gets the full text;
# UserPromptSubmit gets a one-line pointer. Plain stdout only: jq is not installed in the hook runtime.
set -euo pipefail

EVENT="${1:-SessionStart}"

if [ "$EVENT" = "UserPromptSubmit" ]; then
  INPUT="$(cat 2>/dev/null || true)"
  # DX-3051 + DX-3235: a relayed danxbot dashboard event, or a background
  # sub-agent's task-notification report, is not new operator intent — this
  # mantra is already in context from SessionStart, so re-asserting even the
  # short pointer on either kind of machine-authored turn is pure per-event
  # tax with nothing new to say. Shared with plan-workflow-autoload.sh (this
  # plugin's only other UserPromptSubmit consumer of this guard) via
  # lib/prompt-guard.sh — see that file's header for why this is NOT shared
  # across plugin boundaries. Do not delete this as dead code.
  source "${CLAUDE_PLUGIN_ROOT}/scripts/lib/prompt-guard.sh"
  PROMPT="$(extract_user_prompt "$INPUT")"
  if is_machine_authored_prompt "$PROMPT"; then
    exit 0
  fi
  printf '%s\n' "DANXBOT MANTRA still in force: every piece of work, follow-up and cleanup lives on a card (AC item or its own card) or in the plan, never only in this session; ideal and correct solution, zero tech debt, go slow to go fast, leave no rakes; work only your connected plan's cards, highest-priority unblocked first — an off-plan finding is FILED to the plan it serves, never built here — and give every card you file a priority chosen against the cards already on the plan."
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
   A plan note (plan_add_note) is a DIFFERENT thing, not a substitute for any item above: a short
   milestone entry on the operator's timeline, written only when a completion, decision or record
   change is worth flagging — never the record of the work itself.
   Never: chat, TaskCreate/TaskList, the session scratchpad (wiped between sessions), your own memory,
   or "I'll remember to do that after X finishes".

   WORKTREES, CLONES, SCRATCH COPIES AND BACKUP PATCHES YOU CREATE. An agent's own git worktree,
   clone, scratch copy or backup patch lives INSIDE its repo, under that repo's git-ignored
   `<repo>/.claude/worktrees/<name>` — never as a sibling checkout in the projects folder, never
   in WSL. Whoever creates it owns removing it. Before reporting done: prove `git status
   --porcelain` is empty and `git cherry origin/main <branch>` shows no `+` lines (nothing unpushed) — or,
   if it must outlive you, record on the card why and who owns it next — then `git worktree
   remove` and delete the branch, and name what you removed in your final report. A sub-agent
   brief that lets an agent create a checkout MUST carry this paragraph: hooks injected here
   reach only the session that reads this file, never a sub-agent's own zero-context window (see
   danxbot:plan-workflow "Running a plan with sub-agents").

   MECHANICAL CHECK — run it before every chat reply, before dispatching or stopping any sub-agent, and before any
   compaction or session end: "If this session were wiped right now, would a zero-context agent miss a single item
   of work or cleanup?" Any YES → write that item to its card or plan now, then continue.

2. RUNNING A PLAN WITH SUB-AGENTS — the mechanics (sizing table, keep-3-in-flight, liveness
   evidence, chat budget, turn gate) are the connected danxbot:plan-workflow skill's own body,
   injected in full by the sibling SessionStart hook in this SAME batch — this mantra does not
   restate them. Two points genuinely not there:
   - PRIORITY ORDER, NEVER RECENCY. Take the highest-priority unblocked card among your plan's
     open and in-progress cards, read THIS turn — not whatever you discovered most recently.
     Give every card you file a priority against the cards already on the plan.
   - A CARD YOU FILED AND NEVER READIED IS UNFINISHED WORK, NOT A QUEUE ENTRY. `ready_at: null`
     means `dispatchable_derived: false` — nothing will ever claim it. Readying is yours to do
     in the same breath as filing, not a later step and not the operator's call, unless it
     carries an open problem.
EOF

printf '%s\n' "$MANDATE"
