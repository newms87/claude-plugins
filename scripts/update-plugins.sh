#!/usr/bin/env bash
#
# Bring every installed Claude Code plugin on this machine up to the version
# its marketplace currently advertises.
#
# WHY THIS EXISTS
# ---------------
# Claude Code's built-in plugin auto-update is disabled in this environment:
# the desktop app launches its CLI with DISABLE_AUTOUPDATER=1, which the docs
# state disables automatic updates "for both Claude Code and all plugins".
# `autoUpdate: true` on the marketplace entry never gets a chance to run.
#
# The visible symptom is nasty precisely because nothing errors: plugin
# versions are recorded PER PROJECT in ~/.claude/plugins/installed_plugins.json,
# so one project silently keeps loading months-old skills, rules and hooks
# while another project on the same machine runs current ones. Sessions look
# healthy the whole time. This machine sat on base v0.3.15 (June 9) in one
# project and v0.3.27 in another before anyone noticed.
#
# See also: https://github.com/anthropics/claude-code/issues/52218 — even with
# auto-update working, Claude Code may promote a plugin's runtime version
# without rewriting installed_plugins.json, leaving plugin-bundled HOOKS
# pinned to the stale installPath. Driving `claude plugin update` directly, as
# this script does, rewrites the record and so is immune to that bug.
#
# WHAT IT DOES
# ------------
#   1. Fast-forwards every marketplace clone under ~/.claude/plugins/marketplaces/
#      (Claude Code's own background refresh does not reliably git-pull these).
#   2. Runs `claude plugin update <plugin> --scope <scope>` once per installed
#      row, from that row's project directory, so project-scoped installs
#      resolve to the right project.
#
# Version comparison is deliberately NOT reimplemented here — the CLI already
# owns that logic and skips a plugin that is current. Running it per row is
# idempotent.
#
# Updates apply to the NEXT session; a running session keeps the versions it
# loaded at launch. That is Claude Code's own model, not a limitation of this
# script.
#
# USAGE
# -----
#   ./scripts/update-plugins.sh [--dry-run] [--quiet]
#
#   --dry-run          Report what would be updated; run no update, pull no clone.
#   --quiet            Suppress per-row progress; print only summary and errors.
#   --throttle <secs>  Exit 0 immediately if a run finished less than <secs>
#                      ago. For the SessionStart hook, so opening ten sessions
#                      an hour does not mean ten full update sweeps.
#
# Concurrent runs are serialized by a lock: a second invocation while one is
# running exits 0 without doing anything, rather than racing the first one's
# rewrite of installed_plugins.json.
#
# Exit status is 0 only when every row updated or was already current. A row
# that fails — including a plugin its marketplace no longer lists — exits 1
# and names the row, rather than being swallowed as "nothing to do".
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
DIM='\033[2m'
NC='\033[0m'

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PLUGINS_DIR="$CLAUDE_DIR/plugins"
INSTALLED_FILE="$PLUGINS_DIR/installed_plugins.json"
MARKETPLACES_DIR="$PLUGINS_DIR/marketplaces"
LOG_FILE="$PLUGINS_DIR/.plugin-update.log"
STAMP_FILE="$PLUGINS_DIR/.plugin-update.stamp"
LOCK_FILE="$PLUGINS_DIR/.plugin-update.lock"

DRY_RUN=0
QUIET=0
THROTTLE=0

# Kept for the lock re-exec below, which needs the original argv after the
# parse loop below has shifted it away.
ORIG_ARGS=("$@")

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  DRY_RUN=1 ;;
    --quiet)    QUIET=1 ;;
    --throttle) shift; THROTTLE="${1:-0}" ;;
    -h|--help)  sed -n '2,60p' "$0"; exit 0 ;;
    *) echo -e "${RED}Unknown option: ${1}${NC}" >&2; exit 1 ;;
  esac
  shift
done

if ! [[ "$THROTTLE" =~ ^[0-9]+$ ]]; then
  echo -e "${RED}--throttle takes a number of seconds (got: ${THROTTLE})${NC}" >&2
  exit 1
fi

err()  { echo -e "${RED}$*${NC}" >&2; }
ok()   { echo -e "${GREEN}$*${NC}"; }
info() { [ "$QUIET" -eq 1 ] || echo -e "${YELLOW}$*${NC}"; }
dim()  { [ "$QUIET" -eq 1 ] || echo -e "${DIM}$*${NC}"; }

log() { printf '%s\n' "$*" >> "$LOG_FILE"; }

# --- Preconditions ------------------------------------------------------
#
# Fail loud on a missing prerequisite. A silent no-op here would recreate the
# exact class of failure this script exists to end: everything looks fine,
# nothing is actually updated.

if ! command -v claude >/dev/null 2>&1; then
  err "The 'claude' CLI is not on PATH — cannot update plugins."
  exit 1
fi

if [ ! -f "$INSTALLED_FILE" ]; then
  err "No installed-plugins record at ${INSTALLED_FILE}."
  exit 1
fi

# --- Throttle + lock ----------------------------------------------------
#
# Both guards exist for the SessionStart hook, where many sessions can start
# close together. Throttle skips redundant sweeps; the lock keeps two sweeps
# from rewriting installed_plugins.json at the same time. Neither applies to
# a dry run, which writes nothing.

if [ "$DRY_RUN" -eq 0 ]; then
  if [ "$THROTTLE" -gt 0 ] && [ -f "$STAMP_FILE" ]; then
    last="$(cat "$STAMP_FILE" 2>/dev/null || echo 0)"
    if [[ "$last" =~ ^[0-9]+$ ]] && [ $(( $(date +%s) - last )) -lt "$THROTTLE" ]; then
      dim "Last update ran $(( ($(date +%s) - last) / 60 ))m ago (throttle ${THROTTLE}s) — skipping."
      exit 0
    fi
  fi

  # Re-run under an exclusive lock. Non-blocking: a concurrent run means the
  # work is already happening, so this invocation has nothing useful to add.
  # -E 75 gives lock contention its own exit code, so it can't be confused
  # with this script's own exit 1 (a row that failed to update).
  if [ -z "${PLUGIN_UPDATE_LOCKED:-}" ] && command -v flock >/dev/null 2>&1; then
    export PLUGIN_UPDATE_LOCKED=1
    set +e
    flock --nonblock -E 75 "$LOCK_FILE" "$0" "${ORIG_ARGS[@]}"
    rc=$?
    set -e
    if [ "$rc" -eq 75 ]; then
      dim "Another plugin update is already running — skipping."
      exit 0
    fi
    exit "$rc"
  fi
fi

log "=== $(date -Is) update-plugins.sh (dry-run=${DRY_RUN}) ==="

# --- Step 1: fast-forward the marketplace clones ------------------------
#
# `claude plugin update` compares against the local clone, so a stale clone
# makes every plugin look current. Claude Code's background refresh does not
# reliably fetch these clones, so pull them here first.

if [ -d "$MARKETPLACES_DIR" ]; then
  for clone in "$MARKETPLACES_DIR"/*/; do
    [ -d "${clone}.git" ] || continue
    name="$(basename "$clone")"
    if [ "$DRY_RUN" -eq 1 ]; then
      dim "  would pull marketplace: ${name}"
      continue
    fi
    if git -C "$clone" pull --ff-only >/dev/null 2>&1; then
      dim "  pulled marketplace: ${name}"
      log "  pulled: ${name}"
    else
      # Not fatal: a clone may be detached, offline, or seed-managed and
      # read-only. The plugin updates below still run against whatever the
      # clone currently holds — but say so rather than pass silently.
      info "  WARN: could not fast-forward marketplace clone '${name}'"
      log "  pull-failed: ${name}"
    fi
  done
fi

# --- Step 2: update every installed row ---------------------------------
#
# Rows are (plugin, scope, projectPath). Project- and local-scope rows are
# updated from inside their project directory, which is how the CLI resolves
# WHICH project's record to rewrite.

mapfile -t ROWS < <(
  python3 - "$INSTALLED_FILE" <<'PY'
import json, sys

with open(sys.argv[1]) as fh:
    data = json.load(fh)

seen = set()
for name, entries in data.get("plugins", {}).items():
    for entry in entries:
        # "-" marks "no project path" (user scope). An empty field cannot be
        # used: tab is IFS-whitespace, so bash's `read` collapses a run of
        # tabs and would shift every later field left by one.
        row = (name, entry.get("scope", "user"), entry.get("projectPath") or "-", entry.get("version", "?"))
        if row in seen:
            continue
        seen.add(row)
        print("\t".join(row))
PY
)

if [ ${#ROWS[@]} -eq 0 ]; then
  err "No plugin rows found in ${INSTALLED_FILE} — nothing to update."
  exit 1
fi

declare -a UPDATED=()
declare -a CURRENT=()
declare -a FAILED=()
declare -a SKIPPED=()

for row in "${ROWS[@]}"; do
  IFS=$'\t' read -r plugin scope project version <<<"$row"

  target_dir="$HOME"
  label="${plugin} [${scope}] ${version}"
  if [ "$project" != "-" ]; then
    if [ ! -d "$project" ]; then
      # The project directory is gone; its record can never resolve again.
      SKIPPED+=("${plugin} [${scope}] — project path missing: ${project}")
      continue
    fi
    target_dir="$project"
    label="${plugin} [${scope} @ $(basename "$project")] ${version}"
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    dim "  would update: ${label}"
    continue
  fi

  info "  checking ${label}"
  if output="$(cd "$target_dir" && claude plugin update "$plugin" --scope "$scope" 2>&1)"; then
    log "  ok: ${label} :: ${output//$'\n'/ }"
    if grep -qiE 'updated from' <<<"$output"; then
      UPDATED+=("${plugin} [${scope}] $(grep -oiE 'from [^ ]+ to [^ ]+' <<<"$output" | head -1)")
    else
      CURRENT+=("${plugin} [${scope}]")
    fi
  else
    log "  FAILED: ${label} :: ${output//$'\n'/ }"
    FAILED+=("${plugin} [${scope}] — ${output//$'\n'/ }")
  fi
done

# --- Summary ------------------------------------------------------------

# Stamp on any completed sweep, including one with failed rows — otherwise a
# permanently-broken row (a plugin its marketplace dropped) would defeat the
# throttle and re-sweep on every single session start.
[ "$DRY_RUN" -eq 1 ] || date +%s > "$STAMP_FILE"

for line in "${SKIPPED[@]}"; do info "SKIPPED: ${line}"; done

if [ "$DRY_RUN" -eq 1 ]; then
  ok "Dry run complete — $(( ${#ROWS[@]} - ${#SKIPPED[@]} )) of ${#ROWS[@]} installed rows would be checked."
  exit 0
fi

if [ ${#UPDATED[@]} -gt 0 ]; then
  ok "Updated ${#UPDATED[@]}:"
  for line in "${UPDATED[@]}"; do echo "  - $line"; done
  ok "Restart Claude Code (or /reload-plugins) to load the new versions."
else
  [ "$QUIET" -eq 1 ] || ok "All ${#CURRENT[@]} plugins already current."
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  err "Failed ${#FAILED[@]}:"
  for line in "${FAILED[@]}"; do err "  - $line"; done
  err "A row that no longer exists in its marketplace stays failed until it is uninstalled."
  exit 1
fi

exit 0
