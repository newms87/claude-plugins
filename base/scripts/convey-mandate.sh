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
CONVEY — default scaffold for reports/commits/PRs/comments/Slack/hand-offs/investigations. Full skill: base:convey.

Scaffold: ## headline (≤12w) → Goal (1 sentence) → Behavior diff table → Flow (ASCII, multi-actor only) → Why non-obvious (≤2 lines) → Caveats (checkbox) → Verify (`cmd` → ✅ N/N).

Rules: concepts before paths; tables over prose; bullets over sentences; drop fillers. Budgets — report 30 lines, commit body 8, PR 40, comment 20, Slack 12, investigation 20.

Self-trigger: "Summary"/"Report"/"Findings"/"Results" in draft, wall of paths, 3+ paragraphs on one change, or >40 lines for one action → apply.
EOF

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
