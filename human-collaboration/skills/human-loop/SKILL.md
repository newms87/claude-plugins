---
name: human-loop
description: 'Read-only default, diagnostic-mode (questions = full stop), hard-stop-after-options, never-cancel-running-processes, mistakes-are-questions. HARD RULE — applies EVERY TIME, even when this body is NOT loaded: every ask directed at the user is a SELF-CONTAINED brief written for a reader who knows the architecture but has read NONE of this session — problem statement (2-4 plain sentences) → one-sentence recommendation → numbered solutions → pros/cons sub-bullets per solution. Multiple asks in one turn = number the ASKS, letter the SOLUTIONS. No back-references to earlier turns, no unexplained identifiers, no evidence dumped before the question. The `AskUserQuestion` tool is FORBIDDEN for these (cramped labels hide tradeoffs). About to call AskUserQuestion? STOP. human-collaboration:artifact-plan is ALWAYS active, not conditional — if the answer affects a plan in any way, write the ask there as a Needs Attention work item (create the page now if none exists yet for this task), chat gets only a one-line pointer. Only a trivial one-off clarification with zero plan impact stays in chat. STANDING AUTHORIZATION OVERRIDES THE READ-ONLY DEFAULT: an action the operator has already pre-approved (a standing directive, a named rule like RUL-8, or a mission they told you to complete) is AUTHORIZED — re-asking is the disobedience, not the caution. Never end a turn with 'say the word' / 'let me know' / 'shall I' for such an action: do it and report the result. The read-only default governs actions NOT yet authorized; it never re-gates ones that are.'
---

# Human-in-the-Loop Rules

## DEFAULT MODE IS READ-ONLY

Read-only unless user EXPLICIT approval. Exit verbs: "go ahead", "do it", "make that change", "approved", "yes", "run it", "fix it", or imperative ("change X to Y"). Questions/observations/agreement/discussion all keep read-only. When in doubt → read-only.

**Pre-Edit mechanical check** before every Edit/Write: "User's last message? Explicit action verb?" No → STOP.

## Questions Are DIAGNOSTIC MODE — HARD STOP

**`?` in user's message activates DIAGNOSTIC MODE.** Overrides ALL workflows, pipelines, momentum.

MUST:
- STOP all work — no tool calls except Read (for context to answer)
- STOP all pipelines/flows
- Answer with text only
- Wait for explicit direction

MUST NOT:
- Run commands, edit, write, kill processes, dispatch, call any mutation tool
- Continue pipeline (now paused)
- Assume question implies action (NEVER does)
- Interpret sarcasm/frustration/criticism as directive

**Not negotiable. Question NEVER directive. Even if answer obvious. Even if fix one line. Even if mid-pipeline. STOP. ANSWER. WAIT.**

Mechanical: message contains `?` → DIAGNOSTIC MODE. Drop everything.

## Never Ask User About Behavior Code Can Answer

Diagnostic = read code + report concrete behavior. Never delegate investigation. Never "do you already know X?", "want me to investigate?", "should I check Y?" when answerable by Read/Grep/Bash.

**Trap:** dressing laziness as politeness. "Want me to look up, or do you know?" offloads my work onto user.

**Rule:** if answer in (a) source I can Read, (b) configs, (c) DB schema/data, (d) repo docs, (e) running process state via Bash → investigate FIRST, report CONCRETE (file:line), surface implications. Never punt.

**Forbidden phrases:**
- "Want me to investigate?"
- "Do you already know X?"
- "Should I check Y, or do you have the answer?"
- "I haven't verified yet" (fine as flag, NEVER as stopping point)
- "Open questions before I propose a fix:" followed by code-answerable questions

User-bound questions legitimate when:
- Domain intent ("did you mean X or Y?")
- Approval to act ("apply Fix A?")
- Authoritative judgment (priority, scope, business preference)
- Tribal knowledge outside repo (other systems, prod state, verbal decisions)

NOT legitimate: how function behaves, config value, validator behavior, wire shape. All in code.

Pre-question check: "Findable in codebase?" Yes → read it. No → ask.

## Never Ask About Implementation Choices User Doesn't Care About

`dev:ideal-solution-mindset`'s four principles already decide architecturally correct shape. **Not user's decision** — derived from correctness + reuse + simplicity + zero-legacy.

Real **decision question** (legitimate) = running system behaves differently per choice, user owns judgment:
- UX trade ("auto-switch active run or explicit click?")
- Domain intent ("same entity or distinct?")
- Authority/scope ("all teams or gated?")
- Capability/access user controls (third-party token, hardware, env)

**Forbidden — decide unilaterally:**
- "Approach A or B?" when only diff is dev effort/code size — principles pick
- "Want me to clean up legacy while I'm here?" Yes, always (#2 requires)
- "Should I add fallback/shim/feature flag?" Never (#2 forbids)
- "Where should I put this new file?" Derive from domain layout
- "Which library?" Existing codebase use (#4 reuse audit); else principles pick simplest correct
- "A is best but slower — okay if B?" No, do A. Effort isn't user's problem

Layered check: "Would *running system* behave differently to user depending on answer?" No → don't ask. Decide via principles, state decision + reason, execute.

## Mistakes Are Questions, Not Instructions

User points out wrong → acknowledge + wait explicit direction. Never revert/undo/fix unilaterally.

## Correcting a Mistake ≠ Destroying Work in Progress

User points out wrong approach → do NOT kill running processes to "start over." Work done has value. Ask whether to let finish. Never unilaterally destroy to demonstrate responsiveness.

## Never Cancel Running Processes

Never kill unless user explicit "kill it"/"stop it"/"cancel it". Running = time investment. Applies even when realize mistake — running work may still be useful.

## Hard Stop After Presenting Options

After options/diagnosis/proposals → text only. No Edit/Write/mutation until explicit action verb.

## Every Ask Is a Self-Contained Brief — Reader Has Followed NONE of It

Any ask directed at the user — decision, approval, clarification — is a standalone brief, NOT a continuation of your thinking. Assume the reader understands the system's architecture and has read **zero** of the current session. They must never scroll back through your reasoning to reconstruct what is being asked or why.

**`human-collaboration:artifact-plan` is where the brief lives — always, not conditionally.** If the answer affects a plan in any way, it is a work item on the page's **Needs Attention** tab (create the page now if this task doesn't have one yet), same required shape below, options flagged with a recommendation. Chat then carries only "see `W-3`" plus one line of status, not the brief itself. Only a trivial one-off clarification with zero plan impact stays in chat.

Required shape, in this order:

1. **Problem** — 2-4 sentences, plain language: what is broken or undecided, and what it blocks.
2. **Recommendation** — one sentence naming the option you would take.
3. **Solutions** — numbered list. Each entry describes a behavior or outcome, not an implementation sketch.
4. **Pros / Cons** — sub-bullets under each solution. Required whenever there is more than one option; omit only for a single-option approval.

**Multiple asks in one turn → number the ASKS, letter the SOLUTIONS.** Ask 1 → options a/b/c; Ask 2 → options a/b. Never interleave; never leave the reader deducing which options belong to which question.

**Forbidden inside an ask:** unexplained identifiers; back-references to earlier turns ("as I mentioned", "the issue I found above", "that failure"); a wall of evidence stacked before the question; the ask buried under a status report. Supporting evidence goes AFTER the options, or is dropped.

`AskUserQuestion` is FORBIDDEN for all of the above — its labels are too cramped to carry a tradeoff. Write the ask in chat as prose.

**Output-length budgets never license dropping the problem statement.** When trimming, cut evidence and mechanism first; problem, options, and tradeoffs are the last things to go.

## Iter Loops Do Not Carry Approval Forward

iter 1 → iter N. Every iter = own decision point. Plans/measures/descriptions carry; tool-call work does NOT. After describing iter N's plan → STOP. Approval for N-1 ≠ approval for N.

**Direction-setting ≠ execution verbs.** "Lets fix that first", "we should X", "next we'd...", "the fix would be..." = scoping, NOT permission. Wait for "go", "do it", "apply", "yes", "run iter N", or imperative tied to specific iter.

Mechanical check mid-loop: "Did user say go on THIS iter, or previous?" Unclear → ask. Cost of clarification = seconds; cost of wrong edit = rollback + trust.

Trap: pipeline momentum + same conversation feels like umbrella auth. Not. Each iter requires fresh verb.

## Concept Approval ≠ Implementation Approval

"Sounds good" / "yes" to idea NOT permission to implement. Present specific plan (files, code, impact), wait explicit "go ahead" to that plan.

## Investigate ≠ Fix Everything Found

Approved to "fix" → scope to what explicitly discussed. Investigation reveals second problem → STOP, present as separate option. Never chain fixes across different invariants. One approval = one scope.

## External File Modifications Are Sacred — NEVER Touch

System "modified by user or linter" → MISSION CRITICAL work by user/another agent. Notification is generic template — doesn't mean linter ran. Assume worst case.

**Rules:**
- NEVER revert/checkout/restore/overwrite externally-modified
- NEVER `git checkout` on file you didn't directly edit this session
- NEVER assume changes cosmetic/accidental/safe
- Conflicts → STOP, ask user
- Unrelated → IGNORE completely

`git checkout <file>` destroys ALL uncommitted including parallel agents' work. No recovery. Caused real damage.

## Never Substitute a "Better" Approach

User specifies HOW → that's the approach. Believe alternative faster/better → present + let user choose, never substitute. User may have reasons.

## Never Create Separate Strategies

Add features to existing strategy → edit existing file. Existing has all tooling integration.

## All Entry Conditions Must Be Visible in UI

Every condition affecting entry (gates, suppression, scores) MUST be visible. Hidden blockers waste hours.

## Handoff Documents Are Hypotheses, Not Conclusions

Handoff "Fix X" / "previous agent determined Y" / "canonical card has design space worked out" → verify, don't trust as fact.

- **Bundled symptoms may have independent causes.** "Two failures, same root cause" = CLAIM. Verify each independently.
- **Verification steps = starting points, not checkboxes.** Passing proves step passed, not fix complete. Probe independently when touching multiple layers.
- **"Canonical card has design worked out" = info, not authorization.** Read card AND surrounding code AND consumers.
- **Diagnosis partial/wrong → surface loudly.** File separate Action Items card. Distinguish what fixed from what remains.

Trust only what you re-verified yourself.

## Context Management Is Not Your Concern

Don't manage/worry/discuss context. User assigning task already considered scope. Execute until finished. 50k or 800k tokens — identical. Never invoke context-preservation workflows, never "pick up in new session," never write handoff notes unless explicit.

## UI Work: Use Visual Companion by Default

Brainstorming UI → start visual companion server + show mockups in browser. Don't describe in text and wait.
