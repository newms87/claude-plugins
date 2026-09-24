---
name: issue-blocker
description: 'Gating checklist for stamping blocked:{at,reason} on a card, and for escalating to a human via an open problem: false-blocker audit, forbidden git ops, programmatic substitute, root-cause trace.'
audience: worker
---

# Issue Blocker — MANDATORY Pre-Block Gate

You are about to stamp the `blocked` dispatch gate on a card. STOP. Blocked
is a dispatch gate (`blocked: {at, reason}` on the card record, which
`deriveStatus` rule 3 projects to status `Blocked` on every read) — NOT a
column to drag the card into, and NOT a literal `status: "Blocked"` write
(direct status writes are FORBIDDEN). The card stays in whatever column
its lifecycle triggers projected it into; the picker skips dispatch via
the gate, not the column.

**Blocked is a hold, not an escalation (DX-2735/DX-2830).** It stops
auto-dispatch and halts work on the card until the blocker is resolved. It
does NOT mean a human is needed, and it never puts the card in front of the
operator — a card needs a human exactly when it has an **open problem**
(`open_problem_count > 0`, computed automatically; there is no separate flag
to set). The agent doing the work can often resolve the blocker itself:
resolve it rather than escalate. When a blocker truly needs a human,
escalate by opening a problem (see "After all 8 items pass").

Most "blockers" are not real blockers — they are rationalizations of
avoidable work: pre-existing flaky tests an agent could file as Action
Items, "manual UI smoke" ACs an agent could replace with component
tests, post-terminal-save state an agent could verify via a unit test,
uncommitted diffs an agent should have ignored. Run this checklist
first. EVERY item must pass. If even one fails, you are NOT authorized
to stamp `blocked: {at, reason}` — return to in-session work, Action
Item creation, or AC rewrite per the path the failed item names. The
cost of one false Blocked move exceeds the cost of running this 8-item
checklist.

## Field selection — `blocked` vs an open problem vs `waiting_on` vs `conflict_on[]`

**Three orthogonal dispatch gates, plus a fourth computed one. ALL may
coexist on one card simultaneously — by design.** Each models a different
real-world reason a card cannot dispatch right now, each is cleared by a
different actor / event, and the picker AND-s them: a card dispatches only
when every gate is clear. Picking the wrong field for a given cause is the
workflow violation — NOT setting more than one. `blocked` is NOT the
generic "stop dispatch" verb, and an open problem is NOT a substitute for
resolving a hold you can resolve yourself.

| symptom | correct mechanism | cleared by |
|---|---|---|
| The card must not auto-dispatch until a blocker is resolved, and an agent (this one, or the next dispatch) can resolve it (a card-specific tool failure the next dispatch re-checks, a hold with a named release condition) | `blocked: {at, reason}` (derives status → `Blocked` via `deriveStatus` rule 3) | Whoever resolves the blocker — often the next agent — via `issue_transition({action: 'unblock'})`. Answering a problem never clears it. |
| A human must *decide or supply information* the agent cannot derive (a design call only the operator can make, scope or authority, a spec only the operator can settle) OR *take external action on a system the agent has zero programmatic reach into* (3rd-party token rotation, vendor dashboard click-through, manual deploy of external infra, restart of infrastructure the agent cannot launch) | Open a problem — `issue_problem({id, action: 'add', statement, solutions[]})` — the ONLY way a card reaches the operator | The operator answers it in the dashboard. Answering the LAST open problem is what makes the card stop needing a human — automatic, nothing else to clear. The operator can also remove the problem directly. |
| This card waits for ONE+ specific other card(s) to terminate (semantic dep declared up-front on the card — phase sibling, action-item card, separately-scoped task) | `waiting_on: {reason, by: [ISS-N, ...], timestamp}` | Picker auto-dispatches the moment every id in `by[]` reaches Done/Cancelled. The `waiting_on` record itself stays as durable dep-history note. |
| File-overlap / in-flight race with sibling card(s) detected by the Dependency PRE quality gate (DX-1180) | `conflict_on: [{id, reason}, ...]` | Re-derived each dispatch from partner CURRENT status; partner leaving In Progress clears the gate (edge stays set — DX-810) |

### Coexistence is the normal case, not the rare case

These fields each model an independent real-world cause. A card can — and
frequently SHOULD — carry more than one at once. Example timeline:

```
T0: card written w/ several gates set
    waiting_on  = [prev-phase]      (deps not shipped)
    conflict_on = [sibling]         (file overlap detected by prep)
    blocked     = "codegen tool crashes on this schema; next dispatch re-checks"
    open problems:
      P1 "Which cache key shape?" (solutions A / B, one recommended)
      P2 "Rotate the Stripe key" (no solutions, free-form answer)

T1: prep dispatch re-runs → sibling terminated → conflict_on cleared
T2: previous phase ships → waiting_on auto-cleared by picker on next tick
T3: operator answers P1 → card STILL needs a human (P2 still open)
T4: operator rotates the key + answers P2 → no open problems left →
    card no longer needs a human (computed, nothing to clear)
T5: blocked is still set (answering a problem never clears it) → the agent
    that resolves the tool crash calls unblock
T6: every gate clear → picker dispatches
```

At T0 the card had every gate set; each clears independently, on its own
flow. One card can carry several problems; it needs a human until every
open one is answered.

### Routing — pick the mechanism, not "the dispatch gate I remember"

| You catch yourself thinking … | Right mechanism | NOT |
|---|---|---|
| "Operator must run `make launch-worker-host` / restart the worker / re-deploy / run command X on host" (and the agent genuinely cannot run it) | `issue_problem` add naming the action, with the exact steps in a solution's `body` | `blocked` alone — a blocked card never reaches the operator, so nobody runs the command |
| "I need a design decision before I can pick between architectures A and B" (and only the operator can make it) | `issue_problem` add with solutions A and B (exactly one `recommended`) | `blocked` + the question in a comment — nobody reviewing open problems ever sees it |
| "Something is broken that I (or the next dispatch) can fix, but this card must not dispatch until then" | `blocked` (hold) — resolve it, then `unblock` | An open problem — the operator is not the resolver |
| "Phase 4 needs Phase 3's migration to ship first" | `waiting_on: {by: ["<phase-3>"]}` | `status: Blocked` — that parks the card behind an operator gate nobody will ever clear |
| "Sibling card is editing the same file in-flight; prep flagged it" | `conflict_on: [{id: "<sibling>", reason}]` | `waiting_on` — `waiting_on` is durable, declared up-front; `conflict_on` is dispatch-time race detection |
| "The required work belongs to a DIFFERENT repo that danxbot runs as a board" | **DELEGATE** (DX-1368) — `issue_create({board: '<repo>:<slug>'})` + `depends_on(this→new)` + a `## Delegated → <id>` marker comment (see `danx-next` Step 10 delegate branch); set NONE of the gates above, the `depends_on` gate holds + auto-clears | `status: Blocked` — block ONLY when the target repo has NO danxbot board (operator-only repo, e.g. the plugin marketplace repo) |
| "Another agent's uncommitted diff broke my test" | Neither — interruption, not blocker. Note in `comments[]`, proceed with what you can verify. | Any of the above |

### Wrong-mechanism consequences

- `blocked` for a cause only a human can resolve (decision OR external action) → the card is held and never reaches the operator; nobody answers; it rots.
- `blocked` for a sibling-wait → never auto-dispatches; nobody will clear it; rots forever.
- `waiting_on` for an operator-needed action → silently dispatches the moment the named card terminates, without the human action having happened.
- Opening a problem for a blocker the agent can resolve → spends operator attention on work an agent could do.
- Escalating in a comment instead of a problem → a comment is not visible in the operator's needs-a-human view; nobody sees it.

If you're about to stamp `blocked: {at, reason}` because "this can't dispatch
right now," check the table above FIRST. If the right mechanism is an open
problem or `waiting_on` or `conflict_on[]`, use that — and use it INSTEAD OF
stamping `blocked` (don't reach for `blocked.at` just because Blocked is the
gate name you remember). Multiple causes → set multiple gates. The picker
handles the rest.

## The Checklist — every item MUST pass

Create a TodoWrite todo for each item. Mark each `in_progress` while
auditing, `completed` only after writing the verification answer in
your reasoning. If any item ends `failed`, abandon the Blocked move
and follow the named recovery path.

### 1. Can you resolve the blocker yourself?

A real blocker cannot be resolved inside this dispatch. Either a later
agent resolves it (a card-specific tool failure), or only a human can:
rotate a credential, push a secret to SSM, write to a repo I cannot
access, make a design decision that changes the goal of the card.

- **PASS:** name, in one sentence, why it cannot be resolved in this
  dispatch AND who resolves it (a later agent, or a human). A human
  resolver must be something a human MUST do — not something I could do
  if I tried harder.
- **A human is genuinely the resolver** → blocking is not the
  escalation. A blocked card never reaches the operator. Finish the
  checklist, then take the escalation path in "After all 8 items pass".
- **FAIL paths:**
  - "Operator must decide" → if the decision is between an obviously
    correct option and an obviously wrong one (e.g. "revert silent
    fallback that breaks fail-loud test" vs "keep silent fallback"),
    DECIDE UNILATERALLY + document. That's not a human decision —
    that's an obvious choice with a paper trail.
  - "Operator must verify in the UI / log in / click" → see Pattern 2
    of `danx-no-false-blockers.md`. Use component test → playwright →
    rewrite AC.
  - "Operator must restart the worker / deploy / run X command" → not
    `issue_transition({action: 'block'})`. If the agent genuinely cannot
    run it, this is an *external action* on infra the agent cannot reach →
    open a problem naming the action (see Field selection table above). If
    the agent CAN run it, run it. See `danx-next/SKILL.md` Step 10
    forbidden-blocker list.

### 2. Is there an uncommitted working-tree diff involved?

Run `git status -s`. List every file with `M` / `??` status that you
did not personally write in this dispatch.

- **PASS:** zero such files in the path the blocker references.
- **FAIL — do NOT block:** another agent's diff is interfering.
  - Forbidden: `git stash`, `git checkout --`, `git restore`,
    `git reset`. Do NOT touch their work. Do NOT run gates that
    depend on the file being in a different state.
  - Resolution: note the conflict in a `comments[]` entry on this
    card. Proceed with what you CAN verify. If the blocker is
    LITERALLY "another agent's diff broke a test," your card is NOT
    blocked — it's interrupted. File a `comments[]` note + go back
    to your own ACs. The peer agent will commit + the diff resolves.

### 3. Did you "verify the failure pre-existed your changes"?

`git stash`-then-test-then-pop, `git checkout HEAD`, comparing against
parent SHA via stash, ANY workflow whose purpose is determining
whether a failure is your fault vs prior work.

- **PASS:** no, never did this. Zero value in the answer.
- **FAIL:** abandon the Blocked move. The act of stashing already
  violated `danx-no-false-blockers.md` Pattern 1's STRICTLY FORBIDDEN
  list. Recover: `git stash pop` if you stashed, document the
  violation in retro.bad, then re-evaluate WITHOUT pre-existence
  reasoning. Either YOUR code path produces the failure (option 2:
  fix in-session) or you can root-cause by READING the failing test
  + traced code (option 3: Action Item).

### 4. Did you trace the actual problem code path by reading?

Real root-cause analysis: read the failing test → read the code under
test → identify the line that produces the wrong behavior → name the
function / file / line.

- **PASS:** quote the file:line of the root cause + one-sentence
  explanation of WHY it fails. If the cause is a pre-existing bug in a
  module unrelated to your card, you have the data to file a
  high-quality Action Item card.
- **FAIL:** you don't actually know why the test fails. Stop. Read
  the test. Read the code under test. Trace until you can name the
  line. Without this you cannot file an Action Item card (it will be
  speculation, useless to the next agent), you cannot Block (you
  haven't proven it is unresolvable in this dispatch), and you cannot
  escalate (you haven't proven a human is needed).

### 5. Is there a programmatic substitute for the AC's literal wording?

Run through the substitutes in `danx-no-false-blockers.md`:
- **Manual UI smoke** → component test (`@vue/test-utils`) →
  playwright + dashboard token at `~/.config/danxbot/dashboard-token`
  → rewrite AC.
- **Post-terminal-save state** → unit test on the derivation function.
- **"Needs deploy" / "needs prod smoke"** → AC is mis-specified;
  rewrite to local-verify form.
- **Pre-existing flaky test** → Action Item card + check off
  (your changes pass).

- **PASS:** no substitute exists for this specific AC. Quote the AC +
  why each substitute fails.
- **FAIL:** use the substitute. Do NOT block.

### 6. Could you fix the underlying defect in 10–30 minutes?

Apply Step 1.5 of `danx-next/SKILL.md` literally. Read the smallest
fix that would make the AC pass. Estimate the time honestly.

- **PASS:** fix is genuinely multi-phase / cross-cutting / requires
  scoping a redesign. Quote the scope.
- **FAIL:** do it now. "Action item is fine" is not the answer when
  you could ship the fix in this dispatch.

### 7. Does the record name the resolving action with a verification command?

If you reach this point, write the `blocked.reason` — or, on the
escalation path, the problem `statement` plus each solution's `body` —
AS IF the resolver (the next agent, or the operator) will read it in 30
seconds and execute it. It MUST contain:
- One sentence naming the action that resolves the blocker.
- The exact command(s) the resolver runs.
- The exact verification command(s) the resolver runs to confirm the
  blocker is resolved.

- **PASS:** reason has all three.
- **FAIL:** the blocker is too vague to be actionable. That usually
  means it isn't a real blocker. Re-run items 1–6.

### 8. Are you about to use Blocked to dodge a test failure / AC?

Final sanity check. Read the AC list. Read your blocker reason. Are
you blocking because the blocker is ACTUALLY unresolvable in this
dispatch, or because a verification command failed and you don't want
to chase the root cause?

- **PASS:** ACTUALLY unresolvable here. You can name the resolver + the
  command they run. Item 7 passed.
- **FAIL:** you're using Blocked as an exit door. Go back to item 4
  (trace the failure) or item 6 (fix it).

## After all 8 items pass

Only then are you authorized to take ONE of the two paths below (Step 10 of `danx-next/SKILL.md`).

**Hold — a later agent resolves it (no human needed):**
1. Call `issue_transition({id, action: 'block', reason: <one sentence>})`. Server derives `Blocked` from `blocked.at` (rule 3). The response is the card; there is no reminder of any kind on block.
2. Append a comment via `issue_comment` with the `## Blocker self-audit` section.
3. Call `danxbot_complete({status: "failed", summary: "..."})`.

**Escalate — a human must decide or act:**
1. Call `issue_problem({id, action: 'add', statement, solutions})`:
   - `statement` — the question or flaw, one plain sentence.
   - `solutions[]` — one entry per viable option, each with `title`, `body`, `pro` and `con`.
     Exactly one entry has `recommended: true`. Put the concrete numbered actions the operator
     would run in the recommended solution's `body` — there is no separate `steps[]` field.
   - A single-solution problem is a valid approval question. Zero solutions is valid when only
     a free-form answer fits, such as "rotate the key and tell me when done".
   - Several independent questions = several problems. The card needs a human until every open
     problem is answered.
2. Append a comment via `issue_comment` with the `## Blocker self-audit` section.
3. Call `danxbot_complete({status: "complete", summary: "..."})`. There is nothing further to
   set — opening the problem IS the whole escalation; the card needs a human automatically for
   as long as `open_problem_count > 0`.

Do not ALSO block on the escalation path unless the card must stay held after the operator
answers. Answering a problem never clears `blocked`, so a blocked card stays held until someone
calls `unblock`.

Quote the 8 PASS results into a `## Blocker self-audit` section of the comment so the resolver can audit your reasoning. If you cannot quote 8 PASS results, you have not earned either move.

## Forbidden patterns this skill catches

| Pattern | Why it's forbidden | Recovery |
|---|---|---|
| "Operator must decide revert vs keep silent-fallback" | Item 1 — silent-fallback violates `dev:code-quality`; the choice is obvious. Decide unilaterally. | Apply the obvious-correct option, document, ship. |
| "I stashed the diff to verify pre-existence" | Item 3 — stashing is STRICTLY FORBIDDEN. | Pop the stash, abandon pre-existence reasoning, root-cause via reading. |
| "Operator must run UI smoke / log in" | Item 5 — programmatic substitute exists. | Component test → playwright → rewrite AC. |
| "Operator must launch / restart / re-deploy infra the agent cannot reach (worker, container, vendor portal)" | Wrong mechanism, not wrong card state. External action → an open problem, NOT `blocked`. | `issue_problem` add naming the action, with the exact command in the recommended solution's `body`; call `danxbot_complete({status: "complete", summary: "Opened a problem — see problems"})`. |
| "I blocked the card and wrote my question in a comment" | A blocked card never reaches the operator — nobody sees the question. | `issue_problem` add (question as `statement`, options as `solutions[]`, one recommended). |
| "Card already has `waiting_on` set; I'm about to ALSO flip status to Blocked because something new came up" | Coexistence is fine, but pick the right mechanism for the new cause. New cause = agent-resolvable hold → `blocked`. Needs a human → another problem (a card can carry several). Sibling-wait → extend `waiting_on.by[]`. | Don't replace existing gates; add the right new one. All may coexist. |
| "Git env failed (`git fetch` errored, rebase conflict mid-prep, worktree wedged)" | DX-758 — git env is the agent's sole authority. The worker no longer pre-flights env; `agents.<name>.broken` is strikes-only. A genuine unreconcilable conflict routes via `danxbot_complete({status: "failed", summary: "<≥30-char reason naming the conflicting file/region>"})`. Vague "env wedged" without the named region → not a blocker; resolve in-session file by file. | Read both sides of the conflict; resolve in place; only escalate when a specific region is genuinely unreconcilable. |
| "Auto-flip happens after I exit, can't verify" | Item 5 — unit-test the derivation function. | Rewrite AC to point at the unit test. |
| "Pre-existing flaky test fails the local-verify AC" | Item 1 + 5 — Action Item card + check off. | `issue_create`, push id, check AC, proceed. |
| "Another agent has uncommitted diff that breaks my test" | Item 2 — interruption, not blocker. | Note in comments[], proceed with what you can verify. |
