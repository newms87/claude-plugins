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
CONVEY — high-yield information transfer is the default for every report, commit message, PR description, issue comment / description / retro, Slack reply, code-review feedback, investigation finding, unblock note, hand-off prompt to a subagent. Full skill: base:convey.

Format (apply to any finished artifact someone else will read to decide something):

  ## <headline — what now works/fails/changed — ≤12 words>

  **Goal.** 1 sentence. User-visible. Plain English. No file paths.

  **Behavior diff.** | axis | Before | After | table.

  **Flow.** ASCII arrow diagram (only if multi-actor / non-linear).

  **Why non-obvious.** ≤2 lines. Skip when goal covers it.

  **Caveats / next actions.** Checkbox list — operator deploy / publish / restart, known limits.

  **Verify.** `cmd` → ✅ N/N | path:line audit pointers.

Rules — concepts before paths, tables over prose, bullets over sentences, present-tense system-actor verbs, drop fillers ("just", "basically", "actually", "essentially", "in order to", "make sure that", "the following is"). Composes with caveman — convey owns content + structure; caveman owns word-level form.

Self-trigger gate: before sending any response containing "Summary", "What shipped", "What I did", "Report", "Findings", "Results", a wall of file paths with prose around them, OR 3+ paragraphs about one change — apply the scaffold. If draft >40 lines for a single completed action, you're not applying convey.

Length budgets — end-of-turn report 30 lines, commit body 8, PR description 40, issue comment 20, Slack reply 12, investigation 20.
EOF

jq -n --arg event "$EVENT" --arg ctx "$MANDATE" \
   '{hookSpecificOutput:{hookEventName:$event, additionalContext:$ctx}}'
