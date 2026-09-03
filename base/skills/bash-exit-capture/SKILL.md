---
name: bash-exit-capture
description: Bash launch discipline — exit-code capture for chained commands (`cmd; tail` swallows the real exit; use `EXIT=$?`), and never launch a command that can block on stdin.
---

# Bash Exit-Code Capture

Long-running (deploys, builds, tests, containers) MUST capture exit code on next line. Anything else (`echo`, `tail`, `grep`) overwrites `$?`.

Example failure: `make deploy ...; echo EXIT=$?; tail` → echo returns 0, tail returns 0, make's failure silent.

## Forbidden anti-pattern

```bash
long_cmd > /tmp/log 2>&1; echo EXIT=$?; tail -30 /tmp/log
```

Three bugs: (1) `echo EXIT=$?` = echo's code, not long_cmd's. (2) `tail` is last → script exit = tail's 0. (3) Actual failure vanishes.

Never end chain with tail/grep/head/cat after long-running cmd.

## Fix A — immediate capture

```bash
long_cmd > /tmp/log 2>&1
RC=$?
if [ $RC -ne 0 ]; then
  echo "FAILED:"; tail -30 /tmp/log
else
  echo "OK"; tail -10 /tmp/log
fi
```

Newline or `;` immediately after long_cmd. Nothing before `RC=$?`.

## Fix B — short-circuit

```bash
long_cmd > /tmp/log 2>&1 && echo "OK" || (echo "FAIL"; tail -30 /tmp/log; exit 1)
```

`&&`/`||` branch directly. `exit 1` in failure subshell propagates.

## Mechanical rules

- Long cmd → next line: `RC=$?` or `&&`/`||` branch. No exceptions.
- Never end chain with tail/grep/head/cat.
- Pattern `; echo EXIT=$?; tail` = red flag → search-and-replace.
- Don't trust `EXIT=0` without pointing to `RC=$?` line.

## Redirect to a file FIRST if you'll need to search it after

Before running, ask: will I need to grep/search the FULL output afterward (e.g. every FAIL line in a test run), not just the tail? If yes → redirect to a file (`cmd > /tmp/scratch/out.log 2>&1; RC=$?`) and `Read`/`grep` the file as many times as needed. Piping through `tail -N`/`head -N` at capture time discards everything past N lines — if a full-content search turns out to be needed later, the whole run must be redone. Decide this BEFORE running, not after seeing truncated results.

## Never launch a command that can block on stdin

Before EVERY Bash call, foreground or background: does any command in the chain read stdin with no input attached? `cat > file` (no `<<EOF`, no pipe), bare `cat`, `read`, `ssh`, `psql`, `npm login`, any `-i`/interactive flag — these hang forever, and everything after the `;`/`&&` never runs.

Redirect stdin closed (`< /dev/null`) or write files with the `Write` tool.

Backgrounding HIDES this: "no output yet" is visually identical to still-working. **A background task with zero bytes of output past ~2 minutes is presumed hung — go read it, never assume it is progressing.**

Real failure: `cat > /tmp/patch.py 2>/dev/null; node -e "..."` backgrounded as a heredoc workaround. `cat` blocked on stdin for 39 minutes; the `node -e` never ran; the operator noticed before the agent did.
