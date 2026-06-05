---
name: tool-discipline
description: Tool-choice discipline — prefer Read/Edit/Write over bash equivalents, schema-before-MCP-call, run_in_background over shell `&`.
---

# Tool Usage Rules

## File Ops — NEVER bash equivalents

| Op | Tool | Never |
|---|---|---|
| Create | Write | `echo >`, `cat <<EOF` |
| Edit | Edit | `sed`, `awk` |
| Read | Read | `cat`, `head`, `tail` |
| Search | Glob/Grep | `find`, `grep` |

Read first (prereq) → Edit → auto-lint.

**Edit fails?** Reduce `old_string` to 2–5 lines. Repeated failure = stop; file not editable or shouldn't edit.

## Import order

Linters run post-Edit/Write. Strict: usage first, imports second. Add code using class → add import. Never add imports before usage (linter deletes).

## MCP Tools

Never guess params. Always ToolSearch for schema. MCP interfaces vary (name vs ID). Trello: `update_checklist_item` needs `checkItemId`.

**Literal strings in MCP params.** `\n` = two chars (`\` + `n`), NOT newline. Real line breaks only. All tools: Trello names/descriptions/comments.

## Background processes — `run_in_background: true` ONLY

Long-running (deploys, test suites, workers, dev servers) → Bash with `run_in_background: true`. Harness captures PID.

**FORBIDDEN:** `&`, `nohup`, `setsid`, `disown`. Shell exit → PID lost → can't kill later.

**FORBIDDEN:** double-background (`&` + flag). The `&` detaches from Bash → harness tracks wrapper only → real process orphans → kill fails.

**Mechanical pre-write check — before EVERY Bash invocation, regardless of complexity:**

1. Does the command contain trailing `&`, `nohup`, `setsid`, `disown`, OR `> /tmp/*.log 2>&1 &` (output-redirect-then-background)? → REWRITE. Strip the backgrounding chars. Add `run_in_background: true` to the Bash tool params.
2. Does the command launch ANY of: `make launch-*`, `make deploy*`, `make dev*`, `docker run`, `docker compose up` (without `-d`), `npm run dev`, `yarn dev`, `vite`, `tsx ... --watch`, a worker / dashboard / poller startup script? → MUST use `run_in_background: true`. Foreground would block the turn.
3. Tempted to capture output via `> /tmp/<name>.log 2>&1` so you can `tail -f` it later? → That's the smell of shell-backgrounding instinct. Harness already streams stdout per call + retains the background task's transcript at the harness-managed `output_file`. Use that, not your own tmpfile.

"I'll just background it real quick to keep moving" / "the user authorized the worker launch so the mechanism doesn't matter" / "I'll redirect to a logfile so I can read it" are rationalizations, not reasoning. The mechanism is what gets enforced; user authorization scopes WHAT runs, not HOW it runs.

## Browser automation

Use `mcp__claude-in-chrome__*` only. Start: `tabs_context_mcp` → `tabs_create_mcp` → `navigate` → `computer` → `read_page`.

**Close what you opened.** Every tab you created with `tabs_create_mcp` MUST be closed via `tabs_close_mcp` before the session ends — clean up the moment you're done with a tab, not as an afterthought. Leaving tabs open litters the user's browser with stray windows across sessions. Rule: opened a tab → you own closing it. Reusing a pre-existing user tab (only on explicit request) → leave it; you didn't open it.

## dist/ + node_modules/

Never read/edit `dist/` (stale). `src/` = truth. node_modules: read OK, edit NEVER.

## Refactoring tools

Use language tools for cross-file renames (auto-update refs). Manual find-replace = error-prone.
- PHP: `phpactor class:move`
- TS/JS: `ts-morph`, IDE refactoring
- Go: `gorename`, `gopls rename`
- Python: `rope`, `jedi`

## CLI tables

Keep row width <140 chars. Abbreviate + icons. More rows > wide rows.
