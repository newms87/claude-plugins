---
name: settings-deep
description: '<repo>/.danxbot/settings.json schema, ownership matrix, writer-merge invariants, isFeatureEnabled hot path.'
---

# Per-Repo Settings File Deep Contract

Always-on reminder: `.claude/rules/settings-file.md` carries the load-bearing 5-line invariant (`isFeatureEnabled` hot path + ownership tripwire + `board_halts` distinction). This skill carries the schema, ownership matrix, writer-merge invariants, and migration details — needed when actually editing the code.

## TodoWrite checklist (mandatory on first invoke)

1. Identify which contract applies: schema / ownership / writer-merge / reader hot-path / display-refresh / pre-rename key fallback.
2. If editing a toggle-enforcement path (`worker/dispatch.ts`, `dispatch/core.ts`, the escalation reconcile) → MUST `await isFeatureEnabled(...)`, never `readSettings` directly and never an un-awaited call.
3. If adding a feature toggle → extend the schema, update `normalize`, update `isFeatureEnabled`, default to env-driven value (or `false` for cost-bearing toggles).
4. If touching a writer → merge `display` and `overrides` independently; never let one section's patch clobber the other.

## What lives at `<repo>/.danxbot/settings.json`

- **Feature toggles** — the `Feature` type is exactly `dispatchApi | ideator | autoTriage | autoModelEscalation` (`src/settings-file.ts`). Three-valued (`true` / `false` / `null`): `null` defers to env default, `true`/`false` is an explicit override. `ideator` and `autoTriage` default `false` (explicit opt-in for cost-bearing recurring dispatches); `autoModelEscalation` (DX-1100 — bounded context-overflow auto-upgrade) defaults `true`; `dispatchApi` defaults to its env-driven value. **`slack` and `issuePoller` are NOT feature toggles here** — see the Readers section above.
- **Masked config mirrors** (`display.*`) — safe read-only projections rendered by the dashboard Agents tab. **Never raw secrets.**
- **Metadata** (`meta.updatedAt`, `meta.updatedBy`).

Lock file `<repo>/.danxbot/.settings.lock` serializes concurrent writes via `fs.open("wx")` + 30s stale-steal. Both gitignored.

> **Sibling tripwire — NOT this file:** a critical-failure halt is a separate `board_halts` DB row, not a file, with an unrelated schema, writer, and lifecycle. Operator toggles here = three-valued runtime overrides; the halt = present-or-absent signal cleared by a human via the dashboard. Do not conflate. Full contract: `.claude/rules/agent-dispatch.md` "Critical failure halt — poller halt".

## Ownership

**The operator-facing write path for the toggles has moved (DX-1817).** `PATCH /api/agents/:repo/toggles` (`src/dashboard/agents-toggles.ts`) persists via `writeBoardSettings` (`src/board-settings.ts`) into the per-board `board_settings` Postgres row — not `writeSettings`/`overrides` on this file. `DASHBOARD_PREFIX` and the `Feature` type are still shared from `src/settings-file.ts`, but the write itself is DB, matching the Readers section above. The table below documents this file's OWN write contract (still real for whatever still calls `writeSettings` directly, e.g. `effortLevels`) — verify which path a given field actually goes through in `src/settings-file.ts` vs `src/board-settings.ts` before assuming this file's `writeSettings` is the live path for a specific field.

| Writer                  | Touches                                | When                                               |
|-------------------------|----------------------------------------|----------------------------------------------------|
| `dashboard:<username>`  | `overrides.<feature>` + `meta`         | Operator clicks a toggle on the Agents tab (Phase 4+ records the actual operator's username via `DASHBOARD_PREFIX`) |
| `worker`                | `display` + `meta`                     | `syncSettingsFileOnBoot` on every worker start    |
| `deploy`                | `display` + `meta` (indirectly, via worker restart) | After secrets materialize + worker relaunch |
| `setup`                 | `display` + `meta` (seed) + `overrides` reset to null | Initial `setup` skill run                   |

`SettingsWriter = \`dashboard:${string}\` | "deploy" | "setup" | "worker"` — bare `"dashboard"` is rejected by `normalizeUpdatedBy` and falls back to the default writer on read, so pre-Phase-4 files auto-heal on the next write.

**Invariant:** a patch containing only `display` NEVER clobbers `overrides`, and vice versa. `writeSettings` enforces this by merging each section independently. Operator toggles survive every deploy and every restart.

## Readers

**`isFeatureEnabled(boardCtx, ctx, feature)` in `src/settings-file.ts` is ASYNC** (DX-1817 moved per-board settings off this file's `overrides` into the `board_settings` Postgres row — the read is now a DB query, not a synchronous file read). Never throws — falls back to `envDefault(ctx, feature)` on any failure (DB unreachable, pool exhausted, missing/incomplete row, or a read exceeding the bounded `featureReadTimeoutMs` ceiling). **Always `await` it.** A missed `await` makes `!isFeatureEnabled(...)` evaluate `!Promise` → always `false` → silently opens the gate; `tsc` does not catch this, only the sweep `src/__tests__/no-unawaited-board-settings-reads.test.ts` does. The `dispatchApi` / `ideator` / `autoTriage` / `autoModelEscalation` toggles resolve through this path from `src/worker/dispatch.ts` and `src/dispatch/core.ts`.

**Slack and issue-poller enablement do NOT go through `isFeatureEnabled` at all.** DX-1025 moved Slack enable + tokens + channel into `board_slack_settings`; DX-1030 moved poller enablement into `board_poller_settings` — both per-board DB tables gated directly by their own readers, not this file's contract. `src/poller/index.ts` is itself retired (commit `4669e288`) — dispatch is driven by `src/dashboard/dispatcher-loop.ts` now, not a per-repo poll loop.

Everything else touching the per-repo `settings.json` file itself — `readSettings` (sync, file-backed, returns the default structure when the file is absent, logs-once-per-minute-per-path on parse errors without throwing) — is for the `overrides`/`display` contract this skill documents below, never for the DB-backed toggles above.

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

## Agents roster — NOT in this file at all (DX-1225)

The named-agent roster has never lived in `<repo>/.danxbot/settings.json` since DX-1225. There is no `agents{}` map, no `normalizeAgents`/`mutateAgents`, on this file — `src/settings-file.ts`'s `Settings` interface carries no `agents` field. The intermediate per-board `board_agents` Postgres table (DX-1113, one row per `(board_id, name)`) is itself superseded: DX-1225 moved the roster again, into the **install-global** `agent_profiles` Postgres table (`src/issues/db/agent-profiles.ts`) — one row per NAME across the whole install, since profiles are board-agnostic roles that a board selects rather than owns. Per-(profile, card) strikes live in the sibling `agent_profile_strikes` table (`src/agent/strikes.ts`). There is exactly ONE home (Core Principle 1) — never add an `agents` field back to this file, and never add a JSON-fallback reader.

## Schema (abbreviated)

```
{
  "overrides": {
    "dispatchApi":  { "enabled": true | false | null },
    // env default `false` — operator opts in per-repo when they want
    // /danx-ideate to run when the Review list runs short.
    "ideator":      { "enabled": true | false | null },
    // env default `false` — operator opts in per-repo when they want
    // /danx-triage to run on Action Items + Review when ToDo is empty.
    "autoTriage":   { "enabled": true | false | null },
    // DX-1100 — bounded context-overflow auto-upgrade. Default `true`.
    "autoModelEscalation": { "enabled": true | false | null }
  },
  "display": {
    "worker":  { "port": 5562, "runtime": "docker" },
    "github":  { "token":    "ghp_****xyz", "configured": true },
    "db":      { "host": "mysql", "database": "ssap_sail", "configured": true },
    "links":   { "slackChannelUrl": "", "githubUrl": "..." }
  },
  "meta": { "updatedAt": "...", "updatedBy": "dashboard:<username>" | "deploy" | "setup" | "worker" }
}
```

`pickupNamePrefix` (system-test isolation, `make test-system-poller`) is NOT under `overrides` — it lives under `testIsolation` on the worker-owned runtime-drift file, not the operator-facing contract shown above.

See `src/settings-file.ts` for the canonical TypeScript types and `docs/superpowers/specs/2026-04-20-agents-tab-design.md` for the full design document.
