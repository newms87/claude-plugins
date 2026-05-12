---
name: pipe-finish
description: 'Use (a) immediately after every `/pipe-commit` to produce a post-commit report + invoke the next pipeline step, AND (b) at session end to surface unwritten knowledge + spawn Action Items cards. Replaces the retired `/pipe-report` skill. All output sections follow the `convey` format (auto-loaded base skill) — concept-first headline, behavior-diff tables, ASCII flow, caveats list, verify line.'
---

# Finish — post-commit reports AND end-of-session wrap

This skill has two modes, invoked at different cadences:

| Mode | When | What it does |
|---|---|---|
| **Post-commit** (mode `A`) | Immediately after every `/pipe-commit` | Emits a `convey`-format report of the just-committed change, then invokes `/next-phase` or recurses into mode `B` if the session is done. |
| **Final wrap** (mode `B`) | At session end (last phase committed OR user wraps up) | Action Items spawning, session knowledge dump, recommended next actions, final session report. |

All output produced by either mode follows the `convey` format — see the auto-loaded `base:convey` skill for the scaffold (headline → goal → behavior diff table → flow → caveats → verify). Length budgets: post-commit report 30 lines, final wrap 60 lines.

---

## Mode A — Post-commit report

Replaces the retired `/pipe-report` skill. Use immediately after `/pipe-commit` succeeds.

### Steps

1. `git show --stat HEAD` — sanity-check the commit landed.
2. Emit a `convey`-format report (use the scaffold from `base:convey`):
   - **Headline** — what now works / fails / changed in ≤12 words.
   - **Goal** — one sentence.
   - **Behavior diff** — table for any "Before / After" axis the commit changed. Skip if a one-line commit with one clear effect.
   - **Caveats / next actions** — `- [ ]` checkboxes for operator deploy / publish / restart steps, known limitations.
   - **Verify** — `cmd → ✅ N/N` line. Skip per-suite tables unless something failed.
   - **Skipped findings** — list any validly-skipped pipe-quality findings.
3. State the next step as a **declarative fact**, then invoke it without pausing.

### Decision tree for the next step

| Situation | Next step | Action |
|---|---|---|
| More phases remain in the plan | Name the next phase | Invoke `/next-phase` in the same response. |
| This was the final phase | `/pipe-finish` (mode B) | Recurse into mode B in the same response. |
| Waiting on external input the pipeline cannot produce itself (human-only Trello approval, third-party API outage) | State the blocker | Stop. Do not invoke a pipeline step. |

### Forbidden — never ask permission for pipeline-mandated steps

`/next-phase` and the mode-B wrap are pre-approved by the original plan approval. Writing any of these is a rule violation:

- "Let me know if you want me to also…"
- "Say go / go ahead / approve and I'll…"
- "…want me to run X?"
- Any `?` attached to a pipeline step name

Correct pattern: declarative statement + immediate invocation. The user can interrupt if they want something else.

---

## Mode B — Final session wrap

Context is about to be destroyed — anything not written down is lost forever. Three jobs: spawn Action Items cards, dump session knowledge, present recommended next actions. All output follows `convey`.

---

## Part 1: Action Items

Review the session for anything that went wrong or needs attention. For each issue, decide:

- Did this waste meaningful time (>10 min)?
- Was the human frustrated or had to correct the same mistake twice?
- Is there a concrete fix (rule change, new tool, better docs)?

If YES to any: spawn a fresh issue card by calling `mcp__danx-issue__danx_issue_create` with typed args.

**Action item categories** (use to choose `type` + frame description):
- **Prompt/rules fix** — rule missing, ambiguous, or wrong → caused mistake
- **New tool/skill** — manual workflow should be automated
- **Skill improvement** — existing skill missed case or could be tightened
- **Documentation** — code comments, CLAUDE.md updates that would have saved time
- **Code refactor** — misleading code sent agent down wrong path
- **Better error messages** — script failed silently or unhelpfully

**Rules, Not Memory.** Behavioral corrections go in rules files (`~/.claude/rules/` or project `.claude/rules/`), NEVER in memory. Memory = contextual, soft, disposable. Rules = universal, durable, authoritative. User corrects behavior → that's a rule. Ask: "Would this help agent in ANY codebase?" Yes → global `~/.claude/rules/`. No → project `.claude/rules/` or CLAUDE.md.

**Spawn procedure:**

Call `mcp__danx-issue__danx_issue_create({...})` directly — no draft YAML required. Required args:

- `type`: `"Bug"` (broken behaviour) or `"Feature"` (new tools/skills/docs)
- `title`: short description of what went wrong or needs fixing
- `description`: markdown body — what happened, why it wasted time, proposed fix (specific files/changes)

Optional args (omit for defaults):

- `status` — defaults `"ToDo"`
- `parent_id` — `"ISS-N"` reference or `null`
- `children` — `string[]` of `ISS-N` refs (epics)
- `ac` — `[{ title, checked? }, ...]`; `checked` defaults `false`
- `phases` — `[{ title, status?, notes? }, ...]`; defaults `Pending` / `""`
- `comments` — `[{ author, timestamp?, text }, ...]`

The tool allocates `ISS-N`, builds the canonical YAML, pushes via `tracker.createCard`, and writes `<id>.yml`. Returns `{created: true, id: "ISS-N", path, external_id}` or `{created: false, errors: [...]}`. On `false`, fix the validation errors and re-call.

**Apply immediate rule fixes directly.** Small rule additions (1-10 lines) to `~/.claude/rules/` or project rules — just make the edit. No card needed for small rule tweaks.

**Commit rule changes separately** if any were made:
- Message: `[Rules] Brief description`
- Stage only rule files

---

## Part 2: Session Knowledge Dump

Before the session ends, review everything you know and surface anything that hasn't been captured.

### What to check

Walk through each category and ask: "Is there anything I learned or observed that isn't written down anywhere?"

1. **Issue cards** — Are all assigned `ISS-N` YAMLs up to date? Any status changes, blockers, or discoveries that should be appended to the card's `comments[]` via direct YAML edit? The chokidar watcher mirrors the change to the DB; the post-completion auto-sync pushes to the tracker.

2. **Code comments / docblocks** — Did I encounter confusing code during investigation that I now understand but didn't document? Any "gotchas" I discovered that the next agent will hit?

3. **Rules / CLAUDE.md** — Did I learn a project convention or pattern that isn't in the rules? Did a rule confuse me or need clarification?

4. **Outstanding work** — Is there anything I said I'd do but didn't? Any loose ends from the conversation? Anything the user mentioned wanting that we didn't get to?

5. **Observations for the user** — Anything I noticed during investigation that the user should know about but wasn't part of the task? Stale data, broken tests, degraded infrastructure, security concerns?

### What to output

Present findings as a concise list grouped by category. Only include categories that have something to say. Skip empty categories.

```
## Session Notes

### Outstanding
- [things not yet done, blockers, next steps]

### Observations
- [things noticed but not addressed — stale data, broken tests, etc.]

### Undocumented Knowledge
- [things learned that aren't captured in rules/docs/comments/cards]
```

If the session was clean and everything is captured: output "Session complete. Nothing outstanding."

### What NOT to do

- Don't repeat what's already on issue card YAMLs, in commit messages, or in flow-report output
- Don't fabricate observations to look thorough — silence is fine
- Don't create cards for observations (those are for the user to decide)
- Don't write files for this — just output to the conversation

### CRITICAL: Act on Undocumented Knowledge

Undocumented Knowledge is not just a dump — it drives the first items in Recommended Next Actions. For each piece of undocumented knowledge, decide:

**Document it if** it helps future agents avoid mistakes, understand how the system works, know how to test/build/deploy, or improves agent behavior. The right places:
- **CLAUDE.md** — how the system works, key concepts, gotchas that affect multiple files
- **Rules files** — behavioral patterns, workflow conventions, things agents keep getting wrong
- **Code comments** — local gotchas in specific functions where the next reader will be confused
- **Issue card YAML descriptions** — context that a fresh agent needs to pick up work (Edit the `description` field directly, or append a `comments[]` entry — the chokidar watcher mirrors the change to the DB; the post-completion auto-sync pushes to the tracker)

**Skip it if** it's one-off implementation detail, obvious from reading the code, or would add noise without preventing real mistakes. Too many rules degrade behavior — each rule competes for attention. A rule that saves 5 minutes once but gets read 100 times is net negative.

**The test:** "If a fresh agent starts tomorrow with zero context, would this documentation prevent a real mistake or save meaningful time?" If yes, document it. If no, let it go.

---

## Part 3: Recommended Next Actions

**End every session with a numbered action list.** The user should be able to glance at this and know exactly what to do next, in priority order. This is the last thing the user sees before closing the session.

### How to build the list

Walk through these sources in order. Each produces zero or more actions:

1. **Documentation from Undocumented Knowledge** — ALWAYS first. For each item from Part 2's Undocumented Knowledge that passes the "fresh agent" test, create an action: "Document X in Y" with the specific file and what to write. This is the highest priority because undocumented knowledge is destroyed when this session ends. Everything else on this list can be rediscovered; knowledge cannot.
2. **Incomplete phases on the active issue card** — if an `ISS-N` is assigned and has unchecked items in `phases[]` or `ac[]`, the next unchecked one is the top action
3. **Issue cards spawned during this session** — Action Items spawns, epic phase cards, bug cards — list their `ISS-N` ids
4. **Blockers requiring user action** — things only the human can do (restart a service, approve a publish, test in browser, make a business decision)
5. **New issue cards to spawn** — problems observed that warrant a card but weren't created (because the agent doesn't spawn cards for observations — the user decides)

### Output format

```
## Recommended Next Actions

1. **[Action verb] [specific thing]** — [why, with link/path if relevant]
2. **[Action verb] [specific thing]** — [context]
3. ...
```

### Rules for the list

- **Actionable and specific.** "Fix the bug" is useless. "Run `npx vitest run` and verify all pass" is actionable.
- **Ordered by priority.** Most impactful or blocking action first.
- **Include commands/URLs/card links** where relevant so the user can act immediately.
- **Max 7 items.** If more than 7, group related items or defer low-priority ones.
- **Skip if truly nothing.** If the session completed all work with no loose ends, say "No actions needed — all work complete."

---

## Rules

- **Sparingly on Action Items.** Most sessions produce zero cards.
- **Thorough on knowledge dump.** Actually think about what you know. The session is about to be destroyed.
- **NEVER write files to `~/.claude/`** except rule files in `~/.claude/rules/`.
- **Action Items cards land as fresh `ISS-N` YAMLs** with `status: ToDo` — the human decides what to act on.
- **Knowledge dump is conversation output only** — no files, no commits, just tell the user.
- **NEVER call `mcp__trello__*` tools from agent path** — issue creation goes through `mcp__danx-issue__danx_issue_create`; the danxbot worker is the sole writer to the backend tracker.
