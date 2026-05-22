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
