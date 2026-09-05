---
name: host-environment
description: 'Host-machine shell discipline: cd-first, relative paths, HMR-immediate, docker-just-start, async-needs-ScheduleWakeup, never-edit-node_modules.'
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

The identical-environment premise justifies not ASKING; it never licenses ASSUMING which tree / host / container you actually read from. When that is load-bearing to a claim, name it and check it.

## Long-Running Commands: Background Only

Commands matching these patterns MUST use `run_in_background: true` with NO timeout: `make backtest`, `make hyperopt`, `make monthly-opt`, `make adaptive-*`, `make analyze`, `make signal-stability`, `make gate-analysis`, `make sweep-thresholds`, `make feature-importance`, `docker compose run.*freqtrade`. Check if previous instance running before launching (`docker top` for containerized commands). Wait for background completion notification — do NOT poll or launch duplicates. First attempt appears stuck → verify with `docker top` before launching another — competing CPU-bound processes make each 3x slower. "Do not poll" is not "sit idle": get on with other work while it runs (canon principle 1) — what is banned is burning turns re-checking, not using them.

## "File Not Found" — Wrong Path, or Wrong Filesystem. Never "Lag"

A container volume-mounted from the host shares one filesystem: host file = container file, no "host version" vs "container version". There, `file not found` is a wrong path essentially every time — run `pwd`, fix the path, move on. Never search the filesystem for a path you already know, never try container paths when host paths fail, never hypothesize about partial clones.

The one real exception is a repo that exists **twice** on genuinely different filesystems — a native checkout mirrored to another OS side, a VM, a sync tool. Then each side holds its own copy, some paths are excluded from the mirror outright (scratch dirs, `.env`, generated trees), and creation may not propagate symmetrically. Establish which side you are reading from and which side must execute the file, then create new files on the executing side. Anything machine-specific about the local topology belongs in the user-global `CLAUDE.md`, not here.

Either way, **a sync delay is never the diagnosis.** It explains any absence, so it explains nothing, and it terminates the investigation exactly where the real check starts. Check the mirror's exclusion list, then read the file back from the side you actually care about.

## Docker Containers: Just Start Them

Stopped container ≠ broken infrastructure. `docker compose up -d` and continue. Never install dependencies on host, run project scripts on host, try alternatives that bypass container.

## Async Commands Require ScheduleWakeup

Run async command (agent dispatch, background job, any process returning immediately while work continues) → MUST call `ScheduleWakeup` to check later. No ability to spontaneously act — without timer, process sits unobserved indefinitely. "I'll check back in N minutes" without `ScheduleWakeup` call = lie. Pattern: dispatch → confirm launched → `ScheduleWakeup` → verify on wake → next step.

## Never Edit node_modules

Reading `node_modules/` OK for understanding dependencies. Editing NEVER OK.
