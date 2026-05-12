---
name: docker-deep
description: 'MANDATORY when touching the deep contracts that govern danxbot container layout, env layering, MCP injection, or workspace cwd isolation. Triggers — editing `src/poller/inject/inject-root-mcp.ts`, `src/poller/index.ts#syncRepoFiles`, `deploy/secrets.ts`, `deploy/cli.ts` env collection, `<repo>/.danxbot/config/compose.yml`, danxbot Dockerfile, anything that writes the root `.mcp.json` of a connected repo, anything that builds or merges `.env.<target>` overlays, anything that resolves a workspace `cwd` for a dispatched agent; about to add a new MCP server to the repo-root inject path; about to introduce a new env-overlay location; about to change container bind-mounts or path layout. Loads the root `.mcp.json` injection contract (DX-201/203), the per-target env overlay merge contract, the workspace cwd isolation rules, and the Laravel `.env.{APP_ENV}` production trap as a TodoWrite checklist.'
---

# Danxbot Docker / Inject / Overlay Deep Contracts

The always-on `.claude/rules/docker-runtime.md` rule file documents the runtime modes + dev workflow. This skill carries the deep contracts that bite when edited carelessly.

## TodoWrite checklist (mandatory on first invoke)

1. Identify which contract applies: root `.mcp.json` inject / env overlay / workspace cwd / Laravel env trap.
2. Re-read the section below for the exact invariants.
3. If introducing a new MCP server at the repo root → STOP. Worker-only MCPs live in workspace `.mcp.json`, NEVER root.
4. If introducing tracker creds (TRELLO_*, DANX_TRACKER) into the repo-root inject env → STOP. DX-203 retired this; tracker is background infra.
5. If creating an `.env.local` (or any `.env.{APP_ENV}`) at a Laravel repo root → STOP. Production-burning trap.
6. After edit: confirm idempotent re-run is a no-op + atomic write preserved.

## Root `.mcp.json` injection contract (DX-201, DX-203)

The poller injects exactly ONE MCP server — `danx-issue` — into every connected repo's root `.mcp.json` on every tick. A developer running bare `claude` at the repo root sees the `danx-issue` tool surface (atomic `<PREFIX>-N` allocation via `danx_issue_create`, list/get/save/close) and nothing else from danxbot. Worker-only MCPs (Trello, Playwright, context7, ...) still live exclusively inside per-workspace dirs (`<repo>/.danxbot/workspaces/<name>/.mcp.json`); they are NEVER added at the repo root.

The injection is implemented by `src/poller/inject/inject-root-mcp.ts#injectDanxIssueMcp` and wired into `syncRepoFiles`. Contract:

- ADDS the `danx-issue` entry to `mcpServers` when the key is missing. The entry shape is `{type: "stdio", command: "npx", args: ["-y", "@thehammer/danx-issue-mcp"], env: {DANX_REPO_ROOT: <literal abs path>}}`. `DANX_REPO_ROOT` is baked as a literal (NOT `${DANX_REPO_ROOT}` placeholder) because the host-session `claude` that consumes this file does not have the worker's env-injection layer — `${DANX_REPO_ROOT}` would resolve to the empty string and the MCP server would refuse to start.
- **The env block contains exactly `DANX_REPO_ROOT` (DX-203).** The `DANX_TRACKER` / `TRELLO_API_KEY` / `TRELLO_API_TOKEN` triple older versions injected was retired when `@thehammer/danx-issue-mcp` became purely a YAML manipulator. The MCP server does NOT call any tracker — `danx_issue_create` writes YAML with `external_id: ""` and the worker's `orphan-push.ts` mirrors it to Trello asynchronously. Re-introducing tracker creds into the inject path puts Trello back in the agent's critical path (an architectural violation — see CLAUDE.md "Trello Is Background Infrastructure — Never In The Agent's Critical Path"). A broken Trello has zero effect on agent operations and surfaces ONLY in the dashboard.
- NEVER deletes, rewrites, or reorders any other `mcpServers` entry — pre-existing servers (operator's own MCPs, playwright in repos that ship one at root, etc.) survive byte-identical.
- NEVER touches top-level keys outside `mcpServers`.
- Operator override wins: if `mcpServers["danx-issue"]` already exists with different content, it is left alone.
- Malformed JSON → log error, no write. The user's file is never overwritten when we can't parse it.
- Atomic write via `.tmp` + `renameSync`; a poller crash mid-write leaves the original file intact.
- Idempotent — re-running is a no-op when the key already exists. Safe to run every tick.

Operators can opt out by adding `danx-issue` themselves with different content — the poller leaves whatever exists alone. Operators can also gitignore the file or commit it; danxbot doesn't dictate either way.

Workers' per-dispatch MCPs are unchanged — they still come from `<repo>/.danxbot/workspaces/<name>/.mcp.json` merged with the danxbot infrastructure server inside `dispatch()`. The root `.mcp.json` is the dev's interactive surface only; it does not feed worker dispatches.

## Per-target env overlays — `.env.<target>` merge contract

When values must differ between local dev and a specific deploy target (prod Slack channel ID, prod-only DB host, prod URLs), put the override in a sibling `.env.<target>` file at the SAME directory as the `.env` it overrides. `<target>` matches the deploy target name (`make deploy TARGET=<target>`), e.g. `.env.gpt`.

Three overlay locations (the deploy collector reads all three):

| Base file | Overlay | Resulting SSM path |
|---|---|---|
| `<root>/.env` | `<root>/.env.<target>` | `/<ssm_prefix>/shared/*` |
| `<repo>/.danxbot/.env` | `<repo>/.danxbot/.env.<target>` | `/<ssm_prefix>/repos/<name>/*` |
| `<repo>/<app_env_subpath>/.env` | `<repo>/<app_env_subpath>/.env.<target>` | `/<ssm_prefix>/repos/<name>/REPO_ENV_*` |

Merge contract (`deploy/secrets.ts#collectDeploymentSecrets`):
- Override keys win; base-only keys preserved; override-only keys added.
- Missing overlay file is a no-op (returns the base map unchanged).
- The merge is in-memory at deploy time only — local files are never modified.
- Local dev (any consumer that reads `.env` without going through deploy) NEVER sees overlay values; the worker container only ever reads what `materialize-secrets.sh` writes from SSM after the deploy push.
- Per-target scope: an overlay named `.env.gpt` is read ONLY when `make deploy TARGET=gpt` runs.

Files are gitignored by default — `.env.*` with `!.env.example` exception so any `.env.example` you commit for documentation stays trackable.

## CRITICAL: never put an `.env.local` (or any `.env.{APP_ENV}`) file at the connected repo's root

Laravel's `LoadEnvironmentVariables::checkForSpecificEnvironmentFile()` substitutes `.env.{APP_ENV}` in place of `.env` whenever `APP_ENV` is already in the env repository at bootstrap time. Under plain `artisan tinker` this is harmless (APP_ENV is not yet set at the check). Under Octane's swoole worker bootstrap, APP_ENV is inherited from the parent process, so every worker loads `.env.{APP_ENV}` INSTEAD of `.env` — stripping `APP_KEY`, `REDIS_HOST`, and every other Laravel var not duplicated in the overlay file. Result: `MissingAppKeyException`, Clockwork/Redis connection refused, supervisor FATAL, HTTP RST. Bit production once; never reintroduce.

When wiring up a new connected repo (especially Laravel / any framework with an env overlay convention), verify zero files at the repo root match `.env*` beyond what the framework itself expects.

## `.claude/settings.local.json` — Developer-Only

`<repo>/.claude/settings.local.json` is STRICTLY the developer's file (permissions, personal allowlists, local MCP toggles for their interactive `claude`). Danxbot does NOT read or write it. The worker port lives in `<repo>/.danxbot/.env` (`DANXBOT_WORKER_PORT=<port>`) alongside the rest of the bot-owned per-repo env; production gets it via `process.env.DANXBOT_WORKER_PORT` injected by compose from `deploy/targets/<target>.yml`.

## Strict isolation from danxbot

Danxbot-dispatched agents (poller, `/api/launch`, Slack) use their own per-dispatch MCP config and env from `<repo>/.danxbot/.env` delivered to the worker container via `env_file: ../.env` in `<repo>/.danxbot/config/compose.yml`. The dev's interactive `claude` at the repo root only sees the single `danx-issue` MCP server the poller injects (DX-201) — zero overlap with the worker's broader MCP surface (Trello, Playwright, etc.). The worker's own dispatches still source MCP from the workspace dir, never from the repo root.

## The workspace: dispatched-agent cwd

Every dispatched agent (poller, HTTP `/api/launch`, Slack) runs with `cwd = <repo>/.danxbot/workspaces/<name>/` — one resolved workspace per dispatch. Each plural workspace is fully self-contained: `workspace.yml`, `.mcp.json`, `CLAUDE.md`, `.claude/settings.json` (enables `danxbot@newms-plugins`), `.claude/rules/` (per-repo rendered only), `.claude/tools/`. Static rules + skills load via the `danxbot` plugin — epic DX-269 retired the inject-pipeline duplicates. The poller inject pipeline (`src/poller/index.ts#syncRepoFiles`) mirrors structural workspace fixtures from `src/poller/inject/workspaces/<name>/` (`.mcp.json`, `workspace.yml`, `CLAUDE.md`, `.claude/settings.json`) and writes per-repo rendered files into each plural workspace's `.claude/rules/` on every tick. The repo-root `.claude/` is strictly developer-owned; the inject pipeline actively scrubs any leftover `danx-*` artifacts there. See agent-dispatch.md "Workspace isolation" + the workspace-dispatch epic.

## Container Paths

**Dashboard container:**

| Host | Container |
|------|-----------|
| `./src` | `/danxbot/app/src` |
| `./dashboard` | `/danxbot/app/dashboard` |

**Worker container:**

| Host | Container |
|------|-----------|
| `<repo>/` | `/danxbot/repos/<name>/` |
| `./claude-auth/` | `/danxbot/app/claude-auth/` |
