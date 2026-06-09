---
name: slack-agent
description: 'Slack-worker dispatch contract: danxbot_slack_reply once + danxbot_complete; intermediate update discipline; thread-scope invariant.'
audience: worker
---

# Slack Agent Dispatch — Replying to Slack Threads

If you were dispatched in response to a Slack message, your entire
user-facing output goes through the `danxbot_slack_*` MCP tools. You do
not print answers to stdout for a Slack user to see — there is nobody
reading your stdout. The Slack thread is the only surface the user ever
sees, and the only way to reach it is via the tools below.

**Format the reply text using `base:convey`** — concept-first headline,
caveats list, optional verify pointer. Slack reply budget is **≤12
lines** under convey. Lead with the answer, not the investigation
narrative. This skill owns the *transport contract* (which tool to
call); `convey` owns the *structure of the message text*. Both apply.

**Slack does NOT render GFM/markdown tables.** A `| col | col |` pipe
table posts as literal unreadable pipes — never emit one. For anything
table-shaped use the format rule under *Returning data* below: tiny
structured answers → Slack-native bullets or a `code` block;
list-shaped or many-column data → a file attachment (CSV or other type
fitting the content).

## Required tool calls

1. **`danxbot_slack_reply`** — call this exactly ONCE, after you have
   finished investigating and have a final answer. The `text` parameter
   IS the user's reply; write it as if you are the one person in the
   thread answering their question. Format with Slack mrkdwn
   (`*bold*` / `_italic_` / `\`code\``), keep it focused, and do not
   hedge with meta-commentary like "I'll go check X" — that belongs in a
   `danxbot_slack_post_update`, not the final reply.

2. **`danxbot_complete`** — call this IMMEDIATELY after
   `danxbot_slack_reply`, with `status: "complete"` and a short
   `summary` (one sentence, for the dispatches dashboard — NOT for the
   Slack user). Never exit without calling this.

If something went wrong and you cannot produce a useful reply, still
post a `danxbot_slack_reply` explaining what you couldn't answer and
why, then call `danxbot_complete` with `status: "failed"` and the
failure reason.

## Intermediate updates — use sparingly

**`danxbot_slack_post_update`** posts a status line into the same
thread while you're still working. Use it ONLY for updates the user
cares about:

- "Reading the campaign schema now" — yes
- "Found the failing test — it's a stale fixture" — yes
- "Running Read on src/foo.ts" — NO, the user doesn't care
- Any progress-bar-style spam — NO

A good dispatch has zero to two intermediate updates. If you catch
yourself posting every file read, stop — noise erodes trust and the
user will mute the bot. The canonical pattern is: post one update when
you've identified the investigation plan, finish the work silently,
post the final `danxbot_slack_reply`, and `danxbot_complete`.

## Thread scope is automatic

The worker routes every `danxbot_slack_*` call back to the originating
thread (same channel, same `thread_ts`) based on the dispatch row. You
do not pick a thread. You do not pick a channel. If you try to address
a different thread, you can't — the tool has no parameter for it.

## Data questions — query the repo's DB directly

For a data/lookup question, fetch the rows yourself before you reply.
Your cwd is the connected repo's **full checkout**, with its own
containers and DB. There is no danxbot DB wrapper tool — you query the
database the way a developer on that repo would, via Bash. Three general
shapes (the **exact** compose file, service/container names, and DB
engine are repo-specific — the connected repo's `tools.md`, loaded into
your context, names them; use those, not the placeholders below):

- `docker compose -f <repo-compose> exec -T <db-service> <client> … -e "<SQL>"`
  — exec the repo's own DB container (works host AND docker worker).
- `docker compose -f <repo-compose> exec -T <app-service> <framework-cmd>`
  — drive the app's own framework (e.g. Laravel `php artisan tinker`).
- the DB client directly against the env creds (`DANX_DB_HOST` /
  `DANX_DB_PORT` / `DANX_DB_USER` / `DANX_DB_PASSWORD` / `DANX_DB_NAME`,
  already in your Bash env) when the CLI is on PATH.

Browse the codebase (models, migrations) to learn the schema, then run
the query, **write the results to a file**, reason over them, and reply.
**Always defer to the connected repo's `tools.md` for the real service
names + commands** — it is authoritative for that repo.

**Returning data — NEVER dump raw rows or a GFM pipe-table inline.**
Slack renders neither; both post as unreadable literal text. This is
the single format rule — pick by size and content:

- **Tiny structured answer** (≤ 10 rows AND few columns) → Slack-native
  **bullets** or a fenced **`code` block** in `danxbot_slack_reply({text})`.
  Never a `| … |` pipe table.
- **> 10 rows, OR many columns, OR any list-shaped data** → **attach a
  file**; `text` is a 1–3 line summary, the data rides in the file:
  ```
  danxbot_slack_reply({ text: "47 active suppliers attached as CSV.", files: ["/tmp/suppliers.csv"] })
  ```
  CSV is the default attachment for tabular data; use a different type
  when it fits the content better (e.g. `.json` for nested shapes,
  `.md`/`.txt` for prose, `.sql` for a schema dump).
- **Default to a file attachment** for any list of data unless you have
  a genuinely better tiny view (e.g. a 3-row rollup). A raw inline
  string dump is never the answer — it also blows the ≤12-line reply
  budget above.

The worker uploads the file(s) atomically with the reply text; a
missing/oversized file fails loud back to you as `{error}`. For a prose
answer with no list, just use `danxbot_slack_reply({text})`.

**Build the CSV with a real serializer — never hand-join with commas.**
`awk '{print $1","$2}'` / `sed` / `tr '\t' ','` produce BROKEN CSV: real
values contain commas/quotes (`"Adams, Jaskolski and Howell"`) and a
naive join shifts every column. The DB client's output is tab-separated,
so pipe it through a tool that quotes per RFC 4180 — Python's `csv`
module is always available:

```
… mysql -e "SELECT …" | python3 -c 'import sys,csv; w=csv.writer(sys.stdout); [w.writerow(r.split("\t")) for r in sys.stdin.read().split("\n") if r]' > /tmp/out.csv
```

(or the app framework's CSV writer, e.g. PHP `fputcsv`, which reads
native values — prefer it for fields that may hold tabs/newlines). The
connected repo's `tools.md` has the exact recipe for that repo.

## This is the ONLY path to the user

There is no direct `chat.postMessage`. There is no Bash-to-curl escape
hatch. There is no "reply in stdout and danxbot will forward it." The
`danxbot_slack_*` MCP tools are the only surface the Slack user ever
sees — an agent that prints its answer to stdout and exits went silent
on the user. (Querying the DB, by contrast, IS plain Bash — that part
has no wrapper.)
