---
name: issue-card-workflow
description: 'Issue card lifecycle: status derivation, mcp__danx-dashboard__issue_* tools, comment/retro/blocked/waiting_on contracts, container-atomic rule (Epic + Feature). LOAD BEFORE proposing card TYPE or how to slice work into cards (epic/feature/story) — recommending a card structure in chat is the gated action, not just the issue_create call; the slice/taxonomy gate that decides epic-vs-story lives ONLY in this body, so naming a type before loading = deciding it wrong.'
---

# Issue Card Workflow

## VOID-GATE — a decomposition drafted BEFORE this skill loaded is VOID (mechanical, first action)

If you arrive here having ALREADY decided the card TYPE (epic/feature/story), the SLICE breakdown, or the EFFORT level — in chat, in a plan, or in your head — that draft is **VOID. Discard it and re-derive from the gates below.** This skill DEFINES what a slice / type / size IS; anything you picked pre-load used your own heuristic, not the gate, so it is wrong-by-construction even if it "looks right." Validating a pre-load draft against the gate ("the skill just confirms what I designed") is the exact failure — the gate is an INPUT to the decision, never a rubber-stamp on it. Re-run the slice-count, vertical-cut, and effort gates from scratch as if no draft existed.

**PRE-`issue_create` TRANSCRIPT CHECKLIST — this MUST appear visibly in your message before ANY Feature/Epic `issue_create` call (N containers = N plans):**
1. **Slice Plan** (Feature/Epic) — the numbered Story breakdown.

Missing it = do not call `issue_create`. (Quality-gate decisions are a server-enforced REQUIRED `issue_create` field — see "Quality-Gate Decisions" below — so they need no separate transcript emission. `triage_enabled` is ALSO decided on every create — see "Auto-Triage Opt-In" below.)

Universal rules for issue cards. **Dashboard Postgres DB is sole source of truth.** Agent path uses the dashboard MCP tools exclusively — that is the entire surface an agent ever touches for card state.

## ⚠ TOOL-NAME PREFIX IS CONTEXT-DEPENDENT — resolve it before your first call

The tool prefix is derived from the MCP **server key in the config that loaded it**, and the two contexts key it differently. **Both spellings below are real; neither is universally correct.**

| Context | Server key | Tool prefix |
|---|---|---|
| **Dispatched danxbot worker** (a `/danx-next`-style card dispatch — most skills in this plugin) | `danx-dashboard` | `mcp__danx-dashboard__issue_*` |
| **Operator / main interactive session** (e.g. a repo whose own `.mcp.json` keys the server `danx_dashboard`) | `danx_dashboard` | `mcp__danx_dashboard__issue_*` |

This file writes the **hyphen** form throughout because the dispatched-worker path is the majority consumer (danxbot materializes `mcpServers[<artifact id>]` verbatim, and that id is `danx-dashboard` — `REQUIRED_WORK_MCP_SERVER_ID`, `src/inject/repo-profile-seed.ts`). **In an operator session those exact names do not exist** and calling them returns "No such tool available."

**Mechanical rule: do not copy a prefix out of this file on faith.** Read the actual tool name from your own loaded tool list (or `ToolSearch` `select:...`) once, at the start, and use that spelling for every call in the session. The part after the prefix — `issue_create`, `issue_transition`, … — is identical in both.

## DX-835 — two-step termination is MANDATORY

Card lifecycle (`completed_at` / `blocked_at` / `cancelled_at`) is the AGENT's explicit responsibility, written via `mcp__danx-dashboard__issue_transition`. `mcp__danxbot__danxbot_complete` finalizes the dispatch row ONLY; it does NOT move cards. Every issue-bound terminal flow is two calls in order:

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

**Two different axes — do not cross them.** This gate decides ROUTING: does the card go to the poller's worker, or is it worked in this session. Canon principle 1 decides EXECUTION: once work is legitimately yours, do you orchestrate sub-agents or dig yourself. Orchestrating is never permission to bypass this gate — a card the operator did not explicitly hand you inline stays the worker's, and fanning it out to your own sub-agents is still self-pickup, not delegation.

## DECIDE FIRST: ready-for-worker vs build-in-session (default = WORKER)

Before ANY implementation, answer one question: **does the operator want this work BUILT now in this session, or FILED for the danxbot worker to build autonomously?** On a worker-backed board the **DEFAULT is FILE + `ready` → the poller dispatches a worker** — that is the entire point of danxbot. Do NOT implement the card yourself in the operator's session unless the operator EXPLICITLY said "build/implement/do it now (here/yourself)". "We need X" / "improve X" / a feature description = a request to FILE the cards and ready them, NOT to spend the operator's interactive session coding. When unsure which they want, ASK — never assume build-in-session. Self-pickup (below) applies ONLY once you have CONFIRMED in-session build is intended.

## In-session work = self-pickup IMMEDIATELY (a ToDo card is an open dispatch request)

A card in `ToDo` (`dispatchable_derived: true`) is NOT a passive note — it is an **open dispatch request the poller will fulfill with a worker on its next tick.** If you create/ready a card for work YOU are doing in THIS session (not delegating), and you leave it in `ToDo` while you work, the poller dispatches a SECOND agent against the same card → two checkouts, duplicate commits, push conflict.

**Mechanical gate — when you are about to work a card yourself, BEFORE the first work action. Triggers on ANY of: you create it, you `ready` it, OR the prompt/handoff/operator names an EXISTING card id for the work** (a handoff that only mentions the terminal `complete` transition is NOT an exemption from pickup — claim first, then work):
1. `issue_transition({id, action: 'pickup', manual: true, assigned_agent: '<your identity>'})` → `In Progress` (`dispatchable_derived: false`). This REMOVES the card from the poller's dispatch pool. **`assigned_agent` IS the claim — a pickup without it does not take the card.** Then `issue_get` and confirm `assigned_agent` is YOU and `dispatch_kind: 'manual'`.
   **HARD PRE-ACTION CHECK:** before the FIRST work action of any kind — a Bash command, an edit, a sub-agent launch — assert that read came back as you. Card already `In Progress` under another agent? `rollback_pickup` first, then claim. "The operator said go run it" is an instruction to DO the work, never permission to skip owning it; starting work on a card assigned to someone else puts two executors on it.
2. **`manual: true` is MANDATORY for self-pickup** (DX-946). It stamps `dispatch_kind: 'manual'` — the marker that tells the worker this card is operator-owned: no orphan-IP heal rollback, no Epic auto-rollup, no auto-transition of any kind. A plain `pickup` (no `manual`) registers as a worker dispatch with no live session behind it; after 5 minutes the orphan heal rolls the card back to ToDo and the poller dispatches a SECOND agent against your in-flight work (this exact race burned SG-331).
3. `pickup` is NOT a worker-only formality. Its function is taking the card OUT of dispatchable state — it applies equally to the main/operator session. "No dispatch context, so skip pickup" is the exact rationalization that causes the duplicate-worker race.
4. `manual: true` bypasses every card-flow gate (`ready_at`, `blocked_at`, `requires_human`, `depends_on`, `conflict_on`) — a manual pickup is fully operator-controlled and works straight from Review. Only terminal / already-dispatched still refuse 409.
5. A manual hold is released ONLY by an explicit transition from your session: `complete` / `cancel` / `block` / `rollback_pickup`. Nothing auto-clears it — abandoning the session leaves the card In Progress until you (or the operator) transition it.

Order for self-done work: `create` → **`pickup` with `manual: true`** → work → `complete`. (`ready` is optional — manual pickup does not require it.) Never `create` → `ready` → work (leaves a dispatchable gap the poller races), and never a bare `pickup` for in-session work (leaves a heal-rollback window).

**Sub-agents under YOUR control ARE in-session work — you own their cards' FULL lifecycle.** Dispatching the work to your OWN `Agent`/sub-agent (not the danxbot poller) is NOT the "(not delegating)" exemption above: manual-pickup the card → `In Progress` BEFORE launching the sub-agent, keep it `In Progress` the whole time they run, and YOU drive the terminal `complete`/`block` the moment they finish (verify via `issue_get`). The ONLY thing "delegating" exempts is handing a card to the *poller* via `ready` — there a worker claims it. Readying (or leaving in `ToDo`) a card your own sub-agent is actively working, and letting the poller own its state, is the failure this clause blocks.

### Manual-session finalization — you ARE the quality-gate + retro authority (no dispatched gate-reviewer exists)

A manually-picked-up card (`dispatch_kind: 'manual'`) never gets a `gate-<name>` dispatch spawned for it — that spawn path is worker-only. The worker's in-dispatch `quality_gate_complete` route is not exposed to an operator/manual session either; **your substitute for it is `issue_quality_gate_verdict`** (step 2 below). This does NOT mean skip the gates — it means YOU are the substitute reviewer, and you drive every card-state field an automated pipeline would have, via the MCP tools you do have, before calling `complete`:

1. **AC checklist** — `issue_get` returns each AC item's `check_item_id`/id under `checklists[].items[]`. As each AC item is genuinely satisfied, call `issue_checklist({action:'update_item', checklist_id, item_id, status:'passing'})` per item. `issue_transition complete` REFUSES 409 (`unresolved_items`) while any checklist item is `incomplete` — this is not optional bookkeeping, it's a hard gate.
2. **Quality gates — record a VERDICT with `issue_quality_gate_verdict`, never a `required` flip.** Run your own equivalent review (architecture-reviewer / code-reviewer / test-reviewer subagents, or inline review for a small change) FIRST. Then, for each required POST gate (`code-architecture` / `code-quality` / `code-test-quality`), call:

   ```
   issue_quality_gate_verdict({id, gate, status: 'pass', message: "<the real reviewer finding, >= 20 chars>"})
   ```

   `message` is REQUIRED at **>= 20 characters** for `pass`/`fail` (shorter → 400) and is the accountability record a later reader sees instead of a reviewer dispatch — write the actual finding, never a rubber stamp. `status: 'pending'` reverts a prior verdict.

   **The two gate tools are SIBLINGS and neither substitutes for the other — this is the #1 way this step goes wrong:**

   | Tool | Writes | Effect on `complete` |
   |---|---|---|
   | `issue_quality_gate({id, gate, required})` | the per-card **`required` FLAG** (does this gate run at all) | **NONE.** Flipping `required:false` does NOT unblock `complete`. |
   | `issue_quality_gate_verdict({id, gate, status, message})` | the **VERDICT** (did it pass) | **This is what unblocks `complete`.** |

   `issue_transition complete` 409s (`failed_gate: "quality_gate_post"`, `failed_post_gates[]`) while any required POST gate row is not `pass`. Setting `required:false` does not clear that: when the BOARD's `default_state` for the gate is `required`, the per-card flag is **inert** ("this flag irrelevant" — `isGateEffectivelyRequired`, `src/issues/quality-gates/read.ts`), so the gate stays required, stays `pending`, and `complete` keeps 409ing. Verified the hard way on SG-318: all three POST gates were flipped to `required:false` and `complete` still returned 409 with `failed_post_gates: [code-test-quality (pending), code-quality (pending)]`. Record the verdict — do not chase the flag.

   Do NOT touch PRE gates (`plan-*`) here; those gate the *dispatch*, not the completion, and manual pickup already bypasses them (rule 4 above).
3. **Retro** — `issue_retro` REFUSES 409 until the card is terminal, so it's the LAST call, right after `issue_transition complete`. Fill `good`/`bad` honestly (including any gate/checklist friction encountered — like this one), `commits[]` with every landed sha+subject, `tests[]` with at least one row summarizing what you ran (a `kind:'group'` row naming the suite is enough — don't enumerate individual unit tests).
4. **Comments** — if the work surfaced a real deferred gap (scope the card's AC didn't cover), don't hand-wave it in a comment: create a follow-up card (`issue_create`), wire `depends_on` if it blocks this one, and push the deferral into `retro.action_item_ids[]` — comments are for narrative, cards are the durable record (see "Durable work-records" in General Rules below).

This sequence — checklist → gates → complete → retro — is mechanical, not discretionary. Skipping any step because "it's just an interactive session" is exactly the rationalization DX-946/DX-835 exist to block: manual pickup changes WHO drives the state machine, never WHETHER it gets driven.

## Source of Truth

**Dashboard DB** (via `mcp__danx-dashboard__issue_*` MCP tools) is the canonical source for title, description, status, AC, children, comments, retro, blocked, waiting_on, requires_human. Agents read + write via MCP only — that is the whole surface. Poller dispatches off the dashboard DB via the dashboard HTTP API. Want a status change → call `mcp__danx-dashboard__issue_transition` or `mcp__danx-dashboard__issue_edit`.

## DB Schema

Full schema available via `mcp__danx-dashboard__issue_get`. Key fields:

- **`status` / `status_derived`** — **DERIVED from lifecycle triggers, agents NEVER write.** Computed by server from timestamps + gates. Pickup → via `issue_transition({action: 'pickup'})` (rule 4 → `In Progress`). Approve → `issue_transition({action: 'ready'})` (rule 5 → `ToDo`). Complete → `issue_transition({action: 'complete', summary})` (rule 2 → `Done`). Cancel → `issue_transition({action: 'cancel'})` (rule 1 → `Cancelled`). Block → `issue_transition({action: 'block', reason})` (rule 3 → `Blocked`). Direct write FORBIDDEN.
- **`dispatch`** — worker-managed, agents don't touch.
- **`children[]`** — ordered list of child ids. On Epic = phase cards (UI "Phases"). On non-epic = sub-cards (UI "Children"). Phases MUST be cards, no in-card checklist. Set via `issue_edit({parent_id})` on child cards.
- **`ac[]`** — Acceptance Criteria. Server assigns `check_item_id` on create. Agents populate via `issue_edit({ac})`.
- **`retro`** — fill on Done/Cancelled/Blocked via `issue_retro({good, bad, action_item_ids[], commits[], tests[]})` (`tests[]` REQUIRED — empty array allowed, omitting the key fails). Server auto-renders `## Retro` comment. `commits[]` owned-repo ONLY (DX-559 gate). `action_item_ids[]` = LAST RESORT.
- **`blocked`** — self-block trigger. Null = card proceeds. Non-null = `{at, reason}` = card stuck, human acts. Set via `issue_transition({action: 'block', reason})`. Agents never write `status: "Blocked"` — call transition, server projects.
- **`waiting_on`** — dep-chain gate, status-independent. Card queued behind OTHER in-flight work (phase sibling, Action Items, separate task). Null = nothing queues. `{reason, timestamp, by[]}` = by[] is IMMEDIATE blocker(s) only (never transitive). Picker skips while any blocker non-terminal; auto-unblocks on terminal. Set via `issue_dependency({action: 'add', kind: 'depends_on'})`. **Waiting On ≠ Blocked** — Blocked is THIS card stuck (human), Waiting On is queued behind OTHER work.
- **`requires_human`** — orthogonal gate, status-independent. Null = no human needed. Non-null = `{reason, steps[], set_by, set_at}` = card needs human on system with zero agent reach (3rd-party token, vendor portal, external infra). Set via `issue_requires_human({id, set: true, reason, steps[]})`. Cleared by human via dashboard only.

## MCP Tools Reference

| Tool | Purpose |
|---|---|
| `mcp__danx-dashboard__issue_create({type, title, description, parent_id?, ac?, effort_level?, phase_children?, gate_decisions?, triage_enabled, list_id?})` | Allocate next `<PREFIX>-N` in DB. Epic creation optionally includes `phase_children[]` to create child cards atomically (each entry carries its OWN `gate_decisions` AND its OWN `triage_enabled`). `gate_decisions?: {gate, enabled, note}[]` is a server-enforced REQUIRED field whenever the board has any optional gate for the card's type — a missing decision fails the create closed with `400 {error, required_gate_decisions:[...]}` (see "Quality-Gate Decisions"). `triage_enabled` MUST be passed explicitly on EVERY create (root + each phase child) — absent → false, the card is never auto-triaged (see "Auto-Triage Opt-In"). Returns `{ok: true, body: {id, ...}}` or `{ok: false, body: {error, ...}}`. |
| `mcp__danx-dashboard__issue_list({filter?: {status_derived?: string[], type?, parent_id?, dispatchable_derived?, assigned_agent?, include_closed?, q?}, fields?, sort?, limit?, offset?})` | **Preferred for multi-card scan/discovery** — status sweeps, sibling lookups, parent→children, "find all blocked". Use BEFORE hand-globbing. **Filters are NESTED under `filter` (DX-935/DX-937 hard-cut — flat top-level params are GONE, including the former standalone `q`).** `filter.status_derived` is an **ARRAY**. Response is MINIMAL by default (see `fields` below). |
| `mcp__danx-dashboard__issue_get({id, fields?})` | Single card read. **The default response is MINIMAL (DX-935/DX-937): cheap scalars only — id, type, title, status, parent_id, priority, timestamps, assigned_agent. NO joined collections.** `description`, `ac`, `comments`, `retro`, `dependencies`, `triage`, `requires_human`, `assignment`, `quality_gates`, `children`, `mirrors`, `code_review_items` each require naming that field-GROUP in `fields[]`. A bare `issue_get({id})` returns none of them — never conclude a card has no description/AC/comments from a bare read. |
| `mcp__danx-dashboard__issue_edit({id, title?, description?, ac?, checklists?, effort_level?, parent_id?, priority?, list_id?, triage_enabled?})` | Prose + structured fields (no status/lifecycle stamps). Agents never write `status` directly. **`priority` IS settable here** — a tier word (`lowest`/`low`/`medium`/`high`/`very_high`/`critical`) or a number in [0,6). To honor "set priority", write the `priority` FIELD; putting "Priority: X" in the description changes nothing downstream and is a silent false-positive. |
| **This table is a SUMMARY, not the contract.** | NEVER conclude a parameter does not exist because it is absent here — this table has been stale before. Before telling the operator something cannot be done via MCP, load the live schema (`ToolSearch` `select:<tool>`) and read its `properties`. "The tool doesn't support it" is a claim requiring the same evidence as any other. |
| `mcp__danx-dashboard__issue_transition({id, action: 'ready'\|'pickup'\|'rollback_pickup'\|'complete'\|'cancel'\|'block'\|'unblock'\|'archive'\|'reopen', reason?, summary?, manual?, assigned_agent?})` | Lifecycle transitions. Server stamps timestamps + recomputes `status_derived`. `manual: true` (pickup-only, DX-946) = operator-session self-pickup: stamps `dispatch_kind: 'manual'`, bypasses card-flow gates, worker never auto-transitions the card. **`assigned_agent` is REQUIRED on every `manual:true` pickup (DX-2282)** — an explicit distinguishing identity, never the shared dispatch-token identity, or the pickup is refused 409. `rollback_pickup` releases a claim non-terminally. |
| `mcp__danx-dashboard__issue_triage({id, confidence: 0-5, reason})` | Single atomic triage call. **DX-2086: you send a `confidence` INTEGER 0-5 + a required non-empty `reason`; the SERVER computes the verdict** against the board's thresholds (→ cancel / defer / keep / approve). There is **no `verdict`, `ice`, or `ttl_seconds` parameter** — those were removed; passing them fails. A keep/defer verdict now also stamps `blocked_at`. |
| `mcp__danx-dashboard__issue_comment({id, action: 'add'\|'edit'\|'delete', comment_id?, text?, metadata?})` | Comment lifecycle (add/edit/delete; delete is a soft-delete). Server stamps author from the bearer — a client-supplied author is IGNORED. `metadata` (add-only) is an optional opaque JSON object danxbot stores and returns verbatim. |
| `mcp__danx-dashboard__issue_dependency({id, action: 'add'\|'remove', kind?: 'depends_on'\|'conflict_on', target_id?, reason?, dependency_id?})` | Manage card dependencies. |
| `mcp__danx-dashboard__issue_requires_human({id, set: true, reason, steps[]} \| {id, set: false})` | Set/clear the `requires_human` gate. Server stamps `set_by`/`set_at`. |
| `mcp__danx-dashboard__issue_retro({id, good, bad, action_item_ids[], commits[], tests[]})` | Populate retro on terminal (409s until the card is terminal). **`tests[]` is REQUIRED (DX-1646)** — an empty array is allowed (the "ran no tests" case), but OMITTING the key fails the call. One row per test GROUP (a whole suite/class — name the group, do NOT enumerate individual unit tests) or per individual e2e test: `{name, kind:'group'\|'e2e', num_tests, num_passing_tests, duration_ms}` required; `num_assertions`/`num_passing_assertions` nullable. |
| `mcp__danx-dashboard__issue_quality_gate({id, gate, required, effort_level?})` | Flips the per-card **`required` FLAG** only. **Does NOT record a verdict and does NOT unblock `complete`.** Inert when the board's `default_state` for that gate is `required` or `disabled`. |
| `mcp__danx-dashboard__issue_quality_gate_verdict({id, gate, status: 'pass'\|'fail'\|'pending', message})` | Records the **VERDICT** — this is what clears the `quality_gate_post` 409 and lets a manually-picked-up card reach Done. `message` REQUIRED at **>= 20 chars** for pass/fail. A manual verdict is a pure row write: a manual `fail` never blocks the card, a manual `pass` never releases a dispatch. See "Manual-session finalization" above. |
| `mcp__danx-dashboard__issue_checklist({id, action: 'add_list'\|'update_list'\|'remove_list'\|'add_item'\|'update_item'\|'remove_item', checklist_id?, item_id?, name?, label?, detail?, status?, items?})` | **Targeted** checklist CUD (DX-1362) — use this to flip ONE item. Prefer it over the wholesale `issue_edit({checklists})`, which silently DROPS any checklist you omit and churns every item id (orphaning its Trello mirror). 4-state status: `incomplete\|failing\|passing\|cancelled`. |
| `mcp__danx-dashboard__issue_attach({id, file_path})` | Attach a LOCAL file (ABSOLUTE path on the dispatch's filesystem) to the card. Auto-mirrors to Trello + the Slack card-view thread. 25 MB ceiling. |

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
>
> **COUNTERFACTUAL check — catches a FABRICATED see/do line (MANDATORY, run per proposed slice):** writing a see/do line is NOT proof it is TRUE. For each slice ask: *if ONLY this card lands and NO later sibling ever ships, is the running system observably better — or still broken / unchanged until a sibling lands?* "Still broken until the others land" ⇒ the see/do line is fabricated, the pieces are INTERLOCKING, and they are **ONE Story, not N** (carry the size in `effort_level`, even `max`). **One-getPool-site-per-card / one-subsystem-per-card / one-module-per-card / one-call-site-per-card is the canonical horizontal split this blocks** — removing one internal coupling while the process still crashes / no-ops on the next delivers nothing standalone. A pile of N distinct code SITES to edit is NOT N slices; an atomic cutover (no valid half-state, no dual path) is ONE slice however large. "The operator said Epic" / "there are N obvious sub-tasks" does NOT override this — re-run the counterfactual before honoring a requested type.

**Allowed parent→child type matrix:** Epic → Feature | Story | Bug | Chore (never Epic). Feature → Story | Bug | Chore. Story / Bug / Chore are atomic — no type-children. (Epic-child types are enforced mechanically by `phase_children[]`; the rest is this gate.)

**Post-`issue_create` DEPENDENCY-WIRING gate (MANDATORY, same turn as creating an Epic/Feature with `phase_children[]`):** `phase_children[]` sets `parent_id` ONLY — it wires ZERO ordering. Sequentially-dependent phases dispatch in PARALLEL the instant they are readied. So immediately after the create, for EVERY phase that needs an earlier phase done first, call `issue_dependency({id: <later-phase>, action: 'add', kind: 'depends_on', target_id: <predecessor>})` — BEFORE readying any phase. Relying on Review-status to hold order is the exact failure this gate blocks: the operator's `ready` bypasses it and the poller fans out every dispatchable phase at once. "I'll add the edges when I ready them later" is the deferral that ships an unguarded epic — wire them at creation or the ordering does not exist.

**Sequencing decided AFTER creation, or a staged rollout (MANDATORY — same gate, no time-of-decision exception):** The gate above is not scoped to "same turn as create," it is scoped to "the moment you know a later phase must wait." Deciding the ordering only after the containers already exist, or readying phases one at a time over a session (or across sessions), does not relax it.

Leaving a later phase un-readied in `Review` is **NOT a hold.** It is zero mechanical protection — nothing prevents a future triage pass or a manual `ready` from promoting it independently of whether its prerequisite ever shipped. Why: the PRE-work `plan-dependency` gate only compares a candidate against the LIVE Ready + In-Progress set (see "Known dependency / conflict edges" above) — a prerequisite still sitting in Review is invisible to it and passes with zero edges recorded. Once both cards get readied without an edge between them, nothing stops them dispatching concurrently, out of order.

Correct pattern, always: the moment you know phase B needs phase A done first, call `issue_dependency({id: B, action:'add', kind:'depends_on', target_id: A})` — same turn if both cards already exist, immediately upon deciding it later otherwise. THEN ready phase B whenever convenient — now, or held un-readied — either is safe once the edge exists, because the edge (`waiting_on`) is what protects ordering, not the status.

A triage `keep` verdict (a `confidence` landing in the keep band — you never name the verdict directly, DX-2086) leaves the card derived-Review AND stamps `blocked_at`. It is NOT a cross-card ordering primitive and must never be used as a substitute for a `depends_on` edge.

See references/phases-epics.md for the split walkthrough, epic mechanics, phase creation, and completion contract.

## Quality-Gate Decisions at Card Creation (decide, don't review)

**Deciding a gate is a DECISION recorded on the card — NOT work you perform in the moment.** You decide WHETHER each board-optional gate runs on this card and why; the gate RUNS LATER (the PRE gates are dispatched into the gate-reviewer agent before work starts; the POST `code` gate runs inside the work agent's own session at the end). **NEVER review at creation time** — no design audit, no test-plan pass, no diff read. Decide → record → next.

**`gate_decisions` is a REQUIRED `issue_create` field** whenever the board has any **optional** gate for the card's type — the server enforces it fail-closed (DX-1594), so you cannot create without answering. You do NOT pre-compute which gates are optional: just create, and if a decision is missing the create returns `400 {error, required_gate_decisions: [...]}` naming exactly which gates to answer. Retry with one `{gate, enabled, note}` per listed gate:

- `enabled` — whether the gate runs on this card.
- `note` — non-empty rationale (persisted as the decision rationale, distinct from the reviewer verdict).

`required` board gates auto-on and `disabled` board gates auto-off — they take NO decision (naming one → 400). A board with no optional gates needs no `gate_decisions` at all. Containers (Epic/Feature) are never gated — no decision owed.

**Phase children carry their OWN `gate_decisions`** — each `phase_children[]` entry takes a `gate_decisions` array resolved against THAT child's type, enforced by the same fail-closed wall. The atomic epic create answers every child's gates in one call; no post-create gate-toggle step.

Reasoning hint for choosing `enabled` per gate (registry names — the names the 400 returns):

| Gate | Phase | Enable when the card… |
|---|---|---|
| `plan-dependency` | PRE | likely overlaps other in-flight work — ordering / same-surface conflict risk. |
| `plan-architecture` | PRE | is non-trivial design: new module boundaries, touches core invariants. |
| `plan-tdd` | PRE | has behavior to pin test-first / AC that should be checkable tests. |
| `code-architecture` / `code-quality` / `code-test-quality` | POST | finished diff warrants architecture / quality / test review before completion. |

Post-create, flip a per-card gate's *required flag* with `issue_quality_gate({id, gate, required})` (the PRE/plan- gates run before the work dispatch; the POST/code- gates block `issue_transition complete`). That flag is inert when the board's `default_state` for the gate is `required` or `disabled`, and it never records a pass — to record a gate VERDICT use the sibling `issue_quality_gate_verdict` (see "Manual-session finalization").

## Auto-Triage Opt-In — `triage_enabled` is an EXPLICIT per-card decision (MANDATORY on every `issue_create`)

**Every `issue_create` call MUST pass `triage_enabled` explicitly — root card AND every `phase_children[]` entry (each child carries its OWN flag, never inherited).** The server default is `false` (explicit-only — operator directive 2026-08-09 reverting DX-1928): a card without an explicit `triage_enabled: true` is NEVER selected by the automatic triage dispatcher, no matter how long it sits in Review. Deciding it explicitly per card is the contract — never rely on the default silently.

- `triage_enabled: true` — ONLY when you intend the card to enter the automatic triage/dispatch pipeline WITHOUT further human review (a fully-specified card you'd be comfortable seeing auto-readied and auto-dispatched).
- `triage_enabled: false` — scoping/draft cards, operator-held cards, cards awaiting discussion, anything filed as a durable record rather than an immediate work request.

Incident rationale: agent-created scoping cards were silently auto-triaged, auto-readied, and auto-dispatched against an explicit operator hold — auto-created cards must never silently enter the dispatch pipeline.

This flag gates ONLY the automatic dispatcher trigger. Operator-directed triage (`POST /api/triage`, `/danx-triage-card`, direct `issue_triage` calls) remains flag-independent, and `issue_edit({triage_enabled})` is the post-create way to opt a card in or out.

## Known dependency / conflict edges at creation (opportunistic, never a search)

When you ALREADY KNOW of a related in-progress / ToDo card in this moment (a sibling you just created, a card you read this session), record the edge:

- `depends_on` — one-way: this card needs another card's output first. `issue_dependency({id, action:'add', kind:'depends_on', target_id})`.
- `conflict_on` — same-file/surface overlap, mutually exclusive per pair. `issue_dependency({id, action:'add', kind:'conflict_on', target_id})`.

**MUST NOT go searching / scanning the board for related cards.** Record only what you already know — opportunistic, best-effort, not a discovery pass. This is DISTINCT from the thorough **dependency quality GATE** (flag `dependency` above), which does the systematic compare against the full live Ready + In-Progress set later. It is ALSO distinct from the mandatory epic phase-child DEPENDENCY-WIRING gate above (which wires required ordering among phases of an epic you just created) — that one stays mandatory; this known-edge recording is the looser, any-card, best-effort layer.

## Issue-Ref Comment Protocol — code comments carry card context (DEFAULT MODE)

`// CARD-ID: <reason>` comments are the **default operating mode** for every agent working in a repo — both WRITING them while implementing and READING them before changing code. They make the code self-documenting: a future agent (reviewer, next implementer, slack-worker) learns WHY a non-obvious decision was made by reading the comment + loading the card, instead of reconstructing intent.

**WRITING — when you implement code tied to a card requirement.** Add a `// CARD-ID: <brief reason>` comment on any non-obvious decision the card's AC / description / design forced — a guard, an ordering constraint, an unusual default, a workaround, an invariant the card defines. Use the repo's comment syntax (`//`, `#`, `--`, `<!-- -->`). The reason is WHY this shape, not WHAT the code does.

```ts
// DX-1234: pickup before spawn — poller races a second worker onto a ToDo card otherwise
issue_transition({ id, action: "pickup", manual: true });
```

Skip the ref on self-evident lines — the bar is "a future agent would otherwise mis-edit this." Multiple cards may stack: `// DX-100 / DX-205: ...`.

**READING — before you change ANY code.** Grep the files you are about to touch for existing refs and load each one's card context FIRST. Anchor the grep to COMMENT markers — an unanchored `[A-Z]+-[0-9]+` also matches ids in test names, migration filenames, fixture strings, and error text (this repo is ref-dense outside comments), drowning the signal:

```bash
grep -rnE '(//|#|--|<!--|/\*|\*)[[:space:]]*[A-Z]+-[0-9]+' <files-you-will-edit>   # comment-anchored ref lines
```

Collect the UNIQUE ids from the matched comment lines; for each, call `mcp__danx-dashboard__issue_get({id, fields: ["description", "ac", "comments"]})` and read those fields BEFORE editing the referenced code (a bare `issue_get({id})` returns MINIMAL scalars only — none of them). The comment names the constraint; the card holds the full intent. Editing past a ref without loading its card risks silently breaking the original requirement — that is the exact failure this protocol prevents.

**LIFECYCLE.** The ref travels with the code as long as the constraint applies. UPDATE it when the constraint changes form (new card supersedes). REMOVE it only when the constraint is genuinely lifted (the card was reverted / the requirement no longer holds) — never leave a ref pointing at a dead constraint, never strip a live one.

**Harness-override note.** The base harness default says "don't reference the task/fix in comments." Issue-ref comments are the SANCTIONED exception on danxbot repos: they document a STANDING behavioral constraint (not a transient task name), travel with the code, and are maintained over the code's life. They are a feature of the codebase, not residue of one dispatch.

## General Rules

- **A dispatched worker processing a card:** one card at a time; no orchestrator, no subagents. Scoped to that path only — it does not bind a main session doing general work, which orchestrates per canon principle 1.
- Call MCP tools only for all card operations
- **`triage_enabled` explicit on EVERY `issue_create`** (root + each phase child) — absent → false, never auto-triaged (see "Auto-Triage Opt-In" above)
- `type:` ∈ `Epic` | `Feature` | `Story` | `Bug` | `Chore` — required (pick via the Card Taxonomy gate above)
- Comments = markdown with `##` headers (set via `issue_comment`)
- AC lives in `ac[]` (set via `issue_edit`) — never inline. Phases/sub-cards in `children[]` as `<PREFIX>-N`; each child has own DB record.
- `retro.action_item_ids[]` = only valid `<PREFIX>-N` format. Create card first, push id (via `issue_retro`).
- Connected repo cards reference that repo's architecture (not danxbot paths).
- NEVER read/write card state via file operations — use MCP tools exclusively.
- NEVER write `status:` literals via `issue_edit` — use `issue_transition` for lifecycle changes.
- NEVER manually append `## Retro` to comments — use `issue_retro` tool.
- NEVER escape markdown — use formatting (`##`, fenced blocks, tables).
- **Issue-ref comments are DEFAULT MODE** (see "Issue-Ref Comment Protocol" above): WRITE `// CARD-ID: <reason>` on non-obvious card-driven decisions; READ + `issue_get` every comment-anchored ref in code you touch BEFORE editing it.
- **Durable work-records live on a card — never a substitute artifact.** (WHEN this fires lives in the SKILL LOAD MANDATE; this is the contract once loaded.) Any card/epic/plan/findings/design/handoff/spec meant to survive the session = CREATE/APPEND on a tracker card (MCP `issue_create`, or `POST /api/issues`). Substitutes that do NOT count and are forbidden: a standalone repo `.md`, and in-session `TaskCreate`/`TaskList` (ephemeral working memory — mirror steps there only AFTER the card exists). Forbidden target dirs — `docs/handoffs/`, `docs/specs/`, or any dir git history shows was deleted: recreating them is the failure. Create-tooling unavailable → STOP and ask; never default to a parallel `.md`. Standalone docs only when the user explicitly asks for a file/doc. **Not the same thing:** `human-collaboration:artifact-plan` is always active in human-driven sessions and produces a LIVE working page (decisions being worked out, a monitoring timeline, published with the Artifact tool) — it does not replace the card as the durable record. Both exist together: the card still gets created/updated per this contract, cross-linked to the page's path/URL.
