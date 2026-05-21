---
name: sub-agent-delegation
description: 'MANDATORY before every Agent / Task sub-agent dispatch. Loads pre-dispatch check (synthesis ratio, isolation justification, raw-passthrough detection) as TodoWrite checklist. Sub-agents = synthesis / judgment / parallelism / context isolation; never raw read/MCP-fetch passthrough.'
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
