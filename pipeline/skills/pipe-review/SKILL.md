---
name: pipe-review
description: 'Post-implementation review. Runs reviewer agents in parallel, fixes ALL findings before committing.'
---

# Post-Implementation Code Review

Post-implementation review step in the development pipeline. Runs reviewer agents and fixes ALL findings before committing. The primary goal is that every file you touched is in perfect shape — feature delivery is secondary to code quality.

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

## Step 3: Create a Revisions Plan

**Every code review produces a temporary revisions plan file.** This keeps review findings and fix tracking separate from the main plan file.

1. **Create a revisions plan file** at `/tmp/claude-code-reviews/<project-basename>/revisions-<timestamp>.md` (e.g., `/tmp/claude-code-reviews/gpt-manager/revisions-2026-02-24-1430.md`). Create the directory if it doesn't exist. This lives in `/tmp` because it's ephemeral and should never be committed.
2. **Copy ALL findings** from every reviewer agent into the file verbatim — organized by reviewer (test-reviewer, code-reviewer, architecture-reviewer)
3. **Write an implementation plan below the findings** — concrete phases detailing how you will address each finding, with specific files and changes described
4. **If trivial** (all findings are simple renames, missing docs, small fixes): a single phase is fine
5. **If extensive** (many files, cross-domain refactors, significant restructuring): break into multiple phases ordered by dependency

**CRITICAL:** Never add review findings to the main plan file. The revisions plan is a separate, temporary document that lives only for the duration of the fix cycle.
### Revisions Plan Format

```markdown
# Code Review Revisions

## Findings

### Test Reviewer
[paste findings verbatim]

### Code Reviewer
[paste findings verbatim]

### Architecture Reviewer
[paste findings verbatim]

## Revisions Plan

### Phase 1: [title]
- [specific changes with file paths]

### Phase 2: [title]
- [specific changes with file paths]
```

## Step 4: Execute the Revisions Plan

**Fix ALL findings following the revisions plan. No exceptions.**

- Work through each phase sequentially
- Mark each phase complete in the revisions plan as you finish it (append ` ✅` to the phase heading)
- Every finding from every reviewer MUST be addressed — either fixed or documented with a valid skip reason (see `/pipe-quality` for the 3 valid skip reasons)

### Highest Priority: Legacy, Backwards-Compatible, Obsolete, and Dead Code

**The primary mission of code review is discovering and eliminating these categories.** When writing the revisions plan, any finding involving old formats, legacy fallbacks, backwards-compatibility branches, dead code, or obsolete patterns goes at the TOP of Phase 1. These findings are the most important thing reviewers produce — they are why we run code reviews. They can NEVER be skipped, deferred, or rationalized away. Fix them first, fix them completely.

## Step 5: Create Action Items for Pattern-Worthy Findings

If any finding reveals a pattern that could prevent future mistakes (a missing rule, a skill gap, a documentation hole), create an issue card in **Action Items** immediately via `mcp__danx-issue__danx_issue_create` (or append to the active card's `retro.action_items[]`). Don't defer to session end.

## Step 6: Run `/pipe-quality`

**After fixing all findings, invoke `/pipe-quality` before proceeding to `/pipe-commit`.** This audits your decisions — verifying that every finding was addressed and no rationalizations slipped through. It is a mandatory pipeline step.

---

## Rules

- **You are the author — agents are the reviewers.** Never skip this step because you're confident in your code.
- **Fix before committing.** ALL findings must be fixed before `/pipe-commit`. No deferring, no "flagging for later."
- **Always create a revisions plan.** Never fix findings ad-hoc without a plan. The plan ensures nothing gets lost and provides a clear record of what was done.
- **Never pollute the main plan file.** Review findings and revision tracking belong in the temp revisions plan only.
- **Always run `/pipe-quality` after fixing.** This is what catches rationalizations and skipped findings.
