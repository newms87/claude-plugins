---
name: docs-first
description: 'MANDATORY before claiming behavior of any external product (Claude Code, Anthropic API, Trello API, Docker, Vite, npm, etc.) — the docs page on that exact feature MUST be fetched FIRST via WebFetch / context7. Triggers — about to assert "X does Y", about to design a hook / script / wrapper around a documented product, about to grep the local install to figure out behavior. Loads docs-first discipline as TodoWrite checklist.'
---

# Docs-First for Platform / Tooling Questions

Before claiming behavior of any external product (Claude Code, Anthropic API, Trello API, Docker, Vite, npm, etc.), fetch the official docs FIRST via WebFetch / context7.

## Forbidden Until Docs Are Read

- "I'll grep the local install to figure out how X works"
- "I'll design a hook around Y"
- "I'll script around Z's quirks"

Each is a reverse-engineering shortcut applied to a documented product. Read the docs first. Then design.

## Why

Reverse-engineering documented behavior is slower than reading the docs AND produces wrong conclusions when undocumented behavior is mistaken for the contract. The docs are the contract. Treat them as the source of truth before any other source.

## What this is NOT for

- Internal codebase behavior — read the source.
- Undocumented APIs / private libs — investigate methodology applies.
- Things you're sure about — still read the docs. Memory rots.
