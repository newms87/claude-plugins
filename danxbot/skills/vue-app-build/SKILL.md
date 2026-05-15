---
name: vue-app-build
description: MANDATORY when working on a Vue SPA template inside a danxbot workspace (consumer-repo `template_*` MCP flow). Loads the build-and-preview contract — `template_workdir` → edit source → `template_save` → `template_rebuild` (danxbot POST /api/template-build) → Playwright MCP preview at the served URL. Triggers — workspace cwd contains `App.vue` plus a `package.json` declaring `vue` as a peer/runtime dep; explicit `/vue-build` invocation by operator or consumer-repo skill; ANY plan to call the consumer repo's `template_save` / `template_rebuild` / `template_workdir` MCP tools; ANY plan to shell out `vite build` / `npx vite` / `pnpm vite` from the agent workspace. Loads the standard flow + failure-mode handling (build failure, deps_missing, shell_version drift) + the anti-pattern list (no shelling vite directly, no in-workspace editing without `template_save`) as a TodoWrite checklist. Auto-loads via newms-plugins marketplace; NOT via inject-pipeline (retired DX-269) — plugin source is the single source of truth, rolls out per `~/.claude/CLAUDE.md` `autoUpdate: true`.
argument-hint: optional — `/vue-build` to force-load when the trigger heuristics miss
---

# Vue App Build

You are working on a Vue SPA template inside a danxbot workspace. The consumer repo (gpt-manager and friends) owns the template source on S3; danxbot owns the build host (Node + Vite + shared deps + Playwright). The agent's job is to edit source, ask the consumer repo to push it, ask danxbot to build it, then drive the served dist through Playwright to verify visual fidelity.

This skill is the standing contract for that loop. Load it once at the start of any Vue-template card; the TodoWrite checklist guides every iteration.

## When this skill fires

Mandatory load when ANY of the following holds:

- The workspace cwd contains `App.vue` AND `package.json` declares `vue` (`"vue": "..."` in `dependencies` / `peerDependencies` / `devDependencies`).
- The operator typed `/vue-build` explicitly.
- You are about to call the consumer repo's `template_workdir`, `template_save`, or `template_rebuild` MCP tools.
- You are about to shell out `vite build`, `npx vite`, `pnpm vite`, `yarn vite`, or any equivalent Vite invocation from the workspace.
- The card's `description` / `ac[]` names a Vue SPA template, a shell_version, or `/srv/sfc-deps/`.

Do NOT load this skill when the work is purely backend (no Vue source touched), or when the card is the danxbot-side infrastructure that BUILDS Vue apps (DX-539 endpoint, DX-540 deps, DX-542 Playwright preview tool). Those cards edit danxbot itself; this skill is for the agent CONSUMING that infrastructure.

## The canonical loop

Six steps, one direction. Do not reorder; do not skip.

```
┌───────────────────────────────────────────────────────────────────────┐
│  1. template_workdir            → {source_path, preview_url, shell_v} │
│  2. Read / Glob source          → understand current SFCs             │
│  3. Edit / Write source         → in-workspace edits only             │
│  4. template_save               → consumer repo pushes to S3          │
│  5. template_rebuild            → danxbot POST /api/template-build    │
│                                   waits for build, returns status     │
│  6. Playwright preview at URL   → screenshot, DOM-snapshot, iterate   │
└───────────────────────────────────────────────────────────────────────┘
         ↑                                                ↓
         └────── iterate until visual fidelity matches ───┘
```

### Step 1 — Resolve the workdir

Call the consumer repo's `template_workdir` MCP tool with the template id from the card description. It returns:

- `source_path` — absolute path inside the workspace where the SFCs live.
- `preview_url` — the local URL where the built dist will be served (Playwright navigates here in Step 6).
- `shell_version` — selects which `/srv/sfc-deps/<shell_version>/node_modules/` the build uses (DX-540 provisions these).

Cache these three values for the rest of the dispatch. They do not change mid-session unless the operator explicitly resets the workdir.

### Step 2 — Read source

`Glob` + `Read` the source tree under `source_path`. Build a mental model of every SFC, every composable, every store. Do not edit yet; do not shell `vite` to "see what builds." The first edit must be intentional.

### Step 3 — Edit source

Use `Edit` / `Write` directly against files under `source_path`. The workspace is your local working copy of the consumer repo's template module — edits do NOT auto-propagate. `template_save` (Step 4) is the only path that pushes changes to S3.

Forbidden:

- `vite build` / `npx vite` / `vite dev` / `vite preview` invoked from the agent workspace (see Anti-patterns).
- Editing files outside `source_path` and assuming the consumer repo will pick them up — only files inside the resolved workdir are part of the template module.
- Spawning a Node process to "test the build locally" — the danxbot build endpoint (DX-539) is the test path.

### Step 4 — `template_save`

Call the consumer repo's `template_save` MCP tool. It collects every file under `source_path` (typically as a tarball), uploads to a presigned S3 PUT URL, and returns when the consumer's storage layer has accepted the upload. The save is the moment the edits become real — until `template_save` succeeds, nothing has left the workspace.

If `template_save` fails:

- Network / S3 errors → retry once; on second failure, escalate via `## Operator action required` comment with the exact error.
- Validation rejection (file size cap, banned file extension) → fix the offending file and retry. Never bypass with a forced flag.

### Step 5 — `template_rebuild`

Call the consumer repo's `template_rebuild` MCP tool. The consumer orchestrator dispatches a danxbot build via `POST /api/template-build` (DX-539) with the freshly uploaded source URL + a presigned PUT URL for the dist + the `shell_version` cached in Step 1. Danxbot:

1. Streams the source tarball down, extracts to `/tmp/sfc-build-<build_id>/`.
2. Symlinks `/srv/sfc-deps/<shell_version>/node_modules/` into the scratch dir.
3. Runs `vite build --outDir dist`.
4. Tars the dist, uploads to the PUT URL.
5. Returns `{ ok, build_id, duration_ms, stderr, file_count }` or `{ ok: false, build_id, error: "...", stderr }`.

The consumer's `template_rebuild` waits for this response and surfaces it back to you. **You do not block on the build manually with `/loop` or `ScheduleWakeup` — the call is synchronous through the consumer repo's MCP tool, which holds the connection open until the danxbot endpoint returns.**

### Step 6 — Playwright preview

Open `preview_url` (from Step 1) via the Playwright MCP server's `navigate` tool. Take a screenshot; read the DOM snapshot. Verify the rendered output matches the card's visual-fidelity AC.

Iterate Steps 3 → 6 until the result is correct.

## Failure modes

Read the `error` field of the `template_rebuild` response and route mechanically:

| `error` | Meaning | Action |
|---|---|---|
| `vite_build_failed` | `vite build` returned non-zero. `stderr` contains the compiler messages. | Read `stderr`. Identify the offending source file(s). `Edit` to fix. Restart loop at Step 4. |
| `deps_missing` | `/srv/sfc-deps/<shell_version>/node_modules/` does not exist on the host. | DO NOT attempt to install deps yourself. Escalate: append `## Operator action required` comment naming the missing `shell_version`. The danxbot deploy hook (DX-540) is responsible for provisioning; missing dir means DX-540 has not run for this shell version yet, OR the consumer repo's `shared_deps_lock.json` for this version was never published. Follow Step 10b (Waiting On) — block on the deploy-side card or file an Action Item against danxbot infra. |
| `source_download_failed` | Danxbot could not pull the source tarball from S3. | Retry `template_save` + `template_rebuild` once (likely transient S3). Second failure → `## Operator action required` with the build_id + error verbatim. |
| `dist_upload_failed` | Build succeeded but danxbot could not upload the result. | Same as `source_download_failed` — retry once, escalate on second failure. |

If the response is `ok: true` but Step 6 reveals the preview is wrong (CSS broken, component missing, blank page despite a successful build), the bug is in YOUR source — restart at Step 2 with a careful re-read.

### Shell version drift

If the card's `description` references one `shell_version` but `template_workdir` returns a different one, the consumer repo's template registry has moved underneath the card. Append a `## Shell version drift` comment naming both versions, then proceed against the workdir's version (it is authoritative — the consumer repo's storage is the source of truth for active versions). Mention the drift in retro so a follow-up can audit whether the card was scoped against a now-deprecated shell.

## Anti-patterns

| Forbidden | Why |
|---|---|
| Shell `vite build` / `npx vite` / `pnpm vite` directly from the agent workspace | The agent workspace has no shared `node_modules` (those live at `/srv/sfc-deps/<v>/`, mounted only at build time inside the danxbot endpoint's scratch dir). Direct invocation fails for the wrong reason ("module not found") or — worse — partially succeeds against a stale local install and ships a divergent dist. The `template_rebuild` path is the ONLY supported build. |
| Editing in-workspace and assuming consumer repo picks it up | Workspace files are your local copy. `template_save` is the only push primitive. Skipping it silently strands your changes. |
| Bypassing `template_save` by uploading to S3 directly | The consumer repo owns presigned-URL minting + version bookkeeping. Direct S3 upload skips the bookkeeping, leaves the consumer's DB in a wrong state, and the next `template_rebuild` will not see your file. |
| `npm install` in the agent workspace | Shared deps live in `/srv/sfc-deps/<v>/` (DX-540). The workspace has no `package-lock.json` and no install budget. If you think you need a new dep, you need a new `shell_version` published from the consumer repo — escalate to operator. |
| Polling `template_rebuild` with `/loop` or `ScheduleWakeup` | The consumer's `template_rebuild` is synchronous (it holds the connection open against the danxbot endpoint's response, which itself blocks on `vite build`). You await the MCP tool call, no manual polling. |
| Treating `vite_build_failed` as "needs operator" | Compiler errors are the agent's job to fix in-session. Step 1.5 of `danxbot:danx-next` applies. Read `stderr`, edit source, retry. |
| Calling `template_rebuild` without an intervening `template_save` | The danxbot endpoint reads the source from S3 at the URL the consumer repo passes. Without a fresh `template_save`, the rebuild operates on the previous version — confusing iteration loop where edits seem to disappear. |

## TodoWrite checklist (auto-populate on load)

Drop these into TodoWrite at skill load and tick as you go:

1. `Call template_workdir; cache source_path, preview_url, shell_version`
2. `Read source tree under source_path with Glob + Read`
3. `Edit / Write source files in workspace (no shell vite)`
4. `Call template_save; confirm upload accepted`
5. `Call template_rebuild; check ok=true + handle error enum on ok=false`
6. `Open preview_url in Playwright; screenshot + DOM-snapshot`
7. `Iterate Steps 3-6 until visual fidelity AC holds`

## Cross-card coordination

This skill assumes the following danxbot infrastructure cards have shipped:

- **DX-539** — `POST /api/template-build` endpoint registered on the danxbot worker. The synchronous build invoked by Step 5 lives here.
- **DX-540** — `/srv/sfc-deps/<shell_version>/node_modules/` provisioned per active shell version. The symlink Step 5 depends on lives here.
- **DX-542** — Playwright MCP `playwright_host_static` + `playwright_host_static_stop` + `vue_build_and_preview` orchestrator. Hosts the dist on `127.0.0.1:<ephemeral>` so Step 6's preview works without depending on a consumer-repo proxy. **Minimum required**: `@thehammer/danxbot-playwright-mcp-server@0.2.0` — earlier versions (0.1.x) shipped only `playwright_screenshot` + `playwright_html` and Step 6 falls back to consumer-proxy preview when those tools are absent.

If any of those are missing on the host, this loop breaks at the named step — escalate to a Waiting-On card pointing at the unshipped phase.

## Rollout

Single source of truth: `~/web/claude-plugins/danxbot/skills/vue-app-build/SKILL.md`. Push to `github:newms87/claude-plugins`; the marketplace consumer settings (every danxbot workspace's `.claude/settings.json` enables `danxbot@newms-plugins` with `autoUpdate: true`) pulls the new revision automatically. `/reload-plugins` in any active session picks it up immediately. NO inject-pipeline edits required — DX-269 retired that path.
