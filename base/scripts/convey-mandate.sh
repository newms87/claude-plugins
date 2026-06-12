#!/usr/bin/env bash
# convey mandate — ships with the `base` plugin.
#
# Fires on SessionStart and UserPromptSubmit. Injects a brief reminder
# of the `convey` skill into every session so concept-first, scaffolded
# reports / comments / hand-offs / commit messages / Slack replies are
# the default for every information-transfer output the agent produces.
#
# convey lives at base/skills/convey/SKILL.md. This hook does NOT
# duplicate the full skill body — it surfaces the gist so the agent
# remembers to apply the scaffold + load the full skill when the
# response will be more than a one-liner.
#
# Argv: $1 = "SessionStart" or "UserPromptSubmit".

set -euo pipefail

EVENT="${1:-SessionStart}"

if [ "$EVENT" = "UserPromptSubmit" ]; then
    cat >/dev/null
fi

read -r -d '' MANDATE <<'EOF' || true
CONVEY — default for every report/commit/PR/comment/Slack/hand-off/investigation. Full skill: base:convey.

LEAD WITH THE CONCLUSION. Every output stands alone to a reader with ZERO session context — never make them scroll up or re-derive. Default depth = high-level (what + impact + next step); defer deep mechanism (internals, evidence chains) until asked — at most a one-line offer to expand. Gate: "would someone who just opened the chat get this without scrolling up?" No → cut detail, restate the conclusion.

Plain English (no codebase knowledge needed); concepts before paths (identifiers/paths in Verify line only); tables/diagrams over prose; drop fillers; reports ~30 lines.

Scaffold: ## headline (≤12w) → Goal (1 sentence) → Behavior diff table → Flow (ASCII, multi-actor only) → Caveats → Verify (`cmd` → ✅ N/N). Per-channel budgets + anti-patterns in the full skill.

Self-trigger: "Summary"/"Report"/"Findings"/"Results" in draft, wall of paths, 3+ paragraphs on one change, or >40 lines for one action → apply.

CHEAP-TO-VERIFY FACTS — read, never estimate. If a fact is one tool call away, READ it before asserting; a confident wrong fact is worse than "let me check." ELAPSED TIME is the canonical trap — you have ZERO reliable internal sense of wall-clock (sessions idle for hours, dates roll mid-session). Before ANY claim about duration / "N min ago" / "recently" / "just" / how-long-since: read the current clock, read the source timestamp, compute the difference, state THAT. Never narrate a duration from feel. Same for any one-lookup fact: current branch/HEAD, a row's status, file existence.
EOF

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
