---
name: issue-card-workflow
description: 'Issue card lifecycle: status derivation, mcp__danx_dashboard__issue_* tools, comment/retro/blocked/waiting_on contracts, container-atomic rule (Epic + Feature). LOAD BEFORE proposing card TYPE or how to slice work into cards (epic/feature/story) — recommending a card structure in chat is the gated action, not just the issue_create call; the slice/taxonomy gate that decides epic-vs-story lives ONLY in this body, so naming a type before loading = deciding it wrong.'
---

# Issue Card Workflow

Universal rules for issue cards. **Dashboard Postgres DB is sole source of truth.** Agent path uses MCP tools (`mcp__danx_dashboard__issue_*`) exclusively — that is the entire surface an agent ever touches for card state.

## DX-835 — two-step termination is MANDATORY

Card lifecycle (`completed_at` / `blocked_at` / `cancelled_at`) is the AGENT's explicit responsibility, written via `mcp__danx_dashboard__issue_transition`. `mcp__danxbot__danxbot_complete` finalizes the dispatch row ONLY; it does NOT move cards. Every issue-bound terminal flow is two calls in order:

| Outcome | Step A (card) | Step B (dispatch) |
|---|---|---|
| Done | `issue_transition({id, action:'complete', summary})` | `danxbot_complete({status:'complete', summary})` |
| Cancelled | `issue_transition({id, action:'cancel'})` | `danxbot_complete({status:'complete', summary})` |
| Blocked | `issue_transition({id, action:'block', reason})` | `danxbot_complete({status:'failed', summary})` |

Skipping Step A leaves the card stuck mid-state — `dispatch_id` cleared (worker side), but no lifecycle stamp. Verify via `issue_get` after Step A: `completed_at` / `cancelled_at` / `blocked_at` non-null + `status_derived` matches expected, BEFORE Step B.

## DEFAULT IS ALWAYS: create card + `ready` for the worker. Inline is NOT a decision you make.

Inline (working a card yourself in this session) is NEVER a judgment call. The operator MUST **explicitly** state to do the card inline ("do it inline" / "do it yourself" / "this session" / "don't dispatch" / "handle it now"). Absent that explicit instruction, the assumption is ALWAYS: **create the card and let the worker handle it** — `ready` it (or leave it in `ToDo`) so the poller dispatches a worker, which brings the worktree to `origin/main`, runs the PRE/POST quality-gate reviewer dispatches natively, and finalizes the merge.

**Mechanical gate — operator gives a fix/build/change ask:**
1. Did the operator EXPLICITLY say to do it inline / yourself / this-session / not-dispatch? → if NO: create the card, `ready` it, STOP. The worker owns it. Do not manual-pickup, do not work it.
2. Only an explicit inline instruction unlocks the self-pickup path below.

There is NO "exploratory / tiny / lower-latency / I'm already here / the work is small" exception — every one of those is the rationalization this gate blocks. "Help me fix this" / "can you fix X" / "this is broken" are NOT inline instructions — they are card-creation requests fulfilled by the worker. When in doubt, it is NOT inline.

## In-session work = self-pickup IMMEDIATELY (a ToDo card is an open dispatch request)

A card in `ToDo` (`dispatchable_derived: true`) is NOT a passive note — it is an **open dispatch request the poller will fulfill with a worker on its next tick.** If you create/ready a card for work YOU are doing in THIS session (not delegating), and you leave it in `ToDo` while you work, the poller dispatches a SECOND agent against the same card → two checkouts, duplicate commits, push conflict.

**Mechanical gate — when you are about to work a card yourself, BEFORE the first work action. Triggers on ANY of: you create it, you `ready` it, OR the prompt/handoff/operator names an EXISTING card id for the work** (a handoff that only mentions the terminal `complete` transition is NOT an exemption from pickup — claim first, then work):
1. `issue_transition({id, action: 'pickup', manual: true})` → `In Progress` (`dispatchable_derived: false`). This REMOVES the card from the poller's dispatch pool. Do it FIRST, then work.
2. **`manual: true` is MANDATORY for self-pickup** (DX-946). It stamps `dispatch_kind: 'manual'` — the marker that tells the worker this card is operator-owned: no orphan-IP heal rollback, no Epic auto-rollup, no auto-transition of any kind. A plain `pickup` (no `manual`) registers as a worker dispatch with no live session behind it; after 5 minutes the orphan heal rolls the card back to ToDo and the poller dispatches a SECOND agent against your in-flight work (this exact race burned SG-331).
3. `pickup` is NOT a worker-only formality. Its function is taking the card OUT of dispatchable state — it applies equally to the main/operator session. "No dispatch context, so skip pickup" is the exact rationalization that causes the duplicate-worker race.
4. `manual: true` bypasses every card-flow gate (`ready_at`, `blocked_at`, `requires_human`, `depends_on`, `conflict_on`) — a manual pickup is fully operator-controlled and works straight from Review. Only terminal / already-dispatched still refuse 409.
5. A manual hold is released ONLY by an explicit transition from your session: `complete` / `cancel` / `block` / `rollback_pickup`. Nothing auto-clears it — abandoning the session leaves the card In Progress until you (or the operator) transition it.

Order for self-done work: `create` → **`pickup` with `manual: true`** → work → `complete`. (`ready` is optional — manual pickup does not require it.) Never `create` → `ready` → work (leaves a dispatchable gap the poller races), and never a bare `pickup` for in-session work (leaves a heal-rollback window).

**Sub-agents under YOUR control ARE in-session work — you own their cards' FULL lifecycle.** Dispatching the work to your OWN `Agent`/sub-agent (not the danxbot poller) is NOT the "(not delegating)" exemption above: manual-pickup the card → `In Progress` BEFORE launching the sub-agent, keep it `In Progress` the whole time they run, and YOU drive the terminal `complete`/`block` the moment they finish (verify via `issue_get`). The ONLY thing "delegating" exempts is handing a card to the *poller* via `ready` — there a worker claims it. Readying (or leaving in `ToDo`) a card your own sub-agent is actively working, and letting the poller own its state, is the failure this clause blocks.

## Source of Truth

**Dashboard DB** (via `mcp__danx_dashboard__issue_*` MCP tools) is the canonical source for title, description, status, AC, children, comments, retro, blocked, waiting_on, requires_human. Agents read + write via MCP only — that is the whole surface. Poller dispatches off the dashboard DB via the dashboard HTTP API. Want a status change → call `mcp__danx_dashboard__issue_transition` or `mcp__danx_dashboard__issue_edit`.

## DB Schema

Full schema available via `mcp__danx_dashboard__issue_get`. Key fields:

- **`status` / `status_derived`** — **DERIVED from lifecycle triggers, agents NEVER write.** Computed by server from timestamps + gates. Pickup → via `issue_transition({action: 'pickup'})` (rule 4 → `In Progress`). Approve → `issue_transition({action: 'ready'})` (rule 5 → `ToDo`). Complete → `issue_transition({action: 'complete', summary})` (rule 2 → `Done`). Cancel → `issue_transition({action: 'cancel'})` (rule 1 → `Cancelled`). Block → `issue_transition({action: 'block', reason})` (rule 3 → `Blocked`). Direct write FORBIDDEN.
- **`dispatch`** — worker-managed, agents don't touch.
- **`children[]`** — ordered list of child ids. On Epic = phase cards (UI "Phases"). On non-epic = sub-cards (UI "Children"). Phases MUST be cards, no in-card checklist. Set via `issue_edit({parent_id})` on child cards.
- **`ac[]`** — Acceptance Criteria. Server assigns `check_item_id` on create. Agents populate via `issue_edit({ac})`.
- **`retro`** — fill on Done/Cancelled/Blocked via `issue_retro({good, bad, action_item_ids[], commits[]})`. Server auto-renders `## Retro` comment. `commits[]` owned-repo ONLY (DX-559 gate). `action_item_ids[]` = LAST RESORT.
- **`blocked`** — self-block trigger. Null = card proceeds. Non-null = `{at, reason}` = card stuck, human acts. Set via `issue_transition({action: 'block', reason})`. Agents never write `status: "Blocked"` — call transition, server projects.
- **`waiting_on`** — dep-chain gate, status-independent. Card queued behind OTHER in-flight work (phase sibling, Action Items, separate task). Null = nothing queues. `{reason, timestamp, by[]}` = by[] is IMMEDIATE blocker(s) only (never transitive). Picker skips while any blocker non-terminal; auto-unblocks on terminal. Set via `issue_dependency({action: 'add', kind: 'depends_on'})`. **Waiting On ≠ Blocked** — Blocked is THIS card stuck (human), Waiting On is queued behind OTHER work.
- **`requires_human`** — orthogonal gate, status-independent. Null = no human needed. Non-null = `{reason, steps[], set_by, set_at}` = card needs human on system with zero agent reach (3rd-party token, vendor portal, external infra). Set via `issue_requires_human({id, set: true, reason, steps[]})`. Cleared by human via dashboard only.

## MCP Tools Reference

| Tool | Purpose |
|---|---|
| `mcp__danx_dashboard__issue_create({type, title, description, parent_id?, ac?, effort_level?, phase_children?, required_gates?})` | Allocate next `<PREFIX>-N` in DB. Epic creation optionally includes `phase_children[]` to create child cards atomically. `required_gates?: string[]` flags which quality gates apply (see Quality-Gate Flagging gate). Returns `{ok: true, body: {id, ...}}` or `{ok: false, body: {error, ...}}`. |
| `mcp__danx_dashboard__issue_list({status_derived?, type?, parent_id?, dispatchable_derived?, assigned_agent?, include_closed?})` | **Preferred for multi-card scan/discovery** — status sweeps, sibling lookups, parent→children, "find all blocked". Returns list of card objects. Use BEFORE hand-globbing. |
| `mcp__danx_dashboard__issue_get({id})` | Single card read. Returns full card object from DB. |
| `mcp__danx_dashboard__issue_edit({id, title?, description?, ac?, effort_level?, parent_id?})` | Prose-only updates (no status/lifecycle stamps). Agents never write `status` directly. |
| `mcp__danx_dashboard__issue_transition({id, action: 'ready'\|'pickup'\|'complete'\|'cancel'\|'block'\|'unblock'\|'archive'\|'reopen', reason?, summary?, manual?})` | Lifecycle transitions. Server stamps timestamps + recomputes `status_derived`. `manual: true` (pickup-only, DX-946) = operator-session self-pickup: stamps `dispatch_kind: 'manual'`, bypasses card-flow gates, worker never auto-transitions the card. |
| `mcp__danx_dashboard__issue_triage({id, verdict: 'approve'\|'cancel'\|'keep'\|'defer', ice?: {i,c,e}, reason, ttl_seconds?})` | Single atomic triage call. Server routes per verdict. |
| `mcp__danx_dashboard__issue_comment({id, action: 'add'\|'edit'\|'delete', comment_id?, text?})` | Comment lifecycle (add/edit/delete). Server stamps author + timestamp. |
| `mcp__danx_dashboard__issue_dependency({id, action: 'add'\|'remove', kind?: 'depends_on'\|'conflict_on', target_id?, reason?, dependency_id?})` | Manage card dependencies. |
| `mcp__danx_dashboard__issue_requires_human({id, set: true, reason, steps[]} \| {id, set: false})` | Set/clear the `requires_human` gate. Server stamps `set_by`/`set_at`. |
| `mcp__danx_dashboard__issue_retro({id, good, bad, action_item_ids[], commits[]})` | Populate retro on terminal. |

### MCP Error Handling

All tools return `{ok: true|false, status, body}`. On error, `body` contains structured error:
- `{error: "<reason>", failed_gate?, non_terminal_phases?, offending_keys?}`

Agents read `result.body.error` (NOT `result.errors[]`) and route per the message. Each tool's own MCP description names the invariant it encodes (e.g., `issue_transition` rejects non-terminal phases on `complete`). Reference that mechanism, not paraphrases.

## Lifecycle & Status Derivation

See references/lifecycle-states.md for complete state machine, derivation rules, triage cadence, and gate contracts.

## Card Taxonomy — Epic / Feature / Story / Bug / Chore

**Primary axis = scope / decomposability, NEVER elapsed time.** Measure scope by *how many independently-shippable, fully-testable vertical slices the work splits into* — each slice = one functional commit. Perceived scope (# files / classes / methods + complexity) sets the count; the clock never does.

| Type | Definition |
|---|---|
| **Story** | One vertical, fully-testable slice that ships as a **single functional commit**. Kept as small as possible while still a working, testable increment. The atomic unit. |
| **Feature** | A **few** related Stories that together deliver one stakeholder-facing capability. |
| **Epic** | **A lot** of Stories, or **multiple Features** — a large initiative decomposed into many independently-shippable slices. |
| **Bug** | A defect; restores intended behavior (no new value). Sized like a Story (one functional commit). |
| **Chore** | Necessary work with no direct user-facing value — deps, docs, tooling, refactor, a "decide X" / "review Y" call. Sized like a Story. |

**Epic AND Feature are CONTAINERS — never worked directly.** A Feature, exactly like an Epic, groups child cards, is NEVER dispatched to a worker, and its status is computed from its children (not its own lifecycle). NEVER put executable work directly in a Feature: the Feature body holds context / goal only; every slice of work is a child Story/Bug/Chore. Story / Bug / Chore are the atomic, dispatchable leaves. A Feature that describes work in its own body / `ac[]` instead of in children is a DEFECT.

**Mechanical gate — count the slices BEFORE you pick a type:**

> Count the independently-shippable, fully-testable vertical slices the work splits into — each slice = one functional commit. **1 slice → Story** (make it as small as still-testable). **A few slices → Feature. Many slices, or multiple Features → Epic.** Interlocking pieces that *cannot each ship as their own green functional commit* are NOT separate slices — they collapse into ONE Story (carry the size in `effort_level`, never by promoting to Epic). The trigger is slice-count / decomposability, measured by perceived scope — **never elapsed time.** File-count, LOC, test-count, and number-of-files-touched are NOT slice signals — a 30-file change that ships as 4 green commits is a 4-slice **Feature**, not an Epic. Promote to Epic only when the slice count itself is large (≫ a handful) or it splits into multiple Features; if you catch yourself reaching for Epic because the work "feels big," re-count slices first. **"Important / risky / reverses a core principle / load-bearing / momentous / nobody's touched this before" are NOT slice signals** — they describe decision-weight, not decomposability. A 3-slice change stays a Feature no matter how consequential the decision behind it; the gravity already lived in the discussion, not the card type.

**Bias-to-COMBINE gate (MANDATORY, run BEFORE the count gate decides type):** "can be a separate commit" ≠ "should be a separate Story." The DEFAULT is the LARGEST card the work reasonably fits in — fewer, bigger Stories beat many tiny ones. Only split when one of TWO things is true: (a) the whole is genuinely TOO LARGE to ship/test as one green commit, OR (b) the parts differ in NATURE / separable concern (different subsystem, different skill, independently re-usable). Pieces that touch the same surface and would naturally be done in one sitting → ONE Story (carry size in `effort_level`), even if each could technically be its own commit. Adding a config var + threading it through 2-3 call sites + a guard is ONE Story, not three. Reflexively splitting because the count gate *lets* you is the exact failure this gate blocks — justify each split against (a)/(b) or collapse it.

**Pre-`issue_create` mechanical check (MANDATORY):** Before writing `type` in the payload, name each slice as "slice N: <verb> X — ships as commit cN that passes its tests standalone." If you can't list ≥2 such slices, the type is **Story** + carry size in `effort_level`. If your draft says `type: "Feature"` or `"Epic"` and you have <2 named green-commit slices, downgrade. Investigation+fix+tests for one defect = one interlocking unit = one slice = Story, regardless of effort. Skipping this check because "the work feels too big for Story" is the exact failure the gate exists to block — re-run it, then write `type`.

**Cross-repo slices DON'T count toward THIS card's type (MANDATORY).** A card lives on ONE repo's board. Count ONLY the slices in THAT board's repo. Work in a *different* repo is a SEPARATE card on that repo's board — never a child, never a slice of this one. A 1-repo-slice card is a **Story** even when related work exists in another repo (note the sibling in the description; file it separately). Counting another repo's work as in-card slices is the exact mis-size that produces a wrong-typed card.

**NEVER create a childless container (MANDATORY).** A `Feature`/`Epic` status is DERIVED from children — a container with zero children CANNOT be readied, picked up, or cancelled (the lifecycle 409s on every transition). So a Feature/Epic is valid ONLY if you create its child Stories on THIS board in the SAME turn (Epic → `phase_children[]`; Feature → child cards with `parent_id`). If you cannot — because there's only one in-repo slice, or the other slices live in another repo — the card is a **Story**, not a childless Feature.

**Pre-`issue_create` EFFORT-sizing check (MANDATORY, separate from type):** `effort_level` measures REASONING-DEPTH the agent needs, NOT importance/risk/blast-radius. Default `medium`; pick the LOWEST level that can plausibly complete. Bump UP only for genuinely deep reasoning (novel multi-file architecture with no prior art, subtle concurrency). Bump DOWN when the card is fully specified, has prior art to clone, or is mechanical (deletions, doc/wiring updates). **NON-signals for high effort — if your only reason is one of these, you are over-sizing:** "reverses a principle", "load-bearing", "important", "consequential", "touches dispatch core". `max` (= opus, most expensive) is reserved for work whose CODE is genuinely the hardest in the repo — never for work whose DECISION was hard. A card that hands the agent a complete spec + prior art is `medium`/`high`, not `max`, however momentous the change.

**FORCING FUNCTION — emit a Slice Plan BEFORE any `issue_create` with `type: "Feature"` or `"Epic"` (MANDATORY, no exceptions):** A Feature/Epic is a CONTAINER of slices, never itself a slice. **Slices ALWAYS live at the Story level** — the Story is the atomic vertical unit. Before the first `issue_create` for a Feature or Epic, you MUST print, visibly in your message, a numbered Slice Plan:

> **Slice Plan for `<container title>`:**
> - Story 1: `<verb> X` → a human can now see/do `<observable Y>` → ships as ONE green commit
> - Story 2: …

Each line MUST name a concrete user-observable result; a line with no see/do answer is a horizontal layer → not a Story → fold it. No Slice Plan printed in the turn = DO NOT create the Feature/Epic (and do not create its child cards). The Feature/Epic card is created only AFTER the plan, and its child cards ARE those Stories — for an Epic, created atomically via `phase_children[]`; for a Feature, created as separate child cards each carrying `parent_id` (`phase_children[]` is Epic-ONLY — the server 400s it on a Feature). Skipping the plan because "the skill is already loaded" / "I know the slices" / "I'll just type Feature" is the exact compliance failure this forcing function exists to make visible — the plan must appear in the transcript, not in your head.

**Pre-`issue_create` VERTICAL-CUT gate (MANDATORY when splitting an epic/feature into phase/child cards):** Slice-count is necessary but NOT sufficient — a card can pass the count gate and still be a horizontal layer that ships green yet delivers ZERO observable behavior. Before creating each phase card, answer mechanically: **"What can a human SEE or DO after this card alone that they couldn't before?"** No concrete user-observable answer → the card is a horizontal slice (schema-only, client-only, route-with-stub-handler, "wire X for later") → it is NOT a valid standalone card. FOLD it into the first vertical slice that exercises it. Each phase MUST be cut by capability end-to-end (its own thin schema + plumbing + behavior), never by architectural layer. Forbidden phase shapes: a "schema/migrations" phase, a "client/API wrapper" phase, an "ingress pipe" phase whose handlers land later. Decompose by feature (V1 outbound mirror, V2 inbound new-card, ...), not by layer (P1 schema → P2 client → P3 routes). "Front-load the schema once to avoid rework" is the exact rationalization this gate blocks — schema rides along with the slice that first needs it (CP1: canonical at its time, bump per slice is fine).

**Allowed parent→child type matrix:** Epic → Feature | Story | Bug | Chore (never Epic). Feature → Story | Bug | Chore. Story / Bug / Chore are atomic — no type-children. (Epic-child types are enforced mechanically by `phase_children[]`; the rest is this gate.)

**Post-`issue_create` DEPENDENCY-WIRING gate (MANDATORY, same turn as creating an Epic/Feature with `phase_children[]`):** `phase_children[]` sets `parent_id` ONLY — it wires ZERO ordering. Sequentially-dependent phases dispatch in PARALLEL the instant they are readied. So immediately after the create, for EVERY phase that needs an earlier phase done first, call `issue_dependency({id: <later-phase>, action: 'add', kind: 'depends_on', target_id: <predecessor>})` — BEFORE readying any phase. Relying on Review-status to hold order is the exact failure this gate blocks: the operator's `ready` bypasses it and the poller fans out every dispatchable phase at once. "I'll add the edges when I ready them later" is the deferral that ships an unguarded epic — wire them at creation or the ordering does not exist.

See references/phases-epics.md for the split walkthrough, epic mechanics, phase creation, and completion contract.

## Quality-Gate Flagging at Card Creation (decide, don't review)

**Flagging a gate is a DECISION recorded on the card — NOT work you perform in the moment.** As the creating/fleshing agent you only decide WHICH gates apply and flag them, then move on. The gate RUNS LATER: the three PRE gates are dispatched by the worker into the dedicated gate-reviewer agent before work starts; the POST `code` gate runs inside the work agent's own session at the end. **NEVER attempt to perform any review at creation time** — no design audit, no test-plan pass, no diff read. Decide → flag → next.

Flag a gate when its trigger fits the card:

| Gate | Phase | Flag when the card… |
|---|---|---|
| `dependency` | PRE | likely overlaps other in-flight work — ordering risk, same-file/surface conflict potential. |
| `architecture` | PRE | is non-trivial design: new module boundaries, touches core invariants, an architectural decision. |
| `tdd` | PRE | has behavior that must be pinned test-first / AC that should be checkable tests. |
| `code` | POST | finished diff warrants a code review before completion. |

**Pre-`issue_create` GATE-DECISION TABLE (MANDATORY, every card — emit visibly, no silent default):** Before EACH `issue_create`, print in your message a gate table FOR THAT CARD covering every gate whose board state is **Optional** (the gates that are the agent's call — `required` ones always run, `disabled` ones never do, so neither needs a row). One row per Optional gate: `Gate | flag / skip | reason`. The reason is one brief clause justifying the verdict against the trigger row above. `required_gates[]` on the payload = exactly the rows marked `flag`. No table printed in the turn → DO NOT create the card. Omitting `required_gates` is valid ONLY when the table shows every Optional gate as `skip` with a reason each — "I didn't think about gates" / an empty `required_gates` with no table is the exact failure this check blocks. Default-on heuristics: a Feature/Epic, a new model/table, or cross-layer work → `architecture: flag`; any card with behavioral AC → `tdd: flag`. Containers inherit nothing — table + flag the Feature/Epic itself, not just its children. Creating N cards in a turn = N tables.

> **Gate table for `<card title>`:**
> | Gate | Verdict | Reason |
> |---|---|---|
> | architecture | flag | new model + cross-layer recorders |
> | tdd | flag | behavioral AC must be pinned test-first |
> | dependency | skip | isolated surface, no overlap |
> | code | flag | diff warrants review before completion |

**HOW to flag:** pass `required_gates: ["architecture", "tdd", ...]` (gate NAMES) on `mcp__danx_dashboard__issue_create`, OR flip the per-card gate toggle later (`mcp__danx_dashboard__issue_quality_gate` / the issue drawer).

**Board requirement is TRI-STATE per gate, NOT a binary on/off.** Each gate's `board_quality_gate_settings.default_state` is one of:

| Board `default_state` | Does flagging the card make the gate run? |
|---|---|
| `required` | Runs ALWAYS — per-card flag irrelevant. |
| `optional` | **ENABLED, per-card opt-in — runs when the card flags it.** This is NOT "off". |
| `disabled` | Never runs — per-card flag is inert. |

So a per-card flag launches the gate when the board state is `required` OR `optional`; it is inert ONLY when the board state is `disabled`. **Do not read `optional` as disabled** — that misread concludes a flagged gate "won't fire" when it will. The single source of truth is `isGateEffectivelyRequired` (`src/issues/quality-gates/read.ts`): `disabled`→never, `required`→always, `optional`→the per-card `required` flag.

## Known dependency / conflict edges at creation (opportunistic, never a search)

When you ALREADY KNOW of a related in-progress / ToDo card in this moment (a sibling you just created, a card you read this session), record the edge:

- `depends_on` — one-way: this card needs another card's output first. `issue_dependency({id, action:'add', kind:'depends_on', target_id})`.
- `conflict_on` — same-file/surface overlap, mutually exclusive per pair. `issue_dependency({id, action:'add', kind:'conflict_on', target_id})`.

**MUST NOT go searching / scanning the board for related cards.** Record only what you already know — opportunistic, best-effort, not a discovery pass. This is DISTINCT from the thorough **dependency quality GATE** (flag `dependency` above), which does the systematic compare against the full live Ready + In-Progress set later. It is ALSO distinct from the mandatory epic phase-child DEPENDENCY-WIRING gate above (which wires required ordering among phases of an epic you just created) — that one stays mandatory; this known-edge recording is the looser, any-card, best-effort layer.

## General Rules

- One card at a time; no orchestrator, no subagents
- Call MCP tools only for all card operations
- `type:` ∈ `Epic` | `Feature` | `Story` | `Bug` | `Chore` — required (pick via the Card Taxonomy gate above)
- Comments = markdown with `##` headers (set via `issue_comment`)
- AC lives in `ac[]` (set via `issue_edit`) — never inline. Phases/sub-cards in `children[]` as `<PREFIX>-N`; each child has own DB record.
- `retro.action_item_ids[]` = only valid `<PREFIX>-N` format. Create card first, push id (via `issue_retro`).
- Connected repo cards reference that repo's architecture (not danxbot paths).
- NEVER read/write card state via file operations — use MCP tools exclusively.
- NEVER write `status:` literals via `issue_edit` — use `issue_transition` for lifecycle changes.
- NEVER manually append `## Retro` to comments — use `issue_retro` tool.
- NEVER escape markdown — use formatting (`##`, fenced blocks, tables).
- **Durable work-records live on a card — never a substitute artifact.** (WHEN this fires lives in the SKILL LOAD MANDATE; this is the contract once loaded.) Any card/epic/plan/findings/design/handoff/spec meant to survive the session = CREATE/APPEND on a tracker card (MCP `issue_create`, or `POST /api/issues`). Substitutes that do NOT count and are forbidden: a standalone repo `.md`, and in-session `TaskCreate`/`TaskList` (ephemeral working memory — mirror steps there only AFTER the card exists). Forbidden target dirs — `docs/handoffs/`, `docs/specs/`, or any dir git history shows was deleted: recreating them is the failure. Create-tooling unavailable → STOP and ask; never default to a parallel `.md`. Standalone docs only when the user explicitly asks for a file/doc.
