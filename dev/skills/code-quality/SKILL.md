---
name: code-quality
description: 'Execution-level code-quality checklist: comments-are-authoritative, verify-before-editing, incremental jobs, Vue data-flow (composables/props/scalars), legacy-import migration. See dev:ideal-solution-mindset for the quality bar/principles this executes.'
---

# Code Quality

See `dev:ideal-solution-mindset` for the quality bar (ideal solution, no legacy/fallbacks, refactor first, reuse-first) — this skill covers execution-level specifics below.

## Legacy Imports ≠ Delete

Module imports deleted symbol = migrate it, don't delete module. Rewrite ~90% of time. Before deleting: (1) capability in one sentence, (2) does capability apply to new system?, (3) unilateral decision? Surface to user if module has consumers (UI, test, Makefile). Deletion requires capability obsolete, not impl outdated.

## Vue Data-Flow — Composables, Props/Emits, Scalars, Instance State

- **Composables directly, no wrappers:** call a composable at its point of use. A function whose body is a single composable call is dead weight. Exception: generic components (SelectField, Button) that can't import domain composables — use emits + props.
- **Props/emits as last resort:** >4 props or >2 emits on a specialized component is suspicious — it can usually import the composable directly instead of threading data through the tree.
- **Scalar values live on the parent:** never make a child component API-call for a single scalar (count, status, flag) the parent already has or could expose (computed column, cached attribute, resource field).
- **Instance state over parameters:** the same context threaded through 3+ method signatures belongs on `$this`, not repeated params.

## Never Guess — Verify

Read source before using a prop/component/code. Reading = seconds; fixing a guess = minutes. Comments on a class/method are authoritative.

**A comment referencing a tracked work item (`// CARD-ID: reason` / `# TICKET-N: reason`) is authoritative on WHY** — it records a standing constraint the original work imposed. Before changing code that carries such a ref, consult the referenced item to recover the full intent; editing past it blind risks silently breaking the requirement that put it there. When you make a non-obvious decision driven by a tracked item, add the same ref.

**Before choosing WHERE to write persistent/config state** (DB row vs version-controlled file vs env), read the seed + load path and confirm which store is authoritative AT RUNTIME — does the dispatch/read path actually read it, and does the boot seeder overwrite/prune or only insert-missing? A file that merely seeds a DB once (insert-missing) is a default, not the source of truth. Never infer authority from a header comment; trace the read path.

## Domain Guides Mandatory

Read domain guide before fixing tests/writing code. Don't infer from impl.

## Production Jobs Incremental

"What when runs second time?" Redoes all = wrong design. Identify delta (updated_at, sync cursor), store high-water mark, process delta only. Test: cost of 10th run vs 1st — identical = redesign.
