#!/usr/bin/env bash
# Danxbot plugin skill load mandate — fires on SessionStart only.
set -euo pipefail

EVENT="${1:-SessionStart}"

read -r -d '' MANDATE <<'EOF' || true
DANXBOT SKILL LOAD MANDATE. Load the matching skill BEFORE the first mutating action.

HIGH-VIOLATION:
(1) danxbot:issue-card-workflow — touching <repo>/.danxbot/issues/, mcp__danx-issue__*, <PREFIX>-N card ids, "epic"/"phase"/"create a card"/"make a ticket". MECHANICAL ACTION-#1 CHECK: prompt/handoff contains a card id (<PREFIX>-N) for work THIS session will do → loading this skill + claiming the card (issue_transition pickup manual:true) is the FIRST action — BEFORE Read-orient-then-edit, BEFORE loading other dev skills, BEFORE the first Edit/Write. A scripted handoff that names the card but only mentions the terminal complete transition is NOT an exemption; "card already exists" / "handoff scripted the steps" are the rationalizations this check blocks. ALSO scope-trigger — NO keyword required, fires on work-shape: before the FIRST mutating step of operator-initiated work that is multi-phase / a deploy / launch / migration, OR before recording ANY durable work-record (plan/findings/design/handoff/spec) — whether you'd write it to a repo .md OR track it only in TaskCreate/TaskList — load this skill + file a card FIRST. TaskList/.md ≠ card (ephemeral). "User didn't say card" / "just an interactive session" is the rationalization this gate blocks — scope, not keyword. Epic creation atomic: "epic for X" = epic + every phase card in SAME turn.
(2) danxbot:unblock — picking up Needs Help / Blocked card; "unblock"/"get unstuck"/"what does this need".
(3) danxbot:issue-blocker — about to stamp `blocked: {at, reason}`, populate `waiting_on[]`/`conflict_on[]`, recommend Blocked, or call danxbot_complete with "operator must X" framing.
(4) danxbot:no-false-blockers — assessing blocker is genuine vs ambiguous/recoverable (three false-blocker patterns).
(5) danxbot:requires-human — stamping `requires_human: {reason, set_by, set_at}`; requires_human vs Blocked vs workaround.
(6) danxbot:no-unauthorized-worker-launch — about to run `make launch-worker`/`make launch-all-workers`/`make deploy*`/any worker or prod start.
(7) danxbot:autonomous-mode — dispatched to worker (DANXBOT_REPO_NAME set); no AskUserQuestion, no plan-mode pause, one exit via danxbot_complete.
(8) danxbot:halt-flag — CRITICAL_FAILURE present, poller halted, or signaling `danxbot_complete({status:"critical_failure"})`.
(9) danxbot:danxbot — touching <repo>/.danxbot/, running make launch-worker/deploy, investigating stuck dispatch, explaining dispatch runtime.
(10) danxbot:db-reset — destructive DB reset (`migrate:fresh`, `DROP DATABASE`, etc.).

DOMAIN-MATCH (load via Skill tool):
- comment-style: editing `description`/`comments[]`/`retro.*` on issue YAMLs.
- slack-agent: dispatched in `slack-worker` workspace.
- prod-access: ops against deployed targets; "production unreachable" claims.
- template-app-build: Vue SPA template in danxbot template-app workspace; per-id `load_template_app`/`save_template_app`/`vite build`.
- dispatch-deep: dispatch/resume/staged-files/Playwright-proxy/usage-dedup/stall code.
- settings-deep: `<repo>/.danxbot/settings.json` schema/reader/writer code.
- docker-deep: root `.mcp.json` inject, `.env.<target>` overlay, workspace cwd.
- danx-next: `/danx-next` — top ToDo card, full autonomous workflow.
- danx-start: `/danx-start` — all ToDo cards sequentially.
- danx-ideate: `/danx-ideate` — generate feature cards.
- danx-chat: auto-dispatched per chat-tab message.
- danx-triage-card: auto-dispatched 1-card-per-tick by poller.
- danx-triage-orchestrator: `/danx-triage` — drain Review via parallel subagents.
- danx-flesh-out: auto-dispatched on Create-Card.
- danx-epic-link: auto-fires on Epic with empty children[].
EOF

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
