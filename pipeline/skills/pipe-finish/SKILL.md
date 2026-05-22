---
name: pipe-finish
description: 'Use (a) immediately after every `/pipe-commit` to produce a post-commit report + invoke the next pipeline step, AND (b) at session end to surface unwritten knowledge + spawn Action Items cards. Replaces the retired `/pipe-report` skill. All output sections follow the `convey` format (auto-loaded base skill) — concept-first headline, behavior-diff tables, ASCII flow, caveats, verify line.'
---

# Finish — post-commit reports AND end-of-session wrap

| Mode | When | Output |
|---|---|---|
| A — Post-commit | After every `/pipe-commit` | `convey`-format report (≤30 lines), then invoke next step |
| B — Final wrap | Session end / last phase | Action Items + knowledge dump + next actions (≤60 lines) |

All output follows `base:convey` scaffold (headline → goal → diff table → flow → caveats → verify).

## Mode A — Post-commit

1. `git show --stat HEAD` — sanity check.
2. Emit convey report:
   - Headline ≤12 words
   - Goal — one sentence
   - Behavior diff table (skip if trivial one-line commit)
   - Caveats — `- [ ]` for operator deploy/publish/restart
   - Verify — `cmd → ✅ N/N`
   - Skipped findings — list any validly-skipped pipe-quality findings
3. State next step as declarative fact, invoke without pausing.

### Next-step decision

| Situation | Action |
|---|---|
| More phases | Invoke `/next-phase` same response |
| Final phase | Recurse into Mode B same response |
| External blocker (human approval, API outage) | State blocker, stop |

### Forbidden — never ask permission for pipeline-mandated steps

`/next-phase` + Mode B are pre-approved by plan approval. Violations:
- "Let me know if you want…"
- "Say go and I'll…"
- "…want me to run X?"
- Any `?` on a pipeline step name

Correct: declarative + immediate invocation. User can interrupt.

## Mode B — Final wrap

### Hard skip — dispatched workers

**If `process.env.DANXBOT_DISPATCH_ID` is set, Mode B does NOT run.** Worker handles retro + Action Items spawn from `retro.action_item_ids[]` + file move automatically. Call `danxbot_complete`, emit nothing further.

Mode B = human-loop sessions only.

### Part 1 — Action Items

For each session issue, ask:
- Wasted >10 min?
- Human frustrated / corrected same mistake twice?
- Concrete fix exists (rule / tool / docs)?

If yes: call `mcp__danx-issue__danx_issue_create` directly.

**Categories** (frame `type` + description):
- Prompt/rules fix · New tool/skill · Skill improvement · Documentation · Code refactor · Better error messages

**Rules, not memory.** Corrections → rules files (`~/.claude/rules/` global or project). Helps any codebase → global, else project.

**Create args:**
- Required: `type` (`Bug` / `Feature`), `title`, `description` (what happened, why wasted time, proposed fix)
- Optional: `status` (default `ToDo`), `parent_id`, `children`, `ac`, `phases`, `comments`

Returns `{created: true, id, path, external_id}` or `{created: false, errors}`. On false, fix errors + recall.

**Apply small rule fixes directly** (1-10 lines) — no card. Commit rule changes separately: `[Rules] <desc>`, stage rule files only.

### Part 2 — Knowledge Dump

Walk: issue cards, code comments, rules, outstanding work, observations. Group by category, skip empty.

```
## Session Notes

### Outstanding
- ...
### Observations
- ...
### Undocumented Knowledge
- ...
```

Clean session → "Session complete. Nothing outstanding."

**Never:** repeat existing card/commit content · fabricate observations · create cards for observations · write files.

### Act on Undocumented Knowledge

Document it WHERE:
- **CLAUDE.md** — system behavior, cross-file gotchas
- **Rules** — behavioral patterns, recurring mistakes
- **Code comments** — local function gotchas
- **Issue YAML description / comments[]** — context fresh agent needs (chokidar mirrors, auto-sync pushes)

Skip if one-off, obvious, or noise. Each rule competes for attention.

**Test:** "Fresh agent tomorrow, zero context — would this prevent a real mistake?" Yes → document. No → drop.

### Part 3 — Recommended Next Actions

Last thing user sees. Build by walking these sources:

1. Documentation from Undocumented Knowledge — ALWAYS first (knowledge dies with session)
2. Incomplete phases on active card — next unchecked `phases[]`/`ac[]` item
3. Cards spawned this session — list `ISS-N` ids
4. Blockers needing human (restart, approve, browser test, business decision)
5. New cards to spawn (observed problems user should decide on)

```
## Recommended Next Actions

1. **[verb] [specific thing]** — [why + path/link]
2. ...
```

Rules: actionable + specific · priority order · include commands/URLs · max 7 · skip if nothing.

## Rules

- Sparingly on Action Items (most sessions = zero cards)
- Thorough on knowledge dump
- NEVER write to `~/.claude/` except `~/.claude/rules/`
- Action Items land as fresh `ISS-N` YAMLs `status: ToDo`
- Knowledge dump = conversation only, no files/commits
- NEVER call `mcp__trello__*` — use `mcp__danx-issue__danx_issue_create`
