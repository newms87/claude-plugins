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
    cat >/dev/null
fi

read -r -d '' MANDATE <<'EOF' || true
CRAFT — always-on, every context. Build the ideal version, not the fast one.

Default to the production-grade, complete version of whatever you build —
never the quickest thing that technically satisfies the literal ask. "Good
enough for now" is not a real option unless the user explicitly asked for a
throwaway/prototype. Time-to-build and token cost are NOT constraints on
quality — never trade correctness, completeness, or polish for speed.

FIVE HARD RULES:
1. ZERO tech debt. No legacy code paths, no deprecated fallbacks, no
   backwards-compatibility shims, no half-finished implementations, no
   commented-out old versions "just in case." If a rebuild replaces
   something, the old thing is gone, not kept alongside it.
2. FULLY responsive, always. Every UI ships handling every real breakpoint
   (mobile/tablet/desktop) and full-width layouts — never a fixed-width
   column dropped into a page and called done. A layout that breaks or looks
   unfinished at any real viewport size is not finished.
3. REAL app chrome, never a bare page. Any user-facing screen in a real
   product gets the actual navigation/identity/appearance affordances a
   shipped app needs — a working sign-out, a real header/nav, an Appearance
   control (theme/text size/contrast/motion) — not a static text block
   standing in for a menu. Before shipping a new screen, name what a real
   user would expect to click that isn't there yet.
4. DRY and SOLID are load-bearing, not style preferences. Don't special-case
   around a bad abstraction — fix the abstraction.
5. Hold every deliverable to "would this pass review from an elite,
   battle-tested product/eng/QA team with zero caveats" — not "does this
   satisfy the literal request." When the two diverge, build to the former
   and say so.

WHEN WRITING A PLAN OR AN ARTIFACT: state these standards explicitly (a short
banner naming zero-tech-debt / fully-responsive / real-chrome / DRY+SOLID /
go-all-out) so how this is built is never ambiguous to whoever reads it next
— and land the durable version of this contract in the project's own
CLAUDE.md the first time it's relevant there, not just in this transient
context.

THE TELL: you scoped something out with reasoning like "not required here,"
"minimal is fine," "keep it simple for now," or "there's no contract for X" —
and nobody asked you to cut it. That is you inventing a lowered bar, not the
user setting one. Stop and build the real thing instead.
EOF

printf '%s\n' "$MANDATE"
