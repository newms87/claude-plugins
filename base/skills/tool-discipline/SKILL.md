---
name: tool-discipline
description: 'MANDATORY before any file operation. Loads tool-choice discipline (Read/Edit/Write over bash equivalents, MCP schema reads before calls, dist/node_modules avoidance) as TodoWrite checklist. Triggers — about to run cat/head/tail/sed/awk/grep on tracked files; about to call MCP tool without reading schema.'
---

# Tool Usage Rules

## File Operations

**ALWAYS use Write and Edit tools. NEVER use bash commands for file ops.**

| Operation | Tool | Never Use |
|-----------|------|-----------|
| Create file | Write | `echo >`, `cat <<EOF`, `printf` |
| Edit file | Edit | `sed`, `awk`, `perl -i` |
| Read file | Read | `cat`, `head`, `tail` |
| Search files | Glob | `find`, `ls` |
| Search content | Grep | `grep`, `rg` |

**Workflow:** Read first (required before Edit) → Edit → hooks lint automatically.

## Edit Failures

Edit match fails → reduce `old_string` to 2-5 lines (smaller strings = fewer whitespace mismatches).

**Edit/Write fails repeatedly: STOP.** Do NOT rewrite entire file with Write, use Bash as fallback, invent workarounds. Either file cannot be edited (system issue) or not supposed to edit. Report failure + proceed without that edit if possible.

## Import Order

Linters delete unused imports after EVERY Edit/Write. Strict ordering: **Usage first, imports second.** Add code REFERENCING new class, then add import statement. Never add imports before usage exists — linter deletes + subsequent code resolves to wrong namespace.

## Lint

Hooks run automatically after Write/Edit. Never run lint manually — redundant.

## MCP Tools

Never guess parameters. Always read schema from ToolSearch before calling. MCP tools have inconsistent interfaces — one tool identifies by name, another by ID. Trello example: `update_checklist_item` requires `checkItemId` (not name) → save creation IDs.

**CRITICAL: MCP string parameters are LITERAL — no escape sequences.** `\n` in parameter value = TWO CHARACTERS (`\` + `n`), not newline. Harness JSON-encodes value → `\n` becomes `\\n` in API payload. Use actual multi-line strings with real line breaks in every MCP string parameter. Applies to ALL MCP tools — Trello descriptions, comments, card names, etc. **Pre-call check:** Before every MCP call with multi-line string, visually confirm parameter contains real newlines, not `\n`.

## Browser Automation

Use `mcp__claude-in-chrome__*` tools only, never Playwright. Start with `tabs_context_mcp`, then `tabs_create_mcp`, `navigate`, `computer` (screenshot/click/type), `read_page` (accessibility tree), `read_console_messages` (with pattern filter).

## dist/ and node_modules/

Never read, search, edit `dist/` — stale build artifact. HMR → `src/` = source of truth.

Reading `node_modules/` OK for understanding dependencies. Editing NEVER OK.

## Refactoring Tools

Use language-specific refactoring tools for cross-file renames/moves — update all references automatically. Manual find-and-replace error-prone.

- **PHP:** `phpactor class:move src/Old/Path/Class.php src/New/Path/Class.php`
- **TypeScript/JavaScript:** `ts-morph` or IDE refactoring
- **Go:** `gorename`, `gopls rename`
- **Python:** `rope`, `jedi`

Use for: renaming classes/functions across files, moving to different namespaces, any cross-file reference updates.

## Markdown Tables in Output

Keep total row width under ~140 characters in CLI output. Use abbreviations + icons (e.g., `✏️ M` not "Modified"). Prefer more rows over wider rows.
