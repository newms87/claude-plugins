---
name: tool-discipline
description: 'MANDATORY before any file operation OR before backgrounding any long-running process. Loads tool-choice discipline (Read/Edit/Write over bash equivalents, MCP schema reads before calls, dist/node_modules avoidance, run_in_background:true over shell `&`) as TodoWrite checklist. Triggers — about to run cat/head/tail/sed/awk/grep on tracked files; about to call MCP tool without reading schema; about to write a trailing `&` / `nohup` / `setsid` / `disown` in a Bash command (workers, dev servers, build watches, deploys, anything that outlives the Bash tool call).'
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

**Per-command gate.** Every long-running Bash: scan for trailing `&` / `nohup` / `setsid` — if ANY, strip. Check BEFORE send.

## Browser automation

Use `mcp__claude-in-chrome__*` only. Start: `tabs_context_mcp` → `tabs_create_mcp` → `navigate` → `computer` → `read_page`.

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
