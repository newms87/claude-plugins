---
name: shared-plan
description: 'Default communication method for any task beyond a quick cleanup — a shared HTML page (tabs: Resources / Goals / Architecture / Rules / Caveats / Decisions / Tests / Timeline, all optional, only add what the task needs) is the PRIMARY human-agent surface: questions, decisions, monitoring, plans, handoffs live there, not in chat. ALWAYS ACTIVE — not conditional on anything already running: the first time a task needs tracking or a plan-affecting question arises, create the page right then. Triggers — starting any multi-step plan or build; ANY question whose answer affects a plan (only skip for a trivial one-off clarification with no plan impact); monitoring/watching a long-running task (use the Timeline tab); context nearing exhaustion — write the handoff INTO this page, there is no separate handoff skill. BEFORE writing or restructuring the page you MUST invoke `Skill(shared-plan)` — this description is NOT the skill, and a page built from this summary alone ships as one flat scroll, which is the documented failure. TABS ARE MANDATORY STRUCTURE, not a menu of suggestions: any page with more than one section ships as tabs, and long sections collapse. EVERY decision box is SELF-CONTAINED — its background, evidence, options and tradeoffs live INSIDE that box, never in a sibling section the reader must hunt for; a new finding is filed under the decision it bears on, never appended wherever it chronologically landed. Publish via the `Artifact` tool when in an interactive claude.ai session; otherwise write the same self-contained HTML file to disk and point the operator at the path — works everywhere, no tool dependency. Chat becomes a lightweight pointer ("see DEC-3") plus one line of status — never the record. MUST update the page after every action taken or new information received, including "checked, nothing changed." EVERY entry in EVERY tab carries a real `ts` timestamp (actual current time, never guessed), updated whenever that entry is touched — this is how the operator spots a stale item needing a fresh look.'
---

# Shared Plan — the Page Is the Record

Chat scrolls away and compacts. A page persists, is searchable, keeps stable IDs the operator can reference back ("kill RUL-07, change DEC-3 to B"), and survives a session ending. For anything with more than one decision, more than one moving part, or any duration, this page — not prose in chat — is where the content lives.

## Always active — there is no "if it's running"

Don't gate this on whether a page already exists for the current task. The moment ANY of these happens, create one (or add a tab to the one already open for this task) right then, same turn:

- A question comes up whose answer affects a plan in any way (scope, architecture, sequencing, an irreversible choice). **Only** a trivial one-off clarification with zero plan impact stays in chat.
- Work spans more than one step or more than one turn.
- Anything is being monitored over time.
- Context is running low mid-task.

There is no separate "should I use the artifact this time" decision to make — the decision is already made. What varies is only which tabs the task actually needs.

## No tool dependency — HTML works everywhere

This does **not** require the `Artifact` tool. A plain, self-contained HTML file with its own `<style>`/`<script>` renders correctly in any browser — locally, attached somewhere, wherever the operator can open it. Two delivery paths, same underlying file:

- **Interactive claude.ai session with `Artifact` available:** publish through it. That tool wraps your content in its own `<!doctype>`/`<head>`/`<body>` — per its contract, pass content only, no outer document tags of your own.
- **Everywhere else** (dispatched/headless runs, no `Artifact` tool, or the operator just wants a file): write the full standalone document — `<!DOCTYPE html>` through `</html>`, self-contained, no external requests — to disk (session scratchpad, or whatever durable delivery this environment has, e.g. attaching it to a tracked work-record) and tell the operator the path in chat. It opens in any browser exactly the same.

Either way it's the same page; only the outer wrapper and the delivery step differ.

## Not the same vessel as a tracker card

A tracker card (where one exists — e.g. `danxbot:issue-card-workflow`) is the durable, dispatchable **work-record** — what survives across sessions and agents, what a worker picks up. This page is the live **human↔agent working surface** for the task in progress — decisions pending right now, a timeline being actively watched, architecture being reasoned through together. They compose, they don't compete: link the card id in this page's Resources tab; put this page's path/URL in the card description or a comment. If a card exists for this work, update both — the card for durability, the page for the live conversation.

## Build it: data-driven, not one long hand-authored document

Copy `references/artifact-template.html` in this skill's directory. It is **not** a wall of hand-written `<div>` blocks per entry — that shape breaks under its own weight (a multi-hundred-line HTML file edited in pieces silently corrupts nesting far more often than it looks like it would, and a single new entry means editing deeply nested markup). Instead:

- **Data lives in plain JS objects/arrays** near the top of the `<script>` block — one array per tab, one object per entry (`{id, ts, title, body, status, tags}`, or the richer shape decisions/timeline need). `ts` is mandatory on every entry in every tab — see "Timestamp every entry" below.
- **Rendering is generic** — a small set of functions builds the DOM, tabs, search, filter, and sort FROM that data. You almost never touch the render code.
- **Adding, removing, or updating an entry is a one-line array edit** — push an object, delete one, change a field. Small, safe, append-friendly diffs instead of restructuring nested markup.
- This is what makes filtering/sorting/tab-switching **real** rather than DOM-text-search hacks: it's operating over structured data, the same data the entries are authored in.

Delete whichever tabs the task doesn't need directly from the `TABS` array and the matching `DATA` key — three tabs (say, Goals, Decisions, Timeline) is a completely normal, correct page.

Load `artifact-design` before writing the actual prose/copy (title, descriptions, tone) when publishing through the `Artifact` tool; for a plain local file its principles are still good practice but not a hard tool-contract requirement. Load `artifact-diagramming` if Architecture needs a real diagram, not a decorative one.

**Mechanical pre-publish check, every time:** open the file and confirm the `DATA` object is valid JS (balanced braces/brackets, no leftover placeholder values) before shipping — the equivalent of the old HTML section-count check, now against structured data instead of markup nesting.

**Before creating a new page for a task, check whether one already exists** (an artifact you or another agent already published for this work, or a file already on disk for this task) — a parallel doc built without checking is a real failure mode: it fragments the record and wastes the rebuild. Found one → update it in place, don't fork a second.

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

Every open decision: the question in plain language, why it needs a human (not something derivable from code/docs — that's `human-loop`'s job to filter first), 2-4 numbered options each with a one-line **For/Against**, and the option you'd actually take flagged `Recommended`. Once answered, flip status to decided, add a `Resolved` marker, and record the actual rationale in a `resolution` field — don't delete the considered-and-rejected options, they're why re-litigation doesn't happen.

**Assumption discipline:** anything you inferred rather than the operator stated outright goes in as an explicit open `DEC-N`, not folded silently into a "decided" entry. If you're not sure whether something was said or assumed, it's assumed — flag it.

**Where the ask lives:** the full brief (per `human-loop`) goes into the `DEC-N` entry's `body`/`options`. Chat gets only "see `DEC-N`" plus one line of status — never the brief itself.

### Timeline — for monitoring

Any task where a human is meant to watch progress over time (a deploy, a migration, a background poll, a long solve) gets a Timeline tab. Entries are chronological, newest last, each timestamped and severity-tagged (ok/warn/crit). **A quiet stretch still gets an entry** ("checked 14:30, no change") — an unexplained gap is indistinguishable from "didn't check," and that ambiguity is exactly what defeats monitoring. This composes with `base:monitor-polling`/`ScheduleWakeup` for the actual polling mechanics; this tab is where what was observed gets recorded so the human doesn't have to have been watching live.

## Update discipline — this is the whole point

**Update the page after every action taken or new information received.** Not at the end, not in a batch — as it happens. Chat's job shrinks to: point at what changed ("see `DEC-4`, now resolved") plus one line of status. If a claim, a finding, a decision, or a timeline event isn't in the page, it isn't recorded — a chat-only report is lost the moment the conversation compacts or ends.

**During investigation specifically:** findings, ruled-out approaches, and evidence go into the page as you gather them (a `CAV-N` for a caveat/gap, a `RES-N` for a source, a `DEC-N` for what it's blocking) — not held in your head until a final report. There is no separate end-of-session capture step; if the page has been kept current, the session's context already lives outside the chat transcript.

## Timestamp every entry — how staleness gets caught

**Every entry, in every tab, carries a `ts` field** — when it was added, or last touched if you're editing an existing one. Not optional, not just for Timeline (Timeline's per-event `time` already serves this for that tab; every other tab needs the same discipline on its own entries). Without it, the operator has no way to tell "this Resource entry has been true since v1" from "this Decision was written five minutes ago and might already be stale" — the whole reason a page beats a chat thread for anything long-running is that it can show its own age, and it only can if every entry says when it was last real.

- **Use the actual current time**, read fresh — never guess, never reuse a timestamp from earlier in the session, never estimate "about now." If the runtime exposes real time, use it; if not, use whatever the environment's actual clock source is. A wrong timestamp is worse than none — it tells the operator something is fresh when it isn't.
- **Update `ts` on every touch**, not just creation. Editing `DEC-4`'s options, correcting a `CAV-2`, adding a row to `RES-1`'s table — all of these bump that entry's `ts`. An entry's `ts` is "last confirmed true," not "first written."
- **Render it visibly** — a small muted line near the id/status, not buried in the body text — so the operator can eyeball staleness across a whole tab at a glance, the same way the Timeline's dot-and-line already does.

## What a handoff is, now

Context running low mid-task is not a special case requiring a different file or skill — it's this page, kept current, plus a short chat pointer. Make sure it carries:

- **A "Resume here" entry** — first item in whichever tab is most active, the single next action + exact command.
- **Confidence tags on load-bearing claims** — `Verified` (cite the proof) / `Unverified` (inferred, not observed) / `Unknown` (name the probe).
- **Dead ends with why they died**, not just "tried X" — a `CAV-N` or `TL-N` entry, not silently dropped.

If those three are current, a fresh agent (or the operator) needs only the page's path/URL to resume. That's it — no separate handoff document, no end-of-session audit ritual. The page already is that.
