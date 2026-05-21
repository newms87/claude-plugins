---
name: docs-first
description: 'MANDATORY before claiming behavior of any external product (Claude Code, Anthropic API, Trello API, Docker, Vite, npm, etc.) — the docs page on that exact feature MUST be fetched FIRST via WebFetch / context7. Triggers — about to assert "X does Y", about to design a hook / script / wrapper around a documented product, about to grep the local install to figure out behavior. Loads docs-first discipline as TodoWrite checklist.'
---

# Docs-First for External Products

Before claiming behavior of ANY external product (Claude Code, Anthropic API, Trello, Docker, Vite, npm, etc.): fetch official docs FIRST via WebFetch / context7.

## Forbidden shortcuts

- Grep local install to learn how X works
- Design hook around Y without reading docs
- Script around Z's quirks without reading docs

Reverse-engineering documented behavior slower + wronger than reading docs. Docs = contract.

## NOT for

- Internal codebase → read source
- Undocumented APIs → investigate skill
- "I'm sure" → still read docs. Memory rots.
