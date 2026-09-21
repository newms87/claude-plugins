#!/usr/bin/env bash
# Danxbot zero-context continuity + ideal-solution mantra.
# SessionStart (no matcher, so it re-injects after every compaction) gets the full text;
# UserPromptSubmit gets a one-line pointer. Plain stdout only: jq is not installed in the hook runtime.
set -euo pipefail

EVENT="${1:-SessionStart}"

if [ "$EVENT" = "UserPromptSubmit" ]; then
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
   Incident, 2026-09-15/16: 20 stray worktrees and ~25 clones/temp folders piled up in the projects
   folder, none removed by their creators; one improvised WSL scratch copy's `rsync --delete`
   wiped the machine.

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
   THE MAPPING IS FIXED, AND SAYING IT OUT LOUD IS PART OF DISPATCHING: min/very_low →
   haiku-low · low → haiku-high · medium → sonnet-low · high → sonnet-medium ·
   very_high → sonnet-high · max → opus-high. `high` on sonnet-medium is the DEFAULT for
   most build, fix, test and investigation work. Before each dispatch, state in one visible
   line the effort you set and the agent it maps to. Going ABOVE the mapping needs its
   reason in that same line — and "important", "load-bearing", "consequential", "reverses a
   decision", "the operator is watching" are NOT reasons: they describe the stakes, not the
   code. A reviewer reading a finished diff, a card handed a complete spec, and a change
   with prior art to copy are all routine work however much rides on them. Reach for the
   top tier when the CODE is the hardest thing in the repo, and not otherwise.
   THE TELL: most of this session's dispatches are the same top tier. That is not a hard
   session; it is a sizing gate that never ran.
   Card status is always true: In Progress only while something is actively working it; when
   nobody is, issue_transition rollback_pickup keep_assignment:true — one call, back to ToDo,
   assigned_agent untouched.
   Liveness claims need live evidence: never call a dispatch "running" or "making progress" from
   a status field alone — cite two timestamped progress reads 60s+ apart, or a JSONL last-entry age.
   Session names match: pass your Claude session title as plan_connect's title argument, never
   the repo folder; re-connect with the new title after a rename.
   The plan never waits on the worker: keep up to 3 cards in flight on your own sub-agents,
   picking up the next unblocked card as one finishes; the worker is extra capacity only.

   YOUR PLAN BOUNDS WHAT YOU MAY WORK. You may work only cards on the plan you are connected to.
   Finding something off-plan is not a licence to build it: file it to the plan whose goal it serves
   (danxbot:plan-workflow "Scope") and go back to your own plan's queue. Filing it correctly and then
   working it anyway is the failure this names — the filing rule says where a finding GOES, never that
   you may now do it.

   PRIORITY ORDER, NEVER RECENCY. Take the highest-priority unblocked card among your plan's open and
   in-progress cards, read THIS turn (plan_get fields:["cards"]) — not whatever you discovered most
   recently, which is the order you will reach for by default. Priority only works if it exists: give
   every card you file a priority chosen against the cards already on the plan, and when a finding
   changes an existing card's urgency, re-prioritise it then, not later.

   DISPATCH GATE — mechanical, run it before EVERY reply that ends your turn:
   "Am I about to stop with fewer than 3 agents running while any unblocked card is open?"
   If yes, you may not send that reply. Dispatch first, then report what is now running.
   Finishing what the operator asked about does NOT end the turn — an idle board does.
   Open questions never justify stopping: dispatch the unblocked work, and ask inside the
   same reply. A status summary with 0 agents running and open cards is the failure itself.
EOF

printf '%s\n' "$MANDATE"
