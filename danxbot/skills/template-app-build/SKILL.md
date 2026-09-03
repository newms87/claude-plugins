---
name: template-app-build
description: MANDATORY on every template-app dispatch. Owns the multi-app build loop — read the template id(s) from the task prompt, then per id call load_template_app → edit the three editable SFC files → save_template_app, and signal danxbot_complete when every app is shipped.
argument-hint: optional — `/template-build` to force-load when the trigger heuristics miss
---

# Build Vue template apps

You were dispatched under the template-app profile because a consumer service asked
danxbot to build (or update) one or more Vue Single-File-Component apps.
Each app is identified by a **template id**.

## Where the template ids come from

**The task prompt text.** The dispatch carries NOTHING template-specific in
its launch body, no env var, and no source pre-landed on disk. Read the
prompt to learn which id(s) you must work on. A prompt may name one
id (`"update template 7"`) or several (`"edit apps 1, 2 and 3"`); work each
one through the loop below.

## The canonical loop (per template id)

1. **`load_template_app({template_id})`** — sets the app up on demand. The
   worker pulls the app's existing source from the consumer (extracting it
   into `<cwd>/templates/<template_id>/source/`) or scaffolds a fresh default
   app when the consumer has none yet, starts the per-template Vite HMR
   dev-server, and fires the consumer's HMR-ready callback. Returns
   `{template_id, hmr_url}` synchronously — `hmr_url` is the live preview
   URL. Call this **before** editing an app's source. Idempotent per id
   (re-calling bumps the existing HMR server).

2. **Edit the three editable files** under
   `templates/<template_id>/source/`:

   | File | Role | You may edit |
   |---|---|---|
   | `App.vue` | Top-level component; canonical prop contract (`data`, `theme`) | yes |
   | `style.css` | App-wide stylesheet | yes |
   | `sample-data.json` | Default fixture rendered when no `data` prop is supplied | yes |
   | `main.ts` | Self-mount + `__settings` query-param parser | **NO** (scaffold infra) |
   | `package.json` | **App dependencies** — yours to edit | yes, `dependencies` only |
   | `index.html` | Vite entry | **NO** (scaffold infra) |

   - **Read `App.vue` first.** Its `defineProps` block declares the prop
     contract every consumer relies on (`data`, `theme`). Whatever UI you
     build must consume those props — never replace them with hand-rolled
     refs or static literals.
   - **Read `sample-data.json`.** This is the fixture rendered when the
     consumer supplies no `data` prop at view time. Shape your changes so
     the sample fixture renders meaningfully — a blank `App.vue` that
     refuses to render without consumer-supplied data is a bug.
   - Edit with the `Edit` / `Write` tools. Vite HMR is already live against
     the source dir, so every save hot-reloads in any open preview iframe.

3. **`save_template_app({template_id})`** — when satisfied with this app,
   build and ship it. The worker walks
   `templates/<template_id>/source/`, runs `vite build`, packs `dist/` into
   a gzipped tarball keyed by id (overwriting any prior bundle for this id),
   then — on success — fires the async build callback to the consumer with
   build metadata + the bundle download URL. Returns the synchronous build
   verdict: `{ok: true, build_hash, source_hash, file_count, bundle_bytes,
   build_duration_ms}` on success, `{ok: false, error, source_hash,
   build_duration_ms}` on build failure (fix the source and re-save). Build
   and save each id **independently** — one `save_template_app` call per id.

4. **Signal completion.** After the last app's `save_template_app` returns
   `ok: true`, call:

   ```
   danxbot_complete({status: "complete", summary: "<one-line of what shipped>"})
   ```

   Do NOT emit any output text after `danxbot_complete` — the worker
   discards the conversation stream within 5s of the terminal call.

## Adding an npm dependency

`package.json` IS yours to edit. Add the package to `dependencies` and call
`save_template_app` — the build runs a real `pnpm install` against that manifest
and resolves it through the worker's Verdaccio proxy. There is no allow-list, no
pre-provision step, and nothing to declare anywhere else.

Declare a first-party `@thehammer/*` package as `"latest"`, not a pinned version.
An exact pin freezes it at whatever was published the day the template was built:
a later release that adds a capability never reaches the template, the build still
succeeds, and the app silently renders the old behaviour with no error anywhere.

## Forbidden

- Editing `main.ts` or `index.html`. They are scaffold infra, re-stamped from
  the current scaffold on every `load_template_app`, so an edit there is
  overwritten on the next load and reported back to you as a discarded edit.
- Hand-editing the **danxbot-owned** keys inside `package.json` — `vue`,
  `@thehammer/danx-ui`, `vite`, `@vitejs/plugin-vue`, `tailwindcss`,
  `@tailwindcss/vite`. Those are composed in from the live shell's resolved
  versions at load and stripped back out on save; your value would be
  replaced either way.
- Calling `save_template_app` for an id before `load_template_app` has run
  for that id. Save walks `templates/<template_id>/source/`; without the
  load step the directory is absent or stale and the build produces a wrong
  or empty bundle.
- Calling `danxbot_complete` before the final `save_template_app` has
  returned `ok: true`. The consumer only gets a usable bundle when save
  runs to completion.

## When something looks wrong

- **`load_template_app` / `save_template_app` absent from your tools list.**
  The dispatch's repo has no `template_app` config, so the worker never
  injected the tool endpoints — there is no build channel. Call
  `danxbot_complete({status: "failed", summary: "load_template_app /
  save_template_app unavailable — dispatch repo has no template_app
  config"})` so the consumer knows the build never started.
- **`save_template_app` fails repeatedly with the same error.** Three failed
  `save_template_app` calls in a row for the same id → call
  `danxbot_complete` with `status: "failed"` and the last error verbatim.

## Rollout

Single source of truth: this plugin skill, at
`danxbot/skills/template-app-build/SKILL.md` inside the marketplace plugins
repo (there is no in-tree copy — the plugin is the only home). That repo's
location on disk differs per machine and per context; resolve it rather than
assuming a path — `~/.claude/plugins/known_marketplaces.json` carries the
marketplace `source.url` and an `installLocation` checkout of the same repo,
and an existing working checkout of that URL should be reused rather than
re-cloned.
Publish via `./scripts/publish.sh patch danxbot`; the marketplace consumer
settings (every dispatched clean-room's `.claude/settings.json` enables
`danxbot@newms-plugins` with `autoUpdate: true`) pull the new revision
automatically. `/reload-plugins` in any active session picks it up
immediately.
