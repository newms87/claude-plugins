---
name: halt-flag
description: 'Decision rule for status:"critical_failure" vs "failed" and the danxbot_complete signaling contract on env-level blockers.'
---

# Critical Failure — Signaling Environment Blockers

If the environment you're running in is broken in a way that is NOT specific
to the card you're working on, you MUST signal this to the worker so the
poller halts. Without this signal the poller re-dispatches you (and every
future agent) into the same broken box, burning tokens on work that cannot
succeed.

## When to use `status: "critical_failure"`

Use `critical_failure` ONLY for environment-level blockers that would break
ANY dispatch on this host, regardless of the card — not a problem specific to
your card's worktree:

- **MCP server(s) failed to load** — a tool you expected (schema, dashboard, etc.)
  is not present in your tools list when it should be.
- **Bash tool is broken** — returning errors unrelated to the command you ran
  (PATH issues, shell segfault, permission denied on the repo dir, the tool
  simply not available).
- **Claude auth credentials are missing or rejected** — 401s from the API, no
  `.claude.json` credentials found.
- **Critical CLI tools unavailable** — node, docker, git itself not available
  inside the dispatched session when your card needs them.
- **Any other "the agent on this machine cannot function" class of failure.**

**The one thing this is NOT: your own worktree's git state (DX-758).** A `git fetch` error, a
rebase conflict you cannot resolve, or a wedged worktree affects only THIS dispatch's worktree,
not the host — that routes to `failed` with a `≥30-char` summary naming the specific
file/region, never `critical_failure`. The worker stamps `blocked` on the candidate; the next
dispatched agent runs its own prep on a freshly-synced worktree. Worker-side env detection
NEVER stamps `agents.<name>.broken`; only N consecutive agent-emitted `failed` strikes do
(`src/agent/strikes.ts`).

Getting this wrong is expensive in both directions — `critical_failure` for a worktree-only problem halts every other agent's dispatch on the same host for no reason; `failed` for an env-wide problem (MCP gone) lets the poller burn the queue trying the same broken box.

Rule of thumb: if you tried to do a reasonable thing and the **tool itself**
(not the result) errored, it is likely a critical failure.

## When to use `status: "failed"` instead

Use `failed` (not `critical_failure`) for card-specific blockers. The
orchestrator moves the card to Blocked — it does NOT halt the poller,
because other cards might still be processable:

- Card description is ambiguous or incomplete.
- Dependencies aren't ready (another card must ship first).
- Tests for the feature can't be written without more info from a human.
- User feedback is needed before proceeding.
- The repo you'd need to modify is not accessible in this worker's bind mount.

## The signal

Call the `danxbot_complete` MCP tool with:

```
danxbot_complete({
  status: "critical_failure",
  summary: "<specific description of the env issue — operators read this>"
})
```

`summary` is REQUIRED and must be non-empty. The operator reads it to decide
what to fix on the host. Useless: `"Environment broken"`. Actionable: `"MCP
playwright tools not loaded — tools list shows only builtins; expected
`mcp__playwright__*` tools missing — likely the playwright container is down"`.

## What happens next

1. The worker raises a `board_halts` DB row (`raiseHalt`) with your summary — the sole halt home, not an on-disk file; it survives a container recreate.
2. The poller reads it and refuses to dispatch further agents on that board.
3. Dashboard Agents tab shows a red banner per-repo with your reason.
4. A human operator investigates, fixes the underlying env issue, and clears the halt via the dashboard button (`liftHalt`) — there is no file to `rm`.
5. Poller resumes once cleared.

There is a backup — the worker checks whether you moved the card out of ToDo
and halts itself if you didn't — but that only fires AFTER a full dispatch
runs. Prefer the explicit signal so you don't burn a full run's tokens
before the halt kicks in.

## Failing to signal is a rule violation

If your tools are broken badly enough that you cannot complete the card AND
you do not call `danxbot_complete` with `critical_failure`, you are the
direct cause of the next agent being dispatched into the same broken
environment. Signal explicitly. Do not just exit silently.
