---
name: flow-report
description: 'Present results to the user after a commit. Concise summary of what was done.'
---

# Report Results

Present a concise summary of what was accomplished after committing. The user reviews details via git — this is just the high-level overview.

---

## Steps

1. Run `git show --stat HEAD` to get the files changed in the most recent commit
2. Output the report (see format below)

## Report Format

**Keep it concise.** Include:

- **Accomplished** — Bulleted list: 1-2 bullet summary of the feature/fix/refactor
- **Files changed** — Only include if `/flow-commit` was NOT run earlier in this conversation (it already outputs the summary table). If `/flow-commit` ran, skip this section entirely — the user already saw the file list.
- **Test results** — Table with columns: Suite, Passed, Failed, Status (✅/❌). Only include if tests were run.
- **Skipped findings** — If `/flow-quality-check` identified any validly skipped findings (only: another agent working on the file, or reviewer factually wrong), list them here. Omit section if none.
- **Next step** — Bulleted list: what comes next. Decision tree:
  - **More phases remain** → name the next phase. Then invoke `/next-phase` immediately after the report (no approval gate).
  - **This was the final phase of the session** → the next step is `/flow-finish`. Invoke `/flow-finish` immediately after the report. This is NOT optional and NOT an opt-in question.
  - **Waiting on an external input the pipeline cannot produce itself** (e.g., human-only Trello approval, third-party API outage) → state the blocker and stop. Do not ask permission to run `/flow-finish` or `/next-phase` as a substitute for this case.

## Rules

- **Be concise.** This is a status update, not documentation.
- **Never repeat the full commit message.** Summarize in your own words.
- **Always state the next step.** The user needs to know if there's more work or if they should review and approve.
- **If working in phases**, reference the phase number and name for both completed and upcoming work.
- **CRITICAL — never ask permission for pipeline-mandated steps.** `/next-phase` (between phases) and `/flow-finish` (at session end) are both pre-approved by the original plan approval. Writing "Let me know if you want me to run /flow-finish" or "say go and I'll invoke /next-phase" is a rule violation. The correct pattern is: state the next step AS a fact ("Next step: `/flow-finish`"), then invoke it in the same response without pausing. The user can interrupt if they want something else — they do not need to approve each step.
- **Forbidden phrasing in the Next step bullet:**
  - "If you want me to also…"
  - "Let me know if…"
  - "Say go / go ahead / approve and I'll…"
  - "…want me to run X?"
  - Any question mark attached to a pipeline step.
  If you catch yourself writing one of these about `/flow-finish` or `/next-phase`, rewrite the bullet as a declarative statement and invoke the skill.
