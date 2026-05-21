---
name: convey
description: Use when transferring information to another entity (human or agent) — reports, commits, PRs, issue YAMLs, Slack, code-review, hand-offs, summaries, plans, investigations, unblock notes. Concept-first headline, behavior-diff tables, ASCII flows, caveats, verify line. Signal/token ratio high, scan <30s. Auto-triggers on draft with "Summary", "What shipped", "Report", "Findings" OR wall of paths.
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
| Concepts in body; paths in Verify only | Paths above Verify |
| Tables for "A vs B", matrix, options | Prose comparing states |
| Plain English (zero codebase knowledge needed) | Framed by code path / symbol / `DX-212` / `validateBlocked` |
| ASCII diagrams (`A → B → C`) | Numbered prose paragraphs |
| Bullets for parallel items | Run-on sentences |
| System-actor verbs (skips, stamps, rebuilds) | Personal actor (I added, We refactored) |
| One verb per bullet | Sub-claused bullets |
| Backticks for identifiers/commands only | Backticks on plain English |
| `✅ N/N` one line | Per-suite tables |
| Headline ≤12 words, no jargon | Multi-clause |
| Drop Why-non-obvious if goal covers | Pad with restatement |
| Next actions as `- [ ]` checkboxes | Merge with Caveats |
| Caveats as bullets (state of world) | "Caveats: none" filler |
| Omit section if empty | Forced entries |

## Word compression

Replace: "in order to" → "to" | "make sure that" → "ensure"/drop | "the following" → give it | "essentially/basically/just/simply" → drop | "is dependent upon" → "needs" | "We/I/Let me" → (drop) | "It should be noted" → (drop) | "In terms of" → ":" | "due to the fact" → "because"

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
