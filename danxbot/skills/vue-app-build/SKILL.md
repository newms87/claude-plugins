---
name: vue-app-build
description: 'Vue SPA template build-and-preview contract: edit at templates/{id}/source/, template_save bundles, consumer auto-runs vite build, Playwright preview.'
argument-hint: optional — `/vue-build` to force-load when the trigger heuristics miss
---

# Vue App Build

You are working on a Vue SPA template inside a danxbot workspace. The consumer repo (gpt-manager and friends) owns the template source on S3; danxbot owns the build host (Node + Vite + shared deps + Playwright). SG-187 unified the agent flow: source files are pre-staged on disk before you spawn, `template_save({id})` walks the staged dir + pushes + auto-rebuilds in one round-trip, and `template_rebuild` is reserved for explicit cache-bust on unchanged source.

This skill is the standing contract for that loop. Load it once at the start of any Vue-template card; the TodoWrite checklist guides every iteration.

## When this skill fires

Mandatory load when ANY of the following holds:

- The workspace cwd or any `templates/{id}/source/` subtree contains `App.vue` AND `package.json` declares `vue` (`"vue": "..."` in `dependencies` / `peerDependencies` / `devDependencies`).
- The operator typed `/vue-build` explicitly.
- You are about to call the consumer repo's `template_save` or `template_rebuild` MCP tools.
- You are about to shell out `vite build`, `npx vite`, `pnpm vite`, `yarn vite`, or any equivalent Vite invocation from the workspace.
- The card's `description` / `ac[]` names a Vue SPA template, a `shell_version`, or `/srv/sfc-deps/`.

Do NOT load this skill when the work is purely backend (no Vue source touched), or when the card is the danxbot-side infrastructure that BUILDS Vue apps (DX-539 endpoint, DX-540 deps, DX-542 Playwright preview tool). Those cards edit danxbot itself; this skill is for the agent CONSUMING that infrastructure.

## The canonical loop

Four steps, one direction. Do not reorder; do not skip.

```
┌───────────────────────────────────────────────────────────────────────┐
│  1. Read pre-staged source       → /tmp/schemas/{sid}/templates/{tid}/│
│                                    source/{App.vue, main.ts, style.css│
│                                    , package.json, sample_data.json}  │
│  2. Edit / Write source          → in-place edits, native tools       │
│  3. template_save({id})          → MCP walks dir, POSTs bundle;       │
│                                    backend computes source hash; runs │
│                                    SfcTemplateBuilder synchronously   │
│                                    when hash diverges from            │
│                                    last_build_hash. Envelope carries  │
│                                    {build_was_dirty, build_hash,      │
│                                    build_errors[], build_duration_ms} │
│  4. Playwright preview at URL    → screenshot, DOM-snapshot, iterate  │
└───────────────────────────────────────────────────────────────────────┘
         ↑                                                ↓
         └────── iterate until visual fidelity matches ───┘
```

`template_workdir` is retired — staging happens in the Laravel dispatch pipeline before you spawn. `template_rebuild` is still available but unnecessary in the typical loop; call it only to force a fresh build on unchanged source (cache-bust after a shell upgrade, for example).

### Step 1 — Read pre-staged source

The dispatch infrastructure already wrote the SFC source files to disk before you started. Find them at the path layout your consumer-repo prompt lists (typically `templates/{tid}/source/App.vue`, `main.ts`, `style.css`, `package.json`, `sample_data.json`). `Glob` + `Read` to build a mental model of every SFC, every composable, every store. Do not edit yet; do not shell `vite` to "see what builds." The first edit must be intentional.

If the staged dir is empty (newly-created template, never built before), the agent owns scaffolding: `Write` the initial `App.vue` / `main.ts` / `style.css` / `package.json` / `sample_data.json` before Step 3.

### Step 2 — Edit source

Use `Edit` / `Write` directly against the staged files. Forbidden:

- `vite build` / `npx vite` / `vite dev` / `vite preview` invoked from the agent workspace (see Anti-patterns).
- Spawning a Node process to "test the build locally" — the consumer backend + danxbot's build endpoint (DX-539) is the test path.
- Editing files outside the template's `source/` subtree — only files there are part of the SFC bundle.

### Step 3 — `template_save({id})`

Call the consumer repo's `template_save` MCP tool with just the template id. It walks `templates/{id}/source/`, builds the `files[]` payload, POSTs the bundle to the consumer backend. The backend:

1. Validates every path against the SFC allowlist (`App.vue` / `*.vue` / `*.ts` / `*.css` / `package.json` / `sample_data.json`). Disallowed paths abort the whole save with 422 — no torn source trees.
2. Writes every file to `template-definitions/<id>/<path>` on the Storage disk.
3. Computes the SHA-256 source-bundle hash and compares to `TemplateDefinition.last_build_hash`.
4. **If the hash diverged** (or the template never built before): invokes `SfcTemplateBuilder` synchronously — runs `vite build` on the danxbot host with the matching `shell_version` deps, uploads the dist, persists the new `last_build_hash`. The call returns once the build settles.
5. **If the hash matches**: returns immediately with `build_was_dirty: false`.

Response envelope:

```
{
  status: "ok" | "error",
  written: [{path, size}],
  source_hash: "<sha256>",
  build_was_dirty: true | false,
  build_hash: "<sha256 of dist on disk>",
  build_errors: [{type, message}],
  build_duration_ms: <int>
}
```

Failure handling:

- 422 with `errors[].type: "path_not_allowed"` → fix the offending path locally and re-save.
- 422 with `errors[].type: "no_staged_source"` → the source dir on disk is empty. You skipped Step 2 (or wrote files outside the staged dir). Fix the file location and re-save.
- 502 with `build_errors[].type: "build_failed"` → `vite build` returned non-zero. The `message` carries the compiler stderr. Read it, edit the offending source file, re-save (the next save's hash compare will still trigger a build).
- Network / S3 errors during the build push → retry once; second failure → `## Operator action required` comment with the `build_id` (when present) + error verbatim.

### Step 4 — Playwright preview

Open the template's preview URL via the Playwright MCP server's `navigate` tool. Take a screenshot; read the DOM snapshot. Verify the rendered output matches the card's visual-fidelity AC.

Iterate Steps 2 → 4 until the result is correct.

## When to fall back to `template_rebuild`

`template_rebuild({id})` stays on the tool surface for two narrow cases:

1. **Force a cache-bust** — the source hasn't changed but the underlying shell_version / shared deps were rebuilt on the host and the existing dist is stale.
2. **Diagnose a "saved but no build" report** — call `template_rebuild` to re-run the build pipeline against the current source bundle and read the returned envelope as a clean baseline.

Do NOT use `template_rebuild` after every `template_save` — that doubles the cold-build cost. The save endpoint's auto-build is the primary path.

## Failure modes

| Symptom | Meaning | Action |
|---|---|---|
| `build_errors[].type: "build_failed"` w/ `vite build` stderr | Compiler error in the saved source bundle. | Read `message`, identify the offending source file, `Edit` to fix, re-save. Compiler errors are the agent's job — never escalate to "needs operator." |
| `build_errors[].type: "deps_missing"` | `/srv/sfc-deps/<shell_version>/node_modules/` does not exist on the host. | DO NOT install deps yourself. Escalate: append `## Operator action required` comment naming the missing `shell_version`. The danxbot deploy hook (DX-540) is responsible for provisioning; missing dir means DX-540 has not run for this version yet, OR the consumer repo's `shared_deps_lock.json` was never published. Follow Step 10b (Waiting On) on the deploy-side card or file an Action Item against danxbot infra. |
| `source_download_failed` / `dist_upload_failed` | Danxbot transport error mid-build. | Retry `template_save` once (likely transient S3). Second failure → `## Operator action required` with the build_id + error verbatim. |
| `build_was_dirty: true` but Step 4 preview is wrong | Build succeeded; bug is in YOUR source. | Restart at Step 1 with a careful re-read of every staged file. |

### Shell version drift

If the card's `description` references one `shell_version` but the build envelope returns a different one (visible in the consumer's preview / metadata response), the consumer repo's template registry has moved underneath the card. Append a `## Shell version drift` comment naming both versions, then proceed against the saved version (it is authoritative — the consumer repo's storage is the source of truth for active versions). Mention the drift in retro so a follow-up can audit whether the card was scoped against a now-deprecated shell.

## Anti-patterns

| Forbidden | Why |
|---|---|
| Shell `vite build` / `npx vite` / `pnpm vite` directly from the agent workspace | The agent workspace has no shared `node_modules` (those live at `/srv/sfc-deps/<v>/`, mounted only at build time inside the danxbot endpoint's scratch dir). Direct invocation fails for the wrong reason ("module not found") or — worse — partially succeeds against a stale local install and ships a divergent dist. The `template_save` path's auto-build is the ONLY supported build. |
| Editing in-workspace and assuming consumer repo picks it up | Edits don't auto-propagate — `template_save({id})` is the only push primitive. Skipping it strands changes; the next dispatch re-stages from S3 and your edits vanish. |
| Bypassing `template_save` by uploading to S3 directly | The consumer repo owns the path allowlist + `last_build_hash` bookkeeping + the build trigger. Direct S3 upload skips all three, leaves the DB in a wrong state, and the next build will operate on whichever bytes raced last. |
| `npm install` in the agent workspace | Shared deps live in `/srv/sfc-deps/<v>/` (DX-540). The workspace has no `package-lock.json` and no install budget. If you think you need a new dep, you need a new `shell_version` published from the consumer repo — escalate to operator. |
| Polling `template_save` / `template_rebuild` with `/loop` or `ScheduleWakeup` | Both calls are synchronous — the MCP tool holds the connection open until the build returns. You await the call; no manual polling. |
| Treating `build_errors[].type: "build_failed"` as "needs operator" | Compiler errors are the agent's job to fix in-session. Step 1.5 of `danxbot:danx-next` applies. Read the stderr in `message`, edit source, re-save. |
| Calling `template_rebuild` after every `template_save` | The save endpoint already runs the build when the source hash diverges. Re-running adds a full cold-build cost for zero new behavior. Use `template_rebuild` only for the two narrow cache-bust / diagnostic cases listed above. |
| Calling `template_workdir` | Retired by SG-187. Source is pre-staged on disk; reach for `Read` directly. The tool no longer exists on the MCP surface. |

## TodoWrite checklist (auto-populate on load)

Drop these into TodoWrite at skill load and tick as you go:

1. `Read pre-staged source under templates/{id}/source/ with Glob + Read`
2. `Edit / Write source files in place (no shell vite, no editing outside source/)`
3. `Call template_save({id}); inspect {status, build_was_dirty, build_errors[]}`
4. `If build_errors[]: read message, fix source file, re-save`
5. `Open preview URL in Playwright; screenshot + DOM-snapshot`
6. `Iterate Steps 2-5 until visual fidelity AC holds`

## Cross-card coordination

This skill assumes the following danxbot infrastructure cards have shipped:

- **DX-539** — `POST /api/template-build` endpoint registered on the danxbot worker. The synchronous build invoked by Step 3's auto-build path lives here.
- **DX-540** — `/srv/sfc-deps/<shell_version>/node_modules/` provisioned per active shell version. The symlink Step 3 depends on lives here.
- **DX-542** — Playwright MCP `playwright_host_static` + `playwright_host_static_stop` + `vue_build_and_preview` orchestrator. Hosts the dist on `127.0.0.1:<ephemeral>` so Step 4's preview works without depending on a consumer-repo proxy. **Minimum required**: `@thehammer/danxbot-playwright-mcp-server@0.2.0` — earlier versions (0.1.x) shipped only `playwright_screenshot` + `playwright_html` and Step 4 falls back to consumer-proxy preview when those tools are absent.

If any of those are missing on the host, this loop breaks at the named step — escalate to a Waiting-On card pointing at the unshipped phase.

## Rollout

Single source of truth: `~/web/claude-plugins/danxbot/skills/vue-app-build/SKILL.md`. Push to `github:newms87/claude-plugins`; the marketplace consumer settings (every danxbot workspace's `.claude/settings.json` enables `danxbot@newms-plugins` with `autoUpdate: true`) pulls the new revision automatically. `/reload-plugins` in any active session picks it up immediately. NO inject-pipeline edits required — DX-269 retired that path.
