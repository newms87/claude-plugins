---
name: dispatch-deep
description: 'MANDATORY when touching deep-dispatch contracts the always-on `agent-dispatch.md` rule points away to. Triggers — editing `src/worker/dispatch.ts` resume route or `src/worker/server.ts` `/api/resume`; `src/dispatch/staged-files.ts` or any caller; `src/dashboard/playwright-proxy.ts`; any code accumulating `usage` from JSONL entries (`src/agent/launcher.ts` `seenUsageMessageIds`, `src/dashboard/jsonl-reader.ts`, `LaravelForwarder`, new metrics emitters); `src/agent/stall-detector.ts` recovery logic; `src/agent/api-error-detector.ts` / `attach-monitoring-stack.ts#handleApiErrorRecover` / `MAX_RECOVERS` (DX-246 stream-idle recover); `src/mcp/danxbot-server.ts` DB-fallback / filesystem-queue branch or `src/worker/replay-stop-queue.ts` / `mapCompleteToTerminalStatus` (DX-242 fallback chain); claude-auth troubleshooting (silent dispatch failures, empty `claude -p` stdout, `.credentials.json` rotation, `.claude.json` writability); introducing a new staged-files allowlist root; introducing a new binary-upstream proxy on the dashboard. Loads resume protocol, staged-files validation pipeline, Playwright proxy binary-safety contract, multi-block usage dedup rule (prod bug `d11b63d`), stall-recovery claude-auth diagnostic (PHevzRil), DX-242 completion-signal fallback chain + boot replay, DX-246 stream-idle auto-recover detector + handler as TodoWrite checklist.'
---

# Danxbot Dispatch — Deep Contracts

`.claude/rules/agent-dispatch.md` carries the always-on dispatch spec (single-fork, JSONL-only, completion signaling, forbidden patterns, host-mode interactivity). This skill carries the deep contracts that bite when edited carelessly but aren't needed every turn.

## TodoWrite checklist (mandatory on first invoke)

1. Identify which contract applies: resume / staged_files / Playwright proxy / multi-block usage dedup / claude-auth diagnostic / DX-242 fallback chain / DX-246 stream-idle recover.
2. Re-read the relevant section below before touching code.
3. New binary-upstream proxy → use `handlePlaywrightProxy` pattern, NOT `proxyToWorker`.
4. Accumulating `usage` from JSONL → MUST dedupe by `message.id`.
5. "Silent failing" dispatch → run claude-auth diagnostic before chasing StallDetector.
6. Touching `danxbot_complete` fallback path → preserve HTTP → DB → filesystem-queue ordering; `mapCompleteToTerminalStatus` is the SINGLE collapse point for `CompleteStatus → DispatchStatus`.
7. Changing `MAX_RECOVERS` or detector match logic → update integration test `src/__tests__/integration/api-error-recover.test.ts` in the same commit.

## Resume

`POST /api/resume` spawns a fresh dispatch that inherits a prior job's Claude session via `claude --resume <sessionId>`. Claude loads the previous session's history and appends new turns to the SAME JSONL file. The new dispatch gets its OWN fresh dispatchId and its OWN dispatch tag — so `SessionLogWatcher` can still disambiguate this spawn's slice of the shared JSONL.

**Caller contract:** body shape is `{repo, job_id, task, api_token, ...}` where `job_id` is the PARENT dispatch id the caller got back from `/api/launch`. Callers never see or pass the Claude session UUID — the worker resolves it internally by scanning `~/.claude/projects/<cwd>/` for the parent's dispatch tag. Works across worker restarts because the tag lives in the JSONL file, not in `activeJobs` memory.

Response shape: `{job_id: <new dispatch id>, parent_job_id, status: "launched"}`. Subsequent `/api/status`, `/api/cancel`, `/api/stop` calls use the NEW `job_id`.

**Errors:**
- `400` — missing `job_id`, `task`, or `api_token`
- `404` — parent session file not found in the repo's `~/.claude/projects/` dir (stale parent, different repo, never existed)
- `503` — dispatch API disabled for this repo (same gate as `/api/launch`)

**Worker flow:**

1. Validate body → `isFeatureEnabled(repo, "dispatchApi")` → 503 if off
2. `resolveParentSessionId(repoName, parentJobId)` scans the repo's session dir for the parent's dispatch tag via `findSessionFileByDispatchId`; returns the basename of the JSONL (= Claude session UUID) or null
3. If null → `404`, no spawn
4. New dispatchId, fresh MCP settings, fresh dispatch tag, `--resume <sessionId>` added to claude flags via `buildClaudeInvocation`
5. `dispatch()` (in `src/dispatch/core.ts`) — the SAME shared helper as `/api/launch`. Stall recovery, heartbeat, activeJobs registration, TTL eviction all identical
6. Dispatch row carries `parent_job_id` so the chain is queryable
7. Response: `{job_id, parent_job_id, status: "launched"}`

**Invariants preserved:**

- Single fork — resume is its own dispatch; there is still exactly one claude process per dispatchId
- JSONL-only monitoring — the resume child's entries land in the same JSONL but are found by its fresh dispatch tag
- `danxbot_complete` — same MCP tool, same `/api/stop/:jobId` callback
- Host/docker parity — `--resume` flows through `buildClaudeInvocation`, which both runtime paths share

**Do not:**
- Return the Claude session UUID to callers — it's an internal detail. Callers resume by the dispatch `job_id`.
- Write a second mapping table (jobId → sessionId) — the dispatch tag already provides a deterministic, disk-durable mapping.
- Skip the fresh dispatch tag on resume — that breaks watcher disambiguation inside the shared JSONL.

## Pre-dispatch file staging — `staged_files`

`/api/launch` accepts an optional `staged_files: [{path, content}]` array. Every entry is written to disk BEFORE `spawnAgent` so the dispatched agent sees a fully-populated workspace state on first turn. The mechanism replaces the older "agent calls an MCP tool at startup to fetch its own state" pattern, which put a runtime contract on the agent (must call exactly once, no re-call) and failed opaquely when the agent forgot.

**Body shape:**

```json
{
  "repo": "gpt-manager",
  "workspace": "schema-builder",
  "task": "...",
  "overlay": { "SCHEMA_DEFINITION_ID": "42" },
  "staged_files": [
    { "path": "/tmp/schemas/${SCHEMA_DEFINITION_ID}/schema.json", "content": "..." }
  ]
}
```

**Workspace contract — `staging-paths` allowlist:**

A workspace's `workspace.yml` declares the allowlist roots:

```yaml
staging-paths:
  - "/tmp/schemas/${SCHEMA_DEFINITION_ID}/"
```

Each root may contain `${KEY}` placeholders substituted at request time against the dispatch overlay (same overlay used for `.mcp.json` and `.claude/settings.json`). A workspace with no `staging-paths` rejects any non-empty `staged_files` payload with 400 (fail closed).

**Validation pipeline (`src/dispatch/staged-files.ts` is the single source of truth):**

1. Body shape — every entry MUST be `{path: string, content: string}`. Bad shape → 400.
2. Placeholder substitution — `${KEY}` references in `staged_files[].path` resolve against the overlay; unknown keys → 400.
3. Allowlist check — every resolved absolute path MUST live under one of the workspace's substituted `staging-paths` roots. Path-traversal payloads (`..`, absolute paths outside the allowlist, sibling-prefix attacks like `/tmp/schemas/42-evil` against root `/tmp/schemas/42/`) → 400.
4. Write — `mkdir -p` parents, `writeFileSync(path, content)` for each. Any IO failure rolls back every file written by THIS call (in reverse order) and returns 500. No agent spawns on either failure path.

**Cleanup contract:** when the dispatch reaches a terminal state, `cleanupStagedFiles` removes EVERY path the worker wrote — and ONLY those paths. Sibling files in the same directory survive. Directories created during staging are NOT removed (a shared root like `/tmp/schemas/42/` may be used by sibling dispatches; tearing it down because we happen to be the last writer is the wrong contract). Cleanup is best-effort: failures are swallowed so a stuck file doesn't mask the dispatch's terminal status.

**Error mapping:**

- `StagedFilesError("validation")` → HTTP 400 (caller body bug)
- `StagedFilesError("write")` → HTTP 500 (worker IO)
- Either branch leaves zero files on disk — the `writeStagedFiles` rollback guarantees all-or-nothing.

**Why inline-in-launch (not a separate `PUT /api/workspace/<name>/files`)?**

- Atomic — no race window where staged files exist but the dispatch never lands (or vice versa).
- One round-trip — schema dispatches stage ~10–30 small JSON files; one POST is faster than orchestrating per-file PUTs.
- Reuses `/api/launch`'s bearer auth — no new public surface to defend.

A future out-of-band staging endpoint can be added as a thin wrapper around `prepareStagedFiles` + `writeStagedFiles` if a real consumer needs it; today every consumer pre-populates inline.

## Playwright proxy — binary-safe sibling of the worker proxy

`/api/playwright/<tail>` forwards every method to the Playwright container on `danxbot-net` at `${DANXBOT_PLAYWRIGHT_URL}<tail>` (default `http://playwright:3000`). Same `DANXBOT_DISPATCH_TOKEN` bearer auth as the worker-proxy routes — external callers hit the same dashboard, so the same 401/500 semantics apply. Implemented in `src/dashboard/playwright-proxy.ts`; route registration lives in the dispatch-proxy band in `src/dashboard/server.ts`, BEFORE the blanket `/api/*` user-auth gate.

**CRITICAL: do not reuse `proxyToWorker` here.** That helper hardcodes the outbound request Content-Type to `application/json` and calls `.toString("utf-8")` on the upstream body — both corrupt PNG screenshot bytes. `handlePlaywrightProxy` preserves request Content-Type, request body bytes, response Content-Type, response status, and response body bytes verbatim as `Buffer`s. If you add another binary upstream in the future, extend the Playwright forwarder pattern, not the JSON-only worker one.

Error mapping:
- `401` — bad/missing bearer
- `500` — dashboard has no `DANXBOT_DISPATCH_TOKEN` configured
- `502` — Playwright upstream unreachable / connect error
- `504` — upstream exceeded the per-request timeout (default `PLAYWRIGHT_DEFAULT_TIMEOUT_MS` = 30s; configurable via `PlaywrightProxyDeps.timeoutMs`)

## Multi-block assistant turns — one API response, multiple JSONL lines, ONE usage block

Empirically verified against real Claude Code captures (gpt-manager job `830cbd99`, danxbot smoke `2e60f7ce`): when an assistant turn returns more than one content block (text + tool_use, thinking + text + tool_use, etc.), Claude Code writes ONE JSONL entry per content block, but stamps the IDENTICAL response-level `message.usage` on every entry. All entries share the same `message.id`. The API charged the response ONCE; the JSONL just splits the rendering.

Any code that accumulates `usage` across JSONL entries MUST dedupe by `message.id` — without it, multi-block turns count 2-5× their real cost. This bit production once (commit `d11b63d`): the dashboard reported `200,956` total tokens against a real API charge of `100,478`. The producers in this codebase that sum usage across entries are:

- `src/agent/launcher.ts` — `job.usage` accumulator in the watcher subscriber. Closure-local `seenUsageMessageIds: Set<string>`; skips entries whose `messageId` was already accumulated.
- `src/dashboard/jsonl-reader.ts` — `parseJsonlContent` aggregates `usage` blocks. Same per-call Set, applied BEFORE pushing blocks so timeline display + totals both stay consistent.

The dedup key flows from `convertJsonlEntry` (in `session-log-watcher.ts`) which surfaces `data.messageId` for assistant entries. Both producers consume that field. A new consumer that accumulates usage from watcher entries (e.g., a Laravel forwarder, a metrics emitter) MUST dedupe by `messageId` or it will inherit the bug — see Trello `uPDpsqhe` for the ongoing `LaravelForwarder` instance of this same trap.

Defensive: if `messageId` is missing on an entry that has `usage` (never seen in real Claude Code output), accumulate anyway and `log.warn` once-per-dispatch. Better to over-count a malformed line than to silently zero out billable usage.

## Silent dispatch failures usually mean broken claude-auth, not a stalled agent

Three different claude-auth misconfigurations all surface as the SAME symptom — `/api/launch` returns a `job_id`, status sits at `running`, then eventually `failed` with `summary="Agent timed out after N seconds of inactivity"`. The watcher never attaches, no JSONL appears, no error is logged. Before chasing the StallDetector, check the auth chain first:

1. **Read-only bind on `.claude.json` or `.claude/`** — claude rewrites `.claude.json` (session metadata) on most runs and rotates `.credentials.json` periodically; RO blocks the writes and `claude -p` exits 0 with empty stdout. From `/tmp` cwd it exits silently; from a workspace cwd with `.mcp.json` + `.claude/settings.json` it hangs because MCP startup interacts with the auth-refresh failure (Trello PHevzRil).
2. **Expired OAuth token** — `claudeAiOauth.expiresAt` is in the past (snapshot dir that never rotated, prod redeploy needed). claude attempts a refresh, the refresh fails in `-p` mode, exits 0 silent.
3. **Mismatched UID on the bind source** — host file owned by user A, container claude runs as `danxbot` (UID 1000); `chmod` on the symlink target succeeds but writes still fail.

Diagnostic recipe (matches the verification block on PHevzRil):

```
# 1. Symlink chain reaches a fresh, writable file:
docker exec -u danxbot danxbot-worker-<repo> readlink -f /home/danxbot/.claude/.credentials.json
docker exec -u danxbot danxbot-worker-<repo> python3 -c "import json,time; d=json.load(open('/home/danxbot/.claude/.credentials.json')); print('expired=',d['claudeAiOauth']['expiresAt']<int(time.time()*1000))"
docker exec -u danxbot danxbot-worker-<repo> touch /home/danxbot/.claude.json   # must succeed

# 2. claude -p actually returns output:
docker exec -u danxbot danxbot-worker-<repo> bash -c 'cd /tmp && unset ANTHROPIC_API_KEY && claude --dangerously-skip-permissions -p "Reply only PONG"'
```

Empty stdout + exit 0 = auth chain broken (one of the three above). PONG + exit 0 = auth is fine; the stall is something else (real model latency, infinite loop, etc.). The `worker-compose-mounts.test.ts` regression test guards #1 at the compose level; the spawn-time preflight in Trello `3l2d7i46` (when shipped) will surface #1, #2, and #3 loudly before the worker ever starts a doomed dispatch.

## DX-242 — `danxbot_complete` fallback chain + boot replay

`danxbot_complete` MUST land the terminal signal even when the worker is dead between spawn and completion (OOM-kill, host reboot, crash). The MCP server falls through three paths:

1. **HTTP** — POST to `DANXBOT_STOP_URL`. Always tried first; fast path when worker is alive.
2. **Direct DB UPDATE** — when `DANXBOT_DB_*` + `DANXBOT_DISPATCH_ID` env vars are present, the MCP server opens a one-shot `pg.Pool` and `UPDATE`s the `dispatches` row to terminal status, `summary`, `completed_at`, `pid_terminated_at`. Idempotent: `WHERE "status" NOT IN (TERMINAL_STATUSES)`.
3. **Filesystem queue** — when `DANX_REPO_ROOT` is present, atomic tempfile + rename to `<repoRoot>/.danxbot/dispatch-stops/<dispatchId>.json`. Carries the agent-facing `CompleteStatus` (NOT the collapsed `DispatchStatus`) so boot replay can route `critical_failure` correctly.

Chain succeeds on the first lander. Agent sees one success message naming the path ("recorded via DB fallback" / "queued for boot replay"). When ALL paths fail (no fallback context configured AND HTTP unreachable), MCP server fails loud with the original primary error embedded.

Fallback context is auto-injected by `dispatch()` (`src/dispatch/core.ts`) from `repo.localPath` (queue dir), `dispatchId` (queue key), and `config.db`. **`mcp/danxbot-server.ts#mapCompleteToTerminalStatus` is the SINGLE source of truth for `CompleteStatus → DispatchStatus` collapse.** `worker/dispatch.ts#handleStopFromDb`, `worker/replay-stop-queue.ts`, and the MCP server's DB-fallback branch all import it — never inline a copy.

**Boot replay** (`src/worker/replay-stop-queue.ts`, wired into `startWorkerMode` BEFORE `reconcileOrphanedDispatches`):

- Scan `<repo>/.danxbot/dispatch-stops/`.
- Per entry: `getDispatchById` → skip-if-terminal → `autoSyncTrackedIssue` → `updateDispatch` → `unlinkSync`.
- `critical_failure` branch: `writeFlag(<repo>/.danxbot/CRITICAL_FAILURE)` + row → failed (auto-sync skipped).
- Per-entry failures recorded as `stop-replay`-source system errors; file STAYS on disk for the next boot to retry.
- Malformed JSON / shape errors DISCARD the file (permanently broken file would otherwise loop every boot).

**Do not:**
- Inline a second `CompleteStatus → DispatchStatus` collapse anywhere — always import `mapCompleteToTerminalStatus`.
- Skip the idempotent `WHERE` clause in the DB-fallback UPDATE — concurrent HTTP + DB writes will fight without it.
- Delete queue files on a retryable error — only successful row updates and malformed-shape errors unlink.
- Reorder the chain (HTTP last, DB first, etc.) — HTTP is the fast path that keeps the rest cold.

## DX-246 — Claude API stream-idle auto-recover

Distinct from Stall Recovery. Anthropic stream times out mid-turn → Claude Code writes a synthetic JSONL pair (assistant entry + optional `turn_duration` system entry) signaling lost connection. The agent itself is still alive but produced no real turn — the only forward path is kill + `POST /api/resume` so claude reconnects via `claude --resume <sessionUuid>`.

### Synthetic JSONL signature

Two surface forms (defense in depth — Claude Code has emitted both in the wild):

```jsonc
// Surface 1 — explicit flag
{
  "type": "assistant",
  "message": {
    "model": "<synthetic>",
    "stop_reason": "stop_sequence",
    "content": [{"type": "text",
                 "text": "API Error: Stream idle timeout - partial response received"}]
  },
  "isApiErrorMessage": true,
  "error": "unknown"
}

// Surface 2 — content-pattern
{
  "type": "assistant",
  "message": {
    "model": "<synthetic>",
    "content": [{"type": "text", "text": "API error: <anything>"}]
  }
}

// Usually followed by:
{"type": "system", "subtype": "turn_duration", "durationMs": 1457211}
```

Detection — `src/agent/api-error-detector.ts#matchesSynthetic`:

1. `raw.isApiErrorMessage === true`, OR
2. `raw.message.model === "<synthetic>"` AND content text matches `/API Error/i`.

### Detector behavior

`ApiErrorDetector` subscribes to the same `SessionLogWatcher` every other observer reads (one fork, one watcher). On match:

- **5s confirmation timer** — does not fire immediately. If a real assistant entry (`model !== "<synthetic>"`) arrives during the window, pending recover is cancelled (transient API stutter).
- **Idempotent by recover epoch** — remembers `recoverCount` at fire time; further synthetic entries in the same epoch are no-ops. Next epoch re-arms when the handler bumps the counter.
- **Sub-agent (sidechain) entries skipped** — sub-agent's API error stays scoped to the sub-agent; never triggers a parent recover.

### Recover contract

`attach-monitoring-stack.ts#handleApiErrorRecover` runs after the 5s window confirms:

1. **Skip if non-running** — detector may fire after stall / cancel / inactivity already terminated the job.
2. **Increment counter** — `job.recoverCount + 1`, persisted via `tracker.recordRecoverCount`.
3. **Branch on cap:**
   - `count > MAX_RECOVERS (= 3)` → `writeFlag(<repo>/.danxbot/CRITICAL_FAILURE)` + `job.stop("api_error_failed", ...)`. Poller halts on next tick.
   - `count ≤ MAX_RECOVERS` → `job.stop("api_error_recover", ...)` (row collapses to `status: "recovered"`) + `POST /api/resume` so a fresh dispatch picks up `--resume <sessionUuid>` with `parent_recover_id`.

`/api/resume` failures (network, non-2xx) are logged but do NOT escalate to CRITICAL_FAILURE — transient resume errors are recoverable on the next poller tick; persisting a halt for them defeats the feature.

Status enum carries `"recovered"` as a TERMINAL state (separate from `"failed"`). Chain queryable via `parent_recover_id`. Dashboard's Recovers column surfaces `recover_count` + a `↳` glyph next to dispatch IDs with non-null `parent_recover_id`.

### Integration points

- `src/agent/api-error-detector.ts` — pure detector, no recover logic.
- `src/agent/attach-monitoring-stack.ts` — wires detector onto shared watcher; carries `handleApiErrorRecover` + `MAX_RECOVERS`.
- `src/agent/agent-types.ts#SpawnAgentOptions.recoverContext` — `{originalTask, workspace, workerPort, repoLocalPath}`. Required for the recover-ok branch; missing context fail-louds to `api_error_failed` so the row doesn't leak in `recovered` with no resume-child.
- `src/dispatch/core.ts` — auto-injects `recoverContext` from `RepoContext.localPath` + `workerPort`.
- `src/worker/dispatch.ts#handleResume` — threads `recover_count` + `parent_recover_id` from POST body onto the new dispatch row.
- `src/dashboard/dispatches.ts` — surfaces `recoverCount` + `parentRecoverId` on `Dispatch`; `dispatches-routes.ts` validates `?status=recovered`.
- `dashboard/src/components/DispatchList.vue` — Recovers column badge + parent linkage indicator.
- `src/__tests__/integration/api-error-recover.test.ts` — end-to-end pin: synthetic JSONL → detector → recover handler → `/api/resume` POST + chain stamping + cap-exhausted CRITICAL_FAILURE.

### Tuning

`MAX_RECOVERS = 3` is hardcoded in `attach-monitoring-stack.ts`. Changing it requires updating unit + integration tests in the same commit. 3 × ~5s window is enough to ride out the API stutter the feature was built for; more would burn tokens during sustained outages before falling through to operator intervention.

## syncWorktree ff-only abort — never work around with ref/index/tree mutation (DX-340)

`syncWorktree` (`src/agent/worktree-manager.ts:447-496`, per DX-293) is intentionally strict: `git pull --ff-only origin/main` aborts on any dirty / divergent working tree, and `dispatchWithRecovery` (`src/dispatch/recovery-mode.ts:65-84`) escalates that abort to `agents.<name>.broken` quarantine. The strictness is the feature — it surfaces writer-vs-git contention loudly instead of silently destroying work.

**Forbidden "workarounds" — every one masks the real bug + corrupts agent state:**

- `git update-ref refs/heads/<branch> <commit>` to skip the merge → ref pointer moves but the working tree doesn't; next tick dirties differently; the agent quarantines on the next dispatch instead of this one.
- `git reset --hard origin/main` to "force the worktree to current" → destroys whatever the inject pipeline (or any other live writer) wrote since fork; same dirt reappears on the next tick.
- `git stash` of the inject-written files → destroys the inject's output; next tick re-writes it; oscillation, not a fix.
- `git checkout <file>` / `git restore` on the dirty paths → already banned in `dev:git-discipline`, regardless of motivation.

**Correct fix (canonical example: DX-340).** danxbot's inject pipeline (`src/inject/sync.ts` → `mirrorWorkspaceTree`) rewrites templated content into `<consumer-repo>/.danxbot/workspaces/<templated>/*` every tick. When the consumer repo TRACKS those paths, every tick dirties the working tree → `syncWorktree` aborts → quarantine. The fix is on the writer-side gitignore boundary:

1. Extend `<repo>/.danxbot/.gitignore` (via `ensureGitignoreEntry` calls in `src/inject/sync.ts` — see `src/inject/gitignore-workspaces.ts`) to cover the inject-owned paths.
2. One-time `git rm --cached` of those paths in each consumer repo, commit, push. Files stay on disk; inject keeps writing them; git stops seeing the writes as modifications.
3. Re-dispatch — `syncWorktree` returns `noop` or a clean ff merge.

**Mechanical decision rule when `syncWorktree` aborts on ff-only:**

1. `git status --short` inside the failing worktree → which paths are dirty?
2. Identify the writer (`grep -r "<path-fragment>"` across danxbot `src/`; `mirrorWorkspaceTree` / `renderPerRepoFilesIntoWorkspaces` / any inject helper = the writer is danxbot itself).
3. Fix the gitignore at the writer's gitignore boundary. Commit. Push. One-time `git rm --cached` in the affected consumer repo(s).
4. Re-dispatch.

Reaching for ref / index / tree mutation in step 3 is a workflow violation. The right action is always on the writer side.
