---
name: git-add-on-create
description: 'Git-add-on-create discipline for dispatched agents: stage a new file immediately after creating it so autosave protects it.'
audience: worker
---

# Git-Add-On-Create — Stage New Files Immediately

When you create a new file during a dispatched work session (`Write`, or
any tool that creates a new path on disk), `git add` it in the same turn,
right after the create — do not defer staging to a later "clean up" pass,
and do not wait until you're ready to commit everything at once.

## Why this matters

The worktree-only periodic autosave mechanism (danxbot DX-2034:
`commitWipIfDirty`) stages via `git add -u` — modifications and deletions
to **already-tracked** files only. This is a deliberate design choice, not
an oversight: autosave must never sweep up unrelated scratch/temp/generated
files that were never meant to be committed, so it does not use `git add -A`.

The consequence: a newly-created file that hasn't been `git add`-ed yet is
invisible to both autosave layers (the periodic timer and the SIGTERM-drain
best-effort commit) — it is NOT protected by either data-loss-prevention
mechanism until it is staged. If your session is killed before you stage a
new file, that file's contents are lost even though autosave is running.

## The rule

Every time you create a file, stage it immediately:

```bash
git add path/to/new-file.ts
```

Do this as your next action after the file-creation call, not batched at
the end of a phase of work. Modifications to files you've already staged
(or that were already tracked before your session started) don't need this
— autosave's `git add -u` covers those automatically.
