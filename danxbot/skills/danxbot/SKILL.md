---
name: danxbot
description: 'Networking model, runtime envs, deployment vs local, issue-tracker + Trello poller boundary, MCP server consumers of danxbot workspaces.'
---

# Danxbot — How It Works

Danxbot is an autonomous orchestrator. Source repo: `<DANXBOT_REPO>` (sibling of every connected repo on the operator's dev box). It spawns Claude Code CLI subprocesses to do work in a connected repo (the operator's app/library codebases — examples: `gpt-manager`, `platform`), polls issue trackers, exposes an HTTP dispatch API.

This plugin is the single source of truth for every danxbot discipline rule + skill — operator's main session and dispatched workers all read the same body via `danxbot@newms-plugins` (was previously dual-housed in the poller inject pipeline; epic DX-269 retired the inject side so plugin edits propagate everywhere with `autoUpdate: true`).

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
| `<connected-repo>/.danxbot/workspaces/<name>/mcp.template.json` | declares which packages the workspace's dispatched agent loads. The package itself runs as a stdio child of that agent on Machine B. |
| `<repo>/.danxbot/workspaces/<name>/` | bind-mounted into worker container; agent's `cwd` resolves rules from this dir; its `mcp.template.json` is resolved + merged into the per-dispatch `--mcp-config` file |

A file inside `gpt-manager/mcp-server/` does NOT execute on the gpt-manager Laravel host. It's published to npm and consumed by whatever process loads its MCP server — almost always the dispatched agent on Machine B. Same for `mcp-server-trello`: the package lives as a sibling repo on the dev host, but the only process that loads it is the trello-worker dispatch.

## Runtime Envs

Three distinct runtime contexts. Don't confuse them.

| Runtime | Where | Tool surface |
|---|---|---|
| **Main session** | Your shell on the dev host | Normal Edit/Read/Write/Bash. NEVER `mcp__trello__*`. |
| **Dispatched workspace** | Inside a Claude Code CLI subprocess on Machine B (or local worker) launched from `<repo>/.danxbot/workspaces/<name>/` | Workspace's `mcp.template.json` + `.claude/agents/*.md` + `.claude/rules/*.md` define tool surface. Per-workspace, isolated. |
| **Worker process** | `node` running the danxbot dist on Machine B; runs the Trello poller and `/api/launch` HTTP server | Calls `IssueTracker.*` (the only direct Trello write surface in the system); spawns Claude CLI dispatches via `dispatch()`. |

The dispatched-workspace runtime is what the dispatch API hands work to. The worker runtime hosts the dispatch API and the poller — never confuse "the worker" with "an agent."

## Local vs Deployed

| Verb | What it does |
|---|---|
| `make launch-worker REPO=<name>` (from danxbot repo) | Starts a local Docker worker container for the named repo on this dev box. Compose file: `<connected-repo>/.danxbot/config/compose.yml`. Uses local image `danxbot:latest`. |
| `make deploy TARGET=<target>` (from danxbot repo) | Deploys danxbot + every repo's worker to the target's AWS instance. Per-target config: `deploy/targets/<target>.yml`. Pushes per-target env overlays from SSM. |
| `make publish-mcp` / `make publish-trello-mcp` / other `publish-*` targets | Publishes MCP servers to npm. Required before a new dispatch can pick up changes. **You own these packages — publish freely without asking.** |

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
| `<repo>/.danxbot/workspaces/<name>/` | Generated dispatch workspaces | gitignored |
| `<repo>/.danxbot/settings.json` | Per-repo three-valued runtime toggles (Slack, Trello, Dispatch) + per-repo `agents{}` roster (each repo owns its own set of named agents — `sage` in gpt-manager and `sage` in danxbot are different agents) | yes |
| `<repo>/.danxbot/worktrees/<agent>/` | Per-agent git worktree + per-agent `docker-compose.yml` w/ worktree-unique port allocation (consumer-repo stack — pgsql/redis/etc — runs once per agent, isolated from primary) | gitignored |

**Multi-repo agent lookup — mechanical pre-claim check.** Before claiming an agent name "does not exist" / "never landed" / "is missing", enumerate EVERY connected repo: `for r in ~/web/danxbot/repos/*/; do grep -l <name> "$r/.danxbot/settings.json" 2>/dev/null; done` AND `ls ~/web/danxbot/repos/*/.danxbot/worktrees/`. Agents are per-repo; cwd `.danxbot/` is just one repo's roster. Same applies to worktrees — checking `git worktree list` from the danxbot source repo shows ONLY danxbot's worktrees, not gpt-manager's or platform's. "I checked the agents dir" w/o naming which repo's agents dir is the failure mode this rule blocks.

Per-target overlays are layered ONLY at deploy time (`make deploy TARGET=<x>`). Local dev never reads them.

## Issue Tracker — Dashboard DB Is Authoritative

The issue tracker is split across layers:

```
Dispatched agent  ──MCP tools──>  Dashboard Postgres DB (canonical)
                                       │
                                       │  (worker poll, ~60s)
                                       ▼
                            danxbot worker IssueTracker (worker's local mirror)
                                       │
                                       ▼
                              backend tracker (Trello, inbound: new cards + human comments only)
```

- The dashboard Postgres DB is the authoritative source for all issue state, accessed by agents via `mcp__danx_dashboard__issue_*` MCP tools and by the worker via its internal HTTP client for dispatch picker logic.
- The backend write surface (`mcp__trello__*`) is loaded ONLY by the trello-worker dispatch on Machine B, NOT by the main session. Never call `mcp__trello__*` from main session.
- Agents NEVER refer to issues by tracker-native ids. Internal id `ISS-N` is the only stable handle.

Schema authoritative source: `<DANXBOT_REPO>/src/issue-tracker/interface.ts` (the `Issue` type).

Universal workflow: invoke `danxbot:issue-card-workflow` skill.

## Trello Poller (Worker-Owned)

The worker process on Machine B runs a poller per connected repo (`src/poller/index.ts`). Each tick is **single-dispatch-per-tick** with this decision tree:

1. Lists Trello cards on the configured board and reconciles new cards + human comments against the dashboard DB via `external_id` (inbound mirror — new cards + human comments only).
2. Pushes DB state changes to Trello (status moves, AC checks, comments, retro rendering) for operator visibility.
3. **Active-dispatch check** — reattaches via the structured `dispatch{}` block (PID + host + kind + TTL) so a worker restart does not redispatch a card whose original session is still alive.
4. **Work-ready dispatch** — picks one ToDo card with `waiting_on: null`, sorted **untriaged first** (`triage.expires_at === ""`) then by `triage.ice.total` DESC. Spawns the Claude Code CLI on the chosen card.
5. **Triage dispatch** — if no work-ready card was dispatched, picks one card with `status` ∈ {Review, Blocked} OR `waiting_on != null` whose `triage.expires_at <= now` and dispatches `/danx-triage-card <ISS-N>` (per-card direct triage agent). Default TTLs: Review 24h, Blocked 3h, Waiting On 1h.
6. **Action Items items** — the worker spawns one fresh issue per `retro.action_item_ids[]` string on terminal save.

The Trello "Action Items" list is **not** a separate status — cards on that list hydrate as `status: "Review"` so the per-card triage agent picks them up alongside the Review list. The list itself stays on the board as a UX bucket.

The poller is the ONLY thing that calls Trello. Do not invent agent-path Trello calls. Agents write card state via `mcp__danx_dashboard__issue_*` tools; the worker's outbound Trello sync fires on each poller tick (~60s).

## Pre-dispatch prep step (DX-291 / DX-297)

Every multi-agent dispatch begins with the `danx-prep` skill running on the agent's worktree. The prep agent runs commit-first WIP recovery, branch sync against `origin/main`, file-scope conflict reasoning against in-progress siblings, and a self-stuck check on the candidate card, then emits ONE verdict via `mcp__danxbot__danxbot_prep_verdict`:

| Verdict | Worker route side-effect |
|---|---|
| `ok` | Combined-mode → dispatch keeps running, agent proceeds into `/danx-next`. Separate-mode → stop; poller re-picks next tick for the work pass. |
| `conflict_on` | Call `issue_dependency({id, action: 'add', kind: 'conflicts_with', target_id, reason})` for each partner. The poller's `isAnyKindBlocked` filter skips dispatch while any partner is non-terminal; auto-resolves on the partner reaching terminal status. |
| `blocked` | Call `issue_transition({id, action: 'block', reason})` to set the card's `blocked` timestamp; `deriveStatus` rule 3 projects the card to `Blocked`. |
| `abort` | Stamp `agents.<name>.broken = {reason, suggested_steps, set_at}` on `<repo>/.danxbot/settings.json`. The picker filters this agent out on every subsequent tick until the operator clears the field via the dashboard Agents tab. |

Mode is per-repo via `agentDefaults.prepMode` in `<repo>/.danxbot/settings.json` (`combined` default). DX-297 retired the separate `runConflictCheck` precursor dispatch + the `dispatchInRecoveryMode` recovery prompt; the prep agent now owns file-overlap reasoning + branch state inspection directly on the agent's worktree.

The `agents.<name>.broken` field is a persistent dispatch gate, distinct from per-tick quarantine (DX-221) and `<repo>/.danxbot/CRITICAL_FAILURE` (whole-repo halt). Broken means "this specific agent's worktree is wedged" — the operator clears it after manually unwedging the worktree (e.g. resolving a `git rebase` conflict, force-pushing the agent's branch).

## Self-healing worktree sync (DX-645 — Phase 3 of DX-576)

The autosave-rebase-conflict class — prior dispatch left
`wip(autosave)` commits on the agent branch AND `origin/main` moved
since — used to land an `agents.<name>.broken` stamp and wait for
operator intervention. As of DX-645 the worker auto-dispatches a
`worktree-repair` workspace inside the broken worktree on every
`syncWorktree.kind === "abort"`. Repair agent rebases + resolves +
pushes; on terminal `completed` the dispatcher clears
`agent.broken` programmatically and the original agent is
dispatchable again on the next tick.

| Event | Path |
|---|---|
| `dispatchWithRecovery` observes `syncWorktree.kind === "abort"` | Stamps `agent.broken` (picker-gate during repair) → emits `sync-repair-needed` event → throws so the multi-agent caller releases its lock |
| `sync-repair-dispatcher` subscribes → dispatches `worktree-repair` workspace (worker-initiated, `agent_name = null` so strikes are bypassed) | Repair agent `cd`s into broken worktree → runs Pre-task sync contract → resolves rebase in place (inject-pipeline files take `origin/main`; other files reconcile on merit) → `git push --force-with-lease` agent branch → `danxbot_complete({status: "complete"})` |
| Repair dispatch terminal `completed` | Dispatcher's `onComplete` callback atomically clears `agent.broken = null` + zeros `strikes.count` (preserves history). Original agent rejoins the picker rotation on next tick. |
| Repair dispatch terminal `failed` | Dispatcher leaves `agent.broken` populated. Existing operator-gate behavior preserved as the fallback for genuine application-code conflicts that the repair could not resolve. |

The repair flow is for `syncWorktree` abort ONLY — `snapshotIfDirty`
abort (HEAD not on agent branch, commit failure) retains the
operator-gate behavior because that class signifies worktree
corruption the repair contract cannot heal.

Code surface — `src/dispatch/recovery-mode.ts` (emit), `src/agent/sync-repair-dispatcher.ts` (subscribe + dispatch + clear), `src/inject/workspaces/worktree-repair/` (workspace dir + CLAUDE.md contract body).

## External Dispatch API

```
curl -sS -X POST https://<your-danxbot-deployment>/api/launch \
  -H "Authorization: Bearer $DANXBOT_DISPATCH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repo": "<connected-repo>", "workspace": "system-test", "task": "Reply OK and call danxbot_complete.", "api_token": "'"$DANXBOT_DISPATCH_TOKEN"'"}'
```

- `workspace` is required. Must match a directory under `<connected-repo>/.danxbot/workspaces/`.
- `api_token` (Bearer) → `DANXBOT_DISPATCH_TOKEN`. Per-deployment, persisted to SSM at `/<ssm_prefix>/shared/DANXBOT_DISPATCH_TOKEN`.
- Worker rejects bodies that include the retired `allow_tools` / `agents` / `schema_*` fields — workspace defines the tool surface, not the caller.
- Full route table: `/api/launch`, `/api/resume`, `/api/status/:id`, `/api/cancel/:id`, `/api/stop/:id`. See `danxbot/.claude/rules/agent-dispatch.md#external-entry`.

Laravel apps (Machine A) call this endpoint to start an agent on Machine B. That HTTP call IS the boundary. Anything fancier (FS sharing, cross-host kills, `/proc` walks across the boundary) is wrong.

## MCP Server Ownership

## MCP Server Ownership

Each MCP server consumed by a danxbot workspace has an owner repo with a `make publish-<x>` target. Tracker/schema/trello servers may be owned by other repos in the operator's tree. The workspace's `mcp.template.json` declares which packages it loads. For operator-owned packages, publish freely without re-asking permission — generic "ask before publishing" rules do NOT apply to MCP servers the operator owns.

## Common Failure Modes

| Symptom | Likely cause | Pointer |
|---|---|---|
| New MCP tool not available in dispatched agent | Forgot to publish after editing source | `make publish-mcp` (or relevant publish target), then re-dispatch |
| Card edited, Trello unchanged | Worker hasn't synced yet (~60s tick) OR sync failure (check worker logs) | DB is canonical; Trello is outbound mirror; don't worry unless tick > a few minutes |
| Dispatch fails with "Timed out after 2000ms waiting for PID file" | WSL → Windows interop stall on host-mode launcher | check the operator's WSL-interop runbook (host-mode only) |
| `mcp__trello__*` not found in main session | Correct — it's not loaded there. Worker handles Trello sync. | This skill |
| Editing `mcp-server/` doesn't change agent behavior | Source change ≠ runtime change. Must publish to npm + clear npx cache. | This skill — Repo Location ≠ Runtime Location |
| Confusion about whether Laravel can reach the agent's `/tmp/schemas/{id}/` | It cannot. Boundary is HTTP. Machine B owns local FS. | This skill — Two-Machine Networking Model |

## Cross-References

- `danxbot:issue-card-workflow` skill — universal issue card DB schema + MCP tools
- `danxbot:prod-access` skill — proxy / SSH / `docker exec` recipes for deployed targets
- `danxbot:dispatch-deep` skill — resume protocol, staged_files, multi-block usage dedup, claude-auth diagnostic
- `danxbot:docker-deep` skill — root `.mcp.json` inject, `.env.<target>` overlays, Laravel `.env.{APP_ENV}` trap
- `danxbot:settings-deep` skill — per-repo `settings.json` schema + ownership matrix
- `<DANXBOT_REPO>/CLAUDE.md` — danxbot repo's own dev rules (read when editing danxbot itself)
- `<DANXBOT_REPO>/.claude/rules/agent-dispatch.md` — full dispatch contract
- `<DANXBOT_REPO>/.claude/rules/settings-file.md` — settings.json invariants pointer
