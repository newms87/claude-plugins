#!/usr/bin/env bash
# Danxbot plugin skill load mandate — high-violation triggers only.
#
# Fires on SessionStart and UserPromptSubmit. Injects an unambiguous
# mandate forcing the agent to invoke high-violation danxbot skills
# BEFORE the first mutating action of a task matching the triggers below.
#
# Lower-violation skills (comment-style, slack-agent, prod-access, vue-app-build,
# dispatch-deep, settings-deep, docker-deep, danx-* workflow skills) rely
# on frontmatter `description` only — NOT in this mandate.
#
# Argv: $1 = "SessionStart" or "UserPromptSubmit" (hook event name).

set -euo pipefail

EVENT="${1:-SessionStart}"

# Drain stdin for UserPromptSubmit.
if [ "$EVENT" = "UserPromptSubmit" ]; then
    cat >/dev/null
fi

read -r -d '' MANDATE <<'EOF' || true
DANXBOT PLUGIN SKILL LOAD MANDATE — 10 high-violation triggers only.

These skills address the hardest-to-repair failure modes in autonomous dispatch. Load them BEFORE the first mutating action when you match any trigger below.

(1) danxbot:issue-card-workflow
    TRIGGER: touching <repo>/.danxbot/issues/ (read OR write OR create), calling mcp__danx-issue__*, picking up a card id (any <PREFIX>-N), ANY request with "epic" or "phase" or "create a card" or "make a ticket". **MANDATORY for epic creation — atomic unit: "epic for X" = epic + every phase card in SAME turn. Creating epic without phase cards = violation.**

(2) danxbot:unblock
    TRIGGER: picking up a Needs Help / Blocked card, user says "unblock" / "get unstuck" / "what does this need".

(3) danxbot:issue-blocker
    TRIGGER: about to stamp `blocked: {at, reason}` on any YAML, about to populate `waiting_on[]` / `conflict_on[]`, about to recommend moving a card to Blocked, about to call danxbot_complete with "operator must X" framing.

(4) danxbot:no-false-blockers
    TRIGGER: assessing whether a card is genuinely blocked or the reason is ambiguous/recoverable. Extends issue-blocker — decision framework for the three false-blocker patterns: scope underspecified, input unavailable but fetchable, precedent card stuck (not terminal).

(5) danxbot:requires-human
    TRIGGER: stamping `requires_human: {reason, set_by: "agent", set_at: <now>}` on a card. Discipline on when requires_human is legitimate vs a blocker, when to escalate vs when to find a workaround.

(6) danxbot:no-unauthorized-worker-launch
    TRIGGER: about to run `make launch-worker` / `make launch-all-workers` / `make deploy*` / any worker or production start. Strict user-auth gate.

(7) danxbot:autonomous-mode
    TRIGGER: dispatched to a worker (DANXBOT_REPO_NAME set). Worker-only rules: no AskUserQuestion, no terminal prompts, no plan-mode pause, one exit via danxbot_complete, /loop narrow contract.

(8) danxbot:halt-flag
    TRIGGER: seeing CRITICAL_FAILURE, poller halted, or needing to signal `danxbot_complete({status: "critical_failure", ...})`. Framework for when env is broken vs when a card needs to fail.

(9) danxbot:danxbot
    TRIGGER: touching <repo>/.danxbot/ (any read/write), running make launch-worker / make deploy, investigating a stuck dispatch, explaining dispatch runtime / inter-process communication.

(10) danxbot:db-reset
    TRIGGER: about to run DB reset (`composer artisan migrate:fresh` on Laravel, `python manage.py reset_db` on Django, DROP DATABASE on SQL, etc.). Sanctioned path only.

All other danxbot skills (comment-style, slack-agent, prod-access, vue-app-build, dispatch-deep, settings-deep, docker-deep, danx-triage-card, danx-flesh-out, danx-next, danx-start, danx-ideate, danx-chat, danx-epic-link, danx-triage-orchestrator) rely on skill frontmatter `description` as the primary trigger doc. Load via the Skill tool when their domain matches your task.

NO rationalization — if a trigger matches, load the skill immediately. Do not pattern-match around it.
EOF

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
