---
name: convey
description: Concept-first scaffold for reports/commits/PRs/comments/Slack/hand-offs — headline, behavior diff, ASCII flow, caveats, verify.
---

# convey — Concept-First Information Transfer

Default agent output is code-first: paths, symbols, prose — reader reverse-engineers the
concept. `convey` flips it: concept-first, fixed shape, tables/diagrams over prose, paths
only in Verify, so the reader decides in <30s whether to dig further.

## When to apply

| Situation | Apply? |
|---|---|
| End-of-turn report, commit body, PR, issue card, Slack, code-review, findings, unblock, hand-off | YES |
| Inline narration ("running test now"), code itself | NO |

Any finished artifact someone reads to decide → applies.

## Where the artifact lives — NEVER the consumer repo

Plans, handoffs, decisions are never files: write them to the connected danxbot Plan
(`danxbot:plan-workflow`); work records live on cards (`danxbot:issue-card-workflow`).
Transient scratch goes under `/tmp/`, never the repo's `docs/` or any in-repo path —
clutters git, leaves stale prose nobody owns.

| Artifact | Path |
|---|---|
| Plan, handoff, operator question | the connected danxbot Plan — no file |
| Multi-file scratch / investigation notes | `/tmp/<topic>/` |
| One-shot inline report (scaffold below) | chat — no file |

Only commit a doc to the repo when the user **explicitly** asks for something durable
(canonical guides, runbooks, shared contracts) — "it's a long output" isn't a reason.
Before writing a `.md` under `<repo>/docs/`, `scratch/`, `notes/`, or any in-repo path
that wasn't explicitly requested: stop, retarget to `/tmp/`.

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

**Caveats.** (omit if none)
- Item 1

**Next actions.** (omit if none — operator checkboxes)
- [ ] Action 1

**Verify.** `cmd` → ✅ N/N | optional `path:line` pointers.
```

Section names (bold) stay stable for skimming; never collapse them; omit only empty ones.

## Rules — do / don't

| ✅ Do | ❌ Don't |
|---|---|
| Conclusion first; paths in Verify only | Paths/symbols above Verify; reader re-derives |
| Plain English, zero codebase knowledge | Framed by code path / symbol / ticket id |
| Tables for "A vs B"; ASCII for flow | Prose comparing states; numbered paragraphs |
| System-actor verbs (skips, stamps, rebuilds) | Personal actor (I added, we refactored) |
| Backticks for identifiers/commands only | Backticks on plain English |
| Omit empty sections; drop Why if goal covers | Forced entries; padding |

## Self-containment + progressive disclosure

Same "stands alone, zero session context" rule the always-on session hook already
states. Deep mechanism (memoization, scheduling, wiring, evidence chains) is omitted
unless the user asks "why" — at most a one-line offer to expand, never front-loaded.

## Self-trigger gate

Before sending "Summary", "What shipped", "Report", "Findings", a wall of paths, or 3+
paragraphs on one change — confirm the scaffold applies. A draft >40 lines for a single
action means it wasn't applied; reshape.

**Terminal MCP calls:** after a terminal signal (`danxbot_complete`, etc.), emit no text
— the process is being terminated. The tool's `summary` and the card `retro` ARE the
report.

## Anti-patterns

- **Wall of paths** (`src/A.ts — foo | src/B.ts — bar`) → Goal + Behavior diff instead.
- **Code-shape leakage** (type signature in prose) → move to Verify; say "three decisions."
- **Prose flow** ("X calls Y, awaits Z, invokes W...") → arrow chain instead.
- **Jargon-first** (field names/IDs leading) → real-world first, ID/`path:line` in Verify.
- **Code-path options** ("1. Thread X into Y...") → behavior + tradeoff, no symbols.
- **Section padding** — three commas, one idea; say it once.

## Length budgets

| Output | Budget |
|---|---|
| End-of-turn | 30 |
| Commit body | 8 |
| PR | 40 |
| Card comment | 20 |
| Slack | 12 |
| Investigation | 20 |
| Subagent prompt | 30 |

Over budget → re-read for fluff.

**Carve-out — an ask directed at the user is measured per ask, not per turn.** A
decision/approval/clarification brief owes the reader a problem statement, a
recommendation, numbered options, and pros/cons per option (contract:
`human-collaboration:human-loop`). Those four are the last things to cut; trim evidence
and mechanism first, never merge multiple asks to save lines.
