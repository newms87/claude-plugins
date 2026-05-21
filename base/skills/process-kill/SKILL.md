---
name: process-kill
description: 'MANDATORY before delivering any signal (SIGTERM / SIGKILL / SIGINT / etc.) to any specific process or PID. Loads Iron Rule + Proof Block requirement as TodoWrite checklist. Fires IMMEDIATELY on intent — do NOT pre-verify PID ownership, container state, or process aliveness before loading. Fires on: `kill <pid|name>`, `kill -9 <target>`, `kill -<sig> <target>`, `pkill <name>`, `pkill -f <pattern>`, `killall <name>`, `taskkill /F /PID <n>`, `docker kill <container>` (sends signal to container main process), "send SIGTERM/SIGKILL to <target>", "cleanup of stale processes", "kill the runaway X", "terminate the stuck Y", composite plans like "ps aux | grep X and then kill it" or "docker top X to find the PID and then send it SIGKILL". Does NOT fire on: read-only inspection without a follow-up signal verb (`ps`, `ps aux`, `pgrep`, `docker top`, `lsof`, `docker inspect --format`); signal-verb help/print (`kill --help`, `kill -l`, `kill -L`); graceful lifecycle managers (`docker compose down`, `docker compose restart`, `docker compose stop`, `docker stop`, `systemctl stop`, `systemctl restart`, HTTP `/api/cancel`, HTTP `/api/stop`); figurative usage ("kill the build", "kill the test run" meaning interrupt a runner via its own controls).'
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
