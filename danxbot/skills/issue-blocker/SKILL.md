---
name: issue-blocker
description: 'The whole blocked-card lifecycle: the false-blocker audit before you touch blocked/problem/waiting_on, which mechanism to use, and how to write the report that unblocks it. Covers block vs problem vs dependency, forbidden destructive git ops, and the operator playbook for a stuck card.'
audience: worker
---

# Issue Blocker — the whole blocked-card lifecycle

`blocked: {at, reason}` is a dispatch GATE, not a status column and not an
escalation (DX-2735/DX-2830). `deriveStatus` rule 3 projects it to `Blocked`
on every read; there is no direct `status: "Blocked"` write. It stops
auto-dispatch — nothing more. It does NOT put the card in front of a human:
a card needs a human exactly when it has an **open problem**
(`open_problem_count > 0`, computed automatically, no separate flag). The
agent doing the work can often resolve the blocker itself — resolve it
rather than escalate.

Most "blockers" are rationalizations of avoidable work. This skill has two
parts: **Part A** — the audit you run BEFORE stamping `blocked` or opening a
problem, so you don't file a false one. **Part B** — what to do when you
encounter a card someone else already marked `Blocked` (or holding
`waiting_on`), including the report that hands it to the operator.

## Part A — Is this a real blocker?

### The 8-item pre-block checklist

Create a TodoWrite todo per item. Mark `in_progress` while auditing,
`completed` only after writing the verification answer in your reasoning.
Any item ends `failed` → abandon the Blocked/problem move and follow its
recovery path. The cost of one false Blocked move exceeds the cost of
running this checklist.

**1. Can you resolve the blocker yourself?** A real blocker cannot be
resolved inside this dispatch — either a later agent resolves it (a
card-specific tool failure), or only a human can (rotate a credential, push
a secret to SSM, write to a repo you cannot access, make a design decision
that changes the card's goal).
- PASS: name, in one sentence, why it cannot be resolved here AND who
  resolves it.
- FAIL: "Operator must decide" between an obviously correct and an
  obviously wrong option → decide unilaterally + document, that's not a
  human decision. "Operator must verify in the UI / log in / click" → see
  item 5's manual-smoke substitute. "Operator must restart the worker /
  deploy / run X" → if you genuinely cannot run it, that's an external
  action on infra you cannot reach → open an action problem (Field
  selection below); if you CAN run it, run it.

**2. Is there an uncommitted working-tree diff involved?** Run `git status
-s`. List every `M`/`??` file you did not personally write this dispatch.
- PASS: zero such files in the path the blocker references.
- FAIL — do NOT block: another agent's diff is interfering. Do not touch
  it (forbidden ops below). Note the conflict in `comments[]` and proceed
  with what you CAN verify — this is an interruption, not a blocker.

**3. Did you "verify the failure pre-existed your changes"?** Stash-then-
test-then-pop, `git checkout HEAD`, comparing against parent SHA — any
workflow whose purpose is proving a failure isn't your fault.
- PASS: never did this. There is zero value in the answer — the suite
  either passes for YOUR changes (fix in-session) or it does not (item 2
  interruption, or item 4 root-cause).
- FAIL: the act of stashing already violated the forbidden-ops list below.
  Recover: `git stash pop` if you stashed, document the violation in
  `retro.bad`, re-evaluate without pre-existence reasoning.

**4. Did you trace the actual problem code path by reading?** Read the
failing test → read the code under test → name the file:line that produces
the wrong behavior.
- PASS: quote the file:line + one-sentence why. Gives you the data to file
  a high-quality Action Item card if the cause is pre-existing and
  unrelated.
- FAIL: you don't know why it fails. Read until you can name the line —
  without this you can't file an Action Item (speculation), can't block
  (unproven unresolvable), can't escalate (unproven human-needed).

**5. Is there a programmatic substitute for the AC's literal wording?**
Three recurring cases, cheapest first:
- **Manual UI smoke** ("operator clicks X, sees Y") — the AC's intent is
  "the rendered UI shows the new state," not a human eyeball. Mount the
  component with fixture data (`@testing-library/react`, `cd frontend &&
  npx vitest run` — the Vue `dashboard/` app is frozen, target `frontend/`)
  and assert the DOM; e.g. `render(<AgentBadge name="Dan"/>);
  expect(screen.getByText("D")).toBeInTheDocument()`. Reach for Playwright
  only when a component test can't reach it. If neither works, the AC is
  mis-specified — rewrite its title to the programmatic gate you CAN run
  and note the rewrite in `comments[]`.
- **Post-terminal-save / self-derived state** ("after Done, the parent
  auto-flips," "the DB is updated by the server after I save") — never
  verifiable from inside the dispatch that triggers it. Identify the
  function that performs the derivation (e.g.
  `deriveContainerStatus`), confirm/write a unit test exercising it
  directly with fixture inputs, rewrite the AC to point at that test.
- **Pre-existing flaky test unrelated to your card, root-caused by
  reading (never by stashing), too involved to fix in 30 min** — file an
  Action Item (`issue_create({type:"Bug", ...})`), push the id into
  `retro.action_item_ids[]`, check off your card's AC (your changes pass).
- PASS: no substitute exists for this specific AC — quote the AC + why
  each fails. FAIL: use the substitute, do not block.

**6. Could you fix the underlying defect in 10–30 minutes?** Read the
smallest fix that would make the AC pass; estimate honestly.
- PASS: genuinely multi-phase / cross-cutting — quote the scope.
- FAIL: do it now. "Action item is fine" is not the answer when you could
  ship the fix in this dispatch.

**7. Does the record name the resolving action with a verification
command?** Write `blocked.reason` — or, on the escalation path, the
problem `statement` + each solution's `body` — as if the resolver will read
it in 30 seconds and execute it. It MUST contain: the action that resolves
it, the exact command(s) to run, the exact command(s) to verify resolution.
- FAIL: too vague to be actionable — that usually means it isn't real.
  Re-run items 1–6.

**8. Are you about to use Blocked to dodge a test failure / AC?** Read the
AC list and your blocker reason. Actually unresolvable here, or just don't
want to chase the root cause?
- PASS: actually unresolvable, you can name the resolver + command, item 7
  passed. FAIL: go back to item 4 or item 6.

### Forbidden destructive git ops (stated once)

Against working-tree state you did not personally write this dispatch:
`git stash`, `git checkout --` / `git restore`, `git reset --hard`, `git
clean`. Full ban lives in `dev:git-discipline`; this list exists here only
because items 2–3 above depend on it. Never use any of these to "check"
whether a failure pre-existed your changes — there is zero value in that
answer (item 3).

### Field selection — `blocked` vs an open problem vs `waiting_on` vs `conflict_on[]`

**Three orthogonal dispatch gates, plus a fourth computed one. ALL may
coexist on one card simultaneously — by design.** Each models a different
real-world cause, each is cleared by a different actor/event, and the
picker AND-s them: a card dispatches only when every gate is clear. Picking
the wrong field is the violation — not setting more than one.

| symptom | correct mechanism | cleared by |
|---|---|---|
| Card must not auto-dispatch until resolved, and an agent (this one or the next) can resolve it | `blocked: {at, reason}` — a gate, not a `deriveStatus` rule | Whoever resolves it, via `issue_transition({action:'unblock'})`. Answering a problem never clears it. |
| A human must *decide* something the agent cannot derive | Open a problem, `type:"question"` (default) | Operator answers in the dashboard, or removes the problem. |
| A human must *take external action* the agent has zero programmatic reach into (3rd-party token rotation, vendor click-through, host restart) | Open a problem, `type:"action"` — `summary` REQUIRED, saying why it's needed and why you can't do it | Same as above. |
| Card waits for specific other card(s) to terminate | `waiting_on: {reason, by:[ISS-N,...], timestamp}` | Picker auto-dispatches once every id in `by[]` reaches Done/Cancelled. |
| File-overlap / in-flight race, detected by the Dependency PRE gate | `conflict_on: [{id, reason}, ...]` | Re-derived each dispatch from partner's current status. |
| Work belongs to a DIFFERENT repo danxbot runs as a board | **Delegate** — `issue_create({board:'<repo>:<slug>'})` + `depends_on` + a `## Delegated → <id>` comment; none of the gates above | The `depends_on` gate holds + auto-clears. |

### Question versus action — decide before you file (DX-3313)

Before opening a problem, apply the test: **could I do this myself if I tried
harder, and is the only thing missing a decision?** Yes → `type: "question"`
(default). No — the blocker is access, credentials, hardware, a human's
authority, or a system genuinely out of reach → `type: "action"`.

| | Question | Action |
|---|---|---|
| `statement` | the question, one plain sentence | what is to be done — the deed itself, never phrased as a question |
| `summary` | optional, why it matters | **REQUIRED** — why it is needed, and why you cannot do it yourself (an action `add` with no summary is refused 400) |
| `solutions[]` | candidate answers, each with its own pro/con | the possible routes, each carrying its own steps |
| Ends when | a decision is recorded | the steps are actually done |

The why-I-cannot-do-this-myself sentence in `summary` is REQUIRED for an
action — it is the sentence that stops the operator reading your escalation
as laziness. Full parameter contract → `issue_problem`'s own `type` and
`summary` descriptions.

### Routing — pick the mechanism, not "the gate name I remember"

| You catch yourself thinking … | Right mechanism | NOT |
|---|---|---|
| "Operator must run a command on host and genuinely cannot be me" | `issue_problem` add naming the action + exact steps in a solution's `body` | `blocked` alone — nobody reaching the operator |
| "I need a design decision between A and B" | `issue_problem` add, solutions A/B, one `recommended` | `blocked` + the question in a comment — nobody sees it |
| "Something's broken that I (or the next dispatch) can fix, but the card must not dispatch until then" | `blocked` (hold), then `unblock` when resolved | An open problem — the operator is not the resolver |
| "Phase 4 needs Phase 3's migration to ship first" | `waiting_on: {by:["<phase-3>"]}` | `blocked` — parks it behind a gate nobody clears |
| "Sibling card editing the same file in-flight" | `conflict_on: [{id, reason}]` | `waiting_on` — that's durable/declared-up-front, this is dispatch-time race detection |
| "Another agent's uncommitted diff broke my test" | Neither — note in `comments[]`, proceed with what you can verify | Any of the above |

Coexistence is normal: a card can carry `waiting_on` + `conflict_on` +
`blocked` + several open problems at once, each clearing independently on
its own event. `waiting_on` used for an operator-needed action silently
dispatches once the named card terminates, without the action ever
happening — check the table before reaching for the gate name you
remember.

### After all 8 items pass

**Hold — a later agent resolves it, no human needed:**
1. `issue_transition({id, action:'block', reason: <one sentence>})`.
2. Comment via `issue_comment` with a `## Blocker self-audit` section quoting all 8 PASS results.
3. `danxbot_complete({status:"failed", summary:"..."})`.

**Escalate — a human must decide or act:**
1. `issue_problem({id, action:'add', statement, type?, summary?, solutions})` per "Question versus
   action" above. `solutions[]`: one entry per viable option (`title`, `body`, `pro`, `con`),
   exactly one `recommended`. Put the concrete numbered actions in the recommended solution's
   `body` — no separate `steps[]` field. Zero solutions is valid for a pure free-form ask. Several
   independent questions = several problems.
2. Comment via `issue_comment` with the same `## Blocker self-audit` section.
3. `danxbot_complete({status:"complete", summary:"..."})` — opening the problem IS the whole
   escalation.

Do not also block on the escalation path unless the card must stay held after the operator
answers — answering a problem never clears `blocked`. If you cannot quote 8 PASS results, you have
not earned either move.

## Part B — Encountering an already-blocked card

Auto-trigger this section whenever: you're about to read/work a card whose record has
`status: Blocked` or `waiting_on != null`; you're about to start a card that overlaps a `Blocked`
one (same parent, same key files, same domain — resolve the upstream card's block first, your work
may be invalidated by its resolution); or the operator asks to get a card unstuck. Skip when the
card is `ToDo`/`InProgress`/`Done`/`Cancelled` with `waiting_on: null` and not `Blocked`.

**Vocabulary recap:** `blocked` never itself reaches a human, and answering a problem never clears
it — the two are orthogonal, see Part A's field table.

1. **Load the card**, `issue_get({id})`. Vague ask ("unstick the urgent one") →
   `issue_list({filter:{status_derived:['Blocked']}})`, pick by priority signals (Bug > Feature,
   production-impact phrasing > stretch goals, oldest first on ties).
2. **Find the blocker comment to relay.** Scan `comments[]` newest-first for the last "Blocked" /
   "Operator action" section — relay it as the agent's claim, attributed, never asserted as your
   own finding (a relayed comment is a lead, not a verified fact). Absent → fall back to
   description + `blocked.reason` + open AC items.
3. **Misclassification audit — run before writing anything.** Check every "operator must do" step:
   is it actually something an agent could run? If EVERY step is locally executable, the card was
   wrongly punted — **demote and do it yourself**, don't produce a playbook:
   - `issue_transition({id, action:'unblock'})`.
   - Comment naming the misclassification: which steps were local, what you ran, the outcome.
   - Do the work; update AC and close per the normal card workflow.
   Mixed (some local, some human-only) → execute the local steps yourself first, write the
   playbook only for what remains. **Human-only steps on a card with no open problem** mean the
   operator has never seen them — say so in the report's Blocker line; the fix is opening a
   problem (the human-only step as `statement`, options as `solutions`), not just narrating it.
4. **Extract four fields** for the report: **Blocker** (1 sentence: state + why it can't
   self-progress, attributed unless you verified it yourself), **Done** (commits shipped, ACs
   already checked, tests added), **Operator must do** (numbered steps, ≤2 lines each, exact
   commands), **Outcomes** (success branch and failure branch — always both, never single-path).
   Any step you're about to hand the operator that is IRREVERSIBLE (deploy, destructive command,
   credential rotation) must have its premise verified against real evidence first, or you must
   say plainly that you could not verify it.
5. **Output — only if step 3 found genuine human-only blockers** (`base:convey` scaffold,
   instantiated; ≤20 lines total):

   ```
   ## <ISS-N> — <one-line title> (≤12 words)

   **Goal.** <one sentence — what the operator needs to do, plain English>

   **Status.**
   | Shipped | Pending | Commits |
   |---|---|---|
   | <what's done> | <what's left> | <sha refs if any> |

   **Blocker.** <one sentence — exactly why the agent cannot self-progress>

   **What you do.**
   1. <step + exact command>

   **Outcomes.**
   - ✅ **<success branch>** → <what happens next>
   - ❌ **<failure branch>** → <what to capture / paste back>
   ```
6. **Stop.** Do not start fixing, edit the card, or change AC checks — the report ends the skill.
   The operator runs the steps and reports back; only then resume work (AC updates go through the
   normal card workflow).

**Anti-patterns:** re-investigating the bug from source or asserting a relayed comment as fact;
proposing a different fix instead of reporting on the chosen one; editing AC during the report;
a single-path "do this and you're done" instead of two outcome branches; skipping the
operator-action section because it seems obvious; stamping `blocked.at` without `blocked.reason`
(both move together — `deriveStatus` reads `.at`, the operator reads `.reason`).

**Boundary with `issue-card-workflow`:** that skill is the full lifecycle (create/save/move/retro);
Part B here is a read-only summary of one stuck card. They compose — Part B produces the report;
once the operator confirms an outcome, resume via the normal card workflow to update AC and close.
