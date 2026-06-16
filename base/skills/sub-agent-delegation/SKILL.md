---
name: sub-agent-delegation
description: Sub-agent dispatch checklist — synthesis ratio, isolation justification, raw-passthrough detection; sub-agents synthesize, never proxy reads.
---

# Sub-Agent Delegation Rules

Sub-agents exist for synthesis, judgment, parallelism, context isolation — NOT raw data passthrough.

## Forbidden pattern

```
Orch → SubAgent → Read(path) → return body verbatim
Orch → SubAgent → mcp__X(args) → return JSON verbatim
```

Sub-agent paid tokens to fetch. Orchestrator pays tokens re-reading result. Same bytes, triple cost, zero synthesis.

## Pre-dispatch check — answer all three

1. **What does sub-agent return that orchestrator can't produce itself?** No → don't dispatch.
2. **Is output materially smaller than input?** No (≈ raw read/tool body) → don't dispatch.
3. **Does sub-agent need isolated context** (fan-out, parallel branches)? No → keep inline.

All no → sub-agent is passthrough. Cut it.

## Fixes

- **Orch reads/calls directly.** If path or tool accessible to orch, use it inline.
- **Sub-agent synthesizes.** Return condensed artifact: extracted facts, verdict, diff, checklist — not raw input.
- **Pre-stage filesystem.** Static payload → known path at dispatch, orch reads directly. Don't wrap fetch in sub-agent.

## Tool design implication

Tool's only job = "fetch static blob" → stage on disk, agent reads via Read. Fetch tool + fetch sub-agent = latency/tokens/indirection for zero capability. Mutable ops stay tools; pure-fetch becomes filesystem.

## ALWAYS parallelize independent work — fan out, don't serialize

When a task decomposes into INDEPENDENT sub-tasks — multiple reviews of the same artifact, several non-overlapping fixes, independent file edits or investigations — dispatch them as parallel sub-agents in ONE message (multiple Agent/Task tool calls in a single response), NOT one at a time. Serializing work that has no ordering dependency is pure wasted wall-clock. Sub-agents are the mechanism that makes the parallelism possible; reach for them whenever independent work exists, not only for synthesis.

**Hard cap: 3 concurrent sub-agents (3 parallel items).** More than 3 independent items → batch them: run 3, collect results, then run the next set. The cap is for INDEPENDENT work ONLY — never parallelize genuinely dependent steps (step B needs step A's output).

**Use sub-agents to APPLY fixes, not just to review.** When findings (or any work) split into independent, non-overlapping fixes, fan THEM out to parallel sub-agents too (≤3) — never serialize independent fixes.

**Guardrails (all still hold):**
- **Non-overlapping files/state only.** Two agents must NEVER edit the same file concurrently — partition the work by file/module first; overlap → keep those items serial.
- **Synthesis-not-passthrough still applies** (the pre-dispatch check above): each parallel sub-agent returns a condensed artifact, not raw bytes. If a "sub-agent" would only echo what you could produce yourself, run it inline instead — fan-out is for genuinely independent *work*, not for wrapping trivial edits.
- **The parent runs the test suite ONCE, after all edits land** — never run tests inside parallel sub-agents (no parallel test runs).

### Canonical case — POST code-trio quality gates
The three POST code gates (`code-test-quality` / `code-architecture` / `code-quality`) are independent read-only reviews of the SAME diff with zero ordering dependency. Dispatch their reviewer sub-agents (`architecture-reviewer` + `code-quality-reviewer`) in ONE batch (≤3), run the inline `code-test-quality` review alongside them, collect ALL findings, fix ONCE (independent fixes fanned out, ≤3), then sign off each gate. Do NOT run the three gate reviews one at a time — that was the observed failure this rule exists to prevent.
