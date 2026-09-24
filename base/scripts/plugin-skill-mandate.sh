#!/usr/bin/env bash
# Plugin skill load mandate — ships with the `base` plugin.
#
# Fires on SessionStart only (hooks.json). Injects an unambiguous
# mandate forcing the agent to invoke the matching skill via the Skill
# tool BEFORE the first mutating action of any task whose triggers
# match an installed plugin's domain.
#
# Argv: $1 = "SessionStart".

set -euo pipefail

read -r -d '' MANDATE <<'EOF' || true
PLUGIN SKILL LOAD MANDATE — installed plugin skills are LOAD-FIRST. BEFORE the first mutating tool call (Edit/Write/MCP mutate/git commit/push) of any task matching a trigger below, invoke the matching skill via the Skill tool. Read-only orientation (Read/Glob/Grep/ls) allowed first.

⚠ TRUNCATION CLAUSE — skill TEXT in context, however complete it looks, is NOT a loaded skill; only a `Skill(<name>)` call made in THIS window counts. Full rationale + the mechanical check: the post-compaction skill-reload gate (fires on every `compact`).

Hard MANDATORY triggers — match any one, load the skill immediately. Only installed plugins apply:

(1) base:tool-discipline: TRIGGER: file op via cat/head/tail/sed/awk/grep over Read/Edit/Write; MCP call without schema; trailing `&`/`nohup`/`setsid`/`disown` in Bash (use `run_in_background: true`).
(2) base:process-kill: TRIGGER: kill / pkill / killall / taskkill / `kill -9` / `kill -<sig>` / docker kill of a specific process or PID; composite "find PID then kill it". Read-only `ps`/`pgrep`/`lsof` and graceful lifecycle (`docker compose down`, `systemctl stop`) do NOT fire.
(3) base:sub-agent-delegation: TRIGGER: any Agent / Task sub-agent dispatch.
(4) base:bash-exit-capture: TRIGGER: chained bash with a long-running step (deploys, builds, full suites, container ops); interpreting `EXIT=0` from a chain ending in `tail`/`grep`/`head`/`cat`.
(5) base:monitor-polling: TRIGGER: arming Monitor; `until <cond>; do sleep N; done`; polling backend job state / remote API / `tail -f | grep`; "tell me when X is done".
(6) base:docs-first: TRIGGER: asserting behavior of an external product (Claude Code, Anthropic API, Trello, Docker, Vite, npm); designing a hook/wrapper around one; grepping local install to figure out behavior.
(7) base:convey: TRIGGER: drafting any report / commit / PR / comment / Slack reply / hand-off / investigation longer than one line.
(8) base:fail-loudly: TRIGGER: fix-options list; error-handling design on a critical path; adding a fallback / retry / graceful-degradation branch.
(9) danxbot:plan-workflow: TRIGGER: any task with a human in the loop that goes beyond a quick cleanup — starting a multi-step plan or build; ANY question whose answer affects a plan; monitoring anything over time; context nearly exhausted mid-task; about to /compact; operator says "hand off" / "wrap up so we can continue later"; resuming work after a restart or compaction; any session-end where work is unfinished. The connected danxbot Plan is the ONLY planning record — goals/rules/caveats as plan records, design in its architecture document, work and operator questions as attached cards. No plan file, no `~/.claude/plans/*.md`, no repo `.md`, no HTML page, no chat summary, and no separate handoff document: the next session resumes by reading the plan with `plan_get`.

NO rationalization. "I already know the rule" / "just one quick X" / "skill is overkill" / "load it after I orient and act" are violations, not reasoning. Load now, then act. "Forgot to load" is never an explanation — load it and redo the step.
EOF

printf '%s\n' "$MANDATE"
