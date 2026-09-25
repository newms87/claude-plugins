---
name: host-environment
description: 'Host-machine shell discipline: local-vs-prod dev stack, HMR-immediate, file-not-found diagnosis, docker-just-start.'
---

# Environment Rules

## "Locally" Means The Local Dev Stack, Not "From My Terminal"

User says "locally" / "local" / "on my machine" → means the dev stack running on THIS HOST (containers, local services, `localhost:<port>`), not "run commands from my terminal against production." Check what's actually running locally first (e.g. `docker ps`). Only touch production when the user explicitly says "prod", "production", "deployed", or names a deployment target. Rule exists because SSHing into prod feels equivalent to the agent ("still my terminal") but is categorically different from the user's mental model.

## Everything Is Immediate In A Hot-Reload Dev Stack

If the local dev stack has hot-reload (Vite HMR, live CSS, etc.), a saved file is live immediately — don't run a production build just to "see" the change. Only build when explicitly requested for final validation.

## Never Ask About Environment

See `human-collaboration:human-loop` — Never Ask User About Behavior Code Can Answer; environment state (commit, setup) is one more code-answerable fact.

That premise justifies not ASKING; it never licenses ASSUMING which tree / host / container you actually read from. When that is load-bearing to a claim, name it and check it.

## "File Not Found" — Wrong Path, or Wrong Filesystem. Never "Lag"

A container volume-mounted from the host shares one filesystem: host file = container file, no "host version" vs "container version". There, `file not found` is a wrong path essentially every time — run `pwd`, fix the path, move on. Never search the filesystem for a path you already know, never try container paths when host paths fail, never hypothesize about partial clones.

The one real exception is a repo that exists **twice** on genuinely different filesystems — a native checkout mirrored to another OS side, a VM, a sync tool. Then each side holds its own copy, some paths are excluded from the mirror outright (scratch dirs, `.env`, generated trees), and creation may not propagate symmetrically. Establish which side you are reading from and which side must execute the file, then create new files on the executing side. Anything machine-specific about the local topology belongs in the user-global `CLAUDE.md`, not here.

**A sync delay is never the diagnosis** — it would explain any absence, so it explains nothing. Check the mirror's exclusion list, then read the file back from the side that matters.

## Docker Containers: Just Start Them

Stopped container ≠ broken infrastructure. `docker compose up -d` and continue. Never install dependencies on host, run project scripts on host, try alternatives that bypass container.
