---
name: fail-loudly
description: 'MANDATORY when drafting any fix-options list, designing error-handling for a critical operation, or about to add a fallback / retry / graceful-degradation path. Triggers — saving state across a system boundary (MCP tool, dispatch, schema-builder agent), MCP tool unreachable, sub-agent contract violation, dispatch state corruption, any "what should we do if X fails" decision. Loads no-silent-fallback discipline as TodoWrite checklist.'
---

# Fail Loudly — No Fallbacks for Critical Failures

Critical failure (save fails, MCP unreachable, sub-agent contract broken, state corrupted) → abort loud. Don't propose fallbacks, escalation tiers, retry-with-different, graceful-degradation. Fallbacks mask bugs, cascade drift, turn one visible failure into silent class.

One merge of `try A; fail → write half to B` = cascading state divergence, silent, asymmetric. Surfaces only under load. Doom loops (strikes, broken stamps, dupes) rooted in half-applied transitions. Reviewer agents flag every fallback PRIORITY 0.

## Patterns (reviewers grep these)

| Pattern | Example | Why |
|---|---|---|
| Try-A-then-B chain | `try { http.post(); } catch { writeDb(); }` | Two surfaces, one transition. Half-applied state. |
| Default-on-error | `catch { return DEFAULT; }` | Corrupted input = valid-looking output. |
| Optional discriminator | `const kind = obj.kind ?? "unknown"` | Missing IS bug. Defaulting hides callers. |
| Swallow + log | `.catch(err => log.warn(err))` no rethrow | Caller thinks op succeeded. Error in unread logs. |
| Best-effort naming | `bestEffortPush()`, `tryX()`, `safeZ()` | Names reveal intent: failure OK. Not for critical. |
| Graceful degrade | `if (ready) full(); else minimal();` | Two behaviors. Minimal forever dark. |
| Retry-with-different | HTTP → DB → fs queue → ... | Each tier = partial surface. Truth nowhere. |
| Defensive default | `userId ?? "anon"` on internal input | Boundary validation only. Internal contracts throw. |
| Schema branching | `if (legacyShape) {…}` | Migration OK or writer wrong. Branch keeps both. |
| Commented fallback | `// fallback to old endpoint` | Anticipating fallback IS fallback. |
| TODO remove | `// TODO: remove fallback` | Author knew wrong. Delete. |
| Error to warn | `log.warn` instead of `throw` | Noise IS signal. Restore throw. |

## Grep checks (reviewer recipes)

```bash
grep -rnE 'catch[^{]*\{[^}]*return' <paths>              # catch-and-default
grep -rnE '\?\?\s*("[^"]*"|true|false|0|\[\])' <paths>   # nullish + literal
grep -rnE '\b(try|maybe|safe|best[A-Z]|graceful|fallback)' <paths>  # best-effort names
grep -rnE 'schema_version|legacyShape|isLegacy|oldFormat' <paths>  # schema branching
grep -rnE '//.*(fallback|TODO.*remove|legacy)' <paths>    # comments + markers
```

## Author self-check (before writing)

1. Name upstream invariant. What's guaranteed?
2. If guarantee broken → recover or surface? Internal = surface (throw).
3. Move throw upstream (closer to producer = louder)?
4. Would reviewer label this `bestEffort*` / `try*` / `safe*`? If yes, it's fallback in disguise.

## NOT fallbacks

- User-facing input validation (boundary, required)
- Pagination/optional-arg defaults (missing-input handling)
- Timeouts on external calls (bound wait; timeout firing = loud failure)
- Bounded Tier-4 retry on transient infra (insurance, not primary correctness)

## Standing rule

Fallback merged to main = emergency. Reviewers refuse. Authors who add fallback in response to bug haven't fixed it; buried it. Fix upstream. Delete fallback same commit.
