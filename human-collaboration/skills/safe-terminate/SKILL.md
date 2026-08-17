---
name: safe-terminate
description: 'End-of-session audit — recap every Open/Closed item from the session, surface termination-blocking items.'
---

# Safe Terminate — End-of-Session Audit

User-invokable. The user types `/safe-terminate` (or equivalent) when they think the session is wrapping. You produce a recap that lets them confirm termination is safe — or surfaces work that must land first.

This skill is NOT a long-form report. It is a confidence check. The user reads in under 30 seconds.

## If `human-collaboration:shared-plan` is active this session

Its artifact's Decisions/Timeline tabs already carry the running open-item list — that's the whole point of keeping it updated after every action. Read it first: any `DEC-N` without a `Resolved` pill, and any `TL-N` marked `warn`/`crit` without a follow-up, IS an open item — pull it straight into the recap below instead of re-deriving it from the transcript. Still walk the checklist for anything the artifact wouldn't have captured (uncommitted code, unpublished packages, background processes) — the artifact tracks decisions and status, not filesystem/process state.

## Mandatory pre-output checklist

Walk the full session transcript top-to-bottom. For EACH item below, mentally answer "did this happen this session, and is it durable on disk / persisted to the right place?" If you cannot answer w/ certainty, treat as Open.

1. **Code edits committed?** Any Edit / Write to tracked files in this session — has a commit landed (or has the user explicitly said "leave uncommitted")? Uncommitted edits are Open.
2. **Issue cards filed match user intent?** For every `mcp__danx-dashboard__issue_create` call this session — does the parent linkage, status, AC, waiting_on, and phase coverage match what the user actually asked for? Cards w/ partial scope are Open.
3. **Investigation findings persisted?** For every investigation / debugging report delivered to the user in chat — was it captured into a card comment, retro, doc, or commit message? Chat-only findings are Open if future agents need them.
4. **Octane / queue restarts run?** Any PHP method-add / route change / channel change / service-provider edit this session — did `octane:reload` or `queue:restart` actually run? Skipped reload = Open.
5. **MCP packages published?** Any edit to `mcp-server/`, `mcp-server-trello/`, `danx-issue-mcp/`, `@thehammer/*` source — did `make publish-*` run? Unpublished edits are Open.
6. **danx vendor sync done?** Any edit to `~/web/danx/` — was the same change mirrored into `vendor/newms87/danx/`? Unsynced = Open (tests will fail).
7. **Background processes still running?** Any `run_in_background: true` Bash call — is the process meant to keep running, or should it be stopped? Orphan jobs are Open.
8. **Browser / dev-server state?** Any `mcp__claude-in-chrome__*` work — tabs that should be closed? Dev server `yarn dev` left running on purpose? Note state, not necessarily Open.
9. **Important findings future agents need?** Anything you learned this session that contradicts or extends CLAUDE.md / a plugin skill / a project rule — was it captured into the right rule file or filed as an issue? If not, Open.
10. **Action items not yet tracked?** Any "we should also fix X" / "follow-up: Y" / "TODO: Z" mentioned mid-session — does each have a card or commit? Floating TODOs are Open.
11. **Schema / migration state?** Any DB migration created — has it been run? Any schema edit through tinker — does it match the canonical persistence path? Out-of-band schema mutations are Open.
12. **Test status?** Any test file created / changed — was it run + green? Unverified test claims are Open.
13. **Re-read live state — session memory is stale by definition.** BEFORE listing any open item whose state lives in an external system (tracker card status, another agent's work, a running process, a deploy), re-query that system NOW (card get/list, `docker ps`, `git log`). Other agents work concurrently; a status you observed earlier in the session is a hypothesis, not a fact. An open item reported from memory that a 2-second query would have shown resolved is the documented failure this item blocks.

## Output format

Single response. Keep the headline + closed list tight (~30 lines is the target for those). The **open-items section is exempt from the line budget** — each open item must be fully clear to a first-time reader, even if that costs extra lines. Clarity of open items always wins over brevity. Apply `base:convey`. Caveman-mode-aware (full caveman → tighter prose; no caveman → normal prose, still no filler).

Headline: one of two shapes. Pick mechanically based on whether the Open list below is empty.

- All clear: `## Safe to terminate — N items closed, 0 open`
- Items pending: `## Hold — N open items need resolution before terminate`

Then:

**Goal.** One sentence stating what the session attempted overall (not item-by-item).

**Closed this session.** Bulleted list — one line per item, format `- <ID or name> — <≤8 word title>`. No description, no rationale. The user already knows what closed; this is just the audit trail.

**Open / outstanding.** One section per item, each separated by a `---` rule — NOT a table. A table cramps the text; every item needs room to be understood. **Each section must stand alone to a reader with ZERO session context** — they understand what the item is, where it lives, why it matters, and what to do next, WITHOUT asking a follow-up. A bare label or ID is never the explanation.

Format each open item exactly like this:

---

### `<short handle>` — e.g. `SG-N`, `octane:reload`, `commit pending`

**What it is:** A plain-language sentence (or two) a newcomer understands. Name the thing, where it lives (file path / card id / system / command), and its current state. Spell out any acronym or internal label the first time it appears — write "the unpushed-commits check in `src/worker/x.ts`", not "Audit P0". Use as many words as clarity needs.

**Why it matters:** The concrete consequence of terminating without it. If it's "a future agent won't know X", say so explicitly.

**Recommended action:** The specific next step that closes it — an exact command, a card to file, a decision the user must make, or who must do it. Never "investigate" or "look into" — name the action.

---

If there are no open items, write `_None._` in place of the sections.

**Verify.** One terminal command the user can run NOW to spot-check the recap (e.g. `git status`, `mcp__danx-dashboard__issue_list`, `docker ps`). Skip if no verification command applies.

## Anti-patterns

- **Restating the chat transcript.** The user just lived through the session. Recap items the user might forget — not items the user just confirmed.
- **Bare jargon labels as the explanation.** An item shown only as `Audit P0` / `SG-142 dispatch` / `that swallow thing` with no plain-language "what it is" forces the reader to ask "what's that?" — the exact failure this format exists to prevent. Every row stands alone to a newcomer.
- **Over-compression that destroys clarity.** The line budget covers the headline + closed list, NOT open-item explanations. An open item too terse to understand is worse than one that runs three extra lines. Spell it out — including the file path or location.
- **Padding with closed-item rationale.** Closed items get a title only — no "this was important because..." prose.
- **Hedging on Open vs Closed.** If you cannot tell, mark Open. The cost of one false-positive Open is a 5-second user response; the cost of a false-positive Closed is silent loss.
- **Inventing items to look thorough.** Items must come from the actual transcript. No "maybe we should have done X."

## Examples

### Example A — clean session

```
## Safe to terminate — 4 items closed, 0 open

**Goal.** Add `--rerun` flag to `test:demand-extraction` and verify on WI-6.

**Closed this session.**
- `test:demand-extraction --rerun` flag
- WI-6 regression run — exit 0
- Commit `feat(test): add --rerun to demand-extraction` pushed
- SG-145 marked Done w/ retro

**Open / outstanding.** _None._

**Verify.** `git status` → clean working tree.
```

### Example B — items pending

```
## Hold — 3 open items need resolution before terminate

**Goal.** Refactor SD-14 schema split + file the regression test scaffold.

**Closed this session.**
- SG-141 + SG-142 + SG-145 + SG-146 cards filed
- TO-55 investigation report delivered (chat only)

**Open / outstanding.**

---

### `TO-55 findings`

**What it is:** The root-cause analysis of the provider-variation bug, worked out and delivered only in this chat session. It was never saved to a card, doc, or commit message.

**Why it matters:** A future agent hitting the same bug re-investigates it from scratch — the analysis is lost when this session ends.

**Recommended action:** File a Bug card capturing the findings, or paste them into SD-14's description.

---

### `SG-142 schema split`

**What it is:** Phase 1 card to split the `src/db/schema/*` tables. The edits were planned this session but never executed.

**Why it matters:** Phases 2 and 3 are gated on it — nothing downstream can start until it lands.

**Recommended action:** Dispatch SG-142, or tell me to defer it.

---

### `octane:reload`

**What it is:** A `/api/foo` route was added this session, but the running PHP (Octane) server still holds the old route table in memory.

**Why it matters:** `/api/foo` returns 404 in the live app until the server reloads.

**Recommended action:** Run `php artisan octane:reload`.

---

**Verify.** `mcp__danx-dashboard__issue_list({status_derived: "Review"})` → 4 new SG-N cards.
```

## Composition

- `base:convey` owns format (already auto-loaded).
- Caveman mode is respected — if active, prose tightens; the per-item section format + `---` separators still apply; technical terms unchanged.
- This skill does NOT mutate state. It is a read-only audit. Do not file new cards, run commits, or push during the recap. If items are Open, the user picks what to do next.
