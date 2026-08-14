#!/usr/bin/env bash
# Post-compaction skill-reload gate — ships with the `base` plugin.
#
# Fires on SessionStart ONLY when the session source is `compact` (the
# hooks.json entry carries "matcher": "compact"; SessionStart matchers are
# matched against the source string, valid values: startup, resume, clear,
# compact, fork). Because it fires on exactly one source, it can be short
# and blunt instead of competing for attention with the ~40 lines of the
# generic startup mandate in plugin-skill-mandate.sh.
#
# WHY THIS EXISTS
# ---------------
# Compaction does not drop a skill body outright — it TRUNCATES it, leaving
# a large, authoritative-looking block of skill text in context marked
# `[... skill content truncated for compaction]`. An agent that checks
# "is the skill loaded?" against that block answers yes, and proceeds
# without ever calling Skill(). The generic mandate ("load the skill before
# the first mutating action") does not help: the agent believes the
# condition is already satisfied.
#
# Observed failure (2026-08-13): after a compaction, an agent saw a
# truncated danxbot:issue-card-workflow body, skipped Skill(), and violated
# three mandatory gates in it — created childless Feature containers,
# skipped the dependency-wiring gate, and treated prose "Depends on:" text
# as a substitute for real depends_on edges.
#
# WHY SessionStart AND NOT PostCompact
# ------------------------------------
# Only UserPromptSubmit, UserPromptExpansion, and SessionStart have their
# stdout added as context the model can see and act on. PostCompact output
# goes to the USER only — it cannot reach the model, so it is useless for
# this. SessionStart with source `compact` is the only event that both
# fires after a compaction and injects into the model's context.
#
# Argv: $1 = hook event name for the JSON envelope (always "SessionStart").

set -euo pipefail

EVENT="${1:-SessionStart}"

read -r -d '' MANDATE <<'EOF' || true
⚠ POST-COMPACTION SKILL RELOAD GATE — you just resumed from a compaction. Act on THIS text alone; do not wait to load anything first.

EVERY skill body now in your context is a FRAGMENT, not a loaded skill. Compaction truncates skill bodies in place and leaves behind text that reads convincingly like the real thing — headers, rule names, the shape of a checklist — while dropping the gates, the ordering constraints, and the exact mechanical checks that are the entire reason the skill exists. A summary of a gate is not the gate. Seeing a gate's NAME is not running it.

The ONLY proof a skill is loaded is a `Skill(<name>)` call YOU made AFTER this message. Anything above this line is pre-compaction residue and does not count.

MECHANICAL CHECK, before your first mutating action (Edit/Write/MCP mutate/git commit/push): for EVERY skill whose gates that action relies on — re-invoke `Skill(<name>)` NOW. Includes skills whose text you can see. Especially those.

"It's already in my context" / "I can still read the rule" / "I only need the part I remember" / "re-loading wastes tokens" are the exact rationalizations this gate blocks. The whole failure mode is that the truncated fragment looks sufficient. It is not.
EOF

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
