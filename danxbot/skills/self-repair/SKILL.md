---
name: self-repair
description: 'Per-error repair agent. Single Claude session takes a `Self-Repair > Attempt N:` card created by the Phase-3 dispatcher (DX-563), root-causes the deterministic problem named in its `system error signature`, applies a scoped fix, re-runs the producing code path to verify, then signals a verdict-prefixed completion (`fixed:` / `failed:` / `unfixable:`) the Phase-3 finalize hook parses. Dispatched into the `self-repair` workspace. Read the card via the worktree path the dispatch prompt names; never edit cards other than the candidate.'
argument-hint: <PREFIX>-N repair card id
---

# Danxbot Self-Repair

You are the **self-repair agent** dispatched against ONE
`Self-Repair > Attempt N:` card the Phase-3 dispatcher
(`src/cron/jobs/self-repair-dispatch.ts`) created. The card's
`description` carries a `Repair Target` block naming the system error
signature, a `Sample Payload` block with the raw error payload, and
the history of every prior repair attempt for the same signature. Your
job: read the card, root-cause the deterministic problem behind the
signature, apply the smallest viable fix, verify the originating error
stops reproducing, then signal a verdict-prefixed completion.

**You do NOT run the standard `/danx-next` workflow.** Self-repair is
its own scoped flow — investigator subagent → builder subagent (or
direct fix) → inline verifier → `## Repair Report` comment → commit →
verdict. The seven steps below are mandatory; skipping any one breaks
the Phase-3 finalize hook's parser or the operator-visible audit
trail.

**Verdict prefix is load-bearing.** The Phase-3 finalize hook
(`src/system-repair/finalize.ts#parseVerdictFromSummary`) scans the
FIRST line of `danxbot_complete({summary})` for the keywords `fixed`,
`failed`, or `unfixable` (in that order — `unfixable` is matched
before `fixed` because it contains the substring `fixable`). A
verdict the hook misclassifies flips the wrong `system_errors.status`
or leaves a still-broken category marked `fixed`. Always lead the
`summary` with one of `fixed:<signature>`, `failed:<signature>:<one-
line reason>`, or `unfixable:<signature>:<reason>`.

## Triggers

The skill auto-loads in dispatches that meet any of:

- Workspace cwd is `<repo>/.danxbot/workspaces/self-repair/`.
- The dispatched card's `title` matches `Self-Repair > Attempt N:` —
  the marker the picker uses to route the card to this workspace in
  the first place.
- The dispatch prompt body mentions `system error signature`.

## Mandatory steps

### Step 1 — Read the card

The card id is the slash-command argument (`/self-repair <PREFIX>-N`).
Read the YAML at `<worktree>/.danxbot/issues/open/<PREFIX>-N.yml`
(your worktree path lives in the persona block — substitute it
verbatim). Extract from the `## Repair Target` block:

- `signature_hash` — the deterministic fingerprint the card targets.
- `category_key` — the `<component>:<class>` pair (e.g. `worker:TypeError`).
- `count`, `first_seen`, `last_seen` — pressure context.
- `sample_payload` JSON from `## Sample Payload` — pick the
  `raw_msg`, `path`, `line`, `stack` keys for grep + Read.
- Every entry in `## Prior Repair Attempts` — the verdicts (`fixed` /
  `failed` / `unfixable` / `pending`) and report excerpts tell you
  what was already tried. Do NOT repeat a `failed` attempt's exact
  approach; the renderer keeps a 200-char excerpt of each prior
  report so you can spot the pattern.

### Step 2 — Investigator subagent (read-only)

Dispatch the `general-purpose` agent (or `cavecrew-investigator` if
your plugin set has it) via the `Agent` tool. Brief it with:

- The signature hash, category key, sample payload.
- The reproduction it needs: open the path/line from
  `sample_payload`, grep for callers of the failing function, walk
  back to the producing call site.
- **Read-only mandate** — no edits, no commits, no file writes.
- Output cap: `path:line` of the deterministic root cause plus one
  paragraph explaining why that line produces the signature.

If the investigator returns "cannot locate root cause" → go directly
to Step 3 with classification `unfixable`. Do NOT invoke the builder.

### Step 3 — Classify the fix

Pick exactly one based on the investigator's finding:

| Classification | When to pick | Verifier in Step 5 |
|---|---|---|
| `data-fix` | A malformed YAML row, DB row, or persistent state caused the throw — the code is correct, the data isn't | Re-parse the targeted YAML / row via the same loader the producer used (`loadIssueYaml`, etc.); assert no throw |
| `code-fix` | Worker / library bug — the code path itself is wrong | Run the test that reproduces (TDD pass required); ensure `npx vitest run` is green |
| `template-fix` | A mis-rendered inject file (CLAUDE.md, settings.json, .mcp.json, workspace.yml) caused the worker to crash on load | Re-render via `renderPerRepoFilesIntoWorkspaces` against a fixture; diff vs. expected |
| `drift-fix` | Schema bumped on the writer side but `KNOWN_SCHEMA_MAX` / the danx-issue-mcp bundle lags | Publish lockstep via the `thehammer-publish` skill if `@thehammer/*` is involved |
| `unfixable` | No programmatic path — the signature stems from a transient external system, a flaky test outside this repo's control, an OS-level race, or the investigator could not locate the root cause | Skip Step 4 + Step 5; go directly to Step 6 with the unfixable rationale |

### Step 4 — Builder subagent (or direct fix)

| Scope | Agent | Notes |
|---|---|---|
| 1–2 file scope | `cavecrew-builder` (if available) OR `general-purpose` | Pass the investigator's `path:line` + the planned fix. The builder returns the diff + the test run log. |
| > 2 file scope (rare for self-repair) | `general-purpose` only | Brief the agent on the full scope; cap the diff size you'll accept. |
| Trivial edit (single-line config / typo / off-by-one) | Direct via your own `Edit` / `Write` | Subagent overhead exceeds the work; do it inline. |

**Subagent boundary contract:** investigator is read-only; builder
edits files but does **not** commit; neither subagent calls
`danxbot_complete` or any worker / dispatch / settings mutation. The
agent (you) is the sole committer.

### Step 5 — Inline verifier

You — not a subagent — re-run the producing code path matching the
Step-3 classification. Capture the verifier output for the
`## Repair Report` comment.

- `data-fix` → run the loader on the now-fixed data; assert success.
  Bash: `node --experimental-vm-modules -e "import('./dist/...')"` or
  the appropriate Read + parse path. No throw = pass.
- `code-fix` → run the TDD test that captures the reproduction
  (`npx vitest run <path/to/test>`); confirm green. Also run
  `npx tsc --noEmit` so the regression-test surface stays clean.
- `template-fix` → run `npx vitest run src/inject/workspaces/` (or
  the targeted workspace-shape test) and diff the rendered output
  vs. the fixture.
- `drift-fix` → run the producing parser AND publish lockstep per
  the `thehammer-publish` skill if a `@thehammer/*` package is in
  scope.

If the verifier **fails**: append a `## Repair Attempt Failed`
comment summarizing what you tried + what the verifier output, then
go to Step 7 with the `failed:` verdict. Do NOT flip the card status;
the Phase-3 finalize hook owns the row.

### Step 6 — `## Repair Report` comment

Append a new entry to `comments[]` on the card YAML with this exact
structure (the heading is parsed by `src/system-repair/finalize.ts#readRepairReport`).
Author `self-repair`, timestamp the current ISO 8601 string,
text starting with `## Repair Report`:

```markdown
## Repair Report

**Signature:** `<signature_hash>`
**Category:** `<category_key>`
**Classification:** `<data-fix | code-fix | template-fix | drift-fix | unfixable>`

### Root Cause

<one paragraph — the investigator's `path:line` + the why>

### Fix Applied

<bullets describing what changed; reference each file by path>

### Verification

<verifier command + result — e.g. `npx vitest run src/foo/bar.test.ts` → 5/5 green>

### Files Touched

- `<path/one>`
- `<path/two>`

### Tests

- `<test path>` — added / modified / unchanged
```

For the `unfixable` path, replace the body with:

```markdown
## Unfixable Verdict

**Signature:** `<signature_hash>`
**Category:** `<category_key>`

### Why no programmatic fix exists

<one paragraph — what was investigated, why every classification in
Step 3 was rejected, what operator action might unblock if any>
```

For the `failed` path, replace with:

```markdown
## Repair Attempt Failed

**Signature:** `<signature_hash>`
**Classification attempted:** `<data-fix | code-fix | ...>`

### What was tried

<bullets describing the approach>

### Verifier output

<the failing test / loader / render output verbatim>
```

### Step 7 — Commit + `danxbot_complete`

1. For `fixed` / `failed` outcomes that touched code or data on disk:
   commit via the standard pipeline. Multi-worker dispatches (persona
   block present): `bash .danxbot/scripts/agent-finalize.sh
   <YOUR-NAME> <CARD-ID> "<title>" "<bullet 1>" ...`. Single-workspace
   dispatches: follow the repo's git-mode (`auto-merge` / `pr`) per
   `.claude/rules/danx-repo-config.md`.
2. For `unfixable`: NO commit needed — the YAML comment landed via
   chokidar mirror, and there are no code changes. Skip straight to
   the completion call.
3. Call `danxbot_complete` with the verdict-prefixed summary. The
   first line MUST start with the verdict keyword. Examples:
   - `danxbot_complete({status: "completed", summary: "fixed:abc123def — patched <file>:<line>; verifier 5/5 green"})`
   - `danxbot_complete({status: "failed", summary: "failed:abc123def: verifier still throws after 2 patch attempts"})`
   - `danxbot_complete({status: "failed", summary: "unfixable:abc123def: external Stripe webhook timing; no programmatic path"})`

For the `unfixable` / `failed` verdicts, pass `status: "failed"` to
`danxbot_complete` (Phase-3 finalize reads the verdict from `summary`,
not from `status`). For `fixed`, pass `status: "completed"`.

**Do NOT flip the card YAML's `status` field.** The Phase-3 finalize
hook (`src/system-repair/finalize.ts`) owns the
`system_errors.status` flip; the YAML's `status` is incidental to the
repair flow and the worker's auto-sync moves the file `open/` →
`closed/` based on the verdict landing on the database row.

## Subagent boundary (recap)

| Agent | May edit files? | May commit? | May call `danxbot_complete`? |
|---|---|---|---|
| Investigator | NO | NO | NO |
| Builder | YES (≤ 2 files default; escalate to `general-purpose` for > 2) | NO | NO |
| You (the orchestrator) | YES | YES | YES |

Subagents that violate the boundary by calling `danxbot_complete` or
running `git commit` make the verdict surface ambiguous. The
`general-purpose` agent will respect an explicit instruction; brief
it accordingly.

## Forbidden patterns

| Pattern | Why forbidden |
|---|---|
| Editing cards other than the candidate | Authority is scoped to this card's id; the orphan-resume guard catches stray writes. |
| Calling `danx_issue_create` | Self-repair never spawns follow-up cards; the next dispatch handles attempt N+1 if the verdict is `failed`. |
| Flipping the candidate card's `status` to `Done` / `Cancelled` | Phase-3 finalize owns the lifecycle; flipping here double-mutates the row and confuses the auto-sync. |
| Verdict prefix missing from `summary` | `parseVerdictFromSummary` defaults to `failed` when no keyword leads — a successful repair without `fixed:` prefix is recorded as `failed`. |
| `make deploy` / `make launch-*` | `danxbot:no-unauthorized-worker-launch` applies; self-repair is a local fix flow. |
| `mcp__trello__*` / Slack tools | Self-repair workspace declares only `danx-issue` MCP server — neither tool is reachable; calling either returns "tool not available". |
| Skipping the `## Repair Report` comment | The Phase-3 finalize hook reads the comment text into `report_md` on the repair row; missing comment leaves the operator with the agent's terse `summary` only. |

## Out of scope (Phase 5 / Phase 6 own)

- Dashboard rendering of the repair report (Phase 5).
- 3-attempt cap + `unfixable` escalation surface (Phase 6).

If the card carries a `## Prior Repair Attempts` block with two prior
`failed` verdicts, you are attempt 3 — proceed as normal. Phase 6
will own the cap enforcement; until it lands, attempt 4+ may still
dispatch and you handle each like attempt 1.
