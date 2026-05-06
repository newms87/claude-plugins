---
name: bash-exit-capture
description: 'MANDATORY before writing any chained bash command containing a long-running process (deploys, builds, full test suites, container ops). Loads exit-code-capture discipline as TodoWrite checklist. Triggers — about to write `command1 && command2; tail` or `command; echo $?`-style chain; about to interpret `EXIT=0` from a chain ending in `tail`/`grep`/`head`/`cat`.'
---

# Bash Exit-Code Capture for Long-Running Commands

## CRITICAL: Capture Exit Code Immediately — Never Rely on `$?` After Intervening Commands

Every long-running command (deploys, builds, full test suites, container ops, hyperopts, backtests) MUST have its exit code captured into a variable on the **very next line**. Anything else — `echo`, `tail`, `grep`, another command — overwrites `$?` and silently destroys the failure signal.

This rule exists because real session burned 20+ minutes reporting `EXIT=0` for a `make deploy` that actually failed with exit code 1 — apt-get hit ubuntu archive timeouts mid docker build, "held broken packages", aborted. Pattern was `make deploy ...; echo EXIT=$?; tail -50 /tmp/deploy.log`. `echo` exit code 0 overrode make's 1, then the script's final exit code became `tail`'s 0. Make's failure silently discarded.

## Anti-Pattern (NEVER do this)

```bash
long_command > /tmp/log.txt 2>&1; echo EXIT=$?; tail -30 /tmp/log.txt
```

Three bugs in one line:
1. `echo EXIT=$?` reflects `echo`'s exit code (always 0) on subsequent reads — not `long_command`'s.
2. `tail -30` is the LAST command in the chain, so the entire bash script's exit code = `tail`'s exit code (almost always 0).
3. `long_command`'s actual exit code is silently discarded.

**Forbidden:** ending any chain that wraps a long-running command with `tail`, `grep`, `head`, `cat`, `awk`, `sed`, or any other command that runs after the long one. Those commands reset `$?` and the failure becomes invisible.

## Fix Pattern A — Capture Immediately Into RC

```bash
long_command > /tmp/log.txt 2>&1
RC=$?
echo "EXIT=$RC"
if [ $RC -ne 0 ]; then
  echo "===FAILED — last 30:"
  tail -30 /tmp/log.txt
else
  echo "===OK"
  tail -10 /tmp/log.txt
fi
```

The newline (or `;`) immediately after `long_command` is the only character allowed before `RC=$?`. No `echo`, no `tee`, no anything between them.

## Fix Pattern B — Short-Circuit

```bash
long_command > /tmp/log.txt 2>&1 && echo "OK" || (echo "FAIL"; tail -30 /tmp/log.txt; exit 1)
```

`&&` / `||` branch on `long_command`'s exit code directly. The `exit 1` inside the failure branch propagates the failure through the subshell so the wrapping script still sees non-zero.

## Mechanical Rules

1. **Long-running command → next line MUST be `RC=$?` (or short-circuit `&& / ||`).** No exceptions, no "but it's just a quick echo first."
2. **Never end a chain with `tail` / `grep` / `head` / `cat` after a long command.** Those reset `$?`. Put the diagnostic dump inside an `if [ $RC -ne 0 ]` branch instead.
3. **Treat `; echo EXIT=$?; tail` as a tell** that the exit code is being thrown away. Search-and-replace anywhere this pattern shows up in agent commands.
4. **Don't trust `EXIT=0` reported after a chain** unless you can point to the `RC=$?` immediately following the long command.

## Why Self-Discipline, Not Detection

The pattern looks legitimate at a glance — `echo EXIT=$?` is a normal idiom, `tail` is a normal idiom, semicolons are normal. Mechanical detection would generate huge false-positive volume. The real fix is reading this rule before writing the chain and using Pattern A or B by default.
