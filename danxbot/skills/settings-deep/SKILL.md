---
name: settings-deep
description: '<repo>/.danxbot/settings.json schema, ownership matrix, writer-merge invariants, isFeatureEnabled hot path.'
---

# Per-Repo Settings File Deep Contract

Always-on reminder: `.claude/rules/settings-file.md` carries the load-bearing 5-line invariant (`isFeatureEnabled` hot path + ownership tripwire + CRITICAL_FAILURE distinction). This skill carries the schema, ownership matrix, writer-merge invariants, and migration details — needed when actually editing the code.

## TodoWrite checklist (mandatory on first invoke)

1. Identify which contract applies: schema / ownership / writer-merge / reader hot-path / display-refresh / pre-rename key fallback.
2. If editing an enforcement path (`slack/listener.ts`, `poller/index.ts`, `worker/dispatch.ts`) → MUST go through `isFeatureEnabled`, never `readSettings` directly.
3. If adding a feature toggle → extend the schema, update `normalize`, update `isFeatureEnabled`, default to env-driven value (or `false` for cost-bearing toggles).
4. If touching a writer → merge `display` and `overrides` independently; never let one section's patch clobber the other.

## What lives at `<repo>/.danxbot/settings.json`

- **Feature toggles** (`overrides.slack`, `overrides.issuePoller`, `overrides.dispatchApi`, `overrides.ideator`, `overrides.autoTriage`) — three-valued (`true` / `false` / `null`). `null` defers to env default on `RepoContext`. `true` / `false` = explicit runtime override winning over env. `ideator` and `autoTriage` default `false` (explicit opt-in for cost-bearing recurring dispatches); the other three default to their env-driven values.
- **Masked config mirrors** (`display.*`) — safe read-only projections rendered by the dashboard Agents tab. **Never raw secrets.**
- **Metadata** (`meta.updatedAt`, `meta.updatedBy`).

Lock file `<repo>/.danxbot/.settings.lock` serializes concurrent writes via `fs.open("wx")` + 30s stale-steal. Both gitignored.

> **Sibling tripwire — NOT this file:** `<repo>/.danxbot/CRITICAL_FAILURE` is a separate poller-halt flag with an unrelated schema, writer, and lifecycle. Operator toggles here = three-valued runtime overrides; the flag = present-or-absent halt signal cleared by a human. Do not conflate. Full contract: `.claude/rules/agent-dispatch.md` "Critical failure flag — poller halt".

## Ownership

| Writer                  | Touches                                | When                                               |
|-------------------------|----------------------------------------|----------------------------------------------------|
| `dashboard:<username>`  | `overrides.<feature>` + `meta`         | Operator clicks a toggle on the Agents tab (Phase 4+ records the actual operator's username via `DASHBOARD_PREFIX`) |
| `worker`                | `display` + `meta`                     | `syncSettingsFileOnBoot` on every worker start    |
| `deploy`                | `display` + `meta` (indirectly, via worker restart) | After secrets materialize + worker relaunch |
| `setup`                 | `display` + `meta` (seed) + `overrides` reset to null | Initial `setup` skill run                   |

`SettingsWriter = \`dashboard:${string}\` | "deploy" | "setup" | "worker"` — bare `"dashboard"` is rejected by `normalizeUpdatedBy` and falls back to the default writer on read, so pre-Phase-4 files auto-heal on the next write.

**Invariant:** a patch containing only `display` NEVER clobbers `overrides`, and vice versa. `writeSettings` enforces this by merging each section independently. Operator toggles survive every deploy and every restart.

## Readers

One function: `isFeatureEnabled(ctx: RepoContext, feature: Feature)` — hot path called on every Slack message, every poller tick, every `/api/launch`. Never throws; falls back to `ctx`'s env default on any failure (missing file, corrupt JSON, filesystem error).

Everything else (`readSettings`, dashboard `GET /api/agents[/repo]` handlers) goes through `readSettings` which returns the default structure when the file is absent and logs-once-per-minute-per-path on parse errors without throwing.

**Do not bypass `isFeatureEnabled` in the three enforcement paths** — `src/slack/listener.ts`, `src/poller/index.ts`, `src/worker/dispatch.ts`. A direct `readSettings` call there would skip the env-default fallback and open a race where brief file corruption suppresses messages or 503s live traffic.

## Why the worker refreshes `display` on every boot (not deploy writing it directly)

Deploy runs on the operator's host. Writing `settings.json` from deploy would mean either (a) SSH-uploading JSON, or (b) reimplementing the display-building logic in a remote shell script. Both duplicate the worker's existing code.

The worker already knows everything needed to produce `display`: its `RepoContext` has the masked values, `config.runtime` has the mode, and `writeSettings` enforces the overrides-preservation invariant. Because every deploy restarts the worker (`launchWorkers` recreates the container), `syncSettingsFileOnBoot` naturally runs after every deploy.

Effective flow:

1. Deploy materializes `.env` files on the instance.
2. Deploy recreates the worker container.
3. Worker boots, loads `RepoContext` from the new `.env`, calls `syncSettingsFileOnBoot`.
4. `writeSettings` merges fresh `display` on top of existing `overrides`.
5. Dashboard sees the refreshed masks on its next `/api/agents` poll.

No remote JSON-writing script, no drift between deploy and worker views of config, no duplicated display-building logic.

## Agents roster — TWO surfaces, do not conflate (DX-1113)

There are two distinct "agents" homes; only ONE moved to Postgres. Conflating them is the trap this section exists to prevent.

| Surface | Home | Accessor | Status |
|---|---|---|---|
| **Per-repo** `settings.json` `agents{}` map | `<repo>/.danxbot/settings.json` (the file THIS skill documents) | `normalizeAgents` / `mutateAgents` / `agentsMapMutated` + the DX-281 per-key merge in `writeSettings`, all in `src/settings-file.ts`; `AGENTS_MAX` cap | **UNCHANGED** — still on disk, still DX-281 per-key merged |
| **Per-board** named-agent roster | `board_agents` Postgres table (one row per `(board_id, name)`) | `src/issues/db/board-agents.ts` — `readBoardAgents` / `readBoardAgent` / `insertBoardAgent` / `deleteBoardAgent` / `mutateBoardAgent` / `ensureBoardAgents` | **MOVED to Postgres (DX-1113)** |

DX-1113 moved ONLY the per-board roster (bio, capabilities, schedule, `enabled`, `broken`, `strikes`, `effortLevel`) into `board_agents`. Each agent is its own row, so the strike accumulator, the dashboard CRUD, and the broken stamp do per-row updates under a `(board_id, name)` advisory lock — the old whole-file per-key merge (`mergeBoardAgents` / `mutateBoardAgents` / `agentsMapMutated`) that existed only to stop one file-writer clobbering another agent's keys is **deleted**, not preserved (exactly ONE home — Core Principle 1). Boot step `ensureBoardAgents` (`src/index.ts`) seeds the table once from the legacy on-disk roster (`src/agents-backfill.ts`) — the one-time data migration. Never add an `agents` field back to the per-BOARD settings contract, and never add a JSON-fallback reader.

**Keep the distinction sharp:** the per-REPO `settings.json` `agents{}` map (first row above) is a SEPARATE surface and is NOT affected by DX-1113 — its DX-281 per-key merge in `writeSettings` is live and load-bearing. Only the per-board roster left the settings layer.

## Schema (abbreviated)

```
{
  "overrides": {
    "slack":        { "enabled": true | false | null },
    "issuePoller": {
      "enabled":          true | false | null,
      // Optional. When set as a non-empty string, the poller only
      // dispatches ToDo cards whose name starts with this prefix —
      // pre-existing real ToDo cards are left untouched on every tick.
      // Used by `make test-system-poller` for race-free isolation;
      // operators can also set it to temporarily
      // limit the poller to one card class without disabling it.
      // null / missing / empty string → no filter (default behavior).
      "pickupNamePrefix"?: string | null
    },
    "dispatchApi":  { "enabled": true | false | null },
    // env default `false` — operator opts in per-repo when they want
    // /danx-ideate to run when the Review list runs short.
    "ideator":      { "enabled": true | false | null },
    // env default `false` — operator opts in per-repo when they want
    // /danx-triage to run on Action Items + Review when ToDo is empty.
    "autoTriage":   { "enabled": true | false | null }
  },
  "display": {
    "worker":  { "port": 5562, "runtime": "docker" },
    "slack":   { "botToken": "xoxb-****abc", "channelId": "C0123...", "configured": true },
    "github":  { "token":    "ghp_****xyz", "configured": true },
    "db":      { "host": "mysql", "database": "ssap_sail", "configured": true },
    "links":   { "slackChannelUrl": "", "githubUrl": "..." }
  },
  "meta": { "updatedAt": "...", "updatedBy": "dashboard:<username>" | "deploy" | "setup" | "worker" }
}
```

See `src/settings-file.ts` for the canonical TypeScript types and `docs/superpowers/specs/2026-04-20-agents-tab-design.md` for the full design document.
