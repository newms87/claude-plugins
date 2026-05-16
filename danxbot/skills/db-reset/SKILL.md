---
name: db-reset
description: 'MANDATORY when an agent is about to run any destructive database operation (Laravel `migrate:fresh` / `migrate:refresh` / `migrate:reset` / `db:wipe`, raw `DROP DATABASE` / `DROP SCHEMA`, `dropAllTables` / `dropAllViews` / `dropAllTypes`, or any shell-or-MCP route that achieves the same effect), encounters the `base/scripts/deny-destructive-db.sh` "BLOCKED: destructive database operation" deny message, OR reasons about "the test DB needs a clean slate", "tests are failing because of leftover rows", "I need to re-run migrations from scratch", "my schema is corrupted", "I need to reset the database". Loads the only sanctioned reset path: `bash <worktree>/.danxbot/safe-reset-db.sh` (optionally `--seed`). The script is the contract — the skill body forbids chmod-ing, editing, mimicking, or replicating it via psql / artisan / docker exec / raw SQL.'
audience: worker
---

# Sanctioned Database Reset — `safe-reset-db.sh`

You are about to reset, refresh, drop, wipe, or roll back a database.
**STOP.** Every direct destructive command is blocked by the
`base/scripts/deny-destructive-db.sh` PreToolUse hook — you cannot run
`php artisan migrate:fresh`, `db:wipe`, `DROP DATABASE`, or any
equivalent and have it succeed. There is exactly ONE sanctioned reset
path. Use it. Do not invent a workaround.

## Why this skill exists

On 2026-05-15 an autonomous agent (harry) ran `php artisan
migrate:fresh` against an unsoped worktree whose `.env` symlinked to
the primary repo's `.env`. `DB_DATABASE` resolved to the primary
development database. `migrate:fresh` dropped every table in primary.
Months of historical data lost. The repo-wide fix landed in three
phases under epic DX-570:

1. **Phase 1 (DX-571)** — per-worktree Postgres database + role.
   The worktree role has zero privilege on primary; even an unscoped
   `migrate:fresh` from inside a worktree can ONLY ever destroy that
   worktree's own DB.
2. **Phase 2 (DX-572)** — per-consumer-repo `safe-reset-db.sh` template
   that the worker provisions into every worktree at
   `<worktree>/.danxbot/safe-reset-db.sh`. The script reads the
   worktree's own `.env`, defensively refuses to operate on primary,
   then runs the consumer-repo-appropriate reset.
3. **Phase 3 (this skill)** — closes the loop. The deny hook blocks
   destructive commands; this skill tells the blocked agent where the
   sanctioned alternative lives so the agent doesn't sit and invent
   workarounds that the hook will also block.

Phase 1 makes the destructive command merely "blow up the worktree DB"
instead of "blow up primary." Phase 2 ships the sanctioned tool.
**Phase 3 (this skill) is the only thing standing between an agent and
30 minutes of invented-workaround attempts that all fail the deny
hook.** Use the skill.

## The Hard Rule

**Agents NEVER invent their own destructive DB command, even on the
worktree DB.** The deny hook blocks every direct destructive command at
the Bash tool boundary and will continue to block every variant you
try. Working around the hook (raw `psql DROP`, `TRUNCATE` loops in a
shell loop, deleting-then-migrating, recreating a Docker volume,
chmod-ing or editing the script to bypass its own guard, copying the
script's body into your own Bash command) is **forbidden** regardless
of how clean the result looks. The script is the contract. Call it.
Do not reinvent it.

## The Sanctioned Path

Run this exact command, substituting the literal absolute path your
dispatch's `Your worktree:` line names:

```bash
bash <worktree>/.danxbot/safe-reset-db.sh
```

Optionally pass `--seed` if the consumer repo's reset recipe supports
re-seeding and your work needs fresh fixtures:

```bash
bash <worktree>/.danxbot/safe-reset-db.sh --seed
```

That's the entire surface. No `--database=` override, no `--env=`
override, no `--force` flag, no "skip the safety check" flag. The
target is always the worktree's own DB, derived from
`<worktree>/.env`. The script:

1. Reads `<worktree>/.env` (already worktree-scoped after DX-571).
2. Hard-fails if its derived `DB_DATABASE` matches the primary repo's
   primary DB name (defense-in-depth — even though Phase 1's role
   REVOKE makes the operation impossible, the script refuses to even
   try).
3. Runs the consumer-repo-appropriate reset against the worktree DB
   only.
4. Logs every step to stdout for your tool result.
5. Exits non-zero on any failure.

## Pre-run Checklist (10 seconds, do every time)

Before invoking the script, confirm:

1. **You are in a worktree, not the operator's main shell.** Your
   dispatch's persona block names `Your worktree:` — that path must
   contain `.danxbot/worktrees/`. If it doesn't, STOP — you are NOT a
   dispatched agent and you have no authority to run this. Tell the
   operator and exit.
2. **The script exists at the expected path.** Run
   `ls <worktree>/.danxbot/safe-reset-db.sh`. If it returns ENOENT,
   the consumer repo has no reset recipe — STOP and report. Do NOT
   create one yourself; the script lives in the consumer repo and
   the worker provisions it into your worktree. A missing script
   means either Phase 2 (DX-572) provisioning failed OR the
   consumer repo never authored a template (non-DB repos, future
   consumer repos onboarding later).
3. **Your worktree's `.env` carries a worktree-specific DB name.**
   Run `grep '^DB_DATABASE=' <worktree>/.env`. The value must NOT be
   the primary repo's primary DB name (e.g. for gpt-manager that's
   `laravel`). If it does match, STOP — Phase 1 provisioning is
   broken; do NOT run the reset. Report to the operator with the
   exact `DB_DATABASE` value you observed.

If all three checks pass, invoke the script.

## Failure Handling

The script exits non-zero on any failure. **Do NOT chase the failure
with manual `psql` / `docker exec` / `php artisan` workarounds.** The
deny hook will block every direct destructive command you try; even
if it didn't, you would be reproducing the SG-162 incident class
exactly.

Read the script's stderr verbatim. Then:

- **Environmental failure** (Docker not running, MySQL/Postgres
  connection refused, role permissions broken, consumer repo's reset
  recipe references a tool that isn't installed) → report to the
  operator. Add a `## Operator action required` comment on your card
  describing what the script said + what the operator needs to do.
  Follow Step 10 (Blocked) on the card if the failure prevents your
  current card from progressing.

- **Script bug** (script logic error, script crashed before doing
  anything useful, script's guard misidentified the worktree DB as
  primary) → file an issue card via
  `mcp__danxbot__danx_issue_create({type: "Bug", title, description, ac, ...})`
  describing the script's behavior + expected behavior + the exact
  stderr output. Push the returned id into your retro's
  `action_item_ids[]` only if it is large + separately scopeable;
  small in-script bugs you can fix in-session belong in this dispatch.

- **You don't know which category** → assume environmental, report to
  the operator. The script is small and human-readable; if it has a
  bug, the operator can patch it faster than you can debug it.

## Anti-Patterns the Skill Forbids

| Forbidden | Why |
|---|---|
| `chmod +x <worktree>/.danxbot/safe-reset-db.sh` | The worker provisions the script chmod-ed +x already (DX-572). If it isn't, that's a Phase 2 provisioning bug — file an issue, do NOT silently fix it. |
| Editing the script (`Edit <worktree>/.danxbot/safe-reset-db.sh ...`) | The script is consumer-repo-authored and lives at `<repo>/.danxbot/safe-reset-db.sh` in the consumer repo. Edits to the worktree copy are blown away on the next provisioner run AND bypass the consumer repo's review gate. File an issue against the consumer repo if the script's behavior needs to change. |
| Copying the script's body into your own Bash command | Same outcome as editing — bypasses the script's guard rails AND the deny hook. The hook only knows about command shapes; bypassing the script means re-implementing the safety check, which you will get wrong. |
| Calling `php artisan migrate:fresh` / `db:wipe` directly | Blocked by `base/scripts/deny-destructive-db.sh`. You will sit in a deny-retry loop. |
| Calling `docker exec <container> php artisan migrate:fresh` | Same hook pattern, same block. |
| Calling `psql -c 'DROP DATABASE ...'` / `mysql -e 'DROP DATABASE ...'` | Same hook pattern, same block. |
| `TRUNCATE` loops over `information_schema.tables` | Reinventing `db:wipe` by another route. The hook may not catch it, but you are now operating without the script's defense-in-depth check that the target DB is NOT primary. SG-162 in slow motion. |
| Recreating the Docker volume to "reset" the DB | Bypasses every guard. Destroys whatever else lives in that volume. |
| Asking the operator to disable the deny hook | The hook exists because of SG-162. Disabling it re-opens the failure mode. The answer is always "run the sanctioned script." |
| Inventing a new "safe reset" script in your worktree | Phase 2 already shipped one. Find it or report it missing. |

The script is the contract. The agent calls it. The agent does not
reinvent it.

## Forward-Looking Notes

- **Non-Laravel consumer repos** — when a future consumer repo onboards
  to danxbot and ships its own `<repo>/.danxbot/safe-reset-db.sh`, this
  skill applies unchanged. The script's shape (worktree-scoped reset,
  no override args, hard-fails on primary, optional `--seed`) is the
  contract; the recipe inside is the consumer repo's concern.
- **`--seed` semantics** — defined by the consumer repo's script. If
  your work needs seeded data and the script doesn't support `--seed`,
  file an issue against the consumer repo. Do NOT seed manually after
  the reset; that recreates the "agent invents reset paths" failure
  mode for the seed step.
- **Rollback** — `php artisan migrate:rollback` is NOT blocked by the
  deny hook (rollback is reversible and a normal migration-dev
  operation). Use rollback when you need to step back through
  migrations during migration authoring; use this skill when you need
  to reset the database wholesale.
