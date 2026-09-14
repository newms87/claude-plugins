---
name: plan-workflow
description: 'The danxbot "Plan" feature (goals/rules/caveats/architecture/cards) — real DB schema, MCP tools, HTTP routes, and the critical trap: a fully-built frontend that is NOT wired into deploy.'
---

# Plan Workflow — DB Schema, Tools, and the Unshipped-Frontend Trap

A Plan is danxbot's native replacement for a one-off HTML "artifact" tracking page
(`human-collaboration:artifact-plan`) — a durable, queryable record of Goals, Rules,
Caveats, an Architecture document, and linked Cards, connected to a live session so an
agent's ongoing work has one canonical place to read/write context instead of a local
file. Source of truth for everything below: `<DANXBOT_REPO>` on this dev box
(`C:\Users\newms\projects\danxbot`, the checkout with the real `.git` — never the
separate, independently-historied WSL checkout at `~/projects/newms87/danxbot`).
Verified 2026-09-14 by reading the actual source, not by clicking around the UI — see
the trap below for exactly why that distinction mattered here.

## TodoWrite Checklist (mandatory on first invoke)

1. Confirm which surface you're using: MCP tools (`mcp__danx-dashboard__plan_*` /
   `mcp__danx_dashboard__plan_*` — prefix depends on context, same rule as
   `issue-card-workflow`), the raw JSON API (`/api/plans/*`), or (rare — see the trap)
   the React frontend.
2. If you are about to tell anyone "there is no Plans page" or "the /plans route is
   broken" — STOP and re-read "The Unshipped-Frontend Trap" below first.
3. If you are about to add a field to `plan_records`/`plans`/`plan_cards` — read the
   real migration files named below before guessing a column name.

## Data Model (real tables, verified via migration files)

| Table | Purpose | Key columns |
|---|---|---|
| `plans` | One row per Plan. | `id BIGSERIAL PK`, `name TEXT`, `created_at`, plus 4 nullable `architecture_*` columns (see below) |
| `plan_cards` | Junction: which issue cards are attached to a Plan. | `plan_id` FK→`plans` ON DELETE CASCADE, `card_id` FK→`issues` ON DELETE CASCADE, `UNIQUE(plan_id, card_id)` |
| `plan_records` | Goals / Rules / Caveats — ONE flat table, discriminated by `kind`. | `kind` (`'goal'\|'rule'\|'caveat'`), `ref_num` (permanent, e.g. the `4` in `CAV-4`), `body`, soft-deleted via `deleted_at` — `uniq_plan_records_ref` covers tombstones too, so a deleted ref number is never reused |
| `plans.architecture_*` | The Architecture document. NOT a separate table — 4 nullable columns living directly on `plans` (one-to-one), hash-guarded by a `plans_architecture_content_hash_paired` CHECK constraint (mirrors the content-hash pattern used elsewhere in the dashboard — see `content-hash.ts`). | — |
| `plan_sessions` | Which live agent session is connected to which Plan. | `session_id TEXT PK` = `CLAUDE_CODE_SESSION_ID`, `plan_id` nullable FK ON DELETE SET NULL — **a session connects to at most one Plan at a time** |

Migration files (real names, for when you need to read the actual column list rather
than trust this table): `src/db/migrations/1788777206081-9e32f9_plans_and_plan_cards.ts`,
`1788840717839-114963_plan_records.ts`, `1788842091287-d9c9b8_*` (architecture columns),
`1788844285731-e92e76_*` (`plan_sessions`). All forward-only, no `down` — matches this
repo's Core Principle 1 (no legacy paths).

## HTTP Routes (all JSON, none serve HTML)

Everything lives in `src/issues/plans-routes.ts` (registered in `src/dashboard/server.ts`
behind `url.pathname.startsWith("/api/plans")`), plus a sibling
`src/issues/plan-sessions-routes.ts` for `/api/plan-sessions`:

```
GET/POST   /api/plans
GET/DELETE /api/plans/:id
POST       /api/plans/:id/cards
DELETE     /api/plans/:id/cards/:cardId
CRUD       /api/plans/:id/records[/:rid]
GET/PUT    /api/plans/:id/architecture
GET        /api/plans/:id/full          <- one call, the whole Plan (records + architecture + cards)
*          /api/plans/mine/*            <- session-scoped, resolves via plan_sessions
```

Confirmed live on real production: `curl https://danxbot.sageus.ai/api/plans` → `401`
(route exists, needs the session cookie — this is the SAME backend every
`mcp__danx-dashboard__plan_*` call already goes through).

## MCP Tools

`plan_create`, `plan_list`, `plan_get`, `plan_get_record`, `plan_connect`,
`plan_add_record`, `plan_update_record`, `plan_delete_record`, `plan_add_card`,
`plan_set_architecture` — same tool-prefix rule as `issue-card-workflow` (hyphen
`danx-dashboard` in a dispatched worker, underscore `danx_dashboard` in an operator
session keyed that way in `.mcp.json`). `plan_update_record`/`plan_delete_record` are
hash-guarded (pass the record's current content hash; a stale hash is refused with the
current body returned, same pattern as everywhere else content-hash is used in this
app) — read the tool's own schema via `ToolSearch` before calling it blind.

## ⚠ THE UNSHIPPED-FRONTEND TRAP — read this before ever concluding "no Plans page"

**The backend above is fully live in production. There is also a complete, real React
UI for it in source. Neither implies the other is deployed — and right now, the UI is
not.**

danxbot is mid-migration from an old Vue dashboard (`dashboard/`) to a new React one
(`frontend/`, React 19 + react-router 7). The Plans feature was built ONLY in the new
`frontend/` app:

- `frontend/src/app/routes.tsx` registers `/plans` (list) and `/plans/:planId` (detail).
- `frontend/src/app/nav.ts` lists Plans as the second primary nav item.
- Real screens exist: `frontend/src/routes/plans/{PlansListScreen,PlanDetailScreen,
  PlanCardList,PlanRecordList,PlanArchitectureDocument,ConnectSessionDialog}.tsx`.

**None of that is wired into what actually gets built or served.**
`src/dashboard/server.ts` hardcodes `distDir = "../../dashboard/dist"` — the OLD Vue
app's build output is the only SPA shell ever served, and the file says exactly why any
other path 404s on purpose: *"Only GET / serves the SPA shell. Any unknown path ... must
404 so the SPA's router can't pretend to own routes it doesn't."* `frontend/dist`
appears nowhere in the Dockerfile, any `docker-compose*.yml`, or any build script —
grepped, zero hits. Commit `760db03c` (2026-09-07, "Plans move to the new dashboard and
the Vue version is deleted") deleted the OLD Vue Plans code as part of this migration —
and then the new one was never plugged into deploy. The currently-served Vue app's own
live tab list (`dashboard/src/components/DashboardHeader.vue`'s `TabId` union) has zero
"plans" entry, confirming the same fact from the served-app side.

**So: `GET https://danxbot.sageus.ai/plans` returning a raw `{"error":"Not found"}` is
not a bug, not a wrong URL, and not evidence the feature doesn't exist — it is the
correct, designed behavior of an app whose frontend migration has an unshipped gap.**
`GET /api/plans` on the same host returns `401` (route exists) in the same breath —
proving the backend/frontend split, not contradicting the 404.

Before ever reporting "no Plans UI exists" (or, in the other direction, trying to "fix"
the 404 as if it were a routing regression): check `server.ts`'s `distDir` and whether
`frontend/dist` has been wired into the build/deploy path yet. This file will not be
updated automatically when that changes — if the trap above no longer matches what you
observe, the migration has progressed; update this file in the same breath as noticing
it, the same discipline `docker-deep`/`settings-deep` already hold for their own domains.

## How to actually SEE the real Plans UI today (without deploying anything)

`frontend/` has a plain local dev server (`npm run dev`, Vite, hardcoded port `5567`,
`frontend/vite.config.ts`) that proxies every `/api/*` call to a configurable target:

```bash
cd frontend && VITE_API_TARGET=https://danxbot.sageus.ai npm run dev
```

Opening `http://localhost:5567/plans/1` then renders the REAL React Plans screens
against REAL production data — zero deploy risk, nothing about production changes.

**The one thing this cannot do for you: authenticate.** The dashboard's session is an
HttpOnly cookie scoped per-origin (`vite.config.ts`'s own comment explains why the proxy
exists at all — no CORS preflight support server-side, so a direct cross-origin call is
refused before it ever leaves the tab). Being signed into `danxbot.sageus.ai` in one tab
does **not** carry a session into `localhost:5567` in another — that origin needs its own
sign-in. **Never type the operator's password into that form on their behalf, no
exception** — the same absolute rule as everywhere else in this repo's rules; ask the
operator to sign in on that tab themselves, the same account, same password, just a
second tab.

## Cross-References

- `danxbot:danxbot` (main orientation skill) — points here for anything Plan-specific
- `danxbot:issue-card-workflow` — the card/issue side a Plan attaches to via `plan_cards`
- `human-collaboration:artifact-plan` — the HTML-artifact pattern a Plan is meant to
  eventually replace for durable cross-session tracking
