---
name: dispatch-deep
description: 'MANDATORY when touching any of the deep-dispatch contracts that the always-on `agent-dispatch.md` rule pointed away to keep its size manageable. Triggers — editing `src/worker/dispatch.ts` resume route or `src/worker/server.ts` `/api/resume`, `src/dispatch/staged-files.ts` or any callsite that builds `staged_files`, `src/dashboard/playwright-proxy.ts`, any code that accumulates `usage` from JSONL entries (`src/agent/launcher.ts` `seenUsageMessageIds`, `src/dashboard/jsonl-reader.ts`, `LaravelForwarder`, any new metrics emitter), `src/agent/stall-detector.ts` recovery logic, claude-auth troubleshooting (silent dispatch failures, empty `claude -p` stdout, `.credentials.json` rotation, `.claude.json` writability); about to introduce a new staged-files allowlist root in a workspace `staging-paths`; about to add a new binary-upstream proxy on the dashboard. Loads resume protocol, staged-files validation pipeline, Playwright proxy binary-safety contract, multi-block usage dedup rule (production bug `d11b63d`), stall-recovery auth diagnostic recipe (PHevzRil) as a TodoWrite checklist.'
---

# Danxbot Dispatch — Deep Contracts

`.claude/rules/agent-dispatch.md` carries the always-on dispatch spec (single-fork, JSONL-only, completion signaling, forbidden patterns, host-mode interactivity). This skill carries the deep contracts that bite when edited carelessly but aren't needed every turn.

## TodoWrite checklist (mandatory on first invoke)

1. Identify which contract applies: resume / staged_files / Playwright proxy / multi-block usage dedup / stall-recovery auth diagnostic.
2. Re-read the relevant section below before touching code.
3. If introducing a new binary-upstream proxy → use `handlePlaywrightProxy` pattern, NOT `proxyToWorker`.
4. If accumulating `usage` from JSONL → MUST dedupe by `message.id` (multi-block trap).
5. If a dispatch is "silent failing" → run the auth diagnostic before chasing StallDetector.

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
