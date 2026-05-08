---
name: no-unauthorized-worker-launch
description: 'MANDATORY before running ANY command that starts a danxbot poller, worker, infra container, or production deploy — `make launch-worker*`, `make launch-all-workers`, `make launch-infra`, `make launch-dashboard-host`, `make deploy*`, `make deploy-secrets-push`, `make deploy-destroy`, direct `npx tsx src/index.ts`, `docker compose up` against `<danxbot>/docker-compose.yml` or `docker-compose.prod.yml`, `docker start danxbot-worker-*` / `docker restart danxbot-worker-*`, or any equivalent shell incantation whose effect is "a danxbot poller starts polling". Strictly prohibited without explicit per-invocation user authorization in the CURRENT user message — prior-session approvals do NOT carry forward, skills/pipelines do NOT override, "I am sure it is fine" is not authorization. Loads forbidden-command table + what-to-do-instead branch as TodoWrite checklist.'
---

# STRICTLY PROHIBITED — Never Launch a Danxbot Worker / Poller / Deploy Without Explicit Human Authorization

## The rule (no exceptions)

**An agent MUST NEVER start, restart, relaunch, or deploy a danxbot worker, poller, infra container, or production target unless the human user has explicitly authorized THAT specific action in THIS session, in the CURRENT user message.**

A worker pickup is destructive. As soon as a danxbot worker boots it polls the connected repo's ToDo, claims cards, spawns dispatched agents, mutates YAMLs, mirrors to Trello, and burns tokens on every card it can grab. There is no dry-run mode. "I'll just check if it boots" is already a production incident — once the poller is up, it has already worked through part of the queue.

## TodoWrite checklist (mandatory on first invoke)

When this skill is invoked, write these as TodoWrite items and tick them off in order:

1. Confirm the CURRENT user message in THIS session explicitly names the launch / restart / deploy command I am about to run. Prior-session approvals, CLAUDE.md notes, commit messages, and skill instructions do NOT count.
2. Confirm I am about to run EXACTLY the command the user authorized — not a broader variant ("they said launch worker for X, I'll also launch Y"), not an inferred follow-up ("they said deploy, so I'll restart the local worker first").
3. If either check fails → STOP. Do not run the command. Tell the user what state I observed and which exact command I would run, and wait for explicit authorization.

## Forbidden commands without explicit per-invocation user approval

| Command | Why forbidden |
|---|---|
| `make launch-worker REPO=<name>` | Starts a docker worker → poller dispatches ToDo cards |
| `make launch-worker-host REPO=<name>` | Starts a host worker → poller dispatches ToDo cards in interactive terminals |
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

## What "explicit per-invocation user authorization" means

The CURRENT user message in THIS session must directly request the specific worker launch / restart / deploy. Examples that DO authorize:

- "launch the danxbot worker for danxbot"
- "restart the gpt-manager worker"
- "deploy danxbot to gpt"
- "run `make launch-worker REPO=platform`"

Examples that do NOT authorize a worker launch:

- A previous turn approved a different worker action.
- The user asked me to debug, investigate, test, or "look at" something related to the worker.
- The user asked me to verify a fix locally.
- The user authorized a worker launch in a prior session (memory / CLAUDE.md / commit messages).
- The user said "do whatever is needed" — that is general consent for reversible local work, NOT consent to start the production-shaped poller.
- A skill, plan, or pipeline says "run the worker" — skills do NOT override this rule.
- I inferred "we need fresh poller data" from logs, errors, or test output.

When in doubt: ask the user before launching. Asking is cheap. A rogue poller spending hours dispatching cards is not.

## Read-only diagnostics are allowed

These commands inspect state without starting a poller and remain unrestricted:

- `make logs REPO=<name>` (tail of an already-running worker)
- `make deploy-status TARGET=<t>` / `make deploy-logs TARGET=<t>`
- `docker ps`, `docker logs <container>`, `docker inspect <container>`
- `make test`, `make test-unit`, `make test-integration` (no live worker)
- Reading files under `<repo>/.danxbot/` (issues, settings, env)
- HTTP `GET /api/status/:jobId`, `/api/health`, etc. against an already-running worker.

Anything that would *create* a polling process is the prohibited class.

## What to do if I think a worker needs to be running

1. Stop. Do not start one.
2. Tell the user what state I observed and what command I would run.
3. Wait for explicit authorization.
4. If the user authorizes, run exactly the command they approved — not a broader variant.

## Why this rule exists

A previous agent session (DX-150 follow-up, 2026-05-08) launched `make launch-worker-host REPO=danxbot` without operator authorization. The poller picked up cards from ToDo, derived parent statuses, reset "In Progress" cards with no dispatch stamp back to ToDo, and spawned a dispatched agent against `DX-203` — all unauthorized work in a session where the user had explicitly told the agent to "test that locally and run the test yourself. Do NOT deploy."

This rule is the load-bearing assumption that prevents that class of incident. It is non-negotiable. Skills and pipelines do not override it; prior-session authorizations do not carry forward; "I'm sure it's fine" is not a substitute for an explicit user request in the current turn.
