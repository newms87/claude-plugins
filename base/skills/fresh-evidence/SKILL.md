---
name: fresh-evidence
description: Re-observe before asserting or acting on the CURRENT state of any live/mutable system. Fires when about to say something is running / stopped / done / stuck / up / broken right now; about to act on a prior observation (spawn work, file a defect, skip a step, kill a process) because state "is" a certain way; or restating status you checked in an earlier turn. An observation is a timestamped snapshot whose truth decays.
---

# Fresh Evidence — a stale observation is not current state

An observation of mutable live state — a running process, a job's status, a service's health, a queue's depth, a stored value — is a **snapshot valid only at the instant it was taken**. Its truth decays continuously. A snapshot from an earlier turn is evidence of the PAST, not the present.

Correlation with a past reading is not proof of the present. The only proof of current state is an observation taken *now*.

## The three moves

1. **Before asserting current state in prose** — "X is running", "it's done", "the job is stuck", "it's healthy" — take a FRESH observation in the SAME turn as the claim. Never restate an earlier turn's snapshot in the present tense.

2. **Before ACTING on state** — spawning work, filing a defect, skipping a step, killing a process — re-verify at the moment of decision. The gap between observing and acting is exactly where the state changed: the process you'll act on may have already exited, failed, or flipped. (The kill-Proof-Block is this rule's special case.)

3. **When challenged on a live-state claim, re-check — do not restate.** Repeating the reasoning that produced the stale claim is not verification. Only a fresh observation is. If the challenge is right, you'll find the change; if wrong, you'll have proof.

## The tell

You wrote a present-tense claim about a system's state, but your most recent check was N turns / minutes ago, and the system can change on its own in that gap. That N is the staleness — the claim is unbacked until re-observed.

Report the evidence's freshness, not just the conclusion: **"as of <check just now>, X is running"** beats "X is running." The timestamp is what makes it a finding instead of a guess.

## Does not apply

Immutable facts don't decay — a file's committed content, a past event that already happened, a value you just wrote this turn. Re-observe **mutable, self-changing** state, not settled history.
