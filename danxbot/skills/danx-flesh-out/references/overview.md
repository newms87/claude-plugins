# Flesh-Out Overview

Flesh-out is a single-shot dispatch: read → probe → rewrite → save → complete. No `/loop`, no `ScheduleWakeup`. Terminal call is `danxbot_complete({status: "ready"})` (or `"review"` for sentinel branch).

Flesh-out is invoked when operator creates half-baked card via dashboard Create-Card button. Card enters with `status: Blocked` + sentinel `blocked.reason` starting "Awaiting flesh-out". Agent fills in: `description` (pass zero-context-test bar), `ac[]` (3–8 verifiable items), optional `triage{}` (Review status only), optional epic split via `danx_issue_create`.

**Refuse paths (only if sentinel wrong):**
- `status: In Progress / Done / Cancelled` → agent doesn't re-flesh mid-flight cards.
- `status: Blocked` AND `blocked.reason` NOT starting "Awaiting flesh-out" → non-sentinel self-block, human decided card needs human action.
- `waiting_on != null` OR `requires_human != null` → parked cards out of scope.
- `children[]` non-empty → epic already split, refuse to orphan phases.

**Probe phase (5–10 min):** Read-only exploration via `Read` / `Grep` / `Glob` / git-only bash. No code execution, no edits outside your worktree, no backend-tracker MCP calls, no subagents.

**Card edits (via MCP):**
1. `description` — rewritten per zero-context-test (Goal / Context / Solution / Key Files).
2. `ac[]` — 3–8 verifiable items (imperative-verb prefix, no "operator verifies" / "manual UI smoke" / "post-dispatch auto-flip" shapes).
3. If split: pick the container by slice count — **one slice stays a Story** (no split); **a few slices → a Feature CONTAINER with child Story cards** (never a Feature worked directly); **many slices / multi-domain → Epic**. Epic children are created atomically via `phase_children[]` (Epic-ONLY — the server 400s `phase_children` on a Feature); Feature children are created as separate `Story`/`Bug`/`Chore` cards each carrying `parent_id: <feature-id>`. The container's `children[]` is populated, `waiting_on` chain stamped child 2..N. A Feature is a container exactly like an Epic — never dispatched, status computed from children; a fleshed-out Feature must NEVER hold the work in its own body / `ac[]` with no children.
4. If `status: Review`: `triage{expires_at, last_status, last_explain, ice, history}` stamped.
5. `comments[]` — ONE `## Flesh-out` entry summarizing action (rewrite, AC count, split count).
6. DX-544 sentinel-block clear: parse ` start as <Review|ToDo>` token; emit `danxbot_complete({status: "ready"})` (default) or `"review"` (sentinel target).

After saving via MCP, re-read via `issue_get` to confirm the edits persisted.

**Terminal calls:** only `ready` (default) or `review` (sentinel). Never `complete` (DX-734 / DX-735 bug class — half-baked lands Done).

**Comment shape:** author `"danxbot-flesh-out"`, markdown body: `## Flesh-out — <date>`, `**Action:** <one of "rewrote", "refined", "split into N phases">`, `**AC count:** <N>` (or `<before> → <after>`), `**Phase split:** <bullet list>` (only if split), `**Triage:** <decision> (ICE <total>)` (Review only), `**Probe summary:** <2–3 sentence summary>`.
