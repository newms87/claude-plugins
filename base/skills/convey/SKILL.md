---
name: convey
description: Use when transferring information to another entity (human or agent) — reports, commit messages, PR descriptions, issue YAML descriptions / comments / retros, Slack replies, code-review feedback, hand-offs to subagents, end-of-turn summaries, plan write-ups, investigation findings, unblock notes. Loads the `convey` format — concept-first headline, behavior-diff tables, ASCII flow diagrams, caveats list, verify line. Goal — high signal-to-token ratio, scan-readable in <30s, zero filler. Auto-loaded via SessionStart hook so this skill applies to every information-transfer action in every session, not only when explicitly invoked. Auto-triggers also on YOUR OWN draft — before sending any response that contains a "Summary", "What shipped", "What I did", "Here's what changed", "Report", "Findings" section header OR a wall of file paths with prose around them, STOP and apply convey.
---

# convey — Condensed High-Yield Information Transfer

## The problem this skill solves

Default agent output is **code-first**: file paths, symbols, type signatures, prose narration. Reader reverse-engineers the concept from the code. Fast to dump; slow to consume. Reports balloon to multi-screen walls when the actionable signal is 4 lines.

`convey` flips it. **Concept-first**, scaffolded into a fixed shape, tables and arrow diagrams over prose, paths only at the audit line. Reader can decide in <30s whether to dig further.

## When to apply

| Situation | Apply? |
|---|---|
| End-of-turn report ("here's what I did") | YES |
| Commit message body | YES |
| PR description | YES |
| Issue YAML `description` / `comments[].text` / `retro.good` / `retro.bad` | YES |
| Slack reply | YES |
| Code-review feedback (your output, not the PR you're reviewing) | YES |
| Investigation findings, debug breakdowns | YES |
| Unblock note for next agent | YES |
| Hand-off prompt to a subagent | YES — subagent IS another entity |
| Inline narration during a single tool sequence ("running test now") | NO — convey is for completed-action reports, not progress pings |
| Code itself | NO — different rules (docstrings, identifiers) |

Default: if the output is a finished artifact someone else will read to decide something → convey applies.

## The scaffold

```
## <Headline — what now works / fails / changed — ≤12 words>

**Goal.** 1 sentence. User-visible thing. Plain English. No file paths.

**Behavior diff.**
| <axis> | Before | After |
|---|---|---|
| <concept A> | <state> | <state> |
| <concept B> | <state> | <state> |

**Flow** (only when multi-actor / non-linear):
    actorA → actorB: trigger
    actorB → store: writes record
    store → actorC: next tick reads

**Why non-obvious.** ≤2 lines. Skip if goal sentence already covers it.

**Caveats / next actions.**
- [ ] Operator action 1 (deploy / publish / restart)
- [ ] Known limitation 1

**Verify.** `cmd` → ✅ N/N | optional `path:line` audit pointers.
```

Sections in **bold** are the canonical names — keep them stable so readers can skim by section header.

## Rules — do / don't

| ✅ Do | ❌ Don't |
|---|---|
| Concepts in body; paths in Verify line only | File paths above Verify |
| Tables for any "A vs B" / matrix / option list | Prose comparing two states |
| Options framed in plain English (what + trade-off) — reader doesn't need codebase knowledge | Options framed by code path / file name / internal symbol (`refactor validateBlocked` / `move call out of reconcile.ts`) |
| ASCII arrow diagrams (`A → B → C`) | Numbered prose paragraphs describing flow |
| Bullets for parallel items | Run-on sentences listing items |
| Present-tense, system-actor verbs ("skips", "stamps", "rebuilds") | Past-tense personal-actor ("I added", "We refactored") |
| One short verb per bullet | Bullet that contains its own sub-clauses |
| Inline `backticks` only for identifiers / commands | Backticks around plain English |
| `✅ N/N` test status, one line | Per-suite tables unless something failed |
| Headline = ≤12 words, no jargon | Multi-clause headlines |
| Drop "Why non-obvious" when goal covers it | Pad it with restatement |
| Caveats as `- [ ]` checkboxes (operator action) | Caveats as paragraphs |

## Token-saving rhetoric (apply to every section)

| Replace | With |
|---|---|
| "in order to" | "to" |
| "make sure that" | "ensure" / drop |
| "the following is" | give the thing |
| "essentially / basically / actually / just / simply" | (drop) |
| "is dependent upon" | "needs" / "consumes" |
| "We will / I will / Let me" | (drop — describe end-state) |
| "It should be noted that" | (drop) |
| "In terms of X" | "X:" |
| "due to the fact that" | "because" |

## How convey composes with caveman

|Layer|Owns|
|---|---|
| `convey` | **Content + structure** — what sections, what tables, what order |
| `caveman` (if loaded) | **Word-level form** — articles, fillers, abbreviations |

Order: pick convey shape first, then caveman compresses words inside each section. Both active = maximum density.

## Self-trigger gate (load-discipline)

Before sending ANY response that contains ANY of these tokens / shapes, confirm this skill has been loaded this session and apply the scaffold:

- "Summary", "What shipped", "What I did", "Here's what changed"
- "Report", "Results", "Findings"
- A bulleted list of files / paths with prose around them
- Multiple `##` headers describing the same body of work
- 3+ paragraphs explaining one change

If your draft is going to be longer than 40 lines for a single completed action, convey is not loaded or not applied — re-shape.

### Hard carve-out — terminal MCP calls

When the previous tool call was a **terminal signal** (`mcp__danxbot__danxbot_complete`, `mcp__danxbot__danxbot_slack_reply` followed immediately by `danxbot_complete`, or any equivalent "this dispatch is over" tool), **emit NO further text in this turn.** The process is being SIGTERM'd; any tokens streamed during the grace window are discarded and wasted. The terminal tool's `summary` arg + the `retro` field on the issue YAML ARE the report — the conversation text is not.

Self-trigger gate does NOT fire after a terminal MCP call. Stop output, full stop.

## Anti-patterns

**Anti-pattern: Wall of file paths.**
```
### What shipped
- `src/agent/launcher.ts` — added foo
- `src/agent/spawn.ts` — added bar
- `src/agent/types.ts` — added baz
- ... (30 more lines)
```
→ Reader can't tell what now WORKS differently. Replace with **Goal** + **Behavior diff** table.

**Anti-pattern: Code-shape leakage.**
```
The new `ConflictVerdict` is a tagged union with `kind: "ok" | "conflict" | "wait_for"` ...
```
→ Type signature in body. Move to Verify pointer; in body say "verdict carries one of three decisions".

**Anti-pattern: Prose flow narration.**
```
First the picker calls runConflictCheck, which then awaits a verdict via onComplete, after which applyConflictVerdict is invoked, and then the YAML is mutated on disk...
```
→ Replace with arrow diagram:
```
picker → conflict-check → verdict → apply → YAML on disk
```

**Anti-pattern: Code-path options.**
```
**Options.**
1. Thread `byId` into `validateBlocked` and check `effectiveWaitingOn`.
2. Move `forceWaitingOnToToDo` out of `syncTrackedIssueOnComplete`.
3. Drop the DX-212 invariant at yaml.ts:941.
```
→ Reader needs codebase context to pick. Frame each option as **what behaviour changes** + **the trade**, no internal symbols. Example:
```
1. Validator gets smarter — only fail when deps are still unresolved. Keeps history, medium effort.
2. Picker rips off the wait note on dispatch. Cheap, loses history.
3. Drop the rule. One-line fix, loses a guardrail.
```
File paths + symbols belong in the Verify line, not in the option body.

**Anti-pattern: Section padding.**
```
**Why non-obvious.** Even though same-file overlap might seem like a conflict, git auto-merges disjoint hunks, and the rebase-time resolution is now the expected path, so only heavy structural overlap (same function + >15 min human merge) earns a durable stamp.
```
→ Three commas, one idea. Compress: `Same-file overlap ≠ conflict — git auto-merges disjoint hunks. Only heavy structural overlap earns a stamp.`

## Example — the conflict-mutex shipment, conveyed

```
## Cards can declare durable conflicts; poller honors them in both directions

**Goal.** Two cards whose work would collide can no longer dispatch concurrently — and the gate is sticky, not re-evaluated every tick.

**Behavior diff.**
| Concept | Before | After |
|---|---|---|
| Conflict gate lifetime | Transient — re-asked every ~60s | Persistent — stamped on card |
| Cost per repeat | 1 Sonnet call (~$0.20, ~30s) | 1 DB read (<1ms, free) |
| Enforcement direction | One-way | Two-way (A↔B symmetric) |
| Self-resolve | Manual operator | Auto when partner reaches Done/Cancelled |
| Decision shape | ok / not-ok | ok / conflict (mutex) / wait_for (precedence) |

**Three dispatch gates, distinct meanings.**
| Gate | Means | Cleared by |
|---|---|---|
| `blocked` | THIS card self-stuck | Human |
| `waiting_on` | THIS card needs OTHER's output (1-way) | Partner reaches terminal |
| `conflict_on` | THIS card collides with OTHER's work area (2-way) | Either partner reaches terminal |

**Flow.**
    picker → conflict-check (Sonnet, 5min budget, only when in-progress siblings exist)
    conflict-check → verdict {ok | conflict | wait_for}
    verdict=conflict  → stamp candidate.conflict_on[] (durable)
    verdict=wait_for  → cycle-audit walk → stamp waiting_on OR demote→conflict
    next tick: poller reads stamped fields from DB → skips without calling Sonnet
    partner terminal → effective-gate auto-opens → poller dispatches

**Why non-obvious.** Same-file overlap ≠ conflict. Git auto-merges disjoint hunks; rebase-time resolution is the expected path. Only heavy structural overlap earns a durable stamp.

**Caveats / next actions.**
- [ ] Publish MCP package: `make publish-danx-issue-mcp` (schema v7).
- [ ] Rebuild + restart worker: `make build && make launch-worker REPO=danxbot`.
- [ ] Dashboard UI for conflict_on field — backend writes/reads, SPA unchanged.
- [ ] In-flight conflict-checks finish on old prompt; new dispatches after restart use new path.

**Verify.** `npx vitest run` → ✅ 4805/4805 | `npx tsc --noEmit` → clean | new tests: `effective-conflict-on.test.ts`, `apply-conflict-verdict.test.ts`, `local-issues.test.ts` (+3).
```

Compare line count: prior version with 6 tables of file paths and prose ≈ 70 lines. This version ≈ 30 lines, faster to scan, same actionable info.

## Length budgets (soft caps)

| Output type | Convey budget |
|---|---|
| End-of-turn report | 30 lines |
| Commit message body | 8 lines |
| PR description | 40 lines |
| Issue YAML comment | 20 lines |
| Slack reply | 12 lines |
| Investigation finding | 20 lines |
| Subagent dispatch prompt | 30 lines (briefer is fine; longer means you're carrying state the subagent can derive itself) |

Exceeding a budget = re-read for fluff before sending.
