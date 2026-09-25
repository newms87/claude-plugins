---
name: prepare-for-compaction
description: 'Operationalizes plan-workflow''s zero-context rule into a mechanical checklist for the moment BEFORE a compaction. Load when: the operator asks to prepare for/wrap up before compaction; context is visibly running low and work is unfinished; handing off a session; about to stop with sub-agents still dispatched or a dirty tree. Does not cover ongoing plan hygiene (danxbot:plan-workflow) or git safety (dev:git-discipline).'
---

# Prepare for Compaction

A compaction is not a save point. `danxbot:plan-workflow`'s zero-context rule states the
principle — "session wiped now, would a new agent miss anything? write it first." This skill is
the procedure for actually doing that (SG-713). Every step below exists because skipping it
produced a real, observed failure — not because it sounds thorough.

## What compaction actually does — and does not do

Get this right before writing anything, because two of these are load-bearing and non-obvious:

| It DOES | It does NOT |
|---|---|
| Wipes the model's context, replaced by a summary | Stop running sub-agents — see below |
| Truncates skill bodies in place into convincing-looking fragments (`base`'s `compaction-skill-reload.sh` exists solely to force a re-`Skill()` call after) | Touch the working tree, staged/unstaged/untracked state |
| Re-injects the operating contract's four principles via `base/scripts/operating-contract.sh` on `SessionStart` with no matcher, so it fires on `compact` too | Undo any commit, push, dispatch, or API call already made |
| Re-fires `SessionStart` with `matcher: "compact"` — the only hook point whose stdout still reaches the model after a compaction | Preserve YOUR reasoning about *why* something is in flight — only what got written down survives |

**Sub-agents keep running through a compaction.** A background `Agent()` spawn is a real
process the harness tracks independently of your context — `base:sub-agent-delegation` already
documents this for the general case. Preparing as though compaction pauses your dispatched
agents means you either falsely tell the operator "everything stopped" or — worse — stop agents
that didn't need stopping. **Before writing the handoff, know which of your dispatches are
still alive** and say so explicitly; don't assume either state.

**Nothing injects "compaction is imminent" into context ahead of time.** A `PreCompact` hook
fires before compaction, but — like `PostCompact` — its stdout never reaches the model (see the
`SessionStart`/`compact` row above for the one event that does). This skill has to be invoked
deliberately: by the operator asking, or by your own judgment that context is running low with
unfinished work.

## The procedure

Run these in order.

### 1. Capture the tree NOW, don't remember it

`git status` + `git diff --stat`, every modified/untracked path, right before you start writing
anything down. Do not reconstruct it from memory of what you edited — write down what the
command says, verbatim.

**Why this order matters (SG-713):** a handoff can describe work as uncommitted when it was
already committed by the time it's read — the tree changes while you're writing. Capture, write,
then re-verify (step 8) before you call it done.

### 2. Attribute interleaved work per card, not per tree

A shared working tree with two-plus agents active produces ONE `git status` covering multiple
cards' work. List every changed file and say which card owns it — do not hand a later session
a diffstat and let it guess (SG-709/SG-711). Name each file's owning card explicitly, including
files that belong to a DIFFERENT card than the one you're handing off — without that, the
natural next move (commit everything dirty) merges two unrelated, unreviewed changesets into
one commit.

### 3. Resolve a stopped agent's uncommitted work by COMMITTING it — never discarding it

If an agent was stopped mid-task and left uncommitted changes that are off-plan, unwanted right
now, or breaking tests, the working tree still cannot be thrown away.
`git checkout --`/`restore`/`reset --hard`/`clean` on someone else's uncommitted work is
forbidden outright (`dev:git-discipline`) — this isn't a compaction-specific carve-out, and
compaction pressure is not an exception to it.

**The sanctioned pattern (SG-439):**

1. Commit the work as an explicit WIP, titled so nobody mistakes it for finished:
   `wip(<CARD-ID>): <what, incomplete> — DO NOT SHIP AS-IS`. Body states what it is, why it's
   real, and exactly what's missing.
2. Revert it FORWARD in the very next commit — never `git reset` — so `main` doesn't carry
   failing tests while the WIP is incomplete. Body explains what's still broken and why the
   failure is pre-existing, not caused by the WIP.
3. Save a patch of the WIP diff to the repo's scratch convention (e.g.
   `.junk/<plan>/<card>-wip-<desc>.patch`) so it can be reapplied without archaeology.
4. Record all three references on the card: the WIP commit SHA, the revert commit SHA, and the
   patch path, plus what's left to finish.

### 4. Sweep stale "In Progress" claims

A card claimed by a session that's about to compact away (or already gone) and not actually
being worked is worse than an unclaimed one — it hides from anyone scanning for work and makes
the in-flight count lie.

Fix is one call: `issue_transition({action: "rollback_pickup", keep_assignment: true})`
(documented in `danxbot:plan-workflow` → "Card state always true"; this step says to actually
run the sweep as part of compaction prep, not only when someone notices — SG-483).
`keep_assignment: true` returns the card to
ToDo without erasing who was holding it or implying judgment about the work — it makes the
board tell the truth, nothing more.

### 5. Every outstanding requirement lands on the card — especially the ones given live

If the operator stated a requirement out loud, in chat, with a screenshot, and it exists nowhere
else, it is one compaction away from being gone. These are the highest-risk items in the whole
procedure because there is no fallback source to recover them from — unlike code, which survives
in the tree regardless of what you write down.

Write each one onto its card's description or as a comment, in the operator's own priority
order if they gave one, and distinguish:

- **Done** — and how you know (a command, a screenshot, a read-back).
- **Partially done, in what state** — "in progress" alone is not a handover; say what's
  finished, what's started-but-not-verified, and what hasn't been touched.
- **Never started.**

### 6. Route every durable fact by its actual durability — don't restate the rules, follow them

`danxbot:plan-workflow` already owns the shape, the size limits, and the "Where things go"
routing table — this skill doesn't repeat them, it just says: before compaction, make sure
everything that needs one of those homes (goal/rule/caveat record, plan note, card comment, or
Task-card-plus-problem) actually has one.

Getting the API shape wrong here costs real turns — `plan-workflow` already documents that
comments take `text` not `body`, records take `{kind, body, context}` not `statement`. Don't
rediscover it by trial and error a second time; read that skill's "Records" and "Plan notes"
sections first.

### 7. Two dashboard-API gotchas that read as facts about the board, not the request

Only relevant when working the `danx_dashboard` HTTP API directly (e.g. the MCP server is down
and you're using the token-based fallback) — but both are silent:

- **`GET /api/issues/<id>` omits `description`, `comments`, and the checklist unless you pass
  `?fields=description`.** Nothing in the response says a body was withheld — a carefully
  written card reads as blank, several times smaller than the real one. `?include=description`
  and `?full=1` also return *something*, but smaller — not equivalent; use `?fields=`.
- **`GET /api/plans/<id>?fields=cards` returns `cards: []`** for a plan that genuinely has cards
  attached — they live at the `/api/plans/<id>/cards` sub-resource, not inline on the plan
  object. A zero-context session reading this without knowing that will conclude the plan is
  empty and either recreate work or search the wrong place for it.

Both fail exactly the same way: the tool looks authoritative and the wrong answer looks like a
fact about the world instead of a fact about the query. If you hit either, note it on the plan as
a `caveat` record (not just here) so the specific plan's own future sessions inherit it too.

### 8. Re-verify immediately before declaring ready — this is not optional, it is the step

Everything captured in step 1 can be stale by step 6. Before telling the operator (or the
session log) "ready for compaction": re-run `git status`, re-read back every card you just wrote
to, and confirm the sub-agent liveness claim in the "what compaction does not do" section above
is still true. Anything written more than roughly a minute earlier may already be false — this
is exactly the failure step 1 names, and it recurs unless you close the loop.

### 9. Say plainly, in the handoff itself, what compaction does and does not affect

Don't assume the next session (or the operator, reading later) knows this. One or two sentences:
context is being cleared and replaced with a summary; the working tree, any commits/pushes, and
any dispatched sub-agents are untouched and continue exactly as they were.

## Non-goals

This skill does not own: plan record/note/card mechanics, hash-guarded writes, the "keep 3 in
flight" dispatch rule, or live-event handling — all `danxbot:plan-workflow`. It does not own git
safety (forbidden destructive ops, branch discipline) — `dev:git-discipline`. It does not own
how to phrase the handoff prose — `base:convey`'s scaffold applies to the card comment/description
you write in steps 3-5. This skill is the ordered checklist that ties those together at exactly
one moment: right before a compaction.
