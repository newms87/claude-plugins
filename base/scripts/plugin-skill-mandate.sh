#!/usr/bin/env bash
# Plugin skill load mandate — ships with the `base` plugin.
#
# Fires on SessionStart and UserPromptSubmit. Injects an unambiguous
# mandate forcing the agent to invoke the matching skill via the Skill
# tool BEFORE the first mutating action of any task whose triggers
# match an installed plugin's domain.
#
# Background: skill descriptions in the available-skills list are
# necessary but insufficient. Past sessions have skipped skills because
# the trigger was paraphrased, the task "felt small," or the agent
# thought it knew the rule already. Every one of those was a workflow
# violation. This hook makes the load mandate explicit and unbypassable
# at the prompt-injection layer.
#
# Argv: $1 = "SessionStart" or "UserPromptSubmit" (selects the hook
# event name in the JSON envelope so the harness routes the
# additionalContext correctly).

set -euo pipefail

EVENT="${1:-SessionStart}"

# Drain stdin (UserPromptSubmit hooks receive the prompt JSON; we don't
# need to inspect it for this universal mandate, but we must not block
# the pipe).
if [ "$EVENT" = "UserPromptSubmit" ]; then
    cat >/dev/null
fi

read -r -d '' MANDATE <<'EOF' || true
PLUGIN SKILL LOAD MANDATE — installed plugin skills are LOAD-FIRST. BEFORE the first mutating tool call (Edit/Write/MCP mutate/git commit/push) of any task matching a trigger below, invoke the matching skill via the Skill tool. Read-only orientation (Read/Glob/Grep/ls) allowed first.

⚠ TRUNCATION CLAUSE — skill TEXT in context is NOT a loaded skill. The ONLY thing that counts as loaded is an actual `Skill(<name>)` call YOU made in THIS context window. If you cannot point to that call, the skill is NOT loaded — no matter how much of its body you can see. Specifically: any skill body carrying a truncation/compaction marker (`[... skill content truncated for compaction]`, `[truncated]`, `…`, an abridged summary, or a body that simply survived a compaction) is a FRAGMENT. Compaction preserves fragments that read convincingly like the real thing — headers, rule names, the shape of a checklist — while dropping the gates, the ordering constraints, and the exact mechanical checks that are the entire point. A summary of a gate is not the gate. Reading a gate's NAME is not running it. Mechanical check before the first mutating action: "Did I call Skill(X) in this context window?" NO → call it now, even if X's text is already on screen. "It's already in my context" / "I can see the rule right there" / "re-loading wastes tokens" are the exact rationalizations this clause blocks — a truncated body is precisely when re-loading is cheapest relative to the violation it prevents.

Hard MANDATORY triggers — match any one, load the skill immediately. Only installed plugins apply:

(1) base:tool-discipline: TRIGGER: file op via cat/head/tail/sed/awk/grep over Read/Edit/Write; MCP call without schema; trailing `&`/`nohup`/`setsid`/`disown` in Bash (use `run_in_background: true`).
(2) base:process-kill: TRIGGER: kill / pkill / killall / taskkill / `kill -9` / `kill -<sig>` / docker kill of a specific process or PID; composite "find PID then kill it". Read-only `ps`/`pgrep`/`lsof` and graceful lifecycle (`docker compose down`, `systemctl stop`) do NOT fire.
(3) base:sub-agent-delegation: TRIGGER: any Agent / Task sub-agent dispatch.
(4) base:bash-exit-capture: TRIGGER: chained bash with a long-running step (deploys, builds, full suites, container ops); interpreting `EXIT=0` from a chain ending in `tail`/`grep`/`head`/`cat`.
(5) base:monitor-polling: TRIGGER: arming Monitor; `until <cond>; do sleep N; done`; polling backend job state / remote API / `tail -f | grep`; "tell me when X is done".
(6) base:docs-first: TRIGGER: asserting behavior of an external product (Claude Code, Anthropic API, Trello, Docker, Vite, npm); designing a hook/wrapper around one; grepping local install to figure out behavior.
(7) base:convey: TRIGGER: drafting any report / commit / PR / comment / Slack reply / hand-off / investigation longer than one line.
(8) base:fail-loudly: TRIGGER: fix-options list; error-handling design on a critical path; adding a fallback / retry / graceful-degradation branch.
(9) human-collaboration:artifact-plan: TRIGGER: any task with a human in the loop that goes beyond a quick cleanup — starting a multi-step plan or build; ANY question whose answer affects a plan; monitoring anything over time; context nearly exhausted mid-task; about to /compact; operator says "hand off" / "wrap up so we can continue later"; any session-end where work is unfinished. The published artifact REPLACES every other planning method — no plan file, no `~/.claude/plans/*.md`, no repo `.md`, no chat summary, and there is no separate handoff skill: the handoff is a Resume-here entry written INTO the page, from current state only, every claim tagged VERIFIED/UNVERIFIED/UNKNOWN. Load it before CREATING a page. You do NOT need it to EDIT one — the template is self-documenting, so re-read the page itself and follow the contract block inside it.

NO rationalization. "I already know the rule" / "just one quick X" / "skill is overkill" / "load it after I orient and act" are violations, not reasoning. Load now, then act. "Forgot to load" is never an explanation — load it and redo the step.
EOF

printf '%s\n' "$MANDATE"
