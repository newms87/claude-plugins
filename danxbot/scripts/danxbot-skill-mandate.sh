#!/usr/bin/env bash
# Danxbot plugin skill load mandate — fires on SessionStart only.
set -euo pipefail

EVENT="${1:-SessionStart}"

read -r -d '' MANDATE <<'EOF' || true
DANXBOT SKILL LOAD MANDATE. Load the matching skill BEFORE the first mutating action.

⚠ VESSEL GATE — fires with NO skill loaded; act on THIS text alone, do not wait to load anything. About to Write/Edit a durable work-record — a spec / design / plan / findings / handoff / requirements doc / "notes for the agent building X"? Its ONLY home is an issue card: the content goes in the card BODY (mcp__danx-dashboard__issue_create, then issue_comment for additions). FORBIDDEN vessels — a `.md` anywhere in a repo tree (`docs/`, repo root, ANY tracked/committed path) AND `TaskCreate`/`TaskList`: both bypass the tracker, litter version control, and a dispatched worker cannot read your local files. Mechanical pre-Write check on EVERY `.md`/spec you are about to create: "Is this a durable work-record?" YES → card body, NEVER a file. "It's the deliverable" / "docs/ is where specs live" / "the agent needs a file to read" / "I'll just write it then file a card" are the exact rationalizations this gate blocks — the agent reads the CARD. A standalone file is allowed ONLY when the operator explicitly asks for a file/doc. Then load danxbot:issue-card-workflow for the full lifecycle.

HIGH-VIOLATION:
(1) danxbot:issue-card-workflow — touching issue cards via mcp__danx-dashboard__issue_*, <PREFIX>-N card ids, "epic"/"phase"/"create a card"/"make a ticket". MECHANICAL ACTION-#1 CHECK: prompt/handoff contains a card id (<PREFIX>-N) for work THIS session will do → loading this skill + claiming the card (issue_transition pickup manual:true) is the FIRST action — BEFORE Read-orient-then-edit, BEFORE loading other dev skills, BEFORE the first Edit/Write. A scripted handoff that names the card but only mentions the terminal complete transition is NOT an exemption; "card already exists" / "handoff scripted the steps" are the rationalizations this check blocks. ALSO scope-trigger — NO keyword required, fires on work-shape: before the FIRST mutating step of operator-initiated work that is multi-phase / a deploy / launch / migration → load this skill + file a card FIRST. "User didn't say card" / "just an interactive session" is the rationalization this gate blocks — scope, not keyword. (The durable-work-record / spec-handoff vessel gate is the ⚠ VESSEL GATE block above — it fires without loading.) Epic creation atomic: "epic for X" = epic + every phase card in SAME turn. TYPE-IN-CHAT trigger — proposing/arguing a card TYPE (Epic/Feature/Story) in prose, BEFORE any tool call, fires this load: run the slice-count gate first. DEFAULT to the SMALLEST fitting type; Epic ONLY when the work splits into multiple Features. Migration-count / 2-subsystems / file-count / "feels big" are NOT Epic signals (a multi-file, multi-migration change shipping as a handful of green commits is a Feature). Calling it an Epic in chat without the gate is the failure this blocks.
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
- comment-style: editing `description`/`comments[]`/`retro.*` on issue cards.
- slack-agent: dispatched under the `slack-worker` profile.
- prod-access: ops against deployed targets; "production unreachable" claims.
- template-app-build: Vue SPA template on a danxbot template-app dispatch; per-id `load_template_app`/`save_template_app`/`vite build`.
- dispatch-deep: dispatch/resume/staged-files/Playwright-proxy/usage-dedup/stall code.
- settings-deep: `<repo>/.danxbot/settings.json` schema/reader/writer code.
- docker-deep: root `.mcp.json` inject, `.env.<target>` overlay, clean-room cwd.
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
