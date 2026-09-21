---
name: process-kill
description: Signal-delivery discipline — Iron Rule + Proof Block before kill / pkill / SIGKILL / docker kill of any specific process or PID.
---

# Process Kill Discipline

Workspace shared. Every running process may belong to user, another agent, unrelated program. Destroying any irreversibly → can delete hours of unsaved work. Treat `kill`, `pkill`, `kill -9`, `taskkill`, `SIGTERM`, `SIGKILL`, every other signal delivery same way: **production action, no undo**.

## Iron Rule — Kill ONLY when ALL true

1. **Spawned it THIS session** (visible in conversation)
2. **Captured PID at spawn** into a variable
3. **Same PID still active** (no `ps` lookup, no pattern match)

One fails → ask user instead.

Correlation ≠ proof. Start time, TTY, CPU, "claude" in cmdline = not evidence. Only proof = PID you captured.

## Capture at spawn — >30s processes

- Node: `child.pid` immediately
- Shell: `$!` immediately  
- Python: `proc.pid` immediately
- Scripts: `$$` to PID file before `exec`

Lose PID = lose kill right.

## Forbidden tools

- `pkill -f <pattern>` (unbounded)
- `killall <name>` (unbounded)
- `kill $(pgrep ...)` (unbounded)
- Shell constructs killing by name/pattern/inferred ownership

Only single captured PID, ever.

## Proof block — before ANY signal

```
Target: PID <N>
Spawned: <tool ref or code line>
Captured as: <variable>
Expect to run: <exact args>
```

Can't fill all four from this session → ask.

## "Orphan" labeling — prove absence first

1. Read source-of-truth yourself (quote it)
2. Verify response shape before parsing
3. Exhaust all query params/filters
4. Enumerate every plausible owner

Only then defensible. Label still doesn't authorize kill.

**Forbidden:** housekeeping justifications ("just cleanup," "obviously mine," "no one else could have"). All signals = production action, no undo.

## Restarting a shared dev server — owning it does not clear you to bounce it

A dev server / preview server / local service reachable at a fixed address (a port, a
container name, a launcher-config entry) is not scratch space even when you spawned it,
even when a tool made spawning it one call. A person may have a browser tab open against
it right now — mid-review, mid-form, mid-anything — and every in-flight request or open
connection on it dies the instant you stop or relaunch it. That is true whether you kill
it directly or a helper tool restarts it for you (a "start/ensure this server is running"
call that finds one already up and cycles it instead of reusing it has the same effect as
a manual kill+relaunch, even though no `kill` command appears anywhere in your own
commands).

The Iron Rule above answers "may I signal this PID" — ownership and provenance. It does
not answer "is anyone using it right now," which is a separate question and the more
common way this goes wrong: restarting a server you legitimately spawned, or that a
launcher tool spawned on your behalf, out from under a live user.

**Before stopping, restarting, or relaunching any server a live person could be pointed
at — not just one you're about to `kill`:**

1. Check for a live connection first (an established session/socket on its port, a
   recent request in its access log) rather than assuming the coast is clear because
   *you* have no memory of anyone using it.
2. If a live connection is found, don't restart it silently. Say so and either wait,
   or get confirmation, before you cycle it.
3. Prefer reuse over restart — if the tool you're using can attach to an already-running
   instance instead of stopping and relaunching it, do that.

This is the same "production action, no undo" standard the Iron Rule already applies to
signals — it just also covers the restart paths that never send a `kill` at all.
