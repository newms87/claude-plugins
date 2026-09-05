---
name: artifact-plan
description: 'THE way to work with a human. A single shared HTML page — published with the `Artifact` tool — is the record for every task beyond a quick cleanup: the plan, the accumulated context, every question for the operator, the monitoring log, and the handoff. It REPLACES all other planning methods; there is no plan file, no `~/.claude/plans/*.md`, no repo `.md`, no chat summary standing in for it, and no separate handoff skill. Tabs are fixed, not a menu: Needs Attention / In Progress / Completed / Goals / Architecture / Rules / Caveats / Timeline. Needs Attention holds ONLY things the human must still decide or still do — never progress reports, "here is what shipped", or anything whose own recommendation reads "nothing needed", all of which are Timeline entries; a recommended option is not a decision; and an entry leaves that tab the moment it stops needing them, whether they answered, YOU resolved it yourself, or it stopped mattering. Triggers — starting any multi-step plan or build; ANY question whose answer affects a plan (only a trivial clarification with zero plan impact stays in chat); monitoring anything over time; context running low, which is written INTO the page as a Resume-here entry. Invoke `Skill(artifact-plan)` before creating a page. You do NOT need it to EDIT one: the template is self-documenting, so re-reading the page you are editing restores the full contract plus every bit of session context — which is what makes this survive compaction. CHAT IS A TLDR AND A POINTER, NOTHING ELSE — never a question, never a finding, never reasoning or citations; a question for the operator is a Needs Attention entry and chat says only "W-3 needs your call". EVERY ENTRY IS WRITTEN FOR A STRANGER — an experienced engineer with zero knowledge of this codebase: the title leads with the domain and says the thing in plain words, and the context ORIENTS before it goes deep. Update the page after every action and every new finding, including "checked, nothing changed"; every entry carries a real `ts` read from the clock, never estimated.'
---

# The Artifact Is the Record

Chat scrolls away and compacts. A published page persists, is searchable, keeps stable IDs the operator can point at ("W-3 is wrong, do option B"), and outlives the session that made it.

This skill is deliberately thin. **The template carries the rules** — each tab states what belongs in it, and a contract block above the data states how to edit the file. That is the design, not an omission: after a compaction, re-reading the page recovers the working rules *and* the accumulated project context in one read, with no skill reloaded.

## Creating a page

Copy the template. **Do not read it into context** — it is ~20KB of chrome you never need to see, and reading it invites rewriting it, which is how pages drift apart:

```bash
cp "<this skill's directory>/references/artifact-template.html" <working-file>.html
```

Then fill in **three** things — the `<title>` on line 1 (it is a placeholder that names
the artifact in the tab and gallery; leaving it ships a page called "PRODUCT NAME HERE"),
`PROJECT`, and the `DATA` arrays. Grep the file for `PRODUCT NAME HERE` before publishing —
a hit means the title is still unfilled.

Every work item needs a `priority` (`critical` → `lowest`). The page sorts by it by
default, so Needs Attention reads as a ranked queue; rank by **consequence if ignored**,
never by how long the investigation took. The template's contract block spells out the
tiers.

**Two mechanical checks before every publish — Needs Attention is a queue of the
human's OPEN work, not a log of yours:**

1. **Writing an entry there?** State which the human must do: *make a decision only
   they can make*, or *take an action only they can take*. Neither → it is a Timeline
   entry. "Here is what shipped", "all N fixed", "no action needed", progress of any
   kind — Timeline. An entry whose own recommendation reads "nothing needed" is the
   tell you got this wrong.
2. **Every entry already there:** does it STILL need them? Remove it the moment that
   stops being true — they answered, **or you resolved it yourself**, or it stopped
   mattering. Self-resolved items are the ones that rot, because nothing prompts you
   to revisit them. A tab that is part-noise gets skimmed, and then the one entry that
   needed them is the one they miss.

Then publish:

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

## Write for a stranger

Every entry is read by an experienced engineer who has never seen this codebase, this
product, or this conversation. They know how software works. They do not know what your
services are called, what your domain words mean, or what happened yesterday.

That is not a courtesy — it is the page's job. It exists to survive compaction, hand off to
another agent, and be re-read weeks later by someone who has forgotten the details,
**including the person who wrote it**. An entry only its author can decode has already failed.

- **Title: lead with the domain, then say the thing in plain words.** The title is often all
  that gets read. It has to place the reader — *where in the system is this?* — and then say
  what is wrong. "Fix splitObjectName staleness in DemandHeader" fails; "Demand list vs
  detail page — one case shows two different names" works. Name systems and screens, not
  symbols. A function name can appear later as a pointer; it may not carry the meaning.
- **Problem: what is wrong and who it hurts** — no jargon, no symbol names. If a reader
  cannot tell from this alone why anyone should care, it is not written yet.
- **Context: orient first, then go deep.** Explain what this part of the system IS and what
  the domain words mean before discussing them — a reader must never meet a proper noun
  before its definition. Then the evidence, file paths and history. Say how to SEE it where
  you can: someone who can reproduce a thing can decide about it, and someone who cannot is
  taking your word for it.
- **Options: state costs in human terms.** "Touches three components" is not a cost. "A
  screen of cards headed by a filename is a screen of noise" is.

**The test is mechanical:** hand the entry to someone who was not here. Could they act on it
without asking you a single question? If not, what is missing is orientation — and
orientation goes at the top.

The template carries this as rule 3a, with fuller guidance and worked examples.

## Chat is a TLDR and a pointer. Nothing else. Ever.

**This is absolute. It is not a style preference and it does not relax when the finding
feels important, when the reasoning is subtle, or when the answer seems short enough to
just say.** The operator has stated it directly: the thread is reserved for TLDR responses
and references to the artifact.

What a chat message may contain, and nothing more:

- **What was just done**, in one or two sentences of plain, high-level language.
- **What happens next**, so the operator knows where the work is going.
- **A pointer to the page** — an id (`W-3`, `RUL-09`, `CAV-04`) or the URL.

What NEVER goes in chat, regardless of how well it is written:

- **Questions.** A question for the operator is a `Needs Attention` entry with options and
  a recommendation. Asking in chat means the question dies with the scrollback and gets
  asked again next session. Say "`W-2` needs your call" — never the question itself.
- **Findings, evidence, `file:line` citations, reasoning, trade-offs, comparisons.** All of
  it goes in the page, where it is searchable, ranked, timestamped, and survives compaction.
- **Explanations of a decision.** The decision's `resolution` field is where the reasoning
  lives. Chat says it was decided and names the id.
- **Bulleted findings lists.** A list of discoveries in chat is the page's job done in the
  one place it cannot persist.
- **Progress narration.** "I'm now reading X, then I'll check Y" is noise. Report on
  completion.

**The test before sending any message:** would this still be readable and useful to
somebody who has the page open and has never seen this conversation? If a sentence only
makes sense as part of the chat thread, it belongs in the page instead.

**When there is a lot to report, that is when this matters most.** Four reviews returning
sixty findings is exactly the moment the temptation to summarise in chat is strongest, and
exactly the moment a chat summary is most wasteful — it is the longest thing to write, the
hardest thing to search, and the first thing lost. Write the findings into the page and
send three sentences.

**Length is the tell.** More than roughly five or six lines means something is being said
in chat that belongs in the page. Go move it.

## Relationship to tracker cards

Where a tracker card exists (dispatched work, `danxbot:issue-card-workflow`), the card stays the durable, dispatchable work-record and this page is the live human-facing surface. They compose: link the card id in Goals, and put this page's URL on the card. They are never duplicated content.
