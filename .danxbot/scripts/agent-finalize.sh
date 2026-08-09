#!/usr/bin/env bash
# agent-finalize.sh — Multi-worker dispatch completion (DX-162 / DX-158).
#
# Invoked by an agent at the end of a card dispatch from inside its
# persistent worktree at <repo>/.danxbot/worktrees/<agent-name>/. The
# script squashes the agent branch's WIP into one Conventional Commits
# commit on top of `origin/main`, pushes it (with rebase-loop on push
# race), and resets the agent branch back to a clean `origin/main` for
# the next dispatch.
#
# Usage:
#   bash .danxbot/scripts/agent-finalize.sh <agent-name> <CARD-ID> "<title>" "<bullet 1>" "<bullet 2>" ...
#
# Exit codes:
#   0  — success (squash commit pushed) OR no-op (agent had no commits to push)
#   1  — rebase conflict (`git rebase origin/main` exited non-zero); agent must
#        resolve, run `git rebase --continue`, and re-invoke the script.
#   2  — push race exhausted (5 consecutive non-fast-forward push rejections);
#        agent should comment on the card and signal danxbot_complete with
#        status "needs_help".
#   64 — usage error: missing args, malformed `<CARD-ID>`, or `<title>` contains
#        a newline. Distinct from rebase-conflict (1) so the SKILL routes the
#        agent to a "fix the invocation" path, not a "git rebase --continue"
#        path.
#   65 — wrong branch: invoked from a worktree whose HEAD is not on `<agent>`.
#        Distinct from 1 because the recovery is "investigate the worktree",
#        NOT "git rebase --continue".
#   66 — generation superseded (DX-1665 arm b): the worker's pre-push
#        generation-check (`$DANXBOT_GENERATION_CHECK_URL`) reported this
#        dispatch was superseded by a higher-generation re-dispatch. The push
#        is ABORTED — a zombie/partitioned worker must not double-merge. NOT a
#        recoverable error: the card is already owned by the newer dispatch;
#        this dispatch should terminate without retrying. The check is
#        fail-OPEN — an absent/empty URL, unreachable worker, non-200, or
#        unparseable body all PROCEED to the push (the dashboard reject is the
#        second gate), so 66 fires ONLY on a reachable, explicit superseded:true.
#
# Worktree-safety design (do NOT change without reading this paragraph):
# Each agent owns ONE worktree at <repo>/.danxbot/worktrees/<agent>/ with
# branch `<agent>` checked out. The parent repo at <repo>/ may have `main`
# checked out separately, so this script CANNOT do `git checkout main`
# inside the worktree (git refuses — "main is already checked out
# at /path/to/parent"). Instead the script squashes the branch via
# `git reset --soft <merge-base>` and pushes the agent branch's HEAD
# directly to `refs/heads/main` on origin (`git push origin HEAD:main`).
# The squash commit's parent IS origin/main, so the push is a fast-forward
# unless someone else pushed first — in which case we fetch + rebase
# the squash commit onto the new origin/main and retry.

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: agent-finalize.sh <agent-name> <CARD-ID> \"<title>\" \"<bullet>\" ..." >&2
  exit 64
fi

agent="$1"
card="$2"
title="$3"
shift 3
bullets=("$@")

# DX-1511 — run EVERY git op against the agent's worktree explicitly via
# `git -C "$WT"`, never bare `git` relying on the process cwd being inside the
# worktree. The clean-room launch path (DX-1511) spawns the agent in an
# EXTERNAL cwd (`/var/tmp/danxbot-clean-room/<install-hash>/<key>/`, outside any repo), so a bare
# `git` here would target the wrong tree (or fail with "not a git repository").
# `$DANX_AGENT_WORKTREE` is set by the dispatch layer for every agent-bound
# dispatch (the same path the worktree-guard hook enforces). This is SAFE on
# the OLD in-worktree path too: `git -C <worktree>` when already inside that
# worktree is a no-op. Fall back to the process cwd ("") only when the env var
# is unset (non-agent dispatch) — there the agent already runs inside its tree.
WT="${DANX_AGENT_WORKTREE:-}"
git() {
  if [[ -n "$WT" ]]; then
    command git -C "$WT" "$@"
  else
    command git "$@"
  fi
}

# Card id shape — `<PREFIX>-<N>` (e.g. `DX-162`). The id lands inside the
# Conventional Commits scope `feat(<card>):`; an unconstrained value could
# inject parens, spaces, or shell-meta chars into the commit subject and
# break downstream parsers (tracker bots, changelog generators). Reject at
# the gate, exit 64.
if [[ ! "$card" =~ ^[A-Z]+-[0-9]+$ ]]; then
  echo "agent-finalize: invalid card id '$card' — expected '<PREFIX>-N'" >&2
  exit 64
fi

# Title shape — single-line. Multi-line `git commit -m` arguments produce
# an unexpected commit-subject layout that breaks Conventional Commits
# linters and the dashboard's commit-summary renderer. Single-line titles
# are the contract; reject newlines at the gate.
if [[ "$title" == *$'\n'* ]]; then
  echo "agent-finalize: title must be single-line (no embedded newline)" >&2
  exit 64
fi

# 0. Sanity — must be on the agent's branch. The persona block in the
#    dispatch prompt names this branch; if the agent is on the wrong
#    branch the worktree may be wedged AND `git rebase --continue` would
#    be wrong recovery — so the script exits 65, distinct from
#    rebase-conflict (1).
current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$agent" ]]; then
  echo "agent-finalize: expected branch '$agent', got '$current_branch'" >&2
  exit 65
fi

# 1. Stage + commit any uncommitted work as a temporary WIP commit. The
#    rebase + squash flatten this back into the single conventional
#    commit so the WIP message itself never lands on origin/main.
if [[ -n "$(git status --porcelain)" ]]; then
  git add .
  git commit -m "WIP: $card"
fi

# 2. Fetch latest origin and rebase the agent branch onto origin/main.
#    `set -e` causes the script to exit non-zero on rebase conflict —
#    the agent reads the script's stderr (which carries git's own
#    conflict report from `git rebase`) and resolves before re-running.
git fetch origin
git rebase origin/main

# 3. Squash all commits the agent branch carries on top of origin/main
#    into ONE commit with a Conventional Commits header + bullet body.
#    `reset --soft` to merge-base preserves the working tree + index
#    contents (everything stays staged), then a single commit produces
#    the squash. If the branch carries zero commits ahead of
#    origin/main (agent ran finalize without making any code changes),
#    skip the squash + push and exit 0 — the calling skill should
#    have detected this earlier and skipped finalize altogether, but
#    defending here keeps a stray invocation from blowing up.
base="$(git merge-base HEAD origin/main)"
head="$(git rev-parse HEAD)"
if [[ "$base" = "$head" ]]; then
  # No commits to push. Emit `NO_OP` (NOT `PUSHED <sha>`) so an agent
  # that captures stdout into `retro.commits[]` doesn't record an
  # unreachable WIP sha as a real commit. The SKILL's Step 7a #5
  # ("No-op safety net") routes on the stderr substring; the stdout
  # token here lets a stricter parser distinguish the no-op from a
  # real push.
  echo "agent-finalize: no commits ahead of origin/main — nothing to push" >&2
  echo "NO_OP"
  exit 0
fi

git reset --soft "$base"
msg_args=(-m "feat($card): $title")
for b in "${bullets[@]}"; do
  msg_args+=(-m "- $b")
done
git commit "${msg_args[@]}"

# 3a. DX-1995 — dashboard production build gate. DX-1973 merged a required
#     field onto a backend type (`src/system-repair/types.ts`) without
#     updating dashboard fixtures; every quality gate passed because vitest
#     never type-checks, and nothing here ran the dashboard's own build
#     (`vue-tsc --noEmit && vite build`) — so `main` merged silently
#     undeployable. `dashboard-build-gate.ts` decides, from the squashed
#     diff against `$base`, whether this card's changes are dashboard-
#     reachable (a `dashboard/` edit, or a backend file the dashboard
#     imports via `@backend`); a pure-backend diff with no dashboard-
#     reachable import is skipped so unrelated cards don't pay the build
#     cost. All filesystem/git ops below run against "$WT" explicitly —
#     see the worktree-safety note above; the process cwd is the external
#     clean-room dir, not the worktree. Resolved via the worktree's own
#     `node_modules/.bin/tsx` (never `npx`) so a repo/fixture without the
#     gate script or a local tsx install (e.g. this script's own unit-test
#     fixtures, which are bare tmp git repos with no `src/` or
#     `node_modules/`) skips the check instead of falling through to a slow
#     or network-dependent `npx` resolution.
wt_dir="${WT:-$(pwd)}"
gate_script="$wt_dir/src/dispatch/dashboard-build-gate.ts"
tsx_bin="$wt_dir/node_modules/.bin/tsx"
if [[ -f "$gate_script" && -x "$tsx_bin" ]]; then
  if (cd "$wt_dir" && "$tsx_bin" src/dispatch/dashboard-build-gate.ts "$base" HEAD); then
    echo "agent-finalize: diff touches dashboard-reachable code — running dashboard build" >&2
    if ! (cd "$wt_dir/dashboard" && npm run build); then
      echo "agent-finalize: dashboard build failed — fix before finalizing (DX-1995)" >&2
      exit 1
    fi
  fi
else
  # Loud, not silent: a real worktree missing its own gate script or a
  # working `tsx` install is itself a broken-checkout signal worth a
  # breadcrumb, not a quiet no-op — the whole point of this gate is to
  # never let "nothing ran the build" pass unnoticed again (DX-1973).
  echo "agent-finalize: dashboard build gate skipped (gate_script=$([[ -f "$gate_script" ]] && echo present || echo missing), tsx=$([[ -x "$tsx_bin" ]] && echo present || echo missing))" >&2
fi

# 3a2. DX-2014 — backend `tsc --noEmit` gate. DX-2005 added required
#      `Dispatch` fields (`bootFloorTokens`/`firstTurn*`) without updating 3
#      backend test fixtures; every quality gate stayed green because
#      `vitest` never type-checks and (until this step) nothing in the
#      finalize/gate pipeline ran the backend's own `tsc --noEmit` — the
#      same silent-escape class the 3a dashboard build gate above closes for
#      the dashboard build, now closed for the backend type line. Scoped to
#      diffs that touch `src/` (a docs/dashboard-only diff has no backend
#      surface to break); resolved via the worktree's own
#      `node_modules/.bin/tsc` (never `npx`) so a fixture tree without a
#      `src/` or `node_modules/` skips the check instead of falling through
#      to a slow or network-dependent resolution.
tsc_bin="$wt_dir/node_modules/.bin/tsc"
if [[ -x "$tsc_bin" ]]; then
  if git diff --name-only "$base" HEAD | grep -q '^src/'; then
    echo "agent-finalize: diff touches backend src/ — running tsc --noEmit" >&2
    if ! (cd "$wt_dir" && "$tsc_bin" --noEmit); then
      echo "agent-finalize: backend tsc --noEmit failed — fix before finalizing (DX-2014)" >&2
      exit 1
    fi
  fi
else
  echo "agent-finalize: backend typecheck gate skipped (tsc=$([[ -x "$tsc_bin" ]] && echo present || echo missing))" >&2
fi

# 3b. DX-1665 arm (b) — split-brain fence: consult the dispatch's generation
#     BEFORE pushing. If this dispatch was superseded (a higher-generation
#     re-dispatch exists for the card after a worker-death re-queue), a
#     partitioned/zombie worker must NOT push blind — abort with exit 66.
#     Fail-OPEN by design (every branch except a reachable {superseded:true}
#     proceeds to the push), so a missing/empty URL, an unreachable worker, a
#     non-200, or unparseable JSON never wedges a legitimate finalize — the
#     dashboard-side reject (arm a) is the second gate. Every curl exit is
#     captured (`|| true`) so `set -euo pipefail` (line 41) can't kill us on a
#     transient.
#       env absent OR empty  -> skip check, push (legacy + THIS dispatch's own
#                               finalize; resolveInfraEnv ""-fills the key)
#       reachable + true     -> abort, exit 66 (do NOT push)
#       reachable + false    -> push
#       unreachable/non-200/unparseable -> push (gate 2 covers a real zombie)
if [[ -n "${DANXBOT_GENERATION_CHECK_URL:-}" ]]; then
  # NO `-f`: the `http_code == 200` check below is the SINGLE source of truth for
  # "the worker answered authoritatively". `-f` is redundant with that AND on some
  # curl builds suppresses the body that `-w` appends on a non-2xx — which would
  # turn a parseable non-200 into an empty body. Keeping `-sS` (quiet, but show
  # connect errors on stderr) + `|| true` keeps every branch fail-open.
  gen_body=""
  gen_http=""
  # DX-925: dispatch-internal route now — the presented bearer must be THIS
  # dispatch's own DANX_AGENT_TOKEN. An absent token still fails open (no
  # header -> 401 -> non-200 -> "push", the same as the pre-existing
  # unreachable/non-200 branches below), never a hard block.
  gen_body="$(curl -sS -m 10 -w $'\n%{http_code}' \
    -H "Authorization: Bearer ${DANX_AGENT_TOKEN:-}" \
    "$DANXBOT_GENERATION_CHECK_URL" 2>/dev/null || true)"
  gen_http="${gen_body##*$'\n'}"
  gen_json="${gen_body%$'\n'*}"
  if [[ "$gen_http" == "200" && "$gen_json" == *'"superseded":true'* ]]; then
    echo "GENERATION_SUPERSEDED: this dispatch was superseded by a higher-generation" \
         "re-dispatch — aborting the HEAD:main push (no double-merge). Exit 66." >&2
    exit 66
  fi
fi

# 4. Push the squash commit to origin/main with a rebase-loop on race.
#    `git push origin HEAD:main` fast-forwards origin/main to our
#    single squash commit. On non-fast-forward (someone else pushed
#    between our fetch in step 2 and now), refresh origin/main and
#    rebase our single commit on top, then retry. Cap at 5 attempts
#    so a wedged remote doesn't loop forever.
attempts=0
until git push origin HEAD:main; do
  attempts=$((attempts + 1))
  if [[ $attempts -ge 5 ]]; then
    echo "PUSH_RACE_EXHAUSTED" >&2
    exit 2
  fi
  git fetch origin
  git rebase origin/main
done

# 5. Reset the agent branch back to origin/main so the next dispatch
#    starts from a clean state. `git fetch` was already run inside the
#    push loop on every iteration, but post-push the local
#    `origin/main` ref needs to reflect the just-pushed sha.
git fetch origin
git reset --hard origin/main

# 6. Fast-forward `origin/<agent>` to match `origin/main` so the remote
#    agent branch never lags its own pushes (DX-644). The previous
#    dispatch left `origin/<agent>` pointing at WIP commits the squash
#    reset away locally; without this step those refs accumulate every
#    dispatch and a future prep-skill `git push` of the agent branch
#    fails non-fast-forward. `--force-with-lease` refuses to stomp a
#    concurrent push (rare on agent-owned branches but possible).
git push --force-with-lease origin "HEAD:refs/heads/$agent"

echo "PUSHED $(git rev-parse origin/main)"
