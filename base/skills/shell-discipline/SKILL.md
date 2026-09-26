---
name: shell-discipline
description: Shell discipline — exit-code capture, blocking-stdin avoidance, run_in_background vs Monitor vs tail-grep polling, tool-choice (Read/Edit/Write over bash), and signal delivery (kill/pkill) for any process.
---

# Shell Discipline

## Exit-code capture

A long-running command (deploy, build, test, container) must be followed immediately by
`RC=$?` or a `&&`/`||` branch — nothing else. `echo`, `tail`, `grep`, `head`, `cat` all
overwrite `$?`, so a chain ending in one of those silently reports success no matter what
the real command did. Never end a chain with `tail`/`grep`/`head`/`cat` after a long-running
command.

## Never launch a command that can block on stdin

Before every Bash call, foreground or background: does anything in the chain read stdin
with nothing attached (`cat > file` with no heredoc/pipe, bare `cat`, `read`, `ssh`, `psql`,
`npm login`, any `-i`/interactive flag)? These hang forever, and everything after `;`/`&&`
never runs. Redirect stdin closed (`< /dev/null`) or write files with the `Write` tool.
Backgrounding hides this — a background task with zero output past ~2 minutes is presumed
hung, not "still working."

## Redirect to a file before running, if you'll need to search the full output later

Decide before running: will the full output need grepping afterward, not just a tail? If
yes, redirect to a file and `Read`/`grep` it as needed — piping through `tail -N`/`head -N`
at capture time discards everything past N lines, and a later full-content search means
redoing the whole run.

## Polling — Monitor vs background vs tail

Before calling `Monitor`, writing an `until <cond>; do sleep N; done` loop, or polling a
remote API: pick from this decision tree, don't invent one.

1. Tell me once when X finishes → Bash `run_in_background: true` + an until-loop. Never Monitor.
2. Tell me on state changes → Monitor with a prev/cur diff, emit only on change.
3. Tell me every line → Monitor + `tail -f | grep --line-buffered <pattern>`, covering every terminal state.
4. "I want progress" → that's narration, not signal; use option 1.

Interval floors (don't go lower): local check (file/port/lock) 1-5s; local process (docker
ps, pgrep) 10-15s; local file, no DB, 5-10s; backend job (artisan, queue, DB exec) 60s;
LLM/dispatch/orchestrator 60-120s; remote API (gh, Slack, third-party) 30-60s. If the system
has failed under load this session, double the floor.

Monitor's filter must cover forward-progress signal, every failure you'd act on (error,
failed, killed, OOM, assert, panic), and process death — but emit only actionable lines;
narrating every tick costs tokens and attention for no signal.

## Tool choice

Prefer `Read`/`Edit`/`Write` over their bash equivalents (`cat`/`head`/`tail`, `sed`/`awk`,
`echo >`/heredocs) and `Glob`/`Grep` over `find`/`grep`. Read a file before editing it; if an
`Edit` keeps failing, shrink `old_string` to 2-5 lines, and if it still fails, stop — the
file likely isn't editable this way. Use `run_in_background: true` rather than a trailing
shell `&`/`nohup`/`setsid`/`disown`; never double-background, never roll your own
logfile-and-tail in place of it.

Never guess an MCP tool's parameters — load its schema first; interfaces vary even for the
same concept across tools. Literal `\n` in an MCP string argument is two characters, not a
newline — use a real line break.

Never read or edit `dist/` (or any build output) — it's stale; the source tree is truth.
`node_modules/` may be read, never edited. Prefer a language-native refactoring tool
(ts-morph/IDE rename, `gorename`/`gopls rename`, `rope`/`jedi`, `phpactor`) over manual
find-and-replace for a cross-file rename — manual replacement misses references.

## Browser automation

Use the in-app browser tool for any real-browser check (verification, interaction states,
screenshots) — it runs in its own pane rather than throwing a window onto the user's
desktop. Never launch a headed browser on the user's desktop. Verify only in the browser the
user asked for; don't expand to other browsers/engines/OSes unless asked. Close every tab
you opened before the session ends; leave tabs you didn't open alone.

## Signal delivery (kill / pkill / SIGKILL / docker kill)

Treat every signal to a process as a one-way production action — the workspace is shared,
and any process may belong to the user, another agent, or an unrelated program.

Kill only when all three hold: you spawned it this session, you captured its PID at spawn
time into a variable, and that same PID is still the target — no `ps`/pattern-match lookup.
Correlation (start time, TTY, CPU, name match) is not proof; only a captured PID is. Before
signaling, state target PID, where it was spawned, what variable holds it, and what it's
expected to be running — if any of those can't be filled in from this session, ask instead
of guessing. Forbidden: `pkill -f <pattern>`, `killall <name>`, `kill $(pgrep ...)`, or any
construct that targets by name/pattern/inferred ownership rather than a captured PID.

A dev/preview/local server reachable at a fixed address is not scratch space just because
you started it — a person may have a live connection to it right now, and a restart (even
via a helper that cycles an already-running instance) drops every in-flight request the same
as a manual kill. Check for a live connection before stopping or restarting one; if you find
one, say so and get confirmation rather than cycling it silently; prefer attaching to an
already-running instance over stopping and relaunching it.
