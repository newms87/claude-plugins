---
name: sub-agent-delegation
description: 'MANDATORY before every Agent / Task sub-agent dispatch. Loads pre-dispatch check (synthesis ratio, isolation justification, raw-passthrough detection) as TodoWrite checklist. Sub-agents = synthesis / judgment / parallelism / context isolation; never raw read/MCP-fetch passthrough.'
---

# Sub-Agent Delegation Rules

## ABSOLUTE: Never Dispatch a Sub-Agent to Reproduce Tool Output Verbatim

Sub-agents exist for **synthesis, judgment, parallelism, or context isolation** — never to act as a remote `Read` / `Grep` / MCP-call shim that pipes raw bytes back to the orchestrator. A sub-agent whose output is "the file content I just read" or "the JSON the tool just returned" is pure waste: the sub-agent paid tokens to read it, then paid tokens *again* to retype it into a tool result the orchestrator must re-tokenize on intake. Same bytes, three trips through a model, zero added value.

**The pattern (FORBIDDEN):**

```
Orchestrator → Agent(subagent) → Read(/some/path) → return file body verbatim
Orchestrator → Agent(subagent) → mcp__foo__bar(args) → return tool body verbatim
```

**The fix (one of):**

1. **Orchestrator reads/calls directly.** If the data is on a path the orchestrator can `Read`, or behind a tool the orchestrator can call, do it inline. Sub-agent dispatch is overhead.
2. **Sub-agent synthesizes.** If the orchestrator dispatches a sub-agent, the sub-agent's return value must be a *condensed* artifact — extracted facts, a verdict, a diff, a checklist outcome — not the raw input.
3. **Pre-stage to the filesystem.** If a payload is consistently needed across runs, stage it to a known path at dispatch time (or in the harness) and let the orchestrator `Read` it directly. Don't wrap a pure-fetch behind an agent or MCP call.

## Mechanical Pre-Dispatch Check

Before every `Agent(...)` / `Task` sub-agent call, answer in writing:

1. **What does the sub-agent return that the orchestrator could not produce by reading/calling itself?** No answer → don't dispatch. Read or call directly.
2. **Is the sub-agent's output materially smaller than its input?** No (output ≈ raw read/tool body) → don't dispatch. Either orchestrator reads directly OR sub-agent must do real synthesis (summarize, judge, transform).
3. **Does the sub-agent need an isolated context window** (large fan-out, parallel branches with independent state)? Yes → dispatch is justified even with modest synthesis ratio. No → keep it inline.

If all three answers point to "no real synthesis, no real isolation," the sub-agent is a passthrough. Cut it.

## Why This Rule Exists

A sub-agent reading a file and returning the file body is **strictly worse** than the orchestrator reading that file: extra spawn cost, extra return-trip cost, and the orchestrator still has to ingest the same bytes. The only reason this anti-pattern shows up is convenience — the orchestrator's prompt happens to have an `Agent` tool and not the right context-shape thinking. Treat sub-agents as expensive collaborators, not as remote-procedure call wrappers around `Read`.

## Tool Surface Implication

When designing tools / MCP servers / staged contexts: if a tool's *only* job is "fetch this static blob and hand it to the agent," the right answer is usually **stage the blob on disk** so the agent reads it directly via `Read`. A wrapping tool — and especially a wrapping sub-agent — adds latency, tokens, and indirection without adding capability. Mutable / interactive operations stay tools; pure-fetch read-only context becomes filesystem.
