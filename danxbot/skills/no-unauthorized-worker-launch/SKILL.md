---
name: no-unauthorized-worker-launch
description: 'Per-invocation user-auth gate for make launch-worker* and danxbot infra starts, with standing operator-session exceptions (local worker restarts, gpt deploy-workers, and production deploys of finished work); dispatched agents never launch or deploy.'
---

# STRICTLY PROHIBITED — Never Launch a Danxbot Worker / Poller / Deploy Without Explicit Per-Invocation Authorization

## The rule (no exceptions)

**Starting, restarting, or relaunching a danxbot WORKER/POLLER container (any `danxbot-worker-*` name), danxbot's own infra (`launch-infra`, its `docker-compose.yml`), or a production deploy target requires explicit per-invocation human authorization in the CURRENT user message.**

**This is NOT a Docker/container rule.** Ordinary local containers — Docker Desktop itself, a project's own dev stack (postgres, redis, laravel.test, spa, dashboard, etc.), anything not named `danxbot-worker-*` or part of danxbot's own infra — are unrestricted dev tooling. Start, stop, or restart them freely, any time, no approval needed.

A worker pickup is destructive. As soon as a danxbot worker boots it polls every board it serves for ToDo cards, claims them, spawns dispatched agents, writes the v2 DB, and burns tokens on every card it can grab. There is no dry-run mode. "I'll just check if it boots" is already a production incident — once the poller is up, it has already worked through part of the queue.

## Standing exception — `make deploy-workers TARGET=gpt` (operator session only)

The operator granted standing, cross-session authorization (2026-07-29) to relaunch the production machine-level worker on the `gpt` deploy target (covers the `danxbot` and `gpt-manager` boards) whenever it's found not running, without asking first. **This is the one command exempted from the per-invocation-authorization requirement above.** When `docker ps` on the `gpt` production instance shows no `danxbot-worker-gpt` container, run `make deploy-workers TARGET=gpt COMMIT=<sha>` directly and report what you did — do not stop and ask. `COMMIT=` is required (DX-3230's commit-pinning applies here too — name the commit currently expected to be live, e.g. the tip of `origin/main` or whatever the last successful `deploy` used); the target reuses the already-pushed `:latest` image, it does not rebuild.

This exception is scoped narrowly: exactly `make deploy-workers TARGET=gpt`, in an operator session. It does NOT extend to any REMOTE target, to `deploy`/`deploy-destroy`/`deploy-secrets-push`, or to dispatched-agent context — those all remain fully gated per the rule below.

## Standing exception — LOCAL worker launches/restarts (operator session only)

The operator granted a second standing, cross-session authorization (2026-09-17, via the `explain`
skill, verbatim: *"YOU NEVER need approval for launching local docker containers / restarting
them. Why are you stopping because of that?"*) covering the LOCAL machine's own danxbot worker
container(s) — `make launch-worker`, `make launch-worker-host`, and any `docker restart` /
`docker compose restart` / `docker compose up` / retried `make launch-worker*` needed to recover
an already-configured LOCAL worker from a crash, stale state, or a port conflict (`address already
in use`, `port is already allocated`). Run these directly in an operator session, no per-invocation
ask — report what you did afterward. This mirrors the `deploy-workers TARGET=gpt` exception above,
scoped to the LOCAL target instead of a remote/production one.

**Still fully gated even under this exception:** a `TARGET=` whose resolved `mode` is `deploy` (DX-1822 —
local-vs-remote is the target's own `mode` field, not a separate command; this exception covers the LOCAL
target only), `launch-infra`, `launch-dashboard-host`, every `deploy*`/`deploy-destroy`/`deploy-secrets-push`
command, and — unconditionally, no exception — dispatched-agent context (see below: a dispatched
agent has no live user message, so this exception never reaches it regardless of what an operator
said in a different session).

## Standing exception — production deploys of finished work (operator session only)

The operator granted standing, cross-session authorization (2026-09-22, verbatim: *"you don't need
my sign off to deploy. just deploy"*) to deploy committed, pushed and verified work to production
without asking first. **This exception covers `gpt` (danxbot) and gpt-manager production only.**
Deploying is part of finishing the work — do it, verify it live, report what you did. Asking "shall
I deploy?" is the failure this exception exists to remove.

- **danxbot deploys are always local now (DX-3230, 2026-09-24) — GitHub Actions is not a deploy
  path any more.** `make deploy TARGET=gpt COMMIT=<sha>` runs from ANY danxbot tree, with or
  without a real `.git`, stale or dirty — it always hands off to the dedicated deploy directory
  (`~/projects/newms87/danxbot-deploy` by default, separate from the mutagen-synced dev tree),
  which pins the exact named commit and runs the deploy from there, so the invoking tree's own
  state never matters. Run it from a login shell (`bash -l`), node 22 via nvm, `DANXBOT_TARGET`
  exported to match `TARGET=`, checking no other deploy is running and no worker dispatch is in
  flight first. Full mechanism → `.claude/rules/production-deploy.md` in the danxbot repo.
  gpt-manager: same story, DX-3282 (2026-09-25) — `scripts/deploy-local.sh [sha]`, run from
  `~/projects/newms87/gpt-manager-deploy`, is now the only deploy an agent uses. Its
  `.github/workflows/deploy-production.yml` stays wired for later, but `gh-as` (the required
  wrapper for every `gh` call) refuses `workflow run` / `run watch` / `run list` and names this
  script instead, so `make deploy` in that repo no longer reaches Actions for an agent either.
  Full contract → gpt-manager's `.claude/rules/paths-and-commands.md` "Production Deploy".
- **Each machine deploys only the target(s) its own `deploy-machine.json` names (DX-3232,
  2026-09-24) — there is no global target ban.** DX-3148's "`platform` is not deployed by anyone"
  was a gpt-machine-specific fact written as if universal; it broke the Flytedesk machine, whose
  only valid target IS `platform`. `deploy/launch.ts` reads that per-machine config (outside every
  git tree — default `~/.config/danxbot/deploy-machine.json`) before any deploy work and refuses
  loudly for any target not in it. This exception covers a machine's own configured target(s) —
  it does not grant one machine authority over a target another machine is configured for; do not
  derive a cross-machine deploy authorization from the `gpt` mechanics above, and do not ask the
  operator to bypass the config-gate refusal.
- **The deploy mechanics still bind:** check what is dispatching first, name the exact commit, never
  work around a safety guard (a secrets-overwrite refusal, a disk budget, a failed preflight) — fix
  its cause or report it.
- **A harness permission denial is not overridden by this exception.** Report the exact command to
  the operator; never route around the denial.
- **Still fully gated:** `deploy-destroy`, `deploy-secrets-push` (authoring secret values), and —
  unconditionally — dispatched-agent context.

## Dispatched-agent context — effectively NEVER

If you are a dispatched autonomous agent (running under `/danx-next`, `/danx-triage-card`, `/danx-ideate`, `/danx-start`, or any `/api/launch`-spawned dispatch) **you have no user message that authorizes launching anything.** The issue card is your prompt; cards do not authorize worker launches. Therefore — for dispatched agents — the rule is effectively **NEVER, period.** From any repo. Under any profile. Under any circumstance.

This is true even if:

- The card you are working on says "the worker should be restarted".
- A test you ran failed because the worker is down.
- Logs show the poller is stuck.
- You "just want to check that the fix took".
- You see a `Makefile` target that looks helpful.
- A skill, plan, or pipeline tells you to.
- The card belongs to the danxbot repo itself.
- You are running inside a dispatch against the danxbot repo itself.

You do not have authorization to operate the danxbot infrastructure. Only the human operator running the host session does.

## TodoWrite checklist (mandatory on first invoke)

When this skill is invoked, write these as TodoWrite items and tick them off in order:

1. Confirm the CURRENT user message in THIS session explicitly names the launch / restart / deploy command I am about to run. Prior-session approvals, CLAUDE.md notes, commit messages, and skill instructions do NOT count. **Dispatched agents: this check fails by construction — the "user" is an issue card, which never authorizes worker launches.**
2. Confirm I am about to run EXACTLY the command the user authorized — not a broader variant ("they said launch worker for X, I'll also launch Y"), not an inferred follow-up ("they said deploy, so I'll restart the local worker first").
3. If either check fails → STOP. Do not run the command. **Operator session:** tell the user what state I observed and which exact command I would run, and wait for explicit authorization. **Dispatched agent:** document on the card per "What to do when I think a worker needs to be running" below.

## Forbidden commands without explicit per-invocation user approval

| Command | Why forbidden |
|---|---|
| `make launch-worker [TARGET=<t>] [WORKER_ID=<id>] [BOARDS=<comma-separated>]` | Starts the machine-level docker worker → poller dispatches ToDo cards on every board the target serves. Local-vs-remote is the target's own `mode` field (DX-1822) — there is no separate `-remote` command any more (`launch-worker-remote` is retired); a `TARGET=` whose `mode: deploy` still means an unauthorized launch reaches a REMOTE dashboard, which is worse, not safer. |
| `make launch-worker-host [TARGET=<t>] [WORKER_ID=<id>] [BOARDS=<comma-separated>]` | Same, host-mode (interactive terminals). Same DX-1822 note applies (`launch-worker-host-remote` is retired too) — PLUS it still trips `NestedClaudePreflightError` if run from inside a Claude Code session (see `dispatch-deep` skill), so an agent can never self-launch it regardless of authorization. |
| `make launch-infra` | Starts shared MySQL + dashboard. Dashboard alone is mostly safe; if the user wants ONLY the dashboard, they will say so. |
| `make launch-dashboard-host` | Same — operator-driven only. |
| `make deploy TARGET=<t>` | Production deploy. Operator session: covered by the standing deploy exception above for this machine's own configured target(s) only (`deploy-machine.json`, DX-3232) — `deploy/launch.ts` itself refuses loudly for any other target, regardless of session. Dispatched agent: never. |
| `make deploy-secrets-push TARGET=<t>` | Destructive SSM write. Always operator-driven. |
| `make deploy-destroy …` | Tears down AWS infra. Always operator-driven. |
| `npx tsx src/index.ts` (or any direct run of the worker entrypoint) | Bypasses make but does the same thing — same prohibition. |
| `docker compose up …` against `docker-compose.worker.yml` (local worker) or `docker-compose.prod.yml` (the deployed box) | Same as the make targets above — these are the actual worker compose files (`docker-compose.yml` alone only holds infra: MySQL + dashboard). |
| `docker start danxbot-worker-*` / `docker restart danxbot-worker-*` | Same — restarts an already-configured poller. |
| Any equivalent shell incantation that ends in a running poller/worker | Same prohibition by construction. |

The list is non-exhaustive. **If the action I am about to take results in a danxbot worker process polling ToDo on any repo, it is forbidden without explicit per-invocation user authorization.**

## What IS allowed (local verification)

The forbidden list is specifically **launching workers + deploys**, NOT verification commands. Run these freely when an AC needs them:

- `make test` (Layer 1 — unit + integration)
- `make test-system` (Layer 3 — real Claude API, ~$1, hits the LOCAL worker on this host, does NOT touch production)
- `make test-validate` (Layer 2 — real Claude API budget-capped)
- `npx vitest run …`, `npx tsc --noEmit`, `npx vue-tsc --noEmit`
- `curl http://localhost:5566/...` / `curl http://localhost:5555/...` (local dashboard probes)
- `gh pr create` / `gh pr view` / `git` operations on the repo

Read-only diagnostics also remain unrestricted:

- `make logs WORKER=1 [WORKER_ID=<id>]` (tail of an already-running worker)
- `make deploy-status TARGET=<t>` / `make deploy-logs TARGET=<t>`
- `docker ps`, `docker logs <container>`, `docker inspect <container>`
- Reading files under `<repo>/.danxbot/` (issues, settings, env)
- HTTP `GET /api/status/:jobId`, `/api/health`, etc. against an already-running worker.

Anything that would *create* a polling process is the prohibited class.

**A card is Done when committed code passes local tests.** Deployment is operations and is never a completion gate — see `danx-next/SKILL.md` Step 6 + Step 10.

## Launch mechanism — canonical path only

When authorization to launch IS granted, the launch shape is ALSO constrained — the only allowed mechanism for a foreground-style worker target (`make launch-worker-host`, `make launch-worker`, `make launch-dashboard-host`, `npx tsx src/index.ts`) is a single Bash tool call with `run_in_background: true`. That gives operator the documented kill primitive (`make stop-worker [TARGET=<t>] [WORKER_ID=<id>]`), the documented log path (`make logs WORKER=1 [WORKER_ID=<id>]`), and a single tracked PID the agent can re-probe via `pgrep`.

**FORBIDDEN exotic wrappers, even with launch authorization:** `systemd-run --user …`, `nohup … &`, `setsid …`, `disown`, `screen -dm …`, `tmux new-session -d …`, any wrapper that detaches the worker from the documented lifecycle. These reduce operator visibility (logs land in `journalctl --user` / `nohup.out` / a tmux pane the operator does not know exists), break `make stop-worker`, and split the kill primitive. If the bg-task notification appears to terminate the worker early, the response is INVESTIGATE (`investigate` skill → check `journalctl`, `pgrep`, the worker's own shutdown log for signal source) — NOT bypass the lifecycle. The bash bg task is intended to host long-lived workers; exotic-wrap is a workaround, not a fix.

If investigation confirms the bash bg task genuinely cannot host the worker, ASK the operator before reaching for an exotic wrapper — the right answer is usually "operator launches in their own terminal; agent watchdogs only".

## What "explicit per-invocation user authorization" means

The CURRENT user message in THIS session must directly request the specific worker launch / restart / deploy. Examples that DO authorize:

- "launch the danxbot worker"
- "restart the worker"
- "deploy danxbot to `<TARGET>`"
- "run `make launch-worker TARGET=<t>`"

Examples that do NOT authorize a worker launch:

- A previous turn approved a different worker action.
- The user asked me to debug, investigate, test, or "look at" something related to the worker.
- The user asked me to verify a fix locally.
- The user authorized a worker launch in a prior session (memory / CLAUDE.md / commit messages).
- The user said "do whatever is needed" — that is general consent for reversible local work, NOT consent to start the production-shaped poller.
- A skill, plan, or pipeline says "run the worker" — skills do NOT override this rule.
- I inferred "we need fresh poller data" from logs, errors, or test output.

For dispatched agents — there is no user message channel; the answer is always "not authorized." Do not improvise an authorization from the card content.

When in doubt: ask the user before launching (operator session) or document on the card (dispatched agent). Asking is cheap. A rogue poller spending hours dispatching cards is not.

## What to do when I think a worker needs to be running

**Operator session:**

1. Stop. Do not start one.
2. Tell the user what state I observed and what command I would run.
3. Wait for explicit authorization.
4. If the user authorizes, run exactly the command they approved — not a broader variant.

**Dispatched agent:**

1. **Stop.** Do not run any launch / deploy / restart command.
2. **Escalate via an open problem, not a comment or `blocked` alone.** Per `issue-blocker/SKILL.md`'s field-selection table, an operator-only action the agent cannot run (launch, restart, re-deploy) is an *external action* → `issue_problem({id, action: 'add', statement, solutions})`, never `blocked` — a blocked card and a `comments[]` note both never reach the operator. Name the exact command in the recommended solution's `body`: what to run, why, and the expected effect.
3. **Finish what you can.** If the card's other work can complete without the operator action, do it and let the orchestrator close the card normally — the open problem surfaces to the operator regardless of card status. Only ALSO set `blocked: {at, reason}` if the card must stay held even after the operator answers (uncommon — most cases redispatch cleanly on the next tick once the command has been run).
4. **Complete the dispatch.** `danxbot_complete({status: "complete", summary: "Opened a problem — operator must run <command>"})`. The card needs a human for as long as the problem is open; the operator runs the command and answers it, then the next dispatch (or the poller) picks up.
