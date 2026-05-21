---
name: fail-loudly
description: 'MANDATORY when drafting any fix-options list, designing error-handling for a critical operation, or about to add a fallback / retry / graceful-degradation path. Triggers — saving state across a system boundary (MCP tool, dispatch, schema-builder agent), MCP tool unreachable, sub-agent contract violation, dispatch state corruption, any "what should we do if X fails" decision. Loads no-silent-fallback discipline as TodoWrite checklist.'
---

# Fail Loudly — Never Propose Fallbacks for Critical Failures

When a critical operation fails (save not persisted, MCP tool unreachable, sub-agent contract violated, dispatch state corrupted), **the correct response is to abort loudly so the bug is immediately visible.** Do NOT propose fallback paths, escalation tiers, retry-with-different-tool, or "graceful degradation" patterns. Fallbacks mask bugs, produce cascading drift, and turn one visible failure into a class of silent failures.

> "FAIL LOUDLY. We must abort immediately so the error is immediately seen and can be resolved." This applies to any system whose contract is dispatch-and-persist (schema-builder agents, danxbot dispatches, MCP tool calls). Loud abort > silent fallback, every time.

**Single most defective bug class.** A fallback merged to `main` is instant-death — one merge of `try A; on failure write half of A's effect to B` produces cascading state divergence that is silent, asymmetric, and only surfaces under load when the primary path fails. The doom loops (e.g. agent strikes, broken stamps, duplicate dispatches) are almost always rooted in a fallback that wrote half a terminal transition. Reviewer agents flag every fallback at PRIORITY 0; merging one is never acceptable.

## Forbidden patterns (catalog)

Every shape below is a fallback. Reviewers grep for these; authors recognise them in their own drafts BEFORE writing.

| Pattern | Example | Why bug |
|---|---|---|
| **Try-A-then-B chain** | `try { http.post(); } catch { writeDb(); }` | Two write surfaces for one logical transition. Half-applied state when A or B individually succeeds without the other. |
| **Default-on-error** | `try { return parse(x); } catch { return DEFAULT; }` | Corrupted input silently produces "valid"-looking output. |
| **Optional discriminator** | `const kind = obj.kind ?? "unknown"` | Missing discriminator IS the bug. Defaulting hides callers. |
| **Swallow + log** | `.catch(err => log.warn(err))` with no rethrow | Caller continues thinking the op succeeded. Error visible only in logs no one reads. |
| **Best-effort wrapper** | `bestEffortPush()`, `tryX()`, `maybeY()`, `safeZ()` | Naming reveals intent — failure is acceptable. For critical contracts it is not. |
| **Graceful degradation** | `if (workerReachable) doFull(); else doMinimal();` | Two product behaviors. Minimal path is permanently dark — never exercised, untested, will drift. |
| **Retry-with-different-tool** | HTTP fails → DB fails → filesystem queue → … | Each tier is a partial commit surface. Combined truth lives nowhere. |
| **Defensive default** | `userId ?? "anonymous"`, `port ?? 0`, `path ?? "/"` on internal-contract input | External-input validation belongs at the boundary; internal contracts must throw. |
| **`if (legacyShape) {…} else {…}`** | Reader branching on schema version OR field-presence | The migration ran, OR the writer is wrong. Branching keeps both shapes alive forever. |
| **Commented-out alt path** | `// fallback to old endpoint if new one 404s` | Code that anticipates fallback IS a fallback even if temporarily disabled. |
| **`// TODO: remove fallback`** | TODO marker on a fallback | Marker proves the author knew it was wrong. Delete it. |
| **Error-to-warn downgrade** | Replacing `throw` with `log.warn` to "stop the noise" | The noise IS the signal. Restore the throw. |

## Mechanical greps (reviewer recipes)

Reviewers run these against the diff. ANY match = PRIORITY 0 finding; author must remove before merge or justify with explicit user authorization quoted in the PR body.

```bash
# Catch-and-default
grep -rnE 'catch[^{]*\{[^}]*return\s+[^;]+;' <diff-paths>
grep -rnE 'catch[^{]*\{\s*\}' <diff-paths>                  # naked catch
grep -rnE '\?\?\s*("[^"]*"|true|false|0|\[\]|\{\})' <diff-paths>  # nullish coalesce w/ literal

# Best-effort naming
grep -rnE '\b(try|maybe|safe|best[A-Z]|graceful|fallback|fail[Ss]oft|softFail)' <diff-paths>

# Try-chain shape
grep -rnE 'catch[^{]*\{[^}]*(await|return)' <diff-paths>     # catch that does work

# Schema-shape branching
grep -rnE 'schema_version\s*[<>=!]+|legacyShape|isLegacy|oldFormat|v[0-9]+Shape' <diff-paths>

# Commented-out fallbacks / TODO removal markers
grep -rnE '//.*(fallback|TODO.*remove|old endpoint|legacy|deprecated)' <diff-paths>

# Warn-instead-of-throw downgrade
git diff <base>..HEAD -- <diff-paths> | grep -E '^-.*throw .* new (Error|.+Error)' | head
git diff <base>..HEAD -- <diff-paths> | grep -E '^\+.*(log|console)\.(warn|error|info)' | head
# If the throw count went down + the log.warn count went up, audit each one — likely fallback.
```

## Author self-check (drafting)

Before writing any `catch`, `??`, `if (x === undefined)` branch on internal-contract input:

1. **Name the upstream invariant.** What does the producer guarantee?
2. **If producer guarantee is broken, is the right answer to recover, or to surface the bug?** For internal contracts, the answer is always "surface the bug" → throw.
3. **If I'm tempted to handle the failure here, can I move the throw upstream so it fires earlier?** Closer to the producer = louder.
4. **Would a reviewer say `bestEffort*` / `try*` / `maybe*` / `safe*` about this code?** If yes, the function is a fallback in disguise — refuse to merge until the fail-loud path replaces it.

## What this is NOT

- User-facing input validation — boundary validation of external input is normal + required.
- Pagination defaults / optional-arg defaults — these are not fallbacks, they're missing-input handling.
- Timeouts on external network calls — bound the wait, but the timeout firing IS the loud failure.
- Tier-4 retry wrappers on transient infra blips (DB connection drop, network glitch) where the retry envelope is bounded AND the surface treats exhausted-retries as the loud failure. The retry is insurance, never the primary correctness mechanism.

The rule is about cascading internal contracts where a downstream system silently swallows an upstream contract break and produces wrong data.

## Standing rule

A fallback merged to `main` is an emergency. Reviewers refuse to ship plans that leave any fallback in place. Authors who add a fallback in response to a bug have not fixed the bug — they have buried it. Fix the upstream cause; delete the fallback in the same commit.
