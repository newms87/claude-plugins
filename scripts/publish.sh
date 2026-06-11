#!/usr/bin/env bash
#
# Publish one or more plugins by bumping their .claude-plugin/plugin.json
# version, committing the bump, and pushing.
#
# WHY THIS EXISTS
# ---------------
# The marketplace loader auto-updates plugins only when the advertised
# `version` field changes. Source-tree edits to skills/rules do NOT
# trigger refresh on consumers — every consumer holds whatever version
# was cached at first install. Without a version bump on every meaningful
# edit, every fix you push silently never reaches dispatched workers /
# host sessions / other developers.
#
# This script makes the bump mandatory + automatic. Mirrors the pattern in
# ~/web/danx-ui/scripts/publish.sh; no npm publish (plugins distribute via
# GitHub), so the "publish" action is `git push` after the bump commit.
#
# USAGE
# -----
#   ./scripts/publish.sh <patch|minor|major> [plugin ...]
#
# With no plugin args: auto-detects every plugin whose tree has staged
# OR unstaged OR untracked changes since HEAD, bumps each, commits each
# in a separate commit, then pushes once at the end.
#
# With one or more plugin args: bumps ONLY those plugins (skips
# auto-detect, useful when you have changes in plugin A but only want to
# release plugin B's prior committed work).
#
# EXAMPLES
#   ./scripts/publish.sh patch
#   ./scripts/publish.sh minor danxbot
#   ./scripts/publish.sh major dev pipeline
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

err() { echo -e "${RED}$*${NC}" >&2; }
info() { echo -e "${YELLOW}$*${NC}"; }
ok() { echo -e "${GREEN}$*${NC}"; }

# --- Args ---------------------------------------------------------------

if [ $# -lt 1 ]; then
  err "Usage: $0 <patch|minor|major> [plugin ...]"
  exit 1
fi

BUMP_TYPE="$1"
shift
case "$BUMP_TYPE" in
  patch|minor|major) ;;
  *) err "First arg must be patch|minor|major (got: ${BUMP_TYPE})"; exit 1 ;;
esac

REQUESTED_PLUGINS=("$@")

# --- Locate repo root ---------------------------------------------------

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -f .claude-plugin/marketplace.json ]; then
  err "Not in the claude-plugins repo root (no .claude-plugin/marketplace.json at ${REPO_ROOT})."
  exit 1
fi

# --- Discover all plugin directories from marketplace.json --------------
#
# Marketplace.json is the single source of truth for which dirs are
# plugins. Walk it rather than guessing by directory layout so a future
# plugin nested under a subdir still works without code change.

mapfile -t ALL_PLUGINS < <(
  node -e '
    const m = require("./.claude-plugin/marketplace.json");
    for (const p of m.plugins) {
      // source like "./danxbot" -> "danxbot"
      const dir = p.source.replace(/^\.\//, "");
      console.log(dir);
    }
  '
)

if [ ${#ALL_PLUGINS[@]} -eq 0 ]; then
  err "marketplace.json declares no plugins."
  exit 1
fi

# --- Resolve target plugin set -----------------------------------------

declare -a TARGETS=()

if [ ${#REQUESTED_PLUGINS[@]} -gt 0 ]; then
  # Explicit list — validate each exists in marketplace.
  for p in "${REQUESTED_PLUGINS[@]}"; do
    found=0
    for known in "${ALL_PLUGINS[@]}"; do
      if [ "$p" = "$known" ]; then
        found=1
        break
      fi
    done
    if [ "$found" -eq 0 ]; then
      err "Unknown plugin: ${p}. Known: ${ALL_PLUGINS[*]}"
      exit 1
    fi
    TARGETS+=("$p")
  done
else
  # Auto-detect: any plugin whose subtree has changes vs HEAD (staged,
  # unstaged, OR untracked). We use porcelain output rather than `git
  # diff` so untracked new skill files count too — they're the whole
  # point of bumping the version.
  mapfile -t CHANGED_PATHS < <(git status --porcelain | awk '{ print $2 }')
  if [ ${#CHANGED_PATHS[@]} -eq 0 ]; then
    err "No changes detected. Pass plugin names explicitly to force a bump anyway."
    exit 1
  fi
  for plugin in "${ALL_PLUGINS[@]}"; do
    for path in "${CHANGED_PATHS[@]}"; do
      # Match plugin dir prefix. Trailing slash is required so plugin
      # "dev" doesn't false-match "developer/...". Marketplace plugin
      # names don't currently overlap but the discipline is cheap.
      if [[ "$path" == "${plugin}/"* ]]; then
        TARGETS+=("$plugin")
        break
      fi
    done
  done
  if [ ${#TARGETS[@]} -eq 0 ]; then
    err "Changes detected but none under a known plugin dir. Pass plugin names explicitly."
    exit 1
  fi
fi

info "Plugins to bump (${BUMP_TYPE}): ${TARGETS[*]}"

# --- Pre-flight: working tree must NOT have unrelated changes ----------
#
# We want a clean commit per plugin. If the operator has uncommitted
# changes in plugin A AND plugin B but only asked for A, B's changes
# would land in A's bump commit. Detect + warn.

if [ ${#REQUESTED_PLUGINS[@]} -gt 0 ]; then
  mapfile -t ALL_CHANGED < <(git status --porcelain | awk '{ print $2 }')
  for path in "${ALL_CHANGED[@]}"; do
    matched=0
    for t in "${TARGETS[@]}"; do
      if [[ "$path" == "${t}/"* ]] || [[ "$path" == ".claude-plugin/"* ]]; then
        matched=1
        break
      fi
    done
    if [ "$matched" -eq 0 ]; then
      err "Working tree has changes outside target plugins (${path}). Commit / stash them first or pass the additional plugin name."
      exit 1
    fi
  done
fi

# --- Bump + commit each plugin ----------------------------------------

declare -a BUMPED=()

bump_version() {
  local current="$1"
  local kind="$2"
  node -e "
    const [maj, min, pat] = process.argv[1].split('.').map(Number);
    const kind = process.argv[2];
    let v;
    if (kind === 'patch') v = [maj, min, pat + 1];
    else if (kind === 'minor') v = [maj, min + 1, 0];
    else if (kind === 'major') v = [maj + 1, 0, 0];
    else { console.error('bad kind'); process.exit(1); }
    console.log(v.join('.'));
  " "$current" "$kind"
}

for plugin in "${TARGETS[@]}"; do
  manifest="${plugin}/.claude-plugin/plugin.json"
  if [ ! -f "$manifest" ]; then
    err "Missing manifest: ${manifest}"
    exit 1
  fi
  current=$(node -p "require('./${manifest}').version")
  if [ -z "$current" ]; then
    err "No version field in ${manifest}"
    exit 1
  fi
  next=$(bump_version "$current" "$BUMP_TYPE")
  info "  ${plugin}: ${current} -> ${next}"

  # Rewrite the file via node so other fields + formatting are stable.
  node -e "
    const fs = require('fs');
    const path = process.argv[1];
    const ver = process.argv[2];
    const j = JSON.parse(fs.readFileSync(path, 'utf8'));
    j.version = ver;
    fs.writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
  " "$manifest" "$next"

  # Stage + commit JUST the plugin's tree + manifest. Other plugins'
  # untouched manifests stay out of this commit.
  git add "$manifest" "$plugin/"
  git commit -m "${plugin} v${next}"
  BUMPED+=("${plugin} v${next}")
done

# Push — UNLESS we are running inside a danxbot agent worktree.
#
# A dispatched danxbot agent works on branch `<agent>` in a worktree, not
# `main`. A bare `git push` from there lands the bump commit on
# `origin/<agent>` — never `origin/main` — so it ships NOTHING to
# consumers (the marketplace version-compares `main`). When DANX_AGENT_WORKTREE
# is set we therefore leave the bump committed on the agent branch and let
# `.danxbot/scripts/agent-finalize.sh` do the real push (`HEAD:main`, with a
# rebase-race loop). Operator/main-session runs (no DANX_AGENT_WORKTREE) push
# normally — unchanged behavior.
if [ -n "${DANX_AGENT_WORKTREE:-}" ]; then
  info "DANX_AGENT_WORKTREE set — bump committed on this branch; NOT pushing."
  info "Run .danxbot/scripts/agent-finalize.sh to squash + push HEAD:main."
else
  info "Pushing..."
  git push
fi

ok "Done:"
for line in "${BUMPED[@]}"; do
  echo "  - $line"
done
