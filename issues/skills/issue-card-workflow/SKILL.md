---
name: issue-card-workflow
description: 'MANDATORY when reading, writing, or saving any issue card. Loads YAML schema, tracker contract, danx-issue MCP usage, lifecycle rules (status moves, retro, action items, phase cards) as TodoWrite checklist. Triggers — touching `<repo>/.danxbot/issues/`, calling `mcp__danx-issue__*`, picking up an `ISS-N`, terminal save with retro.'
---

# Issue Workflow

Universal workflow rules for issue cards tracked as YAML files at `<repo>/.danxbot/issues/{open,closed}/<id>.yml`. The danxbot worker mirrors that state to a backend tracker (Trello, Memory) for human visibility on a ~60s poll cycle.

## Source of Truth

**Local YAML is the single source of truth.** Title, description, status, AC, children, comments, retro, blocked, labels — every field on the `Issue` schema lives canonically in `<repo>/.danxbot/issues/{open,closed}/<id>.yml`. The poller dispatches off the local YAML. The danxbot agent path reads + writes the YAML.

**The backend tracker (Trello) is a one-way mirror with two narrow inbound exceptions.**

Outbound (YAML → tracker, every tick):
- Every YAML field — title, description, AC, children, status (list move), labels, comments — is pushed to the tracker so humans see current state.
- The tracker's view is a *projection* of the YAML. Nothing the tracker shows is authoritative.

Inbound (tracker → YAML, narrow):
1. **New cards.** A card created on the tracker that has no matching local YAML gets hydrated into a fresh YAML on the next tick. After hydration, the YAML is the source of truth for that card forever.
2. **New comments.** Human-authored comments on the tracker are pulled into the YAML's `comments[]` so the agent sees them. Comment-author detection distinguishes human vs bot-mirrored comments to avoid echo loops.

**Everything else from the tracker is ignored.** A human dragging a card between lists on the tracker, editing its title, ticking an AC checkbox, etc. has no effect on the local YAML. The next tick re-asserts YAML state and the human's tracker-side edit disappears. If you want a status change, edit the YAML (or use `mcp__danx-issue__danx_issue_save`). The tracker is for *viewing* and *commenting*, not for editing card structure.

This is intentional. Two-way sync on every field would create merge conflicts the worker can't resolve. One-way mirror + narrow inbound exceptions = unambiguous semantics.

**Agent path is YAML + `mcp__danx-issue__*` MCP tools only.** The agent never calls a backend tracker SDK directly. The danxbot worker is the sole writer to the backend on its ~60s poll cycle.

## YAML Schema

Authoritative source: `/home/newms/web/danxbot/src/issue-tracker/interface.ts` (the `Issue` type).

Quick reference:

| Field | Type | Notes |
|---|---|---|
| `schema_version` | `3` | Never change. |
| `tracker` | string | Don't change. Implementation-managed. |
| `id` | string (`ISS-N`) | Internal primary key. Filename is `<id>.yml`. Don't change. |
| `external_id` | string | Tracker-native id. Sync-layer only — never expose, never edit. |
| `parent_id` | `string \| null` | Child card → parent's `id`. On phases of an epic = epic's `id`. Reverse linkage to `children[]`. |
| `children` | `string[]` (ids) | Ordered list of child issue ids (`ISS-N`). Available on every card type. On `type: Epic` = the ordered phase cards (UI label "Phases"). On non-epic = sub-cards (UI label "Children"). One field, two labels. Phases MUST be cards — there is no in-card phase checklist (ISS-81 retired the old `phases[]` field). Maintained by `danx-epic-link` skill (human-created phase cards) and by `danx_issue_create` (drafts with `parent_id` set). |
| `dispatch_id` | `string \| null` | Poller-managed. Don't touch. |
| `status` | `Review` \| `ToDo` \| `In Progress` \| `Needs Help` \| `Needs Approval` \| `Done` \| `Cancelled` | Editing this field IS how you "move" the card. `Needs Approval` is a fifth non-dispatchable status — see "Needs Approval vs Needs Help" below. |
| `type` | `Bug` \| `Feature` \| `Epic` | Required. |
| `title` | string | Card name (no `#ISS-N:` prefix — worker prefixes when pushing). |
| `description` | string | Full markdown body. |
| `triaged` | `{timestamp, status, explain}` | Triage agent owns this. Leave alone. |
| `ac` | `[{check_item_id, title, checked}]` | Acceptance Criteria. New items: `check_item_id: ""` (worker assigns). |
| `comments` | `[{id?, author, timestamp, text}]` | Append `{author, timestamp, text}` (no `id`) — worker pushes. |
| `retro` | `{good, bad, action_item_ids[], commits[]}` | Fill on Done / Cancelled / Needs Help only. Worker auto-renders ONE `## Retro` comment. `action_item_ids[]` is a `string[]` of `ISS-N` references (e.g., `["ISS-12", "ISS-14"]`). Create each action item card first via `danx_issue_create`, then push its returned `id` here. Unknown or malformed `ISS-N` values render as `<ISS-N: unknown>` in the retro comment. |
| `blocked` | `null` OR `{reason, timestamp, by[]}` | `null` when nothing blocks the card. Set to a record when the card is **waiting on other in-flight work** (a phase sibling, an Action Items card, a separately-scoped task) and DOES NOT need a human. `reason` is a non-empty sentence; `timestamp` is ISO 8601; `by[]` is a non-empty list of `ISS-N` ids that must reach Done / Cancelled before the card unblocks. If no card describes the unblock work, **create one** (`danx_issue_create`) and reference it. The worker forces `status: ToDo` whenever `blocked` is non-null; the poller auto-clears the record and dispatches the card once every blocker is terminal. **Blocked is NOT Needs Help** — see "Needs Help vs Blocked" below. |

## MCP Tool Surface

All under prefix `mcp__danx-issue__*` (note hyphen). Error shape: `{<verb>: false, errors: ["msg", ...]}`.

| Tool | Args | Purpose |
|---|---|---|
| `danx_issue_save` | `{id}` | Validate the YAML at `<repo>/.danxbot/issues/{open,closed}/<id>.yml` and reconcile with the tracker (or call `tracker.createCard()` for orphans with empty `external_id`). Returns `{saved: true, ...}` or `{saved: false, errors[]}`. Call after every meaningful Edit. |
| `danx_issue_create` | `{type, title, description, parent_id?, children?, status?, ac?, comments?}` | Allocate next `ISS-N`, build canonical YAML, push via `tracker.createCard`, write to `<repo>/.danxbot/issues/open/<id>.yml`. Returns `{created: true, id, path, external_id}` or `{created: false, errors[]}`. One call — no draft YAML required. The `phases` field is rejected (ISS-81 — use `children[]` for sub-cards / epic phase cards). |
| `danx_issue_get` | `{id}` | Read the YAML for a given `ISS-N` and return parsed object. Use to inspect parents, siblings, etc. without re-parsing manually. |
| `danx_issue_list` | `{status?, type?, parent_id?}` | Enumerate open issues filtered by status / type / parent. Avoid reading every YAML by hand. |
| `danx_issue_close` | `{id}` | Explicit terminal close (sets `status: Cancelled` if not already terminal, fills retro, moves file `open/` → `closed/`). |

**Save semantics:** Edit the YAML with `Edit` (never `Write` over an existing file — preserves other agents' uncommitted edits), then call `danx_issue_save({id})`. Validation runs synchronously; tracker push happens on the next worker poll (~60s). On `saved: false`, fix the validation errors in `errors[]` and re-call.

**Status terminal moves:** when you set `status: Done`, `status: Cancelled`, or `status: Needs Help` and save, the worker moves the file `open/` → `closed/` (Done / Cancelled) on its next poll. Never move the file yourself.

## Needs Help vs Blocked

Two different states for "this card cannot proceed right now":

- **Needs Help** (`status: "Needs Help"`): the card cannot complete without **a human acting**. Credentials, deploy, secrets rotation, ambiguous spec needing a human design call, architectural decision that changes the goal of the card, write-only repo. The card sits in Needs Help until the human acts.
- **Blocked** (`blocked: {...}`): the card is waiting on **other in-flight work** that does NOT need a human — phase siblings shipping first, an Action Items card landing, a separately-scoped task. The poller auto-unblocks and dispatches the card once every blocker reaches Done / Cancelled. Status remains `ToDo` (worker enforces). NEVER set `status: "Needs Help"` for a "waiting on another card" card; that's Blocked.

When the unblock work needs a human, the right shape is: keep this card Blocked, and put the human task in a NEW Needs Help card referenced from `blocked.by[]`. The original card unblocks the moment the human-task card moves to Done / Cancelled.

**Picking up a Needs Help / Blocked card → invoke the `unblock` skill first.** Same applies if the card you are about to start **overlaps** an existing Needs Help card (same parent epic, same key files, same domain) — surface the dependency before doing work that the upstream resolution may invalidate. `unblock` produces the operator playbook; once the human acts and reports back, resume normal `issue-card-workflow` for the AC update.

## Needs Help — Hard Gate Before Saving

Before saving `status: "Needs Help"` you MUST name the **specific human-only resource** that blocks completion. Pick exactly one:

| Allowed reason | Example |
|---|---|
| Credential / secret rotation | API key only humans hold |
| Deploy access | Push to a write-only / human-only environment |
| Write-only repo / external tracker | No agent path to mutate |
| Design / product decision | Ambiguous AC needs human spec call |
| Physical / OOB action | Reset hardware, contact vendor, sign legal doc |

If you cannot name one — **status stays `In Progress` and you do the work.** "Operator should verify in production", "human should run these commands and report back", "live operator-driven runs are the only honest way" are NOT valid reasons. If the verification step is `.env` edit + `artisan` + `make` + `yarn` + log grep, the agent runs it.

**Rationalization detector — if your Needs Help comment contains any of these phrases, you are punting:**
- "operator-driven verification"
- "production-shaped infra"
- "honest way to verify"
- "intermittent — needs more samples" (run more samples yourself)
- "needs to be tested in production / staging"

Strip the punt, run the steps, report the result, update the AC.

## Local-First Execution Rule

**Cards execute + validate in the local Sail environment by default.** Local is intended to be identical to production in every meaningful way. Code, schema, migrations, config defaults, queue, Octane, MCP servers, Pusher, danxbot — all reproducible locally.

A card may target staging / production ONLY when the card's scope IS environment-specific:
- Deploy infra change (Dockerfile, compose, k8s manifest, CI/CD)
- Secret / credential rotation
- Production data migration that cannot run on local fixtures
- Monitoring / alerting wiring that consumes the production telemetry pipe

Reproducing a bug, validating a fix, running an artisan suite, capturing logs, running Pint / vitest / phpunit — all local. If you find yourself writing "verify in staging" on a card whose subject is application code, rewrite the verification step against local.

If local genuinely cannot reproduce, that is a SEPARATE bug — file an action-item card to fix the local-vs-prod divergence rather than punt the original card to staging verification.

## Needs Approval vs Needs Help

`Needs Approval` and `Needs Help` are both non-dispatchable parking statuses — neither status is dispatched by the poller, and the YAML stays in `open/`. They differ in **what kind of human action** unblocks the card:

- **Needs Help** (`status: "Needs Help"`): a human must **supply information** the agent does not have. Credentials, deploy access, missing decision input, an ambiguous AC the agent cannot resolve from the codebase, a write-only repo the agent cannot reach. Without that input the agent is fundamentally unable to do the work.
- **Needs Approval** (`status: "Needs Approval"`): the agent **could** do the work — has the access, the context, the tools — but is uncertain whether the chosen direction is **the right one**. Architectural risk, cross-cutting scope, disruptive refactor, large blast radius, ambiguous tradeoffs. The card sits in Needs Approval until a human reviews the plan and either approves it (move back to ToDo) or redirects it (edit the description, move back to ToDo).

Why two statuses instead of one: operators triaging the parked-card list need to know which kind of action is required at a glance. Conflating "I'm missing information" with "I want sanity check before I proceed" loses signal — the operator either has to read every card body or risks under-reviewing high-risk plans.

The triage agent (auto-triage epic, ISS-74 and downstream phases) routes uncertain cards to `Needs Approval` when ICE-scoring or scope analysis flags the card as risky-but-actionable. Humans can also set `Needs Approval` directly when they want a sanity check before an agent picks up the card.

`Needs Approval` is set / cleared by humans only — the poller never moves a card into or out of Needs Approval automatically. Mirrors today's Needs Help semantics.

## Card Titles

`[Project > Domain] verb phrase` for features. `Fix:` prefix for bugs. Phase cards: `Epic Title > Phase N: Description`. Keep under ~80 chars.

## Card Descriptions (`description` field)

Must pass **zero-context test** — fresh agent with no conversation history can implement from description alone. No code blocks — prose only.

**Feature:** Context (what exists, why change) → Solution (high-level approach) → Key files.

**Bug:** Problem (what's broken) → Root Cause (why, or "TBD") → Solution (what to change) → Key files.

Every description must include: exact file paths, known gotchas, how to verify. Update with investigation findings when picking up a card (Edit the YAML's `description` field, then `danx_issue_save`).

## Checklists

**`ac[]` (Acceptance Criteria, required):** Specific, verifiable items starting with a verb. "Returns 422 when email missing" not "Handle validation."

There is no separate "Progress" or "Phases" checklist on the YAML schema (ISS-81 retired the old `phases[]` field). Multi-step work either fits in `ac[]` on a single card OR splits into an Epic + child phase cards (`children[]`). Progress lives in the agent's pipeline (TDD test pass, code review pass, commit) and is reflected on terminal save via `status: Done` + `retro.commits[]`.

`update_checklist_item` analogue: edit `ac[i].checked: true` (match by exact `title` text — `check_item_id` may be empty for new items the worker hasn't synced yet), then `danx_issue_save`.

## Reading a Card

Always read full context before starting:
- `description`
- ALL `comments[]` (every entry, oldest first)
- `ac[]` (with verification status)
- `children[]` (look up each child YAML — those are the phase cards on epics, sub-cards otherwise)
- `triaged` (if non-empty)

`mcp__danx-issue__danx_issue_get({id})` returns the full parsed object. Never work from title alone.

## Creating a Card != Implementing It

**Spawn → DONE.** Don't implement, don't pick up, don't start work. The card hands work to a different agent in a different session. After `danx_issue_create`, only valid actions: tell user the card was created (show `ISS-N`), continue previous work, or stop.

## CRITICAL: Never Check Off an Unverified AC Item

Before setting `ac[i].checked: true`, must have direct evidence: passing test, command output, verified runtime result. "By construction" / "obviously correct" are NOT evidence. Cannot verify an AC item in current environment → leave `checked: false` and say so — never check off with an excuse for why verification was skipped.

## Card Lifecycle

**Pick up:** Edit YAML → set `status: In Progress`. Save. Read full context (description, all comments, all AC, children, labels-equivalent via `type`). Plan work (complex: use writing-plans skill; simple: start immediately).

**During:** Append review results / discoveries to `comments[]`, save. Status moves + checklist edits handled by `flow-commit` skill.

**Complete:** All completion actions (check off ACs, fill retro, set `status: Done`) happen via `flow-commit`. Don't perform manually outside the pipeline.

## Phases vs Epics

**One concept: `children[]`** (ISS-81). On `type: Epic` cards, `children[]` is the ordered list of phase cards (UI label "Phases"). On non-epic cards, `children[]` is sub-cards (UI label "Children"). Phases MUST be cards — there is no in-card phase checklist.

**Small multi-step work → ONE card with `ac[]`.** Each AC item is a discrete deliverable. No need to split if everything fits in a single commit-able session.

**Large multi-step work → Epic + child phase cards.** `type: Epic` on the parent. Each phase is its own full card (own `description`, own `ac[]`, own commit, own retro). Epic stays In Progress while phases work; flips Done when all children reach Done.

**When to split into epic:** Each phase looks like substantial work (multiple files, own tests, full session). Smaller related tasks → keep as `ac[]` items on one card.

**Epic mechanics:** Set epic's `type: Epic`, then IMMEDIATELY spawn all phase YAMLs (`Epic Title > Phase N: Description`), each with its own description / `ac[]` / `type`. Set each phase's `parent_id` to the epic's `id`. Append each phase's `id` to the epic's `children[]`. Planning agent has full context — capture into phase cards NOW, not later. Stamp `blocked.by` on phase 2..N referencing the prior phase so the poller dispatches them in order (default sequential — skip only when phases are genuinely independent).

**Where phase cards go:** Same `status` as parent epic at creation time. Epic in Review → phase cards Review. Epic In Progress → phase cards In Progress. Phase cards move with the epic through lifecycle.

**After completing each phase card:** Set its `status: Done`, fill retro, save. The worker handles the file move + retro comment + action-item spawn on its next poll. Then update the epic via `flow-commit`'s phase handoff (see `~/.claude/skills/flow-commit/SKILL.md`). All phase cards Done → epic also moves to Done with a retro comment summarizing all phases.

**CRITICAL: Update next phase card before ending session.** Append a "Notes from Phase N" entry to the next phase card's `comments[]` and save. Capture: discovered constraints, timing gotchas, reusable helpers + paths, cost/budget observations, dependencies between phases, corrections to the description. Assume the next agent reads ONLY `description` + `comments[]` — not epic handoff, not conversation history, not git log.

## Comment Formats

All comments append to `comments[]` as `{author, timestamp, text}` (no `id` — worker assigns).

**Use markdown.** `description`, `comments[].text`, `retro.good`, `retro.bad` all render as markdown in the dashboard's Issues drawer (via `MarkdownEditor` / `CodeViewer`). Use `##`/`###` headers, fenced code blocks (```ts, ```yml, ```bash), bullet/numbered lists, tables, links, **bold**, `inline code`, blockquotes. File paths + symbols → backticks. Multi-line code → fenced. Diffs → ```diff. Plain prose is acceptable but worse — readers skim formatted content faster, and the drawer's renderer already pays the parser cost. Don't escape markdown to "play it safe."

**Retro** (filled in `retro.{good, bad, action_item_ids, commits}` fields, NOT as a manual comment): worker renders ONE `## Retro` comment automatically on terminal save (Done / Cancelled / Needs Help). Re-saving with edited retro fields → worker edits the same comment in place. `action_item_ids[]` entries are resolved to their card titles and rendered as `- {title} ({ISS-N})` bullets; unknown ids render as `<ISS-N: unknown>`.

**Bug Diagnosis** (bug cards): Problem, Root Cause, Solution. Either prepend to `description` or append as a `comments[]` entry titled `## Bug Diagnosis`.

**Review:** Summary of findings + fixes. Append as a `comments[]` entry titled `## Code Review` / `## Test Review` / `## Review Fixes`.

## The Card IS the Plan

Issue card assigned (`ISS-N`): never use `EnterPlanMode`, never invoke `writing-plans` or `executing-plans` skills. The YAML's `description` + `ac[]` + `children[]` + `comments[]` ARE the plan. Re-fetch via `mcp__danx-issue__danx_issue_get({id})` after context compaction, when unsure what's left, before marking Done.

## Backend Tracker

Backend tracker (Trello today; could be others later) is owned by the danxbot worker. Backend-specific config (board IDs, list IDs, label IDs) lives in:

- `<repo>/.danxbot/config/trello-backend.md` (project-specific) — consumed only by the worker.

Agents do NOT read backend config and NEVER call `mcp__trello__*` tools. If a user pastes a Trello URL or short link, look up the matching local YAML by `external_id` field via `mcp__danx-issue__danx_issue_list({})`, then proceed by `id` (`ISS-N`).

## General Rules

- One card at a time
- Don't block on tracker sync failures — the worker retries on next poll; the YAML is canonical
- `type: Bug` or `type: Feature` minimum (or `Epic`) — required
- Comments = markdown with `##` headers
- AC lives in `ac[]` — never inline in `description`. Phases / sub-cards live in `children[]` as `ISS-N` references; each child has its own YAML.
- `retro.action_item_ids[]` must contain only valid `ISS-N` format strings (e.g., `ISS-1`, `ISS-42`). No free text. Create the card first, then push the id.
- Connected repo cards reference the connected repo's architecture (not danxbot's paths)
- NEVER call `mcp__trello__*` from agent path
- NEVER manually move YAML files between `open/` and `closed/` — terminal `status` triggers the worker move
