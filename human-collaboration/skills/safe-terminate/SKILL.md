---
name: safe-terminate
description: User-invokable end-of-session audit. Triggers on `/safe-terminate`, "safe to close", "anything outstanding before I end", "session wrap check". Walks the full conversation transcript and produces a recap — every Open / Closed item from this session w/ a one-line title, plus a brief description of what + why for anything still open. Goal — user reads in <30s and knows whether termination is safe or whether items still need resolution. Format follows base:convey (concept-first, tables, no filler).
---

# Safe Terminate — End-of-Session Audit

User-invokable. The user types `/safe-terminate` (or equivalent) when they think the session is wrapping. You produce a recap that lets them confirm termination is safe — or surfaces work that must land first.

This skill is NOT a long-form report. It is a confidence check. The user reads in under 30 seconds.

## Mandatory pre-output checklist

Walk the full session transcript top-to-bottom. For EACH item below, mentally answer "did this happen this session, and is it durable on disk / persisted to the right place?" If you cannot answer w/ certainty, treat as Open.

1. **Code edits committed?** Any Edit / Write to tracked files in this session — has a commit landed (or has the user explicitly said "leave uncommitted")? Uncommitted edits are Open.
2. **Issue cards filed match user intent?** For every `mcp__danx-issue__*_create` call this session — does the parent linkage, status, AC, waiting_on, and phase coverage match what the user actually asked for? Cards w/ partial scope are Open.
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

## Output format

Single response, ≤30 lines total. Apply `base:convey`. Caveman-mode-aware (full caveman → tighter prose; no caveman → normal prose, still no filler).

Headline: one of two shapes. Pick mechanically based on whether the Open list below is empty.

- All clear: `## Safe to terminate — N items closed, 0 open`
- Items pending: `## Hold — N open items need resolution before terminate`

Then:

**Goal.** One sentence stating what the session attempted overall (not item-by-item).

**Closed this session.** Bulleted list — one line per item, format `- <ID or name> — <≤8 word title>`. No description, no rationale. The user already knows what closed; this is just the audit trail.

**Open / outstanding.** ONE-LINE table:

| Item | What | Why it matters |
|---|---|---|

- "Item" = ID (`SG-N`) or short name (`octane:reload`, `commit pending`, `findings not captured`).
- "What" = the concrete unfinished action in ≤10 words.
- "Why it matters" = the consequence of terminating without it in ≤12 words. If the consequence is "future agent will not know X", say so explicitly.

If Open list is empty, write `_None._` instead of the table.

**Verify.** One terminal command the user can run NOW to spot-check the recap (e.g. `git status`, `mcp__danx-issue__danx_issue_list`, `docker ps`). Skip if no verification command applies.

## Anti-patterns

- **Restating the chat transcript.** The user just lived through the session. Recap items the user might forget — not items the user just confirmed.
- **Long descriptions per item.** If "what" needs more than 10 words, file an issue card and reference it instead.
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

| Item | What | Why it matters |
|---|---|---|
| TO-55 findings | Not persisted to any card / doc | Future agent re-investigates same provider variations |
| SG-142 dispatch | Schema edits not yet executed | Phase 2 + 3 cannot start until Phase 1 lands |
| `octane:reload` | Skipped after route edit | New `/api/foo` route returns 404 until reload |

**Verify.** `mcp__danx-issue__danx_issue_list({status: "Review"})` → 4 new SG-N cards.
```

## Composition

- `base:convey` owns format (already auto-loaded).
- Caveman mode is respected — if active, prose tightens; tables still apply; technical terms unchanged.
- This skill does NOT mutate state. It is a read-only audit. Do not file new cards, run commits, or push during the recap. If items are Open, the user picks what to do next.
