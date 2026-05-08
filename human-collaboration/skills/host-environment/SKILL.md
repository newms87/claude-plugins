---
name: host-environment
description: 'MANDATORY when running shell commands or starting/inspecting docker on the host dev machine. Loads cd-first / relative-paths / HMR-immediate / docker-just-start / async-needs-ScheduleWakeup / never-edit-node_modules discipline as TodoWrite checklist. Triggers — about to run a long-running command, about to ask the user about their environment, about to install host-side deps.'
---

# Environment Rules

## Always cd First

Before running git, build tools, any project command, ALWAYS cd into expected directory first. Working directory state unreliable — always be explicit: `cd /path/to/project && git status`.

## Relative Paths Only

Absolute paths forbidden in all bash commands. Require manual approval + break autonomous operation. Always use relative paths (`./vendor/bin/sail test`, `yarn build`). Command fails → check `pwd` first — never switch to absolute paths as fix.

## "Locally" means the LOCAL dev stack, not "from my terminal"

User says "locally", "local", "on my machine", "the local X" (worker, poller, dashboard, API, container) → mean dev stack running on THIS HOST — `docker ps`, `docker logs`, `make logs`, `localhost:<port>`. Do NOT mean "from my terminal running commands against production." Default to local every time. Check `docker ps` first → see what's running locally. Only touch production when user explicitly says "prod", "production", "deployed", or names deployment target (e.g. "on gpt", "on the EC2 instance"). Rule exists because SSHing into prod feels equivalent to agent ("still my terminal") but categorically different from user's mental model — meant stack, you defaulted to shell.

## Everything Is Immediate (HMR)

Local dev environment. PHP/Laravel changes apply instantly. Vue/TypeScript uses Vite HMR. CSS/Tailwind updates instantly. Only run production builds when explicitly requested for final validation.

## Never Ask About Environment

User's environment identical to yours. HMR → every saved file live instantly. Never ask "which commit?", "which environment?", "can you confirm your setup?" — investigate code instead.

## Long-Running Commands: Background Only

Commands matching these patterns MUST use `run_in_background: true` with NO timeout: `make backtest`, `make hyperopt`, `make monthly-opt`, `make adaptive-*`, `make analyze`, `make signal-stability`, `make gate-analysis`, `make sweep-thresholds`, `make feature-importance`, `docker compose run.*freqtrade`. Check if previous instance running before launching (`docker top` for containerized commands). Wait for background completion notification — do NOT poll or launch duplicates. First attempt appears stuck → verify with `docker top` before launching another — competing CPU-bound processes make each 3x slower.

## One Environment — Files Exist Everywhere or Nowhere

Docker containers volume-mounted to host. Host files = container files. No "host version" vs "container version." Write a file → exists everywhere. "File not found" → path wrong — answer 99.99% of time. Run `pwd`, fix path. Never search filesystem for file you already know path to, try container paths when host paths fail, hypothesize about partial clones.

## Docker Containers: Just Start Them

Stopped container ≠ broken infrastructure. `docker compose up -d` and continue. Never install dependencies on host, run project scripts on host, try alternatives that bypass container.

## Async Commands Require ScheduleWakeup

Run async command (agent dispatch, background job, any process returning immediately while work continues) → MUST call `ScheduleWakeup` to check later. No ability to spontaneously act — without timer, process sits unobserved indefinitely. "I'll check back in N minutes" without `ScheduleWakeup` call = lie. Pattern: dispatch → confirm launched → `ScheduleWakeup` → verify on wake → next step.

## Never Edit node_modules

Reading `node_modules/` OK for understanding dependencies. Editing NEVER OK.
