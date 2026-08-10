---
name: prod-access
description: 'Three reach paths into production (HTTP API / SSH / make targets), canonical debug recipes, forbidden-actions list.'
---

# Production Access — You DO Have Direct Shell Access

## The rule the agent keeps getting wrong

Production workers run on AWS EC2 instances per-target (e.g. `gpt`). The EC2 instance is remote, but **the local Bash tool can reach it through three established paths**: the deploy CLI, direct SSH, and the authenticated HTTP proxy on the dashboard. "It's on a production worker" is NOT a reason to say "I can't reach it from here." It is reachable — use the right command.

When a user asks about a deployed job, dispatch, session, or container — go pull the data instead of listing what would be needed.

## TodoWrite checklist (mandatory on first invoke)

1. Identify the target (`gpt`, etc.) and the question (job status, container log, infra state, DB row).
2. Pick the cheapest reach path: HTTP API > make-target > SSH.
3. If destructive (push to SSM, destroy, restart, secrets-push): STOP, ask user.
4. After pulling data: report the actual finding, not "I would need to check".

## Deployments

Per-target config: `<DANXBOT_REPO>/deploy/targets/<TARGET>.yml`. Each target = its own AWS account/region/resources, complete isolation, per-target SSM prefix (e.g. `/danxbot-<target>/...`), per-target EC2. Substitute `<TARGET>` (e.g. `gpt`) from the deployment the operator is asking about — `ls deploy/targets/` lists current targets.

### Running `make deploy TARGET=<t>` — two environment gotchas before it even starts

Both hit live (2026-08-10, DX-2133 deploy) and both fail FAST with a clear message once you know what they are — don't investigate further than this when you hit them:

1. **Node version.** The deploy CLI (`deploy/cli.ts`) needs Node 22+ (see `.nvmrc`). The shell's default/system Node (commonly 18.x) fails immediately with `SyntaxError: Unexpected token 'with'` (the `cli-spinners` dependency uses import-attribute syntax Node 18 doesn't parse). Fix: `source ~/.nvm/nvm.sh && nvm use 22` before running `make deploy`.
2. **`DANXBOT_TARGET` must match the `TARGET=` argument.** The repo's `.envrc` sets `DANXBOT_TARGET=local` on every shell start (direnv). Running `make deploy TARGET=gpt` without ALSO exporting `DANXBOT_TARGET=gpt` fails with `Deploy failed: Target mismatch: CLI argument is "gpt" but DANXBOT_TARGET env var is set to "local"`. A plain `unset DANXBOT_TARGET` does NOT fix it — direnv re-sets it on the next shell invocation. Fix: export it explicitly in the same command.

Full working invocation:
```bash
cd <DANXBOT_REPO> && source ~/.nvm/nvm.sh && nvm use 22 && export DANXBOT_TARGET=<t> && make deploy TARGET=<t>
```

### Worker swap during deploy can abort on a drain-wait timeout — this is a known gap, not a bug to re-diagnose

`deploy/steps/drain.ts` blocks the worker container swap behind a full in-flight-dispatch drain, capped at 15 minutes; on timeout it aborts the whole deploy and requires a literal interactive TTY confirmation (`--yes` is deliberately excluded from bypassing this specific step). If you hit `Drain wait timed out for <worker> with N dispatch(es) still in-flight`, that is expected current behavior, not a new failure to investigate — either wait for the in-flight dispatch(es) to finish naturally and re-run `make deploy` (image build is cached, it finishes in under a minute the second time), or check whether DX-2134 (redesign this to swap immediately and trust the container's existing `stop_grace_period` graceful-shutdown/autosave-resume path instead of blocking) has landed yet.

### A deploy can succeed on the dashboard but leave the worker on the OLD image

The dashboard and worker are separate EC2 instances, redeployed as separate steps in the same `make deploy` run. If the `drain` step times out (see above), the deploy aborts BEFORE the `workers` step runs — the dashboard is already on the new image, the worker is not. Check the deploy summary's per-step status (`✓`/`✗`/`⏭`) rather than assuming "deploy ran" means "both instances are updated."

### After a worker container swap, the fix may not be live even though the deploy succeeded — check for a stale materialize cache

If the deploy changed the config-MATERIALIZER's own logic (e.g. how `.claude/agents/*.md` gets written) without a corresponding content change to the underlying catalog artifacts in the DB, the worker's per-clean-room `.materialize-hash` cache can mask the fix — the cache key is computed from DB content only, not materializer code version, so an unchanged-content re-materialize after the deploy silently short-circuits and leaves the OLD (pre-fix) files on disk. Symptom: the exact same dispatch failure as before the fix, even though the new image is confirmed running.

**Check:** does `.claude/.materialize-hash`'s mtime postdate the deploy, but the actual file under `.claude/agents/<name>.md` predate it? That's this bug, not a regression in the fix.

**Workaround:** `rm` the stale clean-room's `.claude/.materialize-hash` on the worker to force a full rewrite on the next dispatch — path is `/var/lib/danxbot/worker/clean-room/<install-hash>/<repo>__<board>__<kind>__<profile>__<card>/.claude/.materialize-hash`. The real fix (bumping the materializer's own cache-invalidation version tag on a behavior change) is tracked as DX-2140 — check its status before re-diagnosing this from scratch.

## Reach paths

### 1. HTTP API (preferred for job/dispatch queries — no SSH, no streaming)

The dashboard proxies auth-gated requests to the right worker on `danxbot-net`. Public base URL = the operator's deployment hostname (read from the relevant `deploy/targets/<TARGET>.yml` `dashboard_host:` field, or check the operator's prior `make deploy-status` output). Routes:

| Route | Method | Notes |
|-------|--------|-------|
| `/api/launch` | POST | Body `{board, profile, task, api_token, overlay?, ...}` (DX-1715 — `profile` is the dispatch-identity selector, required; `board` is the `<repo>:<slug>` scope key, required) |
| `/api/status/:jobId?repo=<name>` | GET | Returns `{job_id, status, summary, started_at, completed_at, elapsed_seconds, input_tokens, ...}` |
| `/api/cancel/:jobId?repo=<name>` | POST | |
| `/api/stop/:jobId?repo=<name>` | POST | External stop (not the in-agent MCP callback) |

All require `Authorization: Bearer <token>`. Token in SSM:

```bash
DANXBOT_DISPATCH_TOKEN=$(aws --profile <TARGET> ssm get-parameter \
  --name /danxbot-<TARGET>/shared/DANXBOT_DISPATCH_TOKEN \
  --with-decryption --region <REGION> \
  --query Parameter.Value --output text)

curl -sS -H "Authorization: Bearer $DANXBOT_DISPATCH_TOKEN" \
  "https://<your-danxbot-deployment>/api/status/<jobId>?repo=<connected-repo>"
```

Right tool for: "why did job X time out / what was its summary / how long did it run".

### 2. Container logs on the EC2 instance

```bash
# Tails `docker compose -f docker-compose.prod.yml logs -f --tail=100` via SSH.
# Streaming — cap with `timeout` or background + grep.
timeout 20 make deploy-logs TARGET=<TARGET> 2>&1 | grep <jobId>
```

Use for: timeout reasons, stall detection traces, HTTP request errors, any `[Job <id>] ...` line from `src/agent/launcher.ts` or `src/worker/dispatch.ts`.

### 3. SSH for arbitrary shell on the instance

**CRITICAL: do not use bare `terraform output -raw public_ip`.** Terraform's backend is per-target and the last-initialized workspace wins — reading outputs without `terraform init -reconfigure` first gives the IP of whichever target you last deployed, not the one you want. The deploy CLI does this correctly:

```bash
# Run from <DANXBOT_REPO>. Get the real IP for a target by running the deploy CLI's init-then-output pipeline:
IP=$(timeout 30 npx tsx deploy/cli.ts status <TARGET> 2>&1 | grep -oE 'public[_ ]ip[^0-9]*[0-9.]+' | grep -oE '[0-9.]+$')
# Or parse from deploy-logs stdout (it prints the exact SSH command including the IP).

KEY=~/.ssh/danxbot-production-key.pem
ssh -i $KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR ubuntu@$IP \
    "cd /danxbot && docker compose -f docker-compose.prod.yml ps"

# Interactive session (user-driven — not ideal from Bash tool):
make deploy-ssh TARGET=<TARGET>
```

From inside the instance, the entire worker container is reachable: `docker exec danxbot-worker-<connected-repo> ...` for `psql` queries against the dispatches DB, file reads on `~/.claude/projects/...` (claude session JSONLs), or any diagnostic shell.

### 4. SSM + Terraform state for infra questions

```bash
make deploy-status TARGET=<TARGET>           # health + instance state
aws --profile <TARGET> ssm get-parameters-by-path --path /danxbot-<TARGET>/ --recursive --region <REGION>
```

## Canonical debugging recipes

**"Why did job X time out?"** → HTTP status (path 1) gives the `summary` string (`"Agent timed out after N seconds of inactivity"` vs `"Agent exceeded max runtime of N minutes"`). If more is needed: `make deploy-logs TARGET=<target>` + grep for the jobId.

**"What session ID maps to job X?"** → Path 1 (if `session_id` is in `getJobStatus`) or SSH + `grep <dispatchId> ~/.claude/projects/*/*/*.jsonl` inside the worker container.

**"Is worker X alive?"** → `make deploy-status TARGET=<target>` (health probe).

**"What's in the dispatches DB?"** → SSH + `docker exec danxbot-postgres psql ...` (never delete rows — read-only queries only unless the user explicitly asks).

## Forbidden

- Saying "I don't have access to the production worker" when `make deploy-*` targets exist.
- Running production read commands in a `run_in_background` loop — use `timeout` to cap streaming commands.
- Pushing to SSM, destroying infra, restarting the instance, or running `make deploy-destroy` / `make deploy-secrets-push` without explicit user approval.
- Assuming the Laravel dispatch row mirrors worker state — neither timeout path in `launcher.ts` PUTs terminal status (`cleanup()` + `onComplete()` only), so the Laravel row can be stale while the worker already finalized. Pull the worker's HTTP status or container logs as ground truth.
