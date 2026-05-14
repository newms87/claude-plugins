---
name: process-kill
description: 'MANDATORY before delivering any signal (SIGTERM / SIGKILL / SIGINT / etc.) to any specific process or PID. Loads Iron Rule + Proof Block requirement as TodoWrite checklist. Fires IMMEDIATELY on intent — do NOT pre-verify PID ownership, container state, or process aliveness before loading. Fires on: `kill <pid|name>`, `kill -9 <target>`, `kill -<sig> <target>`, `pkill <name>`, `pkill -f <pattern>`, `killall <name>`, `taskkill /F /PID <n>`, `docker kill <container>` (sends signal to container main process), "send SIGTERM/SIGKILL to <target>", "cleanup of stale processes", "kill the runaway X", "terminate the stuck Y", composite plans like "ps aux | grep X and then kill it" or "docker top X to find the PID and then send it SIGKILL". Does NOT fire on: read-only inspection without a follow-up signal verb (`ps`, `ps aux`, `pgrep`, `docker top`, `lsof`, `docker inspect --format`); signal-verb help/print (`kill --help`, `kill -l`, `kill -L`); graceful lifecycle managers (`docker compose down`, `docker compose restart`, `docker compose stop`, `docker stop`, `systemctl stop`, `systemctl restart`, HTTP `/api/cancel`, HTTP `/api/stop`); figurative usage ("kill the build", "kill the test run" meaning interrupt a runner via its own controls).'
---

# Process Kill Discipline

Workspace shared. Every running process may belong to user, another agent, unrelated program. Destroying any irreversibly → can delete hours of unsaved work. Treat `kill`, `pkill`, `kill -9`, `taskkill`, `SIGTERM`, `SIGKILL`, every other signal delivery same way: **production action, no undo**.

## When to Invoke

ANY of:
- About to call `kill`, `pkill`, `kill -9`, `taskkill`, send any signal
- About to "clean up orphans," "kill stale process," restart by-killing
- See process you didn't spawn that you think is no longer needed
- Tempted to use `pkill -f`, `killall`, `kill $(pgrep ...)` — FORBIDDEN

## The Iron Rule

May only kill process when **100% of the following are true**:

1. **Spawned it THIS session** (not prior session, not another agent, not user)
2. **Captured PID at spawn time** into a variable in your own code or notes — spawn command visible in conversation
3. **Captured PID is still the exact PID about to signal** (no `ps` lookup, no pattern match, no inference from time/TTY/CPU/cwd)

Even one not satisfied → don't kill. Ask user. Describe what you want to kill + why, wait for explicit action verb ("kill it," "stop it," "cancel it," "SIGTERM <pid>").

Correlation ≠ proof. Matching start time, TTY, CPU, "claude" string in command line — NONE evidence of ownership. Only evidence = PID personally captured at moment spawned.

## Capture PID at Spawn — Always, Anything That Might Run >30s

Even remote chance process lives >~30s → capture PID exact moment of spawning:

- Node `child_process.spawn()` → save `child.pid` immediately
- Shell `background_cmd &` → save `$!` immediately
- Python `subprocess.Popen()` → save `proc.pid` immediately
- `wt.exe` / `wsl.exe` wrapper scripts → script writes `$$` to PID file before `exec`

Lose PID → lost right to kill. Ask user. Do NOT reconstruct ownership from `ps`.

## Forbidden Tools

- **`pkill -f <pattern>`** — pattern-matching across all processes = unbounded blast radius. Never.
- **`killall <name>`** — same.
- **`kill $(pgrep ...)`** — same.
- Any shell construct killing by name, pattern, inferred ownership from `ps` — FORBIDDEN.

Only ever signal single PID captured yourself at spawn.

## Proof Block — Required Before Any Signal

Before calling `kill`/`pkill`/etc., conversation must contain Proof Block user can audit:

```
Target: PID <N>
Spawned by me at: <tool-call reference or line of code>
Captured as: <variable/note where I stored the PID>
Command I expect it to run: <exact args>
```

Cannot fill all four lines from memory of current session → don't kill. Ask.

## "It's Just Cleanup"

No such thing as "administrative" kill, "quick cleanup" kill, "obviously-mine" kill, "no one else could have that" kill, "just tidying up orphans" kill. Every signal to process not fully verified = potential destruction of someone else's work. Housekeeping not lower category — exactly as dangerous as production work.

When in doubt, process stays alive. Stale orphan ∞ cheaper than destroyed session.

## Why Skill Exists

An agent killed user's unrelated Claude Code session by guessing ownership from `ps` columns. Cost = hours of lost context. Future agent reaching for `kill` without Proof Block → about to repeat that incident. Stop. Ask.
