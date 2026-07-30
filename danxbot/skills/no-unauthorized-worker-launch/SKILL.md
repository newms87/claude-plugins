---
name: no-unauthorized-worker-launch
description: 'Strict per-invocation user-auth gate for make launch-worker*, make deploy*, and any command that starts a danxbot worker or prod deploy.'
---

# STRICTLY PROHIBITED — Never Launch a Danxbot Worker / Poller / Deploy Without Explicit Per-Invocation Authorization

## The rule (no exceptions)

**Starting, restarting, relaunching, or deploying a danxbot worker, poller, infra container, or production target requires explicit per-invocation human authorization in the CURRENT user message.**

A worker pickup is destructive. As soon as a danxbot worker boots it polls the connected repo's ToDo, claims cards, spawns dispatched agents, writes the v2 DB, and burns tokens on every card it can grab. There is no dry-run mode. "I'll just check if it boots" is already a production incident — once the poller is up, it has already worked through part of the queue.

## Standing exception — `make deploy-workers TARGET=gpt` (operator session only)

The operator granted standing, cross-session authorization (2026-07-29) to relaunch the production machine-level worker on the `gpt` deploy target (covers the `danxbot` and `gpt-manager` boards) whenever it's found not running, without asking first. **This is the one command exempted from the per-invocation-authorization requirement above.** When `docker ps` on the `gpt` production instance shows no `danxbot-worker-gpt` container, run `make deploy-workers TARGET=gpt` directly and report what you did — do not stop and ask.

This exception is scoped narrowly: exactly `make deploy-workers TARGET=gpt`, in an operator session. It does NOT extend to any other target, to `launch-worker`/`launch-worker-host` variants, to `deploy`/`deploy-destroy`/`deploy-secrets-push`, or to dispatched-agent context — those all remain fully gated per the rule below.

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
| `make launch-worker BOARD=<board-name>` | Starts a docker worker → poller dispatches ToDo cards |
| `make launch-worker-host BOARD=<board-name>` | Starts a host worker → poller dispatches ToDo cards in interactive terminals |
| `make launch-worker-remote TARGET=<t> BOARD=<board-name>` | DX-1802 — docker worker pointed at a REMOTE dashboard (pulls SSM secrets itself). Same prohibition as `launch-worker` — remote target makes an unauthorized launch WORSE, not safer. |
| `make launch-worker-host-remote TARGET=<t> BOARD=<board-name>` | DX-1802 — host worker pointed at a REMOTE dashboard. Same prohibition as `launch-worker-host`, PLUS this one still trips `NestedClaudePreflightError` if run from inside a Claude Code session (see `dispatch-deep` skill) — an agent can never self-launch it regardless of authorization. |
| `make launch-all-workers` | Starts every configured worker. Worse than above. |
| `make launch-infra` | Starts shared MySQL + dashboard. Dashboard alone is mostly safe; if the user wants ONLY the dashboard, they will say so. |
| `make launch-dashboard-host` | Same — operator-driven only. |
| `make deploy TARGET=<t>` | Production deploy. Always operator-driven. |
| `make deploy-secrets-push TARGET=<t>` | Destructive SSM write. Always operator-driven. |
| `make deploy-destroy …` | Tears down AWS infra. Always operator-driven. |
| `npx tsx src/index.ts` (or any direct run of the worker entrypoint) | Bypasses make but does the same thing — same prohibition. |
| `docker compose up …` against `<danxbot>/docker-compose.yml` / `docker-compose.prod.yml` | Same as the make targets above. |
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

- `make logs BOARD=<board-name>` (tail of an already-running worker)
- `make deploy-status TARGET=<t>` / `make deploy-logs TARGET=<t>`
- `docker ps`, `docker logs <container>`, `docker inspect <container>`
- Reading files under `<repo>/.danxbot/` (issues, settings, env)
- HTTP `GET /api/status/:jobId`, `/api/health`, etc. against an already-running worker.

Anything that would *create* a polling process is the prohibited class.

**A card is Done when committed code passes local tests.** Deployment is operations and is never a completion gate — see `danx-next/SKILL.md` Step 6 + Step 10.

## Launch mechanism — canonical path only

When authorization to launch IS granted, the launch shape is ALSO constrained — the only allowed mechanism for a foreground-style worker target (`make launch-worker-host`, `make launch-worker`, `make launch-dashboard-host`, `npx tsx src/index.ts`) is a single Bash tool call with `run_in_background: true`. That gives operator the documented kill primitive (`make stop-worker BOARD=<board-name>`), the documented log path (`make logs BOARD=<board-name>`), and a single tracked PID the agent can re-probe via `pgrep`.

**FORBIDDEN exotic wrappers, even with launch authorization:** `systemd-run --user …`, `nohup … &`, `setsid …`, `disown`, `screen -dm …`, `tmux new-session -d …`, any wrapper that detaches the worker from the documented lifecycle. These reduce operator visibility (logs land in `journalctl --user` / `nohup.out` / a tmux pane the operator does not know exists), break `make stop-worker`, and split the kill primitive. If the bg-task notification appears to terminate the worker early, the response is INVESTIGATE (`investigate` skill → check `journalctl`, `pgrep`, the worker's own shutdown log for signal source) — NOT bypass the lifecycle. The bash bg task is intended to host long-lived workers; exotic-wrap is a workaround, not a fix.

If investigation confirms the bash bg task genuinely cannot host the worker, ASK the operator before reaching for an exotic wrapper — the right answer is usually "operator launches in their own terminal; agent watchdogs only".

## What "explicit per-invocation user authorization" means

The CURRENT user message in THIS session must directly request the specific worker launch / restart / deploy. Examples that DO authorize:

- "launch the danxbot worker for `<repo>`"
- "restart the `<repo>` worker"
- "deploy danxbot to `<TARGET>`"
- "run `make launch-worker BOARD=<board-name>`"

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
2. **Document on the card.** Add a `comments[]` entry titled `## Operator action required` describing exactly what command the operator would need to run, why, and what the expected effect is.
3. **Set status if appropriate.**
   - If the card cannot proceed without operator action, set `status: "Blocked"` and populate `blocked: {reason, timestamp}` per `danx-next/SKILL.md` Step 10.
   - If the card can complete its other work without the operator action, finish the rest, document the operator-required step in the retro / a comment, and let the orchestrator close the card normally.
4. **Save and exit.** The poller stops dispatching the card; the operator takes the launch action; the next dispatch picks up from there.

## Why this rule exists

A previous agent session (DX-150 follow-up, 2026-05-08) launched `make launch-worker-host REPO=danxbot` without operator authorization. The poller picked up cards from ToDo, derived parent statuses, reset "In Progress" cards with no dispatch stamp back to ToDo, and spawned a dispatched agent against `DX-203` — all unauthorized work in a session where the user had explicitly told the agent to "test that locally and run the test yourself. Do NOT deploy."

This rule is the load-bearing assumption that prevents that class of incident. It is non-negotiable. Skills and pipelines do not override it; prior-session authorizations do not carry forward; "I'm sure it's fine" is not a substitute for an explicit user request in the current turn.

For dispatched autonomous agents, the rule is even simpler: the prompt comes from an issue card; cards do not authorize launches; therefore launches are never authorized inside a dispatch.
