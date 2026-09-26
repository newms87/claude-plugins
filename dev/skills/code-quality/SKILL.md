---
name: code-quality
description: 'Execution-level code-quality checklist: comments-are-authoritative, verify-before-editing, incremental jobs, Vue data-flow (composables/props/scalars), legacy-import migration. See dev:ideal-solution-mindset for the quality bar/principles this executes.'
---

# Code Quality

See `dev:ideal-solution-mindset` for the quality bar (ideal solution, no legacy/fallbacks, reuse-first) — this skill covers execution-level specifics below.

## Legacy Imports ≠ Delete

A module import that's deleted a symbol needs migrating, not deleting the whole module — rewrite ~90% of the time. Before deleting: (1) state the capability in one sentence, (2) does it still apply to the new system? (3) is this unilateral? Surface to the user if the module has consumers (UI, test, Makefile). Deletion requires the capability being obsolete, not just its implementation being outdated. Before removing the file itself, `dev:git-discipline`'s grep-for-consumers gate applies.

## Vue Data-Flow — Composables, Props/Emits, Scalars, Instance State

- **Composables directly, no wrappers:** call a composable at its point of use. A function whose body is a single composable call is dead weight. Exception: generic components (SelectField, Button) that can't import domain composables — use emits + props.
- **Props/emits as last resort:** >4 props or >2 emits on a specialized component is suspicious — it can usually import the composable directly instead of threading data through the tree.
- **Scalar values live on the parent:** never make a child component API-call for a single scalar (count, status, flag) the parent already has or could expose.
- **Instance state over parameters:** the same context threaded through 3+ method signatures belongs on `$this`, not repeated params.

## Never Guess — Verify

Read source before using a prop/component/code — reading costs seconds, a guess costs minutes. A docblock is authoritative when read, not self-updating after: it was true when written, nothing marks when it stopped being. Before trusting one: confirm a named producer/caller/mechanism still exists; re-read every docblock/constant describing a branch you change, including ones you didn't edit; check its examples too, not just the headline — they're what the next reader copies. Cheap checks: grep a deleted symbol in PROSE, not just imports; when a docblock cites another docblock, follow the citation to CODE, since a chain ending in more prose confirms nothing. (Runtime-behavior claims beyond source reading are `dev:debugging`'s evidence discipline.)

**A comment referencing a tracked work item (`// CARD-ID: reason`) is authoritative on WHY.** Consult it before changing code that carries the ref; add the same ref when a non-obvious decision is driven by a tracked item.

**Before choosing WHERE to write persistent/config state** (DB row vs file vs env), trace the seed + load path to confirm which store is authoritative AT RUNTIME — does the boot seeder overwrite/prune, or only insert-missing (a default, not the source of truth)? Never infer authority from a header comment.

## Domain Guides Mandatory

Read the domain guide before fixing tests or writing code. Don't infer behavior from the implementation alone.

## Production Jobs Incremental

Ask "what happens when this runs a second time?" — redoing all work is the wrong design. Identify the delta (updated_at, sync cursor), store a high-water mark, process the delta only. Test: cost of the 10th run vs the 1st should be identical; if not, redesign.
