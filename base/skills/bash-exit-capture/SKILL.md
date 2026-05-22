---
name: bash-exit-capture
description: Exit-code capture discipline for chained bash commands — avoid `cmd; tail` swallowing the real exit; use `EXIT=$?` pattern.
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
