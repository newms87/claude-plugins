---
name: investigate
description: 'Read-only diagnostic skill — hypothesis → evidence → findings → options. You do not fix. User picks next step.'
---

# Investigate

Read-only diagnostic. Hypothesis → evidence → findings → options. **You do not fix.** User picks next step.

## When to invoke

- User says "investigate," "look into," "why," "how does," "what's happening"
- About to make factual claim about runtime (timing, causality, process state, config) without direct evidence
- Task-completion exit codes tell you the wrapper finished, NOT whether the underlying process is healthy. Always verify with live probes (ps, curl, docker ps, systemctl status) before asserting state.
- **Source-of-truth gate (mechanical).** Before claiming row/record X *causes* behavior Y, identify the EXACT field/table the CONSUMING code reads (grep the decision-point query), and verify your evidence comes from THAT field — not a sibling surface that merely looks authoritative. A stale/leftover row is causal ONLY if the decision code actually reads it. A `status='running'` row ≠ a live process (check the pid); a row in table A ≠ what a probe that queries table B counts. Revising a hypothesis? Re-confirm the new evidence is from the field the code reads before re-asserting.
- Draft contains hedging ("probably," "typically," "should be") → STOP, gather evidence

**Not for:** Direct file quotes, doc lookups, or fix-application tasks.

**Line:** any claim not directly quotable from code/docs/tool output → skill required.

## Discipline — pin via TodoWrite

### 1. State the question

One sentence, specific scope. Refine vague prompts, confirm with user.
- Bad: "investigate the worker"
- Good: "Why does gpt-manager EC2 prod return 503 for /api/launch on system-test workspace?"

### 2. Hypothesis (BEFORE tools)

Write: "I expect X because Y. If right, evidence Z appears. If wrong, evidence W appears."

### 3. List evidence sources

- File paths (`Read`/`Grep`)
- Process state (`docker ps`, `ps`, container shells)
- Logs (`make deploy-logs`, `docker logs`, `~/.claude/projects/`)
- DB rows (`mysql` exec)
- HTTP probes (`curl`)
- Config (`.env`, compose, target YAML, settings.json)
- Authoring (`git log`, `git blame`)

Cheapest, most direct first. No fanout before commit.

**Definition-before-history gate (mechanical).** If the question is "what does X do / does X handle Y" where X is a NAMED artifact — a `make` target, script, function, route, config key — READ X's CURRENT definition FIRST: grep the literal name in the working tree and read the whole match (e.g. `grep -nE '^X:' Makefile`, the full target incl. prerequisites). Only AFTER that may you reach for `git log`/`git blame`. History answers "how did X change"; it NEVER answers "what does X do now" — substituting one for the other is the failure. Already formed a verdict ("it's API-only") and now searching history to confirm it? STOP — that's confirmation bias; re-read the current definition in full before asserting.

### 4. Gather evidence

Capture verbatim — file contents (cite line numbers), command output (exit code per `bash-exit-capture`), HTTP shape, DB row shape.

**Hard rule: zero edits.** No Edit, Write, git checkout, kill, restart, deploy, MCP write tool. Only read tools + Bash read-only + WebFetch.

If step requires write → STOP. Tell user what + why, get explicit authorization.

**Read-only probes need NO authorization — gathering them IS the job, including prod/remote.** A read-only probe against a deployed/production target (SSH `cat`/`ps`/`psql SELECT`, `docker ps`/`logs`, `curl` status, SSM `get-parameter`, `make deploy-status`/`deploy-logs`) is ordinary evidence gathering, not a gated escalation. NEVER write "I can't see prod from here / that needs prod access" or offer a read-only prod probe as an option to approve — go run it. Only WRITES to prod (restart, deploy, secrets-push, destroy, DB mutation) cross the authorization line. Deferring a read-only prod read as if it needed permission is the failure this gate blocks.

**Elapsed / "N min ago" / "is it stuck" claims — read the CLOCK first, NEVER infer "now".** Any wall-clock duration (age of a dispatch, time-since-X, idle gap) requires reading the actual current time via `date` THIS turn, then subtracting the target timestamp. NEVER anchor "now" to a timestamp that appeared earlier in context (a prior tool result, a completed-at stamp, a previous message) — those are stale by an unknown amount and produce wrong elapsed math. About to write "~N minutes/hours ago" or "just started" / "sitting for"? STOP → run `date` first.

### 5. Verify against hypothesis

| Evidence | Action |
|---|---|
| Confirms | Continue |
| Contradicts | Revise hypothesis, note contradiction, re-run step 3 if needed |
| Ambiguous | Name disambiguating evidence, get it |

NEVER silently retcon. If original guess wrong, say so.

### 6. Report findings — `base:convey` format

≤20 lines. **Audience default — ZERO codebase context.** Plain English first; file paths are footnotes.

Required sections in order:

1. **Headline** ≤12 words, plain English
2. **Problem** — 1-2 sentences, user-visible terms, no code names
3. **Steps to reproduce** — numbered, observable from outside code
4. **Expected** — one sentence
5. **Actual** — one sentence, user-visible symptom
6. **Root cause (plain English)** — analogy/everyday-language first; symbols allowed only after, in parens
7. **Evidence (footnotes)** — `file:line` / command / row refs, short bullet list
8. **Hypothesis delta** (if applicable) — honest one-sentence
9. **Fix options (plain English)** — numbered, each one sentence, no code/diffs/paths in option text

**Forbidden in report:**
- Hedging about local behavior
- Generic prescriptions not backed by evidence
- A unilateral fix description as first option
- "Do nothing" / "leave as-is" — user invoked investigation to act
- "Investigate further" as filler — include ONLY when (a) root cause uncertain + specific next probe named, (b) hidden coupling not mapped, (c) elsewhere-invariant risks regression
- Leading with file:line / symbol / tracker ID
- Fix options as code/diffs/signatures

### 6a. Solution Quality Bar — Root Cause Over Symptom

Every option clears 3 questions or it's a draft:

1. **Mechanism, not symptom.** Raising timeout, adding retry, swallowing exception, restart — all symptom-only.
2. **Textbook for platform.** Would a senior engineer say this is canonical? If not, name textbook answer + justify deviation.
3. **Class, not instance.** Eliminates failure class or just one instance? Name other exposed call sites.

**Tiered ordering — mandatory when >1 option, by root-cause depth never ease:**

| Tier | Role |
|---|---|
| 1 | Underlying mechanism. Textbook. Default recommendation. |
| 2 | Reduce blast radius (isolation, decoupling, backpressure, concurrency caps) |
| 3 | Observability — instrumentation. Co-ships with T1, never replaces. |
| 4 | Defense in depth (retries, timeouts, fallbacks). Ship ONLY under T1, label as safety net. Never primary. |

**Forbidden:**
- Symptom-only as the solution
- Retry/fallback as primary mechanism
- Local patch with N other unnamed call sites
- "Quick win first, real fix later" with no named follow-up artifact
- Refusing T1 as "bigger change" — name cost honestly, don't disguise as T4

**Evidence insufficient for T1:** SAY SO. List "investigate further to confirm <mechanism>" T1-shaped option ahead of any T4.

### 7. STOP

After report, do nothing. No "while we're here." Wait for user to pick.

User picks code-change option → switch to `debugging` skill.

## Anti-patterns

- **Detective-carpenter.** Find "timeout too short" → bump it → never know if deeper bug was masked.
- **Hedging.** Zero numbers, useless.
- **Scope drift.** "Why one dispatch failed" → auditing the week. STOP, answer original.
- **Suspect lists.** "Suspect X, OR Y, OR Z" on vibes. Forbidden: "Suspect:" / "Likely:" unverified. Required: one candidate verified with code, or "still unknown — next probe is N."
- **One-to-all extrapolation.** Read 1 instance → asserted the whole set ("all 5 cards are X", "every caller does Y"). Mechanical rule: a claim quantified over N items requires reading N items. Verified the sample, not the set → scope the claim to exactly what you read ("DX-872 is `dani`; others unchecked") or read the rest before asserting. Plural/"all"/"every"/"none" in a draft with single-item evidence → STOP, widen the read.
- **Green-parts, broken-whole (inference-chaining).** Probed the pieces AROUND the symptom — DB row, backend-direct curl, source code, adjacent logs — found each green, and chained them into a root cause for a whole that is still broken. Every green adjacent probe is evidence ABOUT a component, NOT evidence about the failing path. **Mechanical gate before ANY root-cause claim: reproduce the symptom on its OWN end-to-end path and observe the EXACT artifact the user sees** — the actual HTTP response the client receives (curl the SAME url/port the client hits, not a sibling), the rendered DOM / console (use the browser tools), the actual returned value. If your "conclusion" rests on "component A is fine + component B is fine + therefore the seam must be C" without ever observing the seam, you have NOT found the bug — you have a hypothesis. Green pieces + red whole = the fault is in a path you have not yet executed. Go execute it.

## Investigate vs Debug

| About to... | Use |
|---|---|
| Tell user what's happening | `investigate` |
| Tell user why past event | `investigate` |
| Quote runtime numbers | `investigate` |
| Write failing test reproducing bug | `debugging` |
| Edit code to fix | `debugging` |
| Config change to fix runtime | `debugging` |
| Decide between architectural options | `investigate` first, escalate if user picks |

Both same session: investigate → user picks → debug. Don't merge.

## Report skeleton

```
## <plain-English question>

**Problem.** <user-visible, no code names>

**Steps to reproduce.**
1. <observable>
2. <observable>

**Expected.** <one sentence>
**Actual.** <user-visible symptom>

**Root cause (plain English).** <mechanism as if to non-coder; symbols in parens after>

**Evidence (footnotes).**
- `path:42` — <what>
- `docker logs <x>` — <observation>

**Hypothesis check.** Expected X; evidence Y. Delta: <sentence>.

**Fix options (plain English — no code).**
1. <behavior change>
2. <behavior change>
<!-- "Investigate further — <named uncertainty>" ONLY if uncertain. NEVER "do nothing". -->
```

Doesn't fit → investigation incomplete. Iterate.
