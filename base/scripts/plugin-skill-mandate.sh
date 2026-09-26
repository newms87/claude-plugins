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

(1) base:shell-discipline: TRIGGER: file op via cat/head/tail/sed/awk/grep over Read/Edit/Write; MCP call without schema; trailing `&`/`nohup`/`setsid`/`disown` in Bash (use `run_in_background: true`); chained bash with a long-running step (deploys, builds, full suites, container ops); interpreting `EXIT=0` from a chain ending in `tail`/`grep`/`head`/`cat`; arming Monitor; `until <cond>; do sleep N; done`; polling backend job state / remote API / `tail -f | grep`; "tell me when X is done"; kill / pkill / killall / taskkill / `kill -9` / `kill -<sig>` / docker kill of a specific process or PID; composite "find PID then kill it". Read-only `ps`/`pgrep`/`lsof` and graceful lifecycle (`docker compose down`, `systemctl stop`) do NOT fire.
(3) base:sub-agent-delegation: TRIGGER: any Agent / Task sub-agent dispatch.
(6) base:docs-first: TRIGGER: asserting behavior of an external product (Claude Code, Anthropic API, Trello, Docker, Vite, npm); designing a hook/wrapper around one; grepping local install to figure out behavior.
(7) base:convey: TRIGGER: drafting any report / commit / PR / comment / Slack reply / hand-off / investigation longer than one line.
(8) dev:ideal-solution-mindset: TRIGGER: fix-options list; error-handling design on a critical path; adding a fallback / retry / graceful-degradation branch.

Other installed plugins carry their own equivalent mandate for their own skills — this list covers base's own triggers plus one pointer into dev.

NO rationalization. "I already know the rule" / "just one quick X" / "skill is overkill" / "load it after I orient and act" are violations, not reasoning. Load now, then act. "Forgot to load" is never an explanation — load it and redo the step.
EOF

printf '%s\n' "$MANDATE"
