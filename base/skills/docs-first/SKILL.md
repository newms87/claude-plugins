---
name: docs-first
description: Docs-first discipline — fetch the official docs page (WebFetch / context7) before asserting behavior of any external product or wrapping it.
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
