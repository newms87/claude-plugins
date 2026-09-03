---
name: artifact-plan
description: 'THE way to work with a human. A single shared HTML page — published with the `Artifact` tool — is the record for every task beyond a quick cleanup: the plan, the accumulated context, every question for the operator, the monitoring log, and the handoff. It REPLACES all other planning methods; there is no plan file, no `~/.claude/plans/*.md`, no repo `.md`, no chat summary standing in for it, and no separate handoff skill. Tabs are fixed, not a menu: Needs Attention / In Progress / Completed / Goals / Architecture / Rules / Caveats / Timeline. Needs Attention holds ONLY undecided things the human must act on — a recommended option is not a decision, and anything decided leaves that tab the moment it is decided. Triggers — starting any multi-step plan or build; ANY question whose answer affects a plan (only a trivial clarification with zero plan impact stays in chat); monitoring anything over time; context running low, which is written INTO the page as a Resume-here entry. Invoke `Skill(artifact-plan)` before creating a page. You do NOT need it to EDIT one: the template is self-documenting, so re-reading the page you are editing restores the full contract plus every bit of session context — which is what makes this survive compaction. Chat is only a pointer ("see W-3") plus one line of status. Update the page after every action and every new finding, including "checked, nothing changed"; every entry carries a real `ts` read from the clock, never estimated.'
---

# The Artifact Is the Record

Chat scrolls away and compacts. A published page persists, is searchable, keeps stable IDs the operator can point at ("W-3 is wrong, do option B"), and outlives the session that made it.

This skill is deliberately thin. **The template carries the rules** — each tab states what belongs in it, and a contract block above the data states how to edit the file. That is the design, not an omission: after a compaction, re-reading the page recovers the working rules *and* the accumulated project context in one read, with no skill reloaded.

## Creating a page

Copy the template. **Do not read it into context** — it is ~20KB of chrome you never need to see, and reading it invites rewriting it, which is how pages drift apart:

```bash
cp "<this skill's directory>/references/artifact-template.html" <working-file>.html
```

Then fill in `PROJECT` and the `DATA` arrays, and publish:

```
Artifact({ file_path, favicon, description })
```

`favicon` is required on the first publish and **must never change afterwards** — people find the tab by its icon. Republish the same `file_path` to update in place; from a different session, pass the artifact's `url`.

**Before creating a page, check whether one already exists for this task.** Found one → update it. A second page for one task fragments the record, which is the whole failure this prevents.

## Editing a page

Read the page — `Artifact({action:"read", url})` — and follow the contract block inside it. That block is authoritative; this file does not repeat it.

The local HTML file is a transient build input. Never curate it, never keep a second copy, never treat it as the record.

## Publishing IS the render

Publish and look at it. Never stand up a local server, a file:// preview or a DOM harness to check a page you could simply publish. If it renders wrong, fix it and republish.

## Relationship to tracker cards

Where a tracker card exists (dispatched work, `danxbot:issue-card-workflow`), the card stays the durable, dispatchable work-record and this page is the live human-facing surface. They compose: link the card id in Goals, and put this page's URL on the card. They are never duplicated content.
