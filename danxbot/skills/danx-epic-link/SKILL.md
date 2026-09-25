---
name: danx-epic-link
description: Wire two-way parent_id ↔ children[] linkage between an Epic and its existing phase cards. Never creates cards.
---

# Danx Epic Link

You are running because the orchestrator picked up an Epic-typed card whose
DB `children[]` is empty — its phase cards already exist in the DB (either
created directly on the tracker UI, or split via `issue_create` where the
linkage step never ran) but carry no `parent_id` pointing back to this epic.

**Your one job**: identify which open issue cards (in DB) are this epic's phase
cards and set `parent_id` on each via `issue_edit` — that is what populates
the epic's `children[]` server-side. Then return control to the orchestrator.
**Do NOT create any new cards. Do NOT edit any phase card content beyond
`parent_id`.**

If `children[]` is already non-empty when this skill is invoked, exit
immediately — the epic is already linked.

---

## Step 1 — Identify candidate phase cards

1. The orchestrator's dispatch prompt names the epic's id. Load it via `issue_get({id})`.
2. Call `issue_list({filter: {parent_id: null, include_closed: false}})` to list all open cards without a parent (`parent_id: null` is a valid filter value).
3. For each open card (excluding the epic itself), extract `id`, `parent_id`, `title`, `type`.
4. Build a candidate set:
   - `parent_id == null` (already-linked phase cards aren't candidates).
   - Title pattern, content, or domain looks like a phase of THIS epic.
     Use your judgment from the titles + descriptions. Common shapes:
     - `<Epic-related-prefix> > Phase N: <Description>`
     - `<Epic title prefix>: Phase N`
     - Description references the epic by id or by name.
5. List the matched candidates back to yourself with their ids and titles.

If zero candidates match, the epic genuinely has no phase children —
leave `children[]` empty and just return (status is derived, there is
nothing to stamp). There is no in-card phase
checklist (ISS-81 retired that field). A childless Epic can never be
readied or picked up (`ready`/`pickup`/`rollback_pickup` refused on every
container — see `issue-card-workflow`'s Card Taxonomy for the general
container-atomic rule), but CAN be completed or cancelled directly
(`CONTAINER_ALLOWED_ON_CHILDLESS`, DX-2173) since there's nothing to roll
up. A genuinely-childless epic was mis-typed — cancelling it directly is
the mechanically-available escape hatch if re-typing to a Story/Bug/Chore
(the creator's call) isn't practical; don't "work it as-is."

If one or more candidates match, proceed to Step 2.

---

## Step 2 — Confirm phase ordering

Phase cards typically have a `Phase N:` numeric marker in the title.
Sort the candidates by:

1. **If ANY candidate has a `Phase N:` marker**, sort the WHOLE candidate
   set by the numeric `N` extracted from `Phase N:` (regex:
   `/Phase\s+(\d+)\s*:/i`). Candidates without the marker sort last,
   alphabetically among themselves. This avoids the alpha-only
   `Phase 10` < `Phase 2` ordering bug.
2. **If NO candidate has a `Phase N:` marker**, fall back to title
   alphabetic ordering across the whole set.

The order you produce becomes the epic's `children[]` array order,
which determines the natural "next phase" the orchestrator picks up
after this skill returns. Order matters.

---

## Step 3 — Wire the linkage

For each candidate phase card, in the order from Step 2:

1. Call `issue_edit({id: <phase-id>, parent_id: "<epic-id>"})`  to set the parent.
2. Call `issue_comment({id: <phase-id>, action: 'add', text: "Linked to parent epic <epic-id> by danx-epic-link skill."})` to append a comment.

After all phase cards are linked, add the linkage comment to the epic. **Do
NOT call `issue_edit({children: [...]})` on the epic — `children` is not an
allowed `issue_edit` key (the server refuses it 400).** `children[]` is
derived server-side from each child's own `parent_id`, which the loop above
already set on every phase card — there is nothing further to write on the
epic itself:

1. Call `issue_comment({id: <epic-id>, action: 'add', text: "## Epic linkage\n\n`danx-epic-link` wired the two-way parent_id ↔ children[] linkage for this epic's phase cards (created directly on the tracker UI without going through `issue_create`).\n\n**Children:**\n\n- <phase-1-id>: <phase-1-title>\n- <phase-2-id>: <phase-2-title>\n- ..."})` with the linkage comment.

---

## Step 3.5 — Stamp `waiting_on` on phase 2..N for serial ordering

Phase cards picked up by the poller dispatch in tracker-list-top order, NOT
phase order. To force serial dispatch (Phase 1 → Phase 2 → ... → Phase N),
set `waiting_on` on every phase except the first via `issue_dependency`:

For each phase card at index `i >= 1` in the ordered `children[]`:

1. Call `issue_dependency({id: <phase-i-id>, action: 'add', kind: 'depends_on', target_id: "<children[i-1]>", reason: "Waits for <prev-phase-id> (<prev-phase-title>) to complete."})`.

Phase 1 (`children[0]`) stays with no `waiting_on` — it dispatches first. The
picker releases phase N+1 once phase N reaches Done / Cancelled (the
`waiting_on` record itself stays on the card as a durable dep history note —
never auto-cleared).

**Skip this step ONLY when phases are genuinely independent** (different
domains, no shared state, can ship in any order). Default = sequential.
If you skip, explain in a comment on the epic.

`waiting_on.by[]` is the IMMEDIATE blocker only (Phase 3 → `["<phase-2-id>"]`, never `["<phase-2-id>", "<phase-1-id>"]`) — see `issue-card-workflow`'s `waiting_on` field entry for the full rule.

---

## Step 4 — Return control to the orchestrator

You are a sub-skill. The orchestrator (`danx-next`) called you to set
up the linkage and now expects you to return so it can continue the
normal workflow.

Do NOT call `danxbot_complete` from this skill — the orchestrator owns
that signal. Do NOT move the epic to Done — the epic stays In Progress
until all phase cards reach Done.

After your last `Edit`, simply stop. The orchestrator's flow will see
`children[]` non-empty on its next read and skip Step 3 (Epic Split)
entirely, then jump to the first incomplete phase card and pick
that up via the normal pipeline.

---

## Forbidden moves

- **Do NOT call `issue_create`.** Phase cards already exist in the DB. Creating new ones would duplicate them.
- **Do NOT edit phase card descriptions, titles, or AC items via `issue_edit`.** Only set `parent_id` and append a comment.
- **Do NOT move any phase card across statuses via `issue_transition`.** They stay in `ToDo` until the orchestrator picks the first one up.
- **Do NOT delete cards that don't match.** Cards in the DB that aren't this epic's phases are unrelated work — leave them alone.
- **Do NOT recurse into nested epics.** If a candidate is itself an Epic with its own children, link it as a phase of THIS epic (`parent_id` to outer epic, `children[]` preserved on the inner epic). The orchestrator handles nested epics on a future pickup.

---

## When in doubt

If the candidate set is ambiguous (e.g. two cards could be Phase 1 of
different epics, or a candidate's title doesn't clearly belong to this
epic), this genuinely needs a human's judgment — abort and escalate. Open a
problem on the epic (`issue_problem`'s `add` action carries no card-type
check — it works on an Epic exactly as on any other card — and refuses
only when the card is already terminal, completed or cancelled):

```
issue_problem({
  id: <epic-id>,
  action: "add",
  statement: "Which open cards are this epic's phase children?",
  solutions: [
    { title: "<candidate set A>", body: "<ids + titles + reasoning>", recommended: true },
    { title: "<candidate set B>", body: "<ids + titles + reasoning>" },
  ],
})
```

Also block the card so the ambiguity stays visible rather than getting
silently retried on a future pass (blocking and escalating are
independent — do both):
`issue_transition({id, action: 'block', reason: "Ambiguous phase candidate set — see open problem"})`.
Then return control to the orchestrator per Step 4 without calling
`danxbot_complete` yourself.
