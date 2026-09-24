# Shared UserPromptSubmit machine-authored-turn detection for the `danxbot`
# plugin's always-on mandates (plan-workflow-autoload.sh,
# zero-context-mandate.sh) — both need to suppress their per-turn pointer on
# a turn that did not originate with the operator. Extracted here because
# BOTH consumers live in this one plugin install. This file is NOT reusable
# by any other plugin's hooks (base's operating-contract.sh /
# craft-mandate.sh, human-collaboration's human-loop-mandate.sh,
# investigate's investigation-gate.sh): each plugin installs independently
# into its own cache dir under a distinct `${CLAUDE_PLUGIN_ROOT}`, so a
# script in one plugin cannot `source` a file that ships with another
# (DX-3235 decision — base carries its own identical copy at
# base/scripts/lib/prompt-guard.sh for its own two consumers;
# human-collaboration and investigate each have exactly one consumer of this
# logic and keep it inline rather than adding a single-consumer "shared" file
# that would only add indirection).
#
# Two markers, both checked against the raw `prompt` field of the
# UserPromptSubmit JSON payload — the ONLY field Claude Code's documented
# schema gives a hook to work with. Confirmed 2026-09-24 against
# https://code.claude.com/docs/en/hooks.md (UserPromptSubmit input =
# the common fields — session_id, prompt_id, transcript_path, cwd,
# scratchpad_dir, permission_mode, effort, hook_event_name, agent_id,
# agent_type — plus event-specific fields) cross-checked against the Agent
# SDK hook-input types (`UserPromptSubmitHookInput`: `hook_event_name:
# Literal["UserPromptSubmit"]`, `prompt: str`): there is no message-source /
# isSidechain / notification-type field on this event. `prompt` is the only
# carrier, so both discriminators below must live inside its text.
#   - RELAY_MARKER (DX-3051): a relayed danxbot dashboard event (a card
#     comment/title acted on in the dashboard), stamped by danxbot's own
#     plan-event-bridge.mjs.
#   - TASK_NOTIFICATION_MARKER (DX-3235): a background sub-agent's completion
#     report, delivered as a turn by the harness's own task-notification
#     mechanism. Matched as a WHOLE LINE reading exactly `<task-notification>`:
#     a real notification turn's text opens with that tag on its own line
#     (read from a session transcript, 2026-09-24). Whole-line, not substring,
#     so an operator prompt that mentions the tag inline still fires the gates;
#     not a strict prefix, because whether the hook's `prompt` carries a prose
#     preamble before the tag is unverified.

RELAY_MARKER='[danxbot-relayed-event]'
TASK_NOTIFICATION_MARKER='<task-notification>'

# node, NOT jq — jq is absent from the hook runtime PATH on the operator's
# Windows machine (and in WSL); node ships with Claude Code. `|| true` plus
# the empty-string catch keep a parse failure from aborting the turn.
extract_user_prompt() {
    printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)?.prompt??""))}catch{process.stdout.write("")}})' 2>/dev/null || true
}

# Exit-code predicate: success (0) when $1 is machine-authored text that a
# per-turn mandate must not re-fire on.
is_machine_authored_prompt() {
    local prompt="$1"
    if printf '%s' "$prompt" | grep -qF -- "$RELAY_MARKER"; then
        return 0
    fi
    if printf '%s' "$prompt" | grep -qxF -- "$TASK_NOTIFICATION_MARKER"; then
        return 0
    fi
    return 1
}
