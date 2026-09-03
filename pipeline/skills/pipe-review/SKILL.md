---
name: pipe-review
description: 'Post-commit reviewer-agent fan-out; findings ship as a separate follow-up commit.'
---

# Post-Commit Code Review

Post-commit review step in the development pipeline. Runs reviewer agents AFTER the implementation commit has been pushed. The primary goal is that every file you touched is in perfect shape — feature delivery is secondary to code quality.

**Order of operations:** `/pipe-commit` (implementation commit) → `/pipe-review` (this skill) → fix findings → `/pipe-quality` → `/pipe-commit` (review-fixes commit). Two commits per cycle. The implementation commit is durable BEFORE the reviewers run; the review-fixes commit captures everything they caught.

---

## Step 1: Determine Scope

Review code from **your current session's work**:

1. Recall which files you worked on during this session
2. Use `git diff --name-only` as a **refresher** to confirm changed files
3. Filter to ONLY files you are aware of working on (other agents may have committed unrelated changes)

## Step 2: Run Reviewer Agents in Parallel

Launch available review agents simultaneously in a SINGLE message with multiple Task tool calls:

All three agents are MANDATORY. They have distinct, non-overlapping roles — do not skip any.

1. **test-reviewer** — Test coverage and quality (tests only)
2. **code-reviewer** — Per-file quality: size limits, per-file DRY, dead code, documentation, per-file anti-patterns
3. **architecture-reviewer** — Cross-file patterns: component interfaces (>4 props, emit chains, prop threading), composable-first enforcement, cross-file DRY, domain placement

## Step 3: Record Findings + Fix Plan ON THE CARD

**The durable record of review findings + the fix plan lives on the CARD, never a file** (card-first rule — see `danxbot:issue-card-workflow`). A `/tmp/*.md` revisions file is forbidden: the next agent and the human read the card, not your scratch dir.

1. **Append a `## Code Review Revisions` comment to the active card** via `mcp__danx-dashboard__issue_comment`: paste ALL findings verbatim grouped by reviewer (test / code / architecture), then a concrete fix plan below them (phases with specific file paths + changes).
2. **Findings that are substantial work outside this card's scope** → file a child or new card (`mcp__danx-dashboard__issue_create`) instead of cramming them in; link via `parent_id`/dependency as fits.
3. **Trivial** (renames, docs, small fixes) → one short phase. **Extensive** (many files, cross-domain) → multiple phases ordered by dependency.
4. You MAY keep a throwaway inline checklist for your own momentary fix-loop tracking, but anything another agent or a human needs — or that you will reference later — MUST be on the card, not a file.

### Revisions comment body shape

```markdown
## Code Review Revisions

### Findings
**Test Reviewer** — [verbatim]
**Code Reviewer** — [verbatim]
**Architecture Reviewer** — [verbatim]

### Fix plan
- Phase 1: [title] — [changes + file paths]
- Phase 2: [title] — [changes + file paths]
```

## Step 4: Execute the Fix Plan

**Fix ALL findings following the recorded plan. No exceptions.**

- Work through each phase sequentially
- Every finding from every reviewer MUST be addressed — either fixed or documented with a valid skip reason (see `/pipe-quality` for the 3 valid skip reasons); record the disposition in the card comment, not a file

### Highest Priority: Fallbacks, Legacy, Backwards-Compatible, Obsolete, and Dead Code

**The primary mission of code review is discovering and eliminating these categories.** When writing the revisions plan, any finding involving fallbacks, old formats, legacy paths, backwards-compatibility branches, dual-shape readers, dead code, or obsolete patterns goes at the TOP of Phase 1. These findings are the most important thing reviewers produce — they are why we run code reviews. They can NEVER be skipped, deferred, or rationalized away. Fix them first, fix them completely.

**Fallback findings are PRIORITY 0 — instant-block.** A fallback merged to `main` is an emergency: one merge of `try A; on failure write half of A's effect to B` produces silent state divergence that surfaces days later as doom loops, false-positive strikes, half-applied terminal transitions, ghost re-dispatches. The DX-242 stop-fallback class burned ~$1K of operator + token budget before root-cause was traced. Reviewers (every reviewer agent, every time) MUST run the `base:fail-loudly` grep recipes against the diff and surface every match. Authors MUST delete every fallback before the review-fixes commit ships. The pipe-quality "3 valid skip reasons" allowlist does NOT apply to fallback findings — there is no valid skip. Either delete the fallback, or quote explicit per-merge user authorization in the PR body that overrides this rule for one specific finding.

## Step 5: Create Action Items for Pattern-Worthy Findings

If any finding reveals a pattern that could prevent future mistakes (a missing rule, a skill gap, a documentation hole), create an issue card in **Action Items** immediately via `mcp__danx-dashboard__issue_create` (or append to the active card's `retro.action_items[]`). Don't defer to session end.

## Step 6: Run `/pipe-quality`

**After fixing all findings, invoke `/pipe-quality` before proceeding to `/pipe-commit`.** This audits your decisions — verifying that every finding was addressed and no rationalizations slipped through. It is a mandatory pipeline step.

---

## Rules

- **You are the author — agents are the reviewers.** Never skip this step because you're confident in your code.
- **Fix every finding in the review-fixes commit.** All findings ship as a separate `/pipe-commit` AFTER this skill runs. No deferring, no "flagging for later" — the review-fixes commit closes the cycle.
- **Always record findings + plan on the card before fixing.** Never fix ad-hoc without the recorded plan — the card comment ensures nothing gets lost and gives the next agent + human a clear record. No `/tmp` revisions file.
- **Always run `/pipe-quality` after fixing.** This is what catches rationalizations and skipped findings.
