# Card Schema Reference

The on-disk YAML issue store is retired. The dashboard Postgres DB is the sole source of truth, reached exclusively through the `mcp__danx_dashboard__issue_*` MCP tools. There is no file to read, no `Edit`/`Write`, no `schema_version` literal to manage, no `open/`→`closed/` move.

**Canonical card schema + full tool list live in the `danxbot:issue-card-workflow` skill** (its "DB Schema" + "MCP Tools Reference" sections). Read that for field semantics — `status`/`status_derived` (derived, never written directly), `children[]`, `ac[]`, `retro`, `blocked`, `waiting_on`, `requires_human`, comments, dependencies.

This file is a pointer to avoid two-source drift — the schema is documented in exactly one place.
