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

## Background processes

The always-on `tool-discipline-mandate.sh` hook (injected every session) carries the full mechanical pre-write check for backgrounding — strip trailing `&`/`nohup`/`setsid`/`disown`, use `run_in_background: true`, never double-background, never roll your own logfile-and-tail. Not restated here.

## Browser automation

**The built-in in-app browser (`mcp__Claude_Browser__*`) is the browser for every real-browser check** — UI verification, interaction states, screenshots, reading pages. It runs in its own pane the user can watch; it never throws windows onto their desktop. Use `mcp__claude-in-chrome__*` only when the user asks for their own Chrome (their sign-ins, their tabs).

- **Never launch a visible (headed) browser on the user's desktop** — no headed Playwright/Puppeteer, no `start chrome`. An existing automated test suite that runs headless as part of a repo's normal gates is fine.
- **Verify in exactly the browser the user asked for, and no other.** Never expand verification to other browsers, engines or operating systems (Firefox, Safari, WebKit, Edge, macOS) unless the user asked. A reviewer's "not verified in browser X" is not a work item — do not file it, do not dispatch it.
- **Every sub-agent brief that touches a browser names the in-app browser tools and forbids headed launches.** If the in-app tools are not available to that agent, it reports that — it does not fall back to a visible browser.

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
