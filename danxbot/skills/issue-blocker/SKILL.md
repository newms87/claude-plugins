---
name: issue-blocker
description: 'Gating checklist for stamping blocked:{at,reason} on a card: false-blocker audit, forbidden git ops, programmatic substitute, root-cause trace.'
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

Most "blockers" are not real blockers — they are rationalizations of
avoidable work. Run this
checklist first. EVERY item must pass. If even one fails, you are NOT
authorized to stamp `blocked: {at, reason}` — return to in-session work,
Action Item creation, or AC rewrite per the path the failed item names.

## Why this gate exists

Production has burned hundreds of dollars on cards parked in Blocked for
"reasons" that were programmatically resolvable: pre-existing flaky
tests an agent could file as Action Items, "manual UI smoke" ACs an
agent could replace with component tests, post-terminal-save state an
agent could verify via a unit test on the derivation function,
uncommitted diffs an agent should have ignored. Every one of those
re-dispatches the next agent into the same trap. The cost of one false
Blocked move > the cost of running this 8-item checklist.

## Field selection — `blocked` vs `waiting_on` vs `requires_human` vs `conflict_on[]`

**Four orthogonal dispatch gates. ALL FOUR may coexist on one card simultaneously — by design.** Each models a different real-world reason a card cannot dispatch right now, each is cleared by a different actor / event, and the picker AND-s them: card dispatches only when EVERY gate is null. Picking the wrong field for a given cause is the workflow violation — NOT setting more than one. `blocked` is NOT the generic "stop dispatch" verb.

| symptom | correct field | cleared by |
|---|---|---|
| Human must supply *information / a decision* the agent cannot derive (ambiguous spec, design call, write-only repo, missing input the agent could use if it had it) | `blocked: {at, reason}` (derives status → `Blocked` via `deriveStatus` rule 3) | Human (writes comment / opens card / next dispatch clears `blocked: null` — worker re-stamps `ready_at` + populates dispatch sidecar) |
| Human must take *external action on a system the agent has zero programmatic reach into* (3rd-party token rotation, vendor dashboard click-through, manual deploy of external infra, restart of infrastructure the agent cannot launch) | `requires_human: {reason, steps[], set_by, set_at}` | Human via dashboard "Mark Resolved" affordance (PATCHes field to `null`) |
| This card waits for ONE+ specific other card(s) to terminate (semantic dep declared up-front on the card — phase sibling, action-item card, separately-scoped task) | `waiting_on: {reason, by: [ISS-N, ...], timestamp}` | Picker auto-dispatches the moment every id in `by[]` reaches Done/Cancelled. The `waiting_on` record itself stays as durable dep-history note. |
| File-overlap / in-flight race with sibling card(s) detected by the Dependency PRE quality gate (DX-1180) | `conflict_on: [{id, reason}, ...]` | Re-derived each dispatch from partner CURRENT status; partner leaving In Progress clears the gate (edge stays set — DX-810) |

### Coexistence is the normal case, not the rare case

The four fields each model an independent real-world cause. A card can — and frequently SHOULD — carry more than one. Example timeline:

```
T0: card written w/ all 4 gates set
    waiting_on   = [prev-phase]      (deps not shipped)
    conflict_on  = [sibling]         (file overlap detected by prep)
    blocked      = "needs design call on cache key shape"
    requires_human = "needs Stripe key rotation"

T1: prep dispatch re-runs → sibling terminated → conflict_on cleared
T2: previous phase ships → waiting_on auto-cleared by picker on next tick
T3: operator answers design question via dashboard → next dispatch flips
    status back to ToDo + nulls blocked
T4: operator rotates Stripe key + clicks "Mark Resolved" → requires_human nulled
T5: all four gates null → picker dispatches
```

At T0 the card had ALL FOUR set; the four clearance events are independent + each handled by its own flow.

### Routing — pick the field, not "the dispatch gate I remember"

| You catch yourself thinking … | Right field | NOT |
|---|---|---|
| "Operator must run `make launch-worker-host` / restart the worker / re-deploy / run command X on host" | `requires_human` (external action on a system the agent cannot reach) | `status: Blocked` — that's for *information / decision* gaps; restarting infra is *external action* |
| "I need a design decision before I can pick between architectures A and B" | `status: Blocked` + `blocked` (information gap) | `requires_human` — operator types an answer, doesn't touch an external system |
| "Phase 4 needs Phase 3's migration to ship first" | `waiting_on: {by: ["<phase-3>"]}` | `status: Blocked` — that parks the card behind an operator gate nobody will ever clear |
| "Sibling card is editing the same file in-flight; prep flagged it" | `conflict_on: [{id: "<sibling>", reason}]` | `waiting_on` — `waiting_on` is durable, declared up-front; `conflict_on` is dispatch-time race detection |
| "The required work belongs to a DIFFERENT repo that danxbot runs as a board" | **DELEGATE** (DX-1368) — `issue_create({board: '<repo>:<slug>'})` + `depends_on(this→new)` + a `## Delegated → <id>` marker comment (see `danx-next` Step 10 delegate branch); set NONE of the four gates, the `depends_on` gate holds + auto-clears | `status: Blocked` — block ONLY when the target repo has NO danxbot board (operator-only repo, e.g. `~/web/claude-plugins`) |
| "Another agent's uncommitted diff broke my test" | Neither — interruption, not blocker. Note in `comments[]`, proceed with what you can verify. | Any of the above |

### Wrong-field consequences

- `status: Blocked` for an external-action cause → parked behind a hint operator may not see in their banner; dashboard's blocked card list and requires_human list are separate operator queues. External actions belong on the latter.
- `status: Blocked` for a sibling-wait → never auto-dispatches; nobody will clear it; rots forever.
- `waiting_on` for an operator-needed action → silently dispatches the moment the named card terminates, without the human action having happened.
- `requires_human` for an information gap → parks the card on the human-action queue when the unblock is a comment reply; operator scans the wrong queue.

If you're about to stamp `blocked: {at, reason}` because "this can't dispatch right now," check the table above FIRST. If the right field is `requires_human` or `waiting_on` or `conflict_on[]`, use that — and use it INSTEAD OF stamping `blocked` (don't reach for `blocked.at` just because Blocked is the gate name you remember). Multiple causes → set multiple fields. The picker handles the rest.

## The Checklist — every item MUST pass

Create a TodoWrite todo for each item. Mark each `in_progress` while
auditing, `completed` only after writing the verification answer in
your reasoning. If any item ends `failed`, abandon the Blocked move
and follow the named recovery path.

### 1. Is a HUMAN action the actual next step?

A real blocker has a specific human action that unblocks: rotate a
credential, push a secret to SSM, write to a repo I cannot access, make
a design decision that changes the goal of the card.

- **PASS:** name the human action in one sentence. The action must be
  something a human MUST do — not something I could do if I tried
  harder.
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
    `issue_transition({action: 'block'})`. This is an *external action* on infra the agent
    cannot reach → use `issue_requires_human` (see Field selection table
    above). Distinct from Blocked (= human supplies *information*).
    See `danx-next/SKILL.md` Step 10 forbidden-blocker list.

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
  speculation, useless to the next agent) and you cannot Block (you
  haven't proven a human is needed).

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

### 7. Does the Blocked record name a HUMAN action with a verification command?

If you reach this point, write the `blocked.reason` AS IF a human will
read it in 30 seconds and execute it. The reason MUST contain:
- One sentence naming the human action.
- The exact command(s) the human runs to unblock.
- The exact verification command(s) the human runs to confirm the
  unblock worked.

- **PASS:** reason has all three.
- **FAIL:** the blocker is too vague to be actionable. That usually
  means it isn't a real blocker. Re-run items 1–6.

### 8. Are you about to use Blocked to dodge a test failure / AC?

Final sanity check. Read the AC list. Read your blocker reason. Are
you blocking because the work is ACTUALLY impossible without a human,
or because a verification command failed and you don't want to chase
the root cause?

- **PASS:** ACTUALLY impossible. You can name the human action + the
  command they run. Item 7 passed.
- **FAIL:** you're using Blocked as an exit door. Go back to item 4
  (trace the failure) or item 6 (fix it).

## After all 8 items pass

Only then are you authorized to:
1. Call `issue_transition({id, action: 'block', reason: <one sentence>})` per Step 10 of `danx-next/SKILL.md`. Server derives `Blocked` from `blocked.at` (rule 3).
2. Append a comment via `issue_comment` with the `## Blocker self-audit` section so the operator can audit your reasoning.
3. Call `danxbot_complete({status: "failed", summary: "..."})`.

Quote the 8 PASS results into a `## Blocker self-audit` section of the comment so the operator can audit your reasoning. If you cannot quote 8 PASS results, you have not earned the Blocked move.

## Forbidden patterns this skill catches

| Pattern | Why it's forbidden | Recovery |
|---|---|---|
| "Operator must decide revert vs keep silent-fallback" | Item 1 — silent-fallback violates `dev:code-quality`; the choice is obvious. Decide unilaterally. | Apply the obvious-correct option, document, ship. |
| "I stashed the diff to verify pre-existence" | Item 3 — stashing is STRICTLY FORBIDDEN. | Pop the stash, abandon pre-existence reasoning, root-cause via reading. |
| "Operator must run UI smoke / log in" | Item 5 — programmatic substitute exists. | Component test → playwright → rewrite AC. |
| "Operator must launch / restart / re-deploy infra the agent cannot reach (worker, container, vendor portal)" | Wrong FIELD, not wrong card state. External action → `requires_human`, NOT `status: Blocked`. | Set `requires_human: {reason, steps[], set_by: agent, set_at}` with the exact command; call `danxbot_complete({status: "complete", summary: "Set requires_human"})`. |
| "Card already has `waiting_on` set; I'm about to ALSO flip status to Blocked because something new came up" | Coexistence is fine, but pick the right field for the new cause. New cause = info gap → `blocked` + status Blocked. External action → `requires_human`. Sibling-wait → extend `waiting_on.by[]`. | Don't replace existing gates; add the right new one. All 4 may coexist. |
| "Git env failed (`git fetch` errored, rebase conflict mid-prep, worktree wedged)" | DX-758 — git env is the agent's sole authority. The worker no longer pre-flights env; `agents.<name>.broken` is strikes-only. A genuine unreconcilable conflict routes via `danxbot_complete({status: "failed", summary: "<≥30-char reason naming the conflicting file/region>"})`. Vague "env wedged" without the named region → not a blocker; resolve in-session file by file. | Read both sides of the conflict; resolve in place; only escalate when a specific region is genuinely unreconcilable. |
| "Auto-flip happens after I exit, can't verify" | Item 5 — unit-test the derivation function. | Rewrite AC to point at the unit test. |
| "Pre-existing flaky test fails the local-verify AC" | Item 1 + 5 — Action Item card + check off. | `danx_issue_create`, push id, check AC, proceed. |
| "Another agent has uncommitted diff that breaks my test" | Item 2 — interruption, not blocker. | Note in comments[], proceed with what you can verify. |
