# Phases vs Epics

**One concept: `children[]`** (ISS-81). On `type: Epic` cards, `children[]` is ordered list of phase cards (UI label "Phases"). On non-epic, `children[]` is sub-cards (UI label "Children"). **Phases MUST be cards** — no in-card phase checklist.

Slice-counting, the combine-vs-split gates, and the childless-container ban all live in SKILL.md's Card Taxonomy section (canonical) — this file does not restate them.

## Container Mechanics (Epic OR Feature) — sequential-phase `waiting_on` chains

Identical for both container types. Beyond the ordinary `issue_create`/`phase_children[]` mechanics (SKILL.md's MCP Tools Reference + DEPENDENCY-WIRING gate): a sequential-phase `waiting_on` chain may land AT creation — `waiting_on` is status-independent, so a phase can carry derived `Review` + `waiting_on: {by: [<prior-phase>]}` together. The creating agent stamps the `by[]` chain in the same pass it creates the phase cards; no second-pass edit. The picker holds each phase off dispatch until BOTH triage approves (stamps `ready_at` → `ToDo`) AND every `by[]` blocker is terminal. Capture this NOW, while the planning agent has full context — not later.

## Where Phase Cards Go

Same derived status as parent epic at creation. Epic derives Review → phase cards derive Review. Epic derives In Progress → phase cards inherit via own triggers. Phase cards move with epic through lifecycle.

## After Completing Each Phase Card

Same two-step termination sequence as any other card (`danxbot:issue-card-workflow` § "DX-835 — two-step termination is MANDATORY"), then `issue_retro` — `issue_retro` REFUSES 409 until the card is terminal, so it comes after the transition, never before. Do NOT edit the epic — the poller propagates the parent's triggers from children's derived statuses automatically. Next phase card's notes go in `comments[]` per the rule below; once all phases derive Done, the server stamps the epic's `completed_at` automatically.

## CRITICAL: Update Next Phase Card Before Ending Session

Append "Notes from Phase N" entry to next phase card's `comments[]` + save. Capture: discovered constraints, timing gotchas, reusable helpers + paths, cost/budget observations, dependencies between phases, corrections to description. Assume next agent reads ONLY `description` + `comments[]` — not epic handoff, not conversation history, not git log.

Completion-contract preconditions (every AC checked, every child terminal, the container-completion FORBIDDEN rule) live in `danx-next/references/step-procedures.md` § "Completion contract" (canonical — it also names the real write-side guard) — this file does not restate them.
