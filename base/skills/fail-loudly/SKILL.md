---
name: fail-loudly
description: 'MANDATORY when drafting any fix-options list, designing error-handling for a critical operation, or about to add a fallback / retry / graceful-degradation path. Triggers — saving state across a system boundary (MCP tool, dispatch, schema-builder agent), MCP tool unreachable, sub-agent contract violation, dispatch state corruption, any "what should we do if X fails" decision. Loads no-silent-fallback discipline as TodoWrite checklist.'
---

# Fail Loudly — Never Propose Fallbacks for Critical Failures

When a critical operation fails (save not persisted, MCP tool unreachable, sub-agent contract violated, dispatch state corrupted), **the correct response is to abort loudly so the bug is immediately visible.** Do NOT propose fallback paths, escalation tiers, retry-with-different-tool, or "graceful degradation" patterns. Fallbacks mask bugs, produce cascading drift, and turn one visible failure into a class of silent failures.

## The audit

When drafting a fix-options list, audit every option for the words "fallback", "escalate", "retry against a different X", "if A fails try B", "graceful", "best-effort". Each is a bandaid signal. Cut the option, and replace it with "abort/fail loud so the underlying bug is fixed at the source".

## Standing rule

"FAIL LOUDLY. We must abort immediately so the error is immediately seen and can be resolved." This applies to any system whose contract is dispatch-and-persist (schema-builder agents, danxbot dispatches, MCP tool calls). Loud abort > silent fallback, every time.

## What this is NOT

- User-facing input validation — boundary validation of external input is normal + required.
- Pagination defaults / optional-arg defaults — these are not fallbacks, they're missing-input handling.
- Timeouts on external network calls — bound the wait, but the timeout firing IS the loud failure.

The rule is about cascading internal contracts where a downstream system silently swallows an upstream contract break and produces wrong data.
