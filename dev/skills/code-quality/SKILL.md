---
name: code-quality
description: 'SOLID + DRY + zero-tech-debt discipline: refactor first, extract abstractions, no backwards compat, no fallbacks, comments-are-authoritative.'
---

# Code Quality

## The Mission: 100% Perfect Quality Code

Cost + time NOT factors. Every file/method/test must be correct — no "good enough", no pre-existing excuse. Never skip work. Never modify reviewer agents to bypass findings.

**SOLID / DRY / Zero-Debt / One-Way / Read-First / 100%-Tests**

## Ideal Solution First

Dev time ≠ deciding factor. "Faster to write" / "another repo involved" / "extend shared infra" are anxieties, not constraints. Legitimate trades: runtime vs correctness · two clean approaches · capability gaps · security. Forbidden: dev effort. Mechanical check: "worse only because faster?" Yes → drop it, propose ideal.

## Zero Backwards Compatibility

Never introduce compat code. Legacy hides bugs → errors instead. ONE correct way. Fix at source, never shims.

## Legacy Imports ≠ Delete

Module imports deleted symbol = migrate it, don't delete module. Rewrite ~90% of time. Before deleting: (1) capability in one sentence, (2) does capability apply to new system?, (3) unilateral decision? Surface to user if module has consumers (UI, test, Makefile). Deletion requires capability obsolete, not impl outdated.

## Refactor First

See DRY/SOLID violation → refactor BEFORE building on top. Do right first, always.

## Extract Shared Abstractions First

2+ classes need same logic → extract shared FIRST. Read domain, identify patterns, extract to trait/base/service, build consumers. Name abstractions explicitly for cross-session work.

## Instance State over Parameters

Method chain shares data → instance state. Passing same context through 3+ signatures = procedural anti-pattern. 3+ methods get param → belongs on `$this`.

## Composables Directly, No Wrappers

Call composables directly where data interacted. Function body = single composable call = dead weight. Exception: generic components (SelectField, Button) that can't import domain composables — use emits + props.

## Props/Emits Last Resort

>4 props suspicious · >2 emits on specialized components suspicious · component can import composable = call directly. Emits passing unchanged = broken at source.

## Scalar Values on Parent

Never API-call for scalar (count, status, flag). Field doesn't exist yet? Add one (computed column, cached attribute, resource field).

## Search Before Building

Every line is permanent. Search for existing solutions first. Follow patterns (consistency > preference). Build for team.

## Grep Schedulers Before Adding Hooks

Adding periodic/maintenance logic → grep canonical scheduler surfaces first. User's location suggestion ≠ search exemption. Verify both before implementing.

## Own All Code

100% responsible 100% of time. You = all previous sessions. Investigate, explain, own untracked.

## Never Guess — Verify

Read source before using prop/component/code. Reading = seconds; fixing guess = minutes. Comments on class/method = authoritative. Read before editing + before asserting behavior.

**Source-of-truth check before persisting state (mechanical).** Before choosing WHERE to write persistent/config state (DB row vs version-controlled file vs env), READ the seed + load path and confirm which store is authoritative AT RUNTIME: what does the dispatch/read path actually read, and does the boot seeder OVERWRITE/prune or only insert-missing? A config file that merely seeds a DB once (insert-missing, never overwrites) is a DEFAULT, not the source of truth — the DB is, and runtime/operator state lives there. NEVER infer authority from a file's header comment; trace the read path. Editing the seed file for a per-install / temporary / operator-divergent value is the wrong layer — it ships fleet-wide + needs a code revert.

## Domain Guides Mandatory

Read domain guide before fixing tests/writing code. Don't infer from impl.

## Fail Loud, Never Silent

Fallback = silent bug. Throw error (default), ask user (uncertain), fallback (100% certain AND optional, rare). Fallbacks always bugs on discriminators (type/status/kind), config, validation, constructors.

## Production Jobs Incremental

"What when runs second time?" Redoes all = wrong design. Identify delta (updated_at, sync cursor), store high-water mark, process delta only. Test: cost of 10th run vs 1st — identical = redesign.

## Observation ≠ Instruction

User reports bug → investigate + report. Don't write code. Wait explicit direction.
