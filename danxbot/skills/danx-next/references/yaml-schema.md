# YAML Schema Reference

| Field | Type | Notes |
|---|---|---|
| `schema_version` | `10` | Always exactly `KNOWN_SCHEMA_MAX`. Never change at write time. |
| `tracker` | string | Don't change. |
| `id` | string (`<PREFIX>-N`) | The id you save with. Matches the filename. Don't change. |
| `parent_id` | string \| null | Set on child cards (epic's `id` for phase children, or any other parent's `id` for sub-cards). Reverse linkage to `children[]`. |
| `children` | `string[]` (ids) | Ordered list of child issue ids. Phases MUST be cards — no in-card phase checklist. Maintained by `danx_issue_create` and `danx-epic-link` skill. |
| `dispatch` | `{id, pid, host, kind, started_at, ttl_seconds} \| null` | Poller-managed dispatch record. Don't touch. |
| `status` | `Review` \| `Backlog` \| `ToDo` \| `In Progress` \| `Blocked` \| `Done` \| `Cancelled` | **Derived — agents NEVER write.** Computed from lifecycle timestamps + gate fields via `deriveStatus()`. Direct write forbidden. Pickup → `dispatch != null`; ready → `ready_at`; complete → worker stamps `completed_at`; cancel → `cancelled_at`; block → `blocked.at`. |
| `ready_at` | `string \| null` (ISO) | Triage Approve / agent-marks-ready → worker stamps. Rule 5 → `ToDo`. |
| `completed_at` | `string \| null` (ISO) | Worker stamps on `danxbot_complete({status: "complete"})`. Rule 2 → `Done`. |
| `cancelled_at` | `string \| null` (ISO) | Triage Cancel / move-to-cancelled-list → worker stamps. Rule 1 → `Cancelled`. |
| `archived_at` | `string \| null` (ISO) | Move-to-archived-list → worker stamps. Rule 6 → `Backlog`. |
| `list_name` | `string \| null` | **Display-only; workers never read.** Auto-resolved by worker to default list of derived type. |
| `requires_human` | `null` OR `{reason, steps[], set_by, set_at}` | Orthogonal "this card needs a human" gate. Null = no human action needed. Non-null = card cannot progress until human acts on system outside agent reach (3rd-party token, vendor portal, manual deploy, external infra). Independent from `blocked`, `waiting_on`, `conflict_on[]` — all may coexist. Picker AND-s them. |
| `type` | `Bug` \| `Feature` \| `Epic` | Required label. |
| `title` | string | Card name. |
| `description` | string | Full markdown body. |
| `triage` | `{expires_at, reassess_hint, last_status, last_explain, ice, history[]}` | Triage agent owns this. Leave alone. |
| `ac` | `[{check_item_id, title, checked}]` | Acceptance Criteria. Empty `check_item_id` on new items — tracker assigns. |
| `comments` | `[{id?, author, timestamp, text}]` | Append new comment by adding `{author, timestamp, text}` (no `id`). Worker handles tracker push. |
| `retro` | `{good, bad, action_item_ids[], commits[]}` | Fill on Done / Cancelled / Blocked. Worker auto-renders `## Retro` comment. `action_item_ids[]` is `string[]` of `<PREFIX>-N` references. **`commits[]` is owned-repo ONLY** — every sha must reach from THIS repo's `origin/main`. Cross-repo work (plugins, sibling repos) documents in `comments[]` entry naming external repo. DX-559 gate blocks `danxbot_complete({status: "complete"})` when violated. |
| `blocked` | `null` OR `{at, reason}` | **Self-block lifecycle trigger.** Null = card can proceed. Non-null = card itself stuck; human/next dispatch must clear `blocked: null`. `at` = ISO timestamp. `reason` = non-empty sentence. Agents never write `status: "Blocked"` — stamp `blocked.at`; derivation projects to `Blocked` via rule 3. |
| `waiting_on` | `null` OR `{reason, timestamp, by[]}` | **Pure dispatch gate, independent of status.** Null = nothing blocks. Non-null = waiting on OTHER in-flight work (phase sibling, Action Items, separately-scoped task). `reason` = non-empty sentence. `timestamp` = ISO. `by[]` = IMMEDIATE blocker(s) only (never transitive). Picker skips dispatch while any `by[]` id non-terminal; auto-unblocks on terminal. Field is **durable record** — never auto-cleared. **Waiting On ≠ Blocked.** |

**Save semantics:** No save verb. `Edit` / `Write` to modify YAML. Chokidar watcher mirrors to Postgres; RFC 6902 patch recorded in `issue_history`. Malformed YAML mirrored as `{_malformed: true, raw: <text>}`.

**Open → closed move:** Worker stamps `completed_at` / `cancelled_at` on `danxbot_complete` triggers; post-completion auto-sync moves file `open/` → `closed/`. Agent does NOT move file; does NOT write `status:` literals.

**Auto-sync:** `danxbot_complete` triggers immediate tracker push. Without it, YAML reaches tracker on poller's next tick (~30-60s); calling `complete` is faster.
