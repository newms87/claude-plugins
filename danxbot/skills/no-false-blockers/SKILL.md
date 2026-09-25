---
name: no-false-blockers
description: 'Three commonly-mistaken false-blocker patterns + their programmatic substitutes; forbidden destructive working-tree git ops list.'
audience: worker
---

# Don't Block On These — False Blocker Patterns

Three patterns commonly mistaken for blockers. **None of them are valid
reasons to stamp `blocked: {at, reason}` (which derives the card to `Blocked`
via `deriveStatus` and stops auto-dispatch), and none are valid reasons to
escalate to the operator (opening a problem via `issue_problem`, the only way
a card reaches a human).** Use the in-session resolution below; keep the
card moving.

These extend (do NOT override) `danx-next`'s Step 10 (`references/step-procedures.md`
§ "Step 10 — Blocker You Cannot Resolve") — Step 10 stays the authoritative menu. This
rule names the patterns Step 10 does not yet list.

## Pattern 1 — Test failure unrelated to your card

**Symptom:** `npx vitest run` (or any suite) fails on a test that touches
a file / module your card does not modify.

**NOT a blocker.** Three options. There is no fourth.

1. **Uncommitted diff in a related file (visible in `git status`)** →
   another agent's active work. Leave it alone. Do NOT `git stash`, do
   NOT `git checkout --`, do NOT `git restore`, do NOT run any gate
   whose result depends on that file being in a different state. Note
   the conflict in a `comments[]` entry on this card and proceed with
   what you CAN verify.
2. **Failure in a code path your card touches** → fix it, in this
   dispatch.
3. **Failure unrelated to your card, root-caused by READING the
   problem code path (not by stashing or reverting), AND too involved
   to fix in 30 min** → create an Action Item card via
   `issue_create({type: "Bug", title, description, ac, triage_enabled, ...})`
   with the actual root-cause hypothesis you traced. Push the returned
   `<PREFIX>-N` into `retro.action_item_ids[]`. Check the AC off (your
   card's tests pass) and proceed.

**STRICTLY FORBIDDEN against working-tree state you did not personally
write in this dispatch.** The general destructive-op list — `git
stash`, `git checkout --`/`restore`, `git reset --hard`, `git clean` —
is `dev:git-discipline`'s; see that skill for the full ban. Additionally
forbidden here: any "verify failure pre-existed my changes"
investigation. There is ZERO value in the answer — the suite either
passes for YOUR changes (option 2) or it does not (option 1 / 3).

Before touching ANY destructive git op, or reasoning about whether a
failure "pre-existed your changes," run `danxbot:issue-blocker`'s
Checklist Items 2–4 (the uncommitted-diff audit, the stash-forbidden
rule, and root-cause-by-reading) — that skill owns the full audit; this
file does not restate it.

**Forbidden:** "I stashed the diff, ran tests, popped back to confirm
the failure pre-existed" → rule violation, regardless of how clean the
result looked. The act of stashing IS the violation.

## Pattern 2 — Manual UI smoke / dashboard verification

**Symptom:** AC says "manually verify at http://localhost:5566 …" or
"operator clicks X, sees Y." Agent has no human eyeball to satisfy literal
wording.

**NOT a blocker.** The AC's INTENT is "the rendered UI shows the new
state." That intent has three programmatic substitutes — pick the cheapest
one that works.

**In-session resolution (in priority order):**

### a) Component test (cheapest, almost always sufficient)

Mount the component with fixture data using `@testing-library/react` + the
frontend's own `vitest` setup (`cd frontend && npx vitest run`). The Vue
dashboard in `dashboard/` is frozen — new UI work and its tests target
`frontend/` (React), never a `.vue` SFC (`.claude/rules/ui-deprecation.md`).
Assert the DOM reflects the new state — this satisfies "renders X when
state Y" ACs deterministically without a browser.

```tsx
// frontend/src/components/AgentBadge.test.tsx
import { render, screen } from "@testing-library/react";
import { AgentBadge } from "./AgentBadge";

it("renders initials when no avatar", () => {
  render(<AgentBadge name="Dan" size="md" />);
  expect(screen.getByText("D")).toBeInTheDocument();
});
```

### b) Playwright drive (when component test can't reach it)

The clean-room `mcp.template.json` ships `mcp__playwright__*` tools (when the profile's catalog selects the playwright server). Auth via the
operator's persistent token:

```bash
# Host-mode dispatch — token file is on the host filesystem.
TOKEN=$(cat ~/.config/danxbot/dashboard-token)
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:5566/api/auth/me
# → {"user":{"username":"monitor"}}  (sanity check)
```

For UI navigation, log the dashboard in once via the API (`POST
/api/auth/login` with the `monitor` user), capture the session cookie /
bearer, and inject it into the playwright context before navigating to a
protected page. Take a screenshot, assert the badge is present in the
serialized DOM. If the playwright MCP does not currently support cookie
injection, fall back to (a) or (c).

### c) Rewrite the AC

If neither (a) nor (b) works, the AC is mis-specified. Edit the AC item
title to a programmatic gate you CAN run:

```yml
# was: "Manual smoke at http://localhost:5566 — badges visible"
# now: "Component test frontend/src/components/AgentBadge.test.tsx asserts badge renders for issue rows + drawer header + busy state"
```

Add a `comments[]` note explaining the rewrite. The AC's intent is
preserved; the gate is now executable. Run the gate, check the AC off,
proceed.

**Forbidden:** "AC says 'manually verify' so I cannot complete it →
Blocked." Manual-only language in an AC is a wording defect, not a human-
action requirement. Rewrite or substitute.

## Pattern 3 — Post-terminal-save / self-derived state

**Symptom:** AC says "after this card moves to Done, the parent epic
auto-flips to Done" or "the worker post-completion auto-sync renders the
retro comment" or "the DB is updated by the server after the agent saves."
The behavior fires AFTER the agent calls `danxbot_complete` — there is no
moment inside the dispatch when it can be observed end-to-end.

**NOT a blocker.** A self-referential post-save behavior is NEVER
verifiable from inside the dispatch that triggers it (chicken-and-egg).
The AC must verify the CODE PATH that performs the derivation, not the
runtime side-effect.

**In-session resolution:**
1. Identify the function / module that produces the derived state. Examples:
   `src/issues/cascade/recompute-derived.ts` (container/Epic-Feature rollup —
   calls `deriveContainerStatus` from `src/issues/derive/container-status.ts`),
   `src/dashboard/server.ts` post-save handlers.
2. Confirm a unit test exists that exercises that function directly with
   fixture inputs. If absent, write one (Step 1.5 — fix in-session).
3. Rewrite the AC to point at the unit test:
   ```yml
   # was: "Epic DX-158 every AC checkable; epic flipped to Done by operator/automation on terminal save"
   # now: "Unit test src/issues/derive/container-status.test.ts asserts deriveContainerStatus({children all Done}) returns 'Done' (covers the rollup code path the next dispatcher tick runs after terminal save)"
   ```
4. Run the unit test, check the AC off.

**Forbidden:** "the auto-flip happens after my dispatch ends, so I cannot
verify it → Blocked." That logic blocks every card that touches a system
with eventual-consistency / post-save hooks. The unit test on the
derivation function IS the verification.

## Generalized rule

Resolve a blocker yourself whenever you can. The three patterns above collapse to one table:

| Apparent blocker | Actual class | Resolution |
|---|---|---|
| Pre-existing flaky test in unrelated file | In-session work or Action Item | Fix in 30 min OR file Action Item, check AC, proceed |
| "Manual UI smoke" AC | Wording defect or programmatic substitute available | Component test → playwright → rewrite AC |
| Post-terminal-save behavior verification | Self-referential AC | Rewrite AC to point at the unit test for the code path |

These three patterns are inputs to `danxbot:issue-blocker`'s 8-item Pre-Block Gate, not a
substitute for it — that skill owns the full block-vs-escalate checklist and the field-selection
table (`blocked` vs an open problem vs `waiting_on` vs `conflict_on[]`). Run it before calling
`issue_transition({action: 'block'})` or `issue_problem` add.
