---
name: shared-plan
description: 'Default communication method for any task beyond a quick cleanup — a shared claude.ai Artifact (tabs: Resources / Goals / Architecture / Rules / Caveats / Decisions / Tests / Timeline, all optional, only add what the task needs) is the PRIMARY human-agent surface: questions, decisions, monitoring, plans, handoffs live there, not in chat. Triggers — starting any multi-step plan or build; asking the operator a decision or open question; monitoring/watching a long-running task (use the Timeline tab); context nearing exhaustion in an Artifact-capable session (this is the artifact-first path — base:handoff-context is the fallback when no Artifact tool or no human present). Chat becomes a lightweight pointer ("see DEC-3") plus one line of status — never the record. MUST update the artifact after every action taken or new information received, including "checked, nothing changed."'
---

# Shared Plan — the Artifact Is the Record

Chat scrolls away and compacts. An artifact persists, is searchable, keeps stable IDs the operator can reference back ("kill RUL-07, change DEC-3 to B"), and survives a session ending. For anything with more than one decision, more than one moving part, or any duration, the artifact — not prose in chat — is where the content lives.

## Capability gate

Requires the `Artifact` tool AND a human able to open the resulting URL. That's an interactive, human-driven session — exactly `human-collaboration`'s install scope. **Not available:** dispatched danxbot workers, headless contexts, anything without a human reading claude.ai. There, fall back to `base:handoff-context` for context-exhaustion handoffs and to plain chat/card comments for everything else.

## Default, with one exception

Use this for: any plan with more than one step, any request for a decision, any monitoring/watch task, any investigation whose findings need to outlive the chat, any build that will span multiple turns. **Skip it** for a genuinely quick, single-action cleanup with nothing to track afterward — a one-line fix, a single question with an obvious answer. When in doubt, use the artifact; the cost of one is low and it's always updatable in place.

## This is not the same vessel as a tracker card

`danxbot:issue-card-workflow`'s cards are the durable, dispatchable **work-record** — what survives across sessions and agents, what a worker picks up. This artifact is the live **human↔agent working surface** for a session in progress — decisions pending right now, a timeline the human is actively watching, architecture being reasoned through together. They compose, they don't compete: link the card id in the artifact's Resources tab; put the artifact URL in the card description or a comment. If a card exists for this work, update both — the card for durability, the artifact for the live conversation.

## Build it

Don't design a new visual system per task. Copy `references/artifact-template.html` in this skill's directory — it's the reusable skeleton (masthead, sticky tabs, search/filter, the row/pill/decision/timeline CSS+JS) distilled from several of these built in production. Delete every `<section>` you don't need; three tabs is a completely normal, correct artifact. Load `artifact-design` before writing the actual prose/copy (title, descriptions, tone) even though the CSS is reused wholesale — pick an accent hue distinct from any other artifact active this session so a reader with several tabs open can tell them apart. Load `artifact-diagramming` if Architecture needs a real diagram, not a decorative one.

**Mechanical pre-publish check, every time:** `grep -c '<section' file.html` must equal `grep -c '</section>' file.html`, and no leftover placeholder text. Hand-editing a multi-hundred-line HTML file in pieces (normal for a growing artifact) silently breaks nesting more often than it looks like it would.

**Before creating a new artifact, list first.** `Artifact({action:"list", scope:"all"})` — a parallel doc built without checking whether one already exists for this work is a real failure mode, not a hypothetical one; it fragments the record and wastes the rebuild. Found one → update it in place via `url:`, don't fork a second.

## Tabs — ID scheme, all optional, keep stable once assigned

| Tab | Prefix | Holds |
|---|---|---|
| Resources | `RES-N` | Source docs, URLs, credentials-locations (never values), prior art, authority order when sources disagree |
| Goals | `GOA-N` | What "done" means, in scope vs explicitly out of scope |
| Architecture | `ARC-N` | System design, components, diagrams |
| Rules | `RUL-N` | Domain logic / business rules / invariants that must hold |
| Caveats | `CAV-N` | Known gaps, contradictions between sources, things verified vs assumed |
| Decisions | `DEC-N` | Open questions needing an operator call, and resolved ones with their rationale |
| Tests | `TST-N` | What proves this was built correctly (split into sub-schemes like `E2E-N`/`UC-N` freely if the domain warrants it) |
| Timeline | `TL-N` | Chronological monitoring log — see below |

Never renumber an assigned ID; only append. IDs are how the operator refers back to specific items across turns — a moving target defeats the entire point.

### Decisions — the shape that makes them answerable

Every open decision: the question in plain language, why it needs a human (not something derivable from code/docs — that's `human-loop`'s job to filter first), 2-4 numbered options each with a one-line **For/Against**, and the option you'd actually take flagged `Recommended`. Once answered, flip status to decided, add a `Resolved` pill, and append a `<details class="resolved">` block with the date and the actual rationale — don't delete the considered-and-rejected options, they're why re-litigation doesn't happen.

**Assumption discipline:** anything you inferred rather than the operator stated outright goes in as an explicit open `DEC-N`, not folded silently into a "decided" entry. If you're not sure whether something was said or assumed, it's assumed — flag it.

### Timeline — new, for monitoring

Any task where a human is meant to watch progress over time (a deploy, a migration, a background poll, a long solve) gets a Timeline tab instead of — or alongside — Decisions. Entries are chronological, newest last, each timestamped and severity-pilled (ok/warn/crit). **A quiet stretch still gets an entry** ("checked 14:30, no change") — an unexplained gap is indistinguishable from "didn't check," and that ambiguity is exactly what defeats monitoring. This composes with `base:monitor-polling`/`ScheduleWakeup` for the actual polling mechanics; this tab is where what was observed gets recorded so the human doesn't have to have been watching live.

## Update discipline — this is the whole point

**Update the artifact after every action taken or new information received.** Not at the end, not in a batch — as it happens. Chat's job shrinks to: point at what changed ("see `DEC-4`, now resolved") plus one line of status. If a claim, a finding, a decision, or a timeline event isn't in the artifact, it isn't recorded — a chat-only report is lost the moment the conversation compacts or ends.

## Absorbed from context handoffs

When this artifact IS the session's primary surface and context runs low, the handoff isn't a separate file — it's making sure the artifact already carries what a handoff needs, then a short chat pointer to it:

- **A "Resume here" row** — first thing in whichever tab is most active, the single next action + exact command.
- **Confidence tags on load-bearing claims** — `Verified` (cite the proof) / `Unverified` (inferred, not observed) / `Unknown` (name the probe) as a pill, same discipline as `base:handoff-context`.
- **Dead ends with why they died**, not just "tried X" — a Caveats or Timeline entry, not silently dropped.

If those three are current in the artifact, a fresh agent (or the operator) needs only the artifact URL to resume — that's the actual goal `base:handoff-context` was solving, reached through the surface that was already being kept live instead of a one-shot file written at the last second.
