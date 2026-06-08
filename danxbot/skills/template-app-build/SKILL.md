---
name: vue-app-build
description: 'Vue SPA template build-and-preview contract: edit `App.vue` / `style.css` / `sample-data.json` under `templates/<templateId>/source/`, call `danxbot_template_save({templateId})` once, danxbot worker runs `vite build` + ships the tarball via async callback. HMR live preview auto-spawned per template.'
argument-hint: optional — `/vue-build` to force-load when the trigger heuristics miss
---

# Vue App Build

You are working on a Vue SPA template inside a danxbot `vue-app` workspace. Danxbot owns the entire build flow: scaffold, Vite build host, shared deps, tarball pack, async callback to the consumer's `callback_url`, HMR live preview. The agent owns three editable source files (`App.vue` / `style.css` / `sample-data.json`); everything else (scaffold infra, `vite build` invocation, dist upload) is danxbot infrastructure.

This skill is the standing contract for that loop. Load it once at the start of any Vue-template card; the TodoWrite checklist guides every iteration.

## When this skill fires

Mandatory load when ANY of the following holds:

- The workspace cwd contains `templates/<id>/source/App.vue` AND `package.json` declares `vue` (`"vue": "..."` in `dependencies` / `peerDependencies` / `devDependencies`).
- The operator typed `/vue-build` explicitly.
- You are about to call the `mcp__danxbot__danxbot_template_save` MCP tool.
- You are about to shell out `vite build`, `npx vite`, `pnpm vite`, `yarn vite`, or any equivalent Vite invocation from the workspace (forbidden — see Anti-patterns).
- The card's `description` / `ac[]` names a Vue SPA template, a `shell_version`, or `/srv/sfc-deps/`.

Do NOT load this skill when the work is purely backend (no Vue source touched), or when the card is the danxbot-side infrastructure that BUILDS Vue apps (`src/template-build/*`, `src/worker/template-save-route.ts`, `src/template-hmr/*`). Those cards edit danxbot itself; this skill is for the agent CONSUMING that infrastructure.

## The canonical loop

Four steps, one direction. Do not reorder; do not skip.

```
┌────────────────────────────────────────────────────────────────────────┐
│  1. Read scaffold source         → <cwd>/templates/<templateId>/source/│
│                                    {App.vue, style.css, sample-data   │
│                                    .json, main.ts, package.json,      │
│                                    index.html}                         │
│  2. Edit / Write source          → only App.vue / style.css /         │
│                                    sample-data.json (the other three  │
│                                    are scaffold infra — see Forbidden)│
│  3. danxbot_template_save        → MCP envelope POSTs to danxbot     │
│        ({templateId})              worker; worker runs `vite build`   │
│                                    against shared shell deps, packs   │
│                                    dist/ into a gzipped tarball at    │
│                                    /tmp/danxbot-app/<dispatchId>.tgz, │
│                                    fires async callback to consumer  │
│                                    with bundle download URL. Returns │
│                                    synchronous {ok, build_hash,      │
│                                    source_hash, build_duration_ms}.  │
│  4. HMR preview (optional)       → Vite HMR child auto-spawned at    │
│                                    dispatch boot; every Edit hot-    │
│                                    reloads. Live URL via             │
│                                    /api/template-hmr/active.         │
└────────────────────────────────────────────────────────────────────────┘
         ↑                                                ↓
         └────── iterate until visual fidelity matches ───┘
```

Single-call save: `danxbot_template_save` walks the full source tree once, builds, packs, and ships. There is no separate sample-data save call — `sample-data.json` lives in the source tree as a normal file and ships with every save.

### Step 1 — Read scaffold source

Danxbot's dispatch infrastructure scaffolded the six-file Vue project before you spawned. Find the files at `templates/$ACTIVE_TEMPLATE_ID/source/`:

| File | Role | Editable |
|---|---|---|
| `App.vue` | Top-level component; canonical prop contract (`data`, `theme`) | ✅ yes |
| `style.css` | App-wide stylesheet | ✅ yes |
| `sample-data.json` | Default fixture when no `data` prop supplied | ✅ yes |
| `main.ts` | Self-mount + `__settings` query-param parser | ❌ NO — scaffold infra |
| `package.json` | Vendor pins | ❌ NO — scaffold infra |
| `index.html` | Vite entry + importmap baked at scaffold time | ❌ NO — scaffold infra |

`Glob` + `Read` to build a mental model of every editable file. Do not edit yet. The first edit must be intentional.

If the source dir is empty or `App.vue` is missing → scaffold boot failed. Call `danxbot_complete({status: "failed", summary: "scaffold absent — template source directory empty"})` so the consumer knows the build never started.

### Step 2 — Edit source

Use `Edit` / `Write` directly against `App.vue` / `style.css` / `sample-data.json`. Every save is hot-reloaded into the live preview iframe automatically by the auto-spawned Vite HMR child.

Forbidden:

- Editing `main.ts`, `package.json`, or `index.html` (scaffold infra).
- `vite build` / `npx vite` / `vite dev` / `vite preview` invoked from the agent workspace (see Anti-patterns).
- Adding new npm dependencies — `package.json` is pinned against the baked importmap; new deps would not resolve.
- Editing files outside the template's `source/` subtree — only files there are part of the SFC bundle.

### Step 3 — `danxbot_template_save({templateId})`

Call exactly once when satisfied (or multiple times during iteration if you want each save to produce a callback). Pass `templateId: "$ACTIVE_TEMPLATE_ID"` verbatim — passing a different id walks the wrong source directory.

The worker:

1. Walks `<cwd>/templates/<templateId>/source/`.
2. Computes `source_hash` (SHA-256 over the source bundle).
3. Spawns `vite build` against `/srv/sfc-deps/<shell_version>/node_modules/`.
4. On `vite build` failure → returns synchronous `{ok: false, error, source_hash, build_duration_ms}`. Fix source, call save again.
5. On success → packs `dist/` into a gzipped tarball at `/tmp/danxbot-app/<dispatchId>.tgz`.
6. Returns synchronous `{ok: true, build_hash, source_hash, file_count, build_duration_ms}`.
7. Fires async callback POST to the consumer's `callback_url` (set on the original `/api/launch` body) with body `{ok: true, bundle_url: "<worker>/api/get-app/<dispatchId>", build_hash, source_hash, build_duration_ms}` + Bearer `callback_token`.
8. Consumer GETs `/api/get-app/<dispatchId>` to retrieve the `.tgz`.

Failure handling:

- `ok: false` with `error` mentioning a compiler / SFC parse failure → read the message, edit the offending source file, re-save. Compiler errors are the agent's job.
- `ok: false` with `deps_missing` style error → escalate (`/srv/sfc-deps/<shell_version>/` not provisioned on the host; DX-540 / provisioner-side problem).
- Network / S3 errors during the async callback → danxbot retries with exponential backoff. The synchronous verdict is still authoritative for your `ok: true` decision.

### Step 4 — HMR preview (optional)

When you want to verify HMR is up before saving, fetch:

```bash
curl "http://localhost:$DANXBOT_WORKER_PORT/api/template-hmr/active?templateId=$ACTIVE_TEMPLATE_ID"
```

Response `{url, ...}` carries the live preview URL. The consumer's UI is the real renderer; your job is correctness of the source, not the preview.

### Step 5 — Signal completion

After the final `danxbot_template_save` returns `ok: true`:

```
danxbot_complete({status: "complete", summary: "<one-line of what shipped>"})
```

Do NOT emit any output text after `danxbot_complete` — the worker discards the conversation stream within 5s of the terminal call.

## Failure modes

| Symptom | Meaning | Action |
|---|---|---|
| `ok: false` with vite stderr in `error` | Compiler error in saved source. | Read error, edit source, re-save. Compiler errors are the agent's job — never escalate as "needs operator." |
| `ok: false` with `deps_missing` / `/srv/sfc-deps/<v>/` missing | Host did not provision SFC deps for this `shell_version`. | DO NOT install deps yourself. Escalate via `danxbot_complete({status: "failed", summary: "deps_missing for shell_version=<v> — host provisioner did not run"})`. Danxbot's `provision-sfc-deps` (DX-746) owns provisioning. |
| Source dir empty / `App.vue` absent at Step 1 | Scaffold boot failed. | `danxbot_complete({status: "failed", summary: "scaffold absent"})`. |
| 3 consecutive `ok: false` with the same error | Persistent compiler failure you can't resolve. | `danxbot_complete({status: "failed", summary: "<last error verbatim>"})`. |
| `danxbot_template_save` not in your tools list | Dispatch was launched without `callback_url` / `callback_token`. | `danxbot_complete({status: "failed", summary: "danxbot_template_save unavailable — launch was missing callback channel"})`. |

### Shell version drift

If the card's `description` references one `shell_version` but the build envelope's `error` references a different one, the host has moved underneath the card. Append a `## Shell version drift` comment naming both versions and proceed against the host-resolved version (the host's deps tree is the source of truth for active versions). Mention the drift in retro so a follow-up can audit.

## Anti-patterns

| Forbidden | Why |
|---|---|
| Shell `vite build` / `npx vite` / `pnpm vite` directly from the agent workspace | The workspace has no shared `node_modules` (those live at `/srv/sfc-deps/<v>/`, mounted only by the worker at build time). Direct invocation fails for the wrong reason ("module not found") or — worse — partially succeeds against a stale install and ships a divergent dist. `danxbot_template_save`'s auto-build is the ONLY supported build. |
| Editing in-workspace and assuming the consumer picks it up | Edits don't auto-propagate — `danxbot_template_save({templateId})` is the only push primitive. Skipping it strands changes; the next dispatch re-scaffolds and your edits vanish. |
| Bypassing `danxbot_template_save` by writing the tarball yourself | Danxbot owns the path allowlist + hash computation + the async callback wiring. Direct writes skip all three and the consumer never gets a usable `bundle_url`. |
| Editing `main.ts` / `package.json` / `index.html` | Scaffold infra. Downstream tooling (importmap, settings parser, mount path) keys on their exact shape. |
| `npm install` in the agent workspace | Shared deps live in `/srv/sfc-deps/<v>/` (DX-746). The workspace has no `package-lock.json` and no install budget. If you think you need a new dep, you need a new `shell_version` provisioned on the host — escalate via `danxbot_complete`. |
| Polling `danxbot_template_save` with `/loop` or `ScheduleWakeup` | The call is synchronous — the MCP tool holds the connection open until the build returns. You await the call; no manual polling. |
| Treating compiler errors as "needs operator" | Compiler errors are the agent's job to fix in-session. Read stderr in `error`, edit source, re-save. |
| Calling `danxbot_template_save` with a templateId other than `$ACTIVE_TEMPLATE_ID` | The tool walks `templates/<templateId>/source/`; passing a different id walks the wrong directory and produces an empty or wrong bundle. |
| Calling `danxbot_complete` before the final `danxbot_template_save` returns `ok: true` | The receiver only gets a usable bundle when save runs to completion. |

## TodoWrite checklist (auto-populate on load)

Drop these into TodoWrite at skill load and tick as you go:

1. `Read scaffold source under templates/$ACTIVE_TEMPLATE_ID/source/ with Glob + Read`
2. `Edit App.vue / style.css / sample-data.json in place (no shell vite, no editing infra files)`
3. `Call danxbot_template_save({templateId: $ACTIVE_TEMPLATE_ID}); inspect {ok, error, build_hash}`
4. `If ok: false: read error, fix source file, re-save`
5. `Verify HMR preview URL via /api/template-hmr/active (optional sanity check)`
6. `Iterate Steps 2-5 until source is correct`
7. `Final save returns ok: true → danxbot_complete({status: "complete", summary: "..."})`

## Cross-card coordination

This skill assumes the following danxbot infrastructure is shipping:

- **`danxbot_template_save` MCP tool** — registered in `src/mcp/danxbot-server.ts`. Advertised iff the launch body set `callback_url` + `callback_token`.
- **`/api/template-save/<dispatchId>` worker route** — `src/worker/template-save-route.ts`. The HTTP endpoint the MCP envelope POSTs to.
- **`/srv/sfc-deps/<shell_version>/node_modules/`** — provisioned per active shell version (DX-746 `provision-sfc-deps`). The build's deps tree.
- **`hmr_callback_url`** — optional explicit launch-body field; when set, danxbot POSTs the live HMR URL to that consumer-owned receiver as soon as Vite binds.
- **`/api/get-app/<dispatchId>`** — consumer download URL; Bearer-auth via `callback_token`.

If any of those are missing on the host, this loop breaks at the named step — escalate via `danxbot_complete({status: "failed", summary: "<which surface is missing>"})`.

## Rollout

Single source of truth: `~/web/claude-plugins/danxbot/skills/vue-app-build/SKILL.md`. Push to `github:newms87/claude-plugins`; the marketplace consumer settings (every danxbot workspace's `.claude/settings.json` enables `danxbot@newms-plugins` with `autoUpdate: true`) pull the new revision automatically. `/reload-plugins` in any active session picks it up immediately. NO inject-pipeline edits required — DX-269 retired that path.
