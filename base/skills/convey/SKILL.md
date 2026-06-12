---
name: convey
description: Concept-first scaffold for reports/commits/PRs/comments/Slack/hand-offs — headline, behavior diff, ASCII flow, caveats, verify.
---

# convey — Concept-First Information Transfer

Default agent output is code-first: file paths, symbols, prose. Reader reverse-engineers concept. Fast to dump, slow to read.

`convey` flips it. Concept-first, fixed shape, tables + diagrams over prose, paths in Verify line only. Reader decides in <30s whether to dig further.

## When to apply

| Situation | Apply? |
|---|---|
| End-of-turn report, commit body, PR, issue YAML, Slack, code-review, findings, unblock, hand-off | YES |
| Inline narration ("running test now"), code itself | NO |

Finished artifact someone reads to decide → convey applies.

## Where the artifact lives — NEVER in the consumer repo

Agent-authored long-form transient artifacts — handoff docs, plans, scratch
specs, investigation reports, multi-step working notes — go under `/tmp/`,
**NEVER into the consumer repo's `docs/` tree** (or any other in-repo path).
The repo is production source; agents dropping handoffs into `docs/handoffs/`
clutters git, forces every future contributor's `git status` to ignore-list
dance over the path, and leaves stale prose nobody owns the moment the
receiving agent finishes.

| Artifact | Path |
|---|---|
| Handoff for the next agent | `/tmp/handoffs/<TITLE>.md` |
| Multi-file scratch / plan / investigation notes | `/tmp/<topic>/` |
| One-shot inline report (the convey scaffold above) | emit in chat — no file |

Only commit a doc to the consumer repo when the user **explicitly** asks for
something durable in vc (canonical guides under `docs/guides/`, runbooks,
contracts the team co-owns). "It's a long output" is not a reason to write to
the repo — `/tmp/` is the default home for everything an agent writes that
isn't code or a user-requested-durable doc.

Mechanical pre-Write check: about to `Write` a `.md` under `<repo>/docs/` (or
anywhere in the consumer tree) that wasn't on the user's explicit request
list → STOP, retarget to `/tmp/`. The same rule blocks an agent from making a
mess in `<repo>/scratch/`, `<repo>/notes/`, or any other ad-hoc dump dir.

## The scaffold

```
## <Headline ≤12 words>

**Goal.** 1 sentence, plain English, no paths.

**Behavior diff.**
| concept | Before | After |
|---|---|---|
| A | state | state |

**Flow** (multi-actor only):
    actor1 → actor2: trigger
    actor2 → store: writes

**Why non-obvious.** ≤2 lines. Skip if goal covers it.

**Caveats.** (omit if none — limitations, gotchas, surprises)
- Item 1

**Next actions.** (omit if none — checkboxes for operator chores)
- [ ] Action 1

**Verify.** `cmd` → ✅ N/N | optional `path:line` pointers.
```

Canonical section names (bold) stay stable for skimming. Caveats = world as-is. Next actions = world that must change. Never collapse. Omit empty sections.

## Rules — do / don't

| ✅ Do | ❌ Don't |
|---|---|
| Lead with conclusion; concepts in body, paths in Verify only | Paths/symbols above Verify; reader re-derives |
| Plain English (zero codebase knowledge) | Framed by code path / symbol / `DX-212` / `validateBlocked` |
| Tables for "A vs B"/matrix; ASCII diagrams for flow | Prose comparing states; numbered prose paragraphs |
| System-actor verbs (skips, stamps, rebuilds) | Personal actor (I added, We refactored) |
| Backticks for identifiers/commands only | Backticks on plain English |
| Omit empty sections; drop Why if goal covers | Forced entries; padding / restatement |

(Scaffold owns headline ≤12w, `✅ N/N` one-liner, caveats/next-actions shape — not repeated here.)

## Word compression

Replace: "in order to" → "to" | "make sure that" → "ensure"/drop | "the following" → give it | "essentially/basically/just/simply" → drop | "is dependent upon" → "needs" | "We/I/Let me" → (drop) | "It should be noted" → (drop) | "In terms of" → ":" | "due to the fact" → "because"

## Self-containment + progressive disclosure

Every artifact stands alone to a reader with ZERO session context. Lead with the plain-language conclusion (what + impact + next step); a reader who lived the session must NOT have to re-derive it. **Default depth = high-level.** Deep mechanism (memoization, scheduling, mock/internal wiring, evidence chains) is OMITTED unless the user asked to "explain further" / "why" — at most a one-line offer to expand, never front-loaded. Mechanical gate: "would someone who just opened the chat understand this without scrolling up?" No → cut detail, restate the conclusion.

## Self-trigger gate

Before sending ANY response with: "Summary", "What shipped", "Report", "Findings", wall of paths, 3+ paragraphs on one change → confirm loaded + apply scaffold.

Draft >40 lines for single action = convey not applied. Re-shape.

**Terminal MCP calls:** when previous tool = terminal signal (`danxbot_complete`, etc.), emit NO text. Process being SIGTERM'd; tokens wasted. Tool's `summary` arg + issue YAML `retro` ARE the report.

## Anti-patterns

- **Wall of paths:** `What shipped: src/A.ts — foo | src/B.ts — bar | ...` → Can't tell what WORKS. Use Goal + Behavior diff.
- **Code-shape leakage:** `ConflictVerdict is tagged union with kind: "ok"|"conflict"|...` → Move type signature to Verify; in body say "three decisions".
- **Prose flow:** `Picker calls runConflictCheck, awaits verdict, invokes applyConflictVerdict, mutates YAML...` → Use arrow: `picker → check → verdict → apply → YAML`.
- **Jargon-first:** `SG-135 waiting_on + In Progress → DX-212 invariant (waiting_on != null ⟹ status=ToDo) fires...` → Lead with real-world, then internals. "Card waiting on SG-134 finished. Agent picked up + flipped to In Progress. Validator sees note-pinned + status-not-waiting → screams." Then field (`waiting_on`), ID (`DX-212`), path (`yaml.ts:941`) in Verify.
- **Code-path options:** `1. Thread byId into validateBlocked. 2. Move forceWaitingOnToDo. 3. Drop invariant.` → Frame as behavior + trade, no symbols. "1. Validator smarter (keeps history, medium effort). 2. Picker clears note (cheap, loses history). 3. Drop rule (one-line, loses guardrail)."
- **Section padding:** Three commas, one idea. `Same-file overlap ≠ conflict — git auto-merges. Only heavy structural overlap earns stamp.`

## Cheap-to-verify facts — read, never estimate

If a fact is one tool call away, READ it before you assert it. Stating a number you could have checked is the failure — a confident wrong fact is worse than "let me check."

**Elapsed time / duration is the canonical trap.** You have ZERO reliable internal sense of wall-clock: a session can sit idle for hours, the date can roll mid-session, and "feels like a few minutes" is routinely off by orders of magnitude. Before ANY claim about elapsed time, duration, "N minutes ago", "recently", "just", or how long since an event:

1. Read the current clock (`date`-equivalent).
2. Read the source timestamp (the record, the log line, the commit).
3. Compute the difference and state THAT.

Never narrate a duration from memory or feel. Same discipline for any other one-lookup fact: current branch/HEAD, a row's status, a file's existence. "I think it's been ~X" about a checkable quantity → STOP, check, then state the computed value.

## Length budgets

| Output | Budget |
|---|---|
| End-of-turn | 30 |
| Commit body | 8 |
| PR | 40 |
| YAML comment | 20 |
| Slack | 12 |
| Investigation | 20 |
| Subagent prompt | 30 |

Over budget = re-read for fluff.
