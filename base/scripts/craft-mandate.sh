#!/usr/bin/env bash
# craft mandate — ships with the `base` plugin.
#
# Fires on SessionStart AND UserPromptSubmit. Injects the "build the ideal
# version, not the fast one" discipline into every session AND every turn so
# it survives context compression and stays top-of-context at the moment
# work actually starts — matches operating-contract.sh's always-on pattern.
#
# SCOPE: build QUALITY only. The evidence / never-assume / orchestrate /
# experiment-first principles live in operating-contract.sh and must not be
# restated here.
#
# There is intentionally NO companion skill. This mandate IS the contract —
# it must fire always, not wait for a trigger.
#
# Argv: $1 = "SessionStart" or "UserPromptSubmit".

set -euo pipefail

EVENT="${1:-SessionStart}"

if [ "$EVENT" = "UserPromptSubmit" ]; then
    INPUT="$(cat 2>/dev/null || true)"
    # A relayed danxbot dashboard event, or a background
    # sub-agent's task-notification report, is not new operator intent — this
    # mandate is already in context from SessionStart, so re-asserting it on
    # either kind of machine-authored turn is pure per-event tax with nothing
    # new to say. Shared with operating-contract.sh (this plugin's only other
    # UserPromptSubmit consumer of this guard) via lib/prompt-guard.sh — see
    # that file's header for why this is NOT shared across plugin boundaries.
    # This does NOT touch the full-vs-pointer cadence question — it
    # only suppresses output entirely on a machine-authored turn, whatever
    # this branch would otherwise emit. Do not delete this as dead code.
    source "${CLAUDE_PLUGIN_ROOT}/scripts/lib/prompt-guard.sh"
    PROMPT="$(extract_user_prompt "$INPUT")"
    if is_machine_authored_prompt "$PROMPT"; then
        exit 0
    fi
fi

read -r -d '' MANDATE <<'EOF' || true
CRAFT — always-on, every context. Build the ideal version, not the fast one.
Never the quickest thing that technically satisfies the literal ask. "Good
enough for now" is not a real option unless the user explicitly asked for a
throwaway/prototype. Time-to-build and token cost are NOT constraints on
quality.

FOUR HARD RULES:
1. ZERO tech debt. No legacy code paths, no backwards-compatibility shims, no
   half-finished implementations, no commented-out old versions "just in
   case." If a rebuild replaces something, the old thing is gone, not kept
   alongside it.
2. FULLY responsive, always. Every UI ships handling every real breakpoint
   (mobile/tablet/desktop) and full-width layouts — never a fixed-width
   column dropped into a page and called done. And a UI is verified in its
   INTERACTION states, not just at rest: actually press, hover and focus the
   control and confirm nothing jumps, clips or reflows. A synthetic `.click()`
   fires no mousedown and no `:active`, so it proves nothing about the pressed
   state — press it for real, or measure what `:active` computes to.
3. REAL app chrome, never a bare page. Any user-facing screen in a real
   product gets the actual navigation/identity/appearance affordances a
   shipped app needs — a working sign-out, a real header/nav, an Appearance
   control (theme/text size/contrast/motion) — not a static text block
   standing in for a menu. Before shipping a new screen, name what a real
   user would expect to click that isn't there yet.
4. Hold every deliverable to "would this pass review from an elite,
   battle-tested product/eng/QA team with zero caveats" — not "does this
   satisfy the literal request." When the two diverge, build to the former
   and say so.

THE TELL: you scoped something out with reasoning like "not required here,"
"minimal is fine," "keep it simple for now," or "there's no contract for X" —
and nobody asked you to cut it. That is you inventing a lowered bar, not the
user setting one. Stop and build the real thing instead.
EOF

printf '%s\n' "$MANDATE"
