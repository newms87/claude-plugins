---
name: danxbot
description: 'MANDATORY when reasoning about, configuring, debugging, or dispatching through danxbot — the autonomous Claude Code orchestrator that processes issue cards, runs Trello sync, and serves the `/api/launch` dispatch API. Triggers — about to invoke `mcp__danx-issue__*`; editing `<repo>/.danxbot/`; reading `<repo>/.danxbot/issues/`, `.danxbot/workspaces/`, `.danxbot/config/`; reading any `danxbot/logs/<uuid>/` dispatch dir; reading any `~/.claude/projects/*danxbot*` or `*workspaces*` session JSONL; investigating ANY dispatch by UUID (stuck, completed, or unknown — read-only "what happened" lookups count); running `make launch-worker`, `make deploy`; comparing local-worker vs deployed-worker behavior; explaining "where does the agent run", "who calls Trello", "how does my Laravel app talk to a remote agent host"; touching MCP servers consumed by danxbot workspaces (`@thehammer/schema-mcp-server`, `@thehammer/mcp-server-trello`, `@thehammer/danx-issue-mcp`). Loads networking model, runtime envs, deployment vs local, issue-tracker + Trello poller boundary as a TodoWrite checklist so you stop confusing repo location with runtime location and stop trying to call backend trackers from the agent path.'
---

# Danxbot — How It Works

Danxbot is an autonomous orchestrator. Source repo: `<DANXBOT_REPO>` (sibling of every connected repo on the operator's dev box). It spawns Claude Code CLI subprocesses to do work in a connected repo (the operator's app/library codebases — examples: `gpt-manager`, `platform`), polls issue trackers, exposes an HTTP dispatch API.

Reading this skill avoids three recurring mistakes:

1. Confusing **repo location** (where source lives) with **runtime location** (where it executes).
2. Treating Trello / backend-tracker calls as part of the agent path.
3. Pretending the deployed worker on Machine B and the Laravel app on Machine A share a filesystem.

## TodoWrite Checklist (mandatory on first invoke)

When this skill is invoked, write these as TodoWrite items and tick them off as you read:

1. Confirm whether the work is **local** (this dev box) or **deployed** (production AWS target).
2. Identify which **runtime** owns the action — main session, dispatched workspace, or worker.
3. If touching backend trackers (Trello, etc.) → confirm you are NOT in agent path.
4. If touching MCP servers consumed by workspaces → confirm publish step required.
5. If editing `<repo>/.danxbot/issues/*.yml` → use `mcp__danx-issue__*` MCP tools, never `mcp__trello__*`.

## Two-Machine Networking Model

| Machine | What runs there |
|---|---|
| **A — Laravel host (e.g. `gpt-manager`)** | The connected app's HTTP server. NO direct filesystem or PID access to the agent host. Sends dispatch requests; receives event/heartbeat callbacks. |
| **B — Danxbot worker host** | The full danxbot worker container, the Claude Code CLI process, the per-dispatch MCP servers (stdio children of the agent), `/tmp/schemas/{id}/`, `/proc`, the connected repo's git checkout, Docker, browser. **Fully equipped local env for itself.** |

Boundary = HTTP only (`POST /api/launch`, plus event callbacks from worker → Laravel). Local-machine artifacts (FS, PIDs, signals, processes) live entirely on Machine B. Do NOT design schemes that require the Laravel host to touch agent-host artifacts directly.

The local dev case collapses A and B onto the same host — but treat them as separate. The boundary is the HTTP call, not the kernel.

## Repo Location ≠ Runtime Location

| Source path | Runtime location |
|---|---|
| `<owner-repo>/<package-source>/` (operator's local checkout of an MCP package) | npm-published name → spawned via `npx` on **Machine B** as stdio child of the dispatched agent. Source-repo path is just where the operator edits + publishes from; it does NOT execute on the connected app's Laravel host. |
| `<connected-repo>/.danxbot/workspaces/<name>/.mcp.json` | declares which packages the workspace's dispatched agent loads. The package itself runs as a stdio child of that agent on Machine B. |
| `<repo>/.danxbot/workspaces/<name>/` | bind-mounted into worker container; agent's `cwd` resolves rules + `.mcp.json` from this dir |

A file inside `gpt-manager/mcp-server/` does NOT execute on the gpt-manager Laravel host. It's published to npm and consumed by whatever process loads its MCP server — almost always the dispatched agent on Machine B. Same for `mcp-server-trello`: the package lives as a sibling repo on the dev host, but the only process that loads it is the trello-worker dispatch.

## Runtime Envs

Three distinct runtime contexts. Don't confuse them.

| Runtime | Where | Tool surface |
|---|---|---|
| **Main session** | Your shell on the dev host | `mcp__danx-issue__*` (writes local YAML), normal Edit/Read/Write/Bash. NEVER `mcp__trello__*`. |
| **Dispatched workspace** | Inside a Claude Code CLI subprocess on Machine B (or local worker) launched from `<repo>/.danxbot/workspaces/<name>/` | Workspace's `.mcp.json` + `.claude/agents/*.md` + `.claude/rules/*.md` define tool surface. Per-workspace, isolated. |
| **Worker process** | `node` running the danxbot dist on Machine B; runs the Trello poller and `/api/launch` HTTP server | Calls `IssueTracker.*` (the only direct Trello write surface in the system); spawns Claude CLI dispatches via `dispatch()`. |

The dispatched-workspace runtime is what the dispatch API hands work to. The worker runtime hosts the dispatch API and the poller — never confuse "the worker" with "an agent."

## Local vs Deployed

| Verb | What it does |
|---|---|
| `make launch-worker REPO=<name>` (from danxbot repo) | Starts a local Docker worker container for the named repo on this dev box. Compose file: `<connected-repo>/.danxbot/config/compose.yml`. Uses local image `danxbot:latest`. |
| `make deploy TARGET=<target>` (from danxbot repo) | Deploys danxbot + every repo's worker to the target's AWS instance. Per-target config: `deploy/targets/<target>.yml`. Pushes per-target env overlays from SSM. |
| `make publish-mcp` / `make publish-trello-mcp` / `make publish-danx-issue-mcp` (from connected repo) | Publishes the MCP server to npm. Required before a new dispatch can pick up the change. **You own these packages — publish freely without asking.** |

"Deploy the X danxbot" ALWAYS means `make deploy TARGET=<x>` from the danxbot repo. NEVER means `make launch-worker` (that's local). NEVER means deploying the connected repo's own app.

Production IS reachable from the dev shell — proxy / SSH / `docker exec` recipes live in `danxbot/.claude/rules/production-access.md`. Don't claim "I can't reach production from here."

## Per-Repo Configuration

Inside each connected repo:

| Path | Purpose | Committed? |
|---|---|---|
| `<repo>/.danxbot/config/config.yml` | Repo-level danxbot config (board mapping, worker port, etc.) | yes |
| `<repo>/.danxbot/config/trello.yml` | Trello board / list / label IDs (consumed only by worker) | yes |
| `<repo>/.danxbot/config/compose.yml` | Worker docker-compose for local launch | yes |
| `<repo>/.danxbot/config/overview.md` + `workflow.md` + `tools.md` | Repo context for dispatched agents | yes |
| `<repo>/.danxbot/.env` | Secrets + per-repo toggles, `DANX_*` prefix, `DANXBOT_WORKER_PORT` | gitignored |
| `<repo>/.danxbot/.env.<target>` | Per-deploy-target overlay | gitignored |
| `<repo>/.danxbot/issues/{open,closed}/<id>.yml` | Issue cards (`ISS-N`) | yes (open + closed both committed) |
| `<repo>/.danxbot/workspaces/<name>/` | Generated dispatch workspaces | gitignored |
| `<repo>/.danxbot/settings.json` | Per-repo three-valued runtime toggles (Slack, Trello, Dispatch) | yes |

Per-target overlays are layered ONLY at deploy time (`make deploy TARGET=<x>`). Local dev never reads them.

## Issue Tracker — Local YAML Is Authoritative

The issue tracker is split across two layers:

```
Main session  ──Edit──>  <repo>/.danxbot/issues/open/<id>.yml  (canonical)
                                       │
                                       │  (worker poll, ~60s)
                                       ▼
                            danxbot worker IssueTracker
                                       │
                                       ▼
                              backend tracker (Trello)
```

- The YAML is canonical. Workers sync to the backend asynchronously.
- The agent path uses `mcp__danx-issue__*` (declared in main `.mcp.json`) only.
- The backend write surface (`mcp__trello__*`) is loaded ONLY by the trello-worker dispatch on Machine B, NOT by the main session. Never call `mcp__trello__*` from main session.
- Agents NEVER refer to issues by tracker-native ids. Internal id `ISS-N` is the only stable handle.

Schema authoritative source: `<DANXBOT_REPO>/src/issue-tracker/interface.ts` (the `Issue` type).

Universal workflow: invoke `danxbot:issue-card-workflow` skill.

## Trello Poller (Worker-Owned)

The worker process on Machine B runs a poller per connected repo (`src/poller/index.ts`). Each tick is **single-dispatch-per-tick** with this decision tree:

1. Lists Trello cards on the configured board and reconciles them against `<repo>/.danxbot/issues/{open,closed}/*.yml` via `external_id` (inbound mirror — new cards + human comments only).
2. Pushes any local YAML edits to Trello (status moves, AC checks, comments, retro rendering).
3. **Active-dispatch check** — reattaches via the structured `dispatch{}` block (PID + host + kind + TTL) so a worker restart does not redispatch a card whose original session is still alive.
4. **Work-ready dispatch** — picks one ToDo card with `waiting_on: null`, sorted **untriaged first** (`triage.expires_at === ""`) then by `triage.ice.total` DESC. Spawns the Claude Code CLI on the chosen card.
5. **Triage dispatch** — if no work-ready card was dispatched, picks one card with `status` ∈ {Review, Blocked} OR `waiting_on != null` whose `triage.expires_at <= now` and dispatches `/danx-triage-card <ISS-N>` (per-card direct triage agent). Default TTLs: Review 24h, Blocked 3h, Waiting On 1h.
6. **Action Items items** — the worker spawns one fresh issue per `retro.action_item_ids[]` string on terminal save.

The Trello "Action Items" list is **not** a separate status — cards on that list hydrate as `status: "Review"` so the per-card triage agent picks them up alongside the Review list. The list itself stays on the board as a UX bucket.

The poller is the ONLY thing that calls Trello. Do not invent agent-path Trello calls. Do not edit YAML expecting an immediate Trello write — wait one poll tick.

## External Dispatch API

```
curl -sS -X POST https://<your-danxbot-deployment>/api/launch \
  -H "Authorization: Bearer $DANXBOT_DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repo": "<connected-repo>", "workspace": "system-test", "task": "Reply OK and call danxbot_complete.", "api_token": "'"$DANXBOT_DISPATCH_TOKEN"'"}'
```

- `workspace` is required. Must match a directory under `<connected-repo>/.danxbot/workspaces/`.
- `api_token` (Bearer) → `DANXBOT_DISPATCH_TOKEN`. Per-deployment, persisted to SSM at `/<ssm_prefix>/shared/DANXBOT_DISPATCH_TOKEN`.
- Worker rejects bodies that include legacy `allow_tools` / `agents` / `schema_*` fields — workspace defines the tool surface, not the caller.
- Full route table: `/api/launch`, `/api/resume`, `/api/status/:id`, `/api/cancel/:id`, `/api/stop/:id`. See `danxbot/.claude/rules/agent-dispatch.md#external-entry`.

Laravel apps (Machine A) call this endpoint to start an agent on Machine B. That HTTP call IS the boundary. Anything fancier (FS sharing, cross-host kills, `/proc` walks across the boundary) is wrong.

## MCP Server Ownership

| Package | Source | Loaded by | Publish command |
|---|---|---|---|
Each MCP server consumed by a danxbot workspace has an owner repo with a `make publish-<x>` target. The `danx-issue-mcp` server is owned by the danxbot repo itself; tracker/schema/trello servers may be owned by other repos in the operator's tree. The workspace's `.mcp.json` declares which packages it loads. For operator-owned packages, publish freely without re-asking permission — generic "ask before publishing" rules do NOT apply to MCP servers the operator owns.

## Common Failure Modes

| Symptom | Likely cause | Pointer |
|---|---|---|
| New MCP tool not available in dispatched agent | Forgot to publish after editing source | `make publish-mcp` (or relevant publish target), then re-dispatch |
| YAML edited, Trello unchanged | Worker hasn't polled yet (~60s tick) OR sync failure (check worker logs) | YAML is canonical; don't worry unless tick > a few minutes |
| Dispatch fails with "Timed out after 2000ms waiting for PID file" | WSL → Windows interop stall on host-mode launcher | check the operator's WSL-interop runbook (host-mode only) |
| `mcp__trello__*` not found in main session | Correct — it's not loaded there. Use `mcp__danx-issue__*` and let the worker sync. | This skill |
| Editing `mcp-server/` doesn't change agent behavior | Source change ≠ runtime change. Must publish to npm + clear npx cache. | This skill — Repo Location ≠ Runtime Location |
| Confusion about whether Laravel can reach the agent's `/tmp/schemas/{id}/` | It cannot. Boundary is HTTP. Machine B owns local FS. | This skill — Two-Machine Networking Model |

## Cross-References

- `danxbot:issue-card-workflow` skill — universal issue YAML lifecycle
- `danxbot:prod-access` skill — proxy / SSH / `docker exec` recipes for deployed targets
- `danxbot:dispatch-deep` skill — resume protocol, staged_files, multi-block usage dedup, claude-auth diagnostic
- `danxbot:docker-deep` skill — root `.mcp.json` inject, `.env.<target>` overlays, Laravel `.env.{APP_ENV}` trap
- `danxbot:settings-deep` skill — per-repo `settings.json` schema + ownership matrix
- `<DANXBOT_REPO>/CLAUDE.md` — danxbot repo's own dev rules (read when editing danxbot itself)
- `<DANXBOT_REPO>/.claude/rules/agent-dispatch.md` — full dispatch contract
- `<DANXBOT_REPO>/.claude/rules/settings-file.md` — settings.json invariants pointer
