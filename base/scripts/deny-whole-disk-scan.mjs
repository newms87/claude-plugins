#!/usr/bin/env node
// PreToolUse Bash|PowerShell deny hook — tree-walking scans (find, grep -r,
// rg, ls -R, du, dir /s, Get-ChildItem -Recurse) whose STARTING PATH is a
// filesystem/drive/mount root or a home directory.
//
// Background: on 2026-09-17 sub-agents left 14 concurrent `find /` processes
// running on this machine. The oldest had been running since 01:08 and had
// accumulated over 13 CPU-hours; each was consuming close to a full core.
// Every dispatch brief that day said "never run a whole-disk find" — agents
// ran one anyway. Examples actually found running:
//   find / -maxdepth 6 -iname flytebot-design-system -type d
//   find / -iname Tag.tsx
//   find / -iname Pagination*.tsx
//   find / -iname *ChatSessionBar*
//   find / -path */node_modules/@flytedan* -iname *CsiBadge*
// Every one of those answers was sitting in the project tree or
// `node_modules` and would have taken milliseconds to find there.
//
// Rule: a command that walks a directory tree (find; grep -r/-R; rg/ripgrep,
// which is recursive by default; ls -R; du; `dir /s`; PowerShell
// `Get-ChildItem -Recurse`) must not start that walk at a filesystem, drive,
// or mount root, or at a home directory — see lib/protected-paths.mjs for
// exactly which paths those are. A scan of a genuinely specific, deep path
// (a project tree, `node_modules`, `.`) is unaffected. Wrapped commands
// (bash -c, wsl.exe, docker exec, xargs, ...) are checked too; see
// lib/shell-commands.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandName, simpleCommands } from "./lib/shell-commands.mjs";
import { protectedPathReason } from "./lib/protected-paths.mjs";

// ---------------------------------------------------------------------------
// Target safety.
// ---------------------------------------------------------------------------

// Spellings of "the user's home directory" that never appear as a literal
// `/home/<user>` or `C:\Users\<user>` path segment, so protectedPathReason()
// alone would not catch them. A trailing slash is allowed; anything ELSE
// after them (`~/projects`, `$HOME/scratch`) names a specific place under
// home and is left alone.
const HOME_ALIASES = [/^~\/?$/, /^\$\{?HOME\}?\/?$/, /^(?:\$env:userprofile|%userprofile%)\/?$/i];

/**
 * Decide whether one scan starting-path word is a whole-disk or whole-home
 * scan. Returns null when safe, or a short human reason when not.
 */
export function unsafeScanRootReason(word) {
  if (HOME_ALIASES.some((re) => re.test(word.text))) return "it is the user's home directory";
  return protectedPathReason(word.text.replace(/\\/g, "/"));
}

// ---------------------------------------------------------------------------
// Scanner recognition — for each tool, extract the words naming where the
// tree walk STARTS. Every extractor returns `null` when the command isn't a
// tree-walking invocation at all, or when it names no explicit starting path
// (which defaults to the current directory — always safe).
// ---------------------------------------------------------------------------

const GREP_VALUE_OPTIONS = new Set([
  "-f", "--file", "-m", "--max-count", "-A", "--after-context", "-B", "--before-context", "-C", "--context",
  "--include", "--exclude", "--exclude-from", "--exclude-dir", "--color", "--colour", "-D", "--devices",
  "--binary-files", "--label",
]);

const RG_VALUE_OPTIONS = new Set([
  "-f", "--file", "-m", "--max-count", "-A", "--after-context", "-B", "--before-context", "-C", "--context",
  "-g", "--glob", "--iglob", "-t", "--type", "-T", "--type-not", "--type-add", "--max-depth", "-j", "--threads",
  "--context-separator", "--color", "--colors", "--encoding", "-M", "--max-columns", "--path-separator",
]);

/** grep/ripgrep share this shape: options, an optional `-e PATTERN` (repeatable), then operands. */
function patternToolOperands(rest, valueOptions) {
  let hasPatternOption = false;
  const operands = [];
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k].text;
    if (t === "-e" || t === "--regexp") {
      hasPatternOption = true;
      k++;
      continue;
    }
    if (valueOptions.has(t)) {
      k++;
      continue;
    }
    if (t.startsWith("-")) continue;
    operands.push(rest[k]);
  }
  // With no `-e PATTERN`, the first operand IS the pattern, not a path.
  return hasPatternOption ? operands : operands.slice(1);
}

function findStartPaths(rest) {
  const exprStart = rest.findIndex((w) => /^[-(!]/.test(w.text));
  const starts = exprStart === -1 ? rest : rest.slice(0, exprStart);
  return starts.length ? starts : null; // no explicit start -> "." -> safe
}

function grepStartPaths(rest) {
  let recursive = false;
  for (const w of rest) {
    const t = w.text;
    if (t === "--recursive" || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(t)) recursive = true;
  }
  if (!recursive) return null;
  const targets = patternToolOperands(rest, GREP_VALUE_OPTIONS);
  return targets.length ? targets : null;
}

function ripgrepStartPaths(rest) {
  const targets = patternToolOperands(rest, RG_VALUE_OPTIONS);
  return targets.length ? targets : null; // rg is recursive by default, no flag needed
}

function lsStartPaths(rest) {
  let recursive = false;
  const operands = [];
  for (const w of rest) {
    const t = w.text;
    if (t === "--recursive") recursive = true;
    else if (/^-[a-zA-Z]+$/.test(t)) recursive ||= /R/.test(t); // ls: capital -R only
    else if (!t.startsWith("-")) operands.push(w);
  }
  if (!recursive) return null;
  return operands.length ? operands : null;
}

function duStartPaths(rest) {
  // du walks the whole tree under its operand(s) even when summarizing (-s);
  // there is no non-recursive mode, so any explicit operand is a start path.
  const operands = rest.filter((w) => !w.text.startsWith("-"));
  return operands.length ? operands : null;
}

/** cmd.exe `dir /s` and PowerShell `Get-ChildItem -Recurse` (incl. its `dir`/`ls`/`gci` aliases). */
function powershellRecurseStartPaths(rest) {
  let recursive = false;
  const operands = [];
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k].text;
    if (/^\/s$/i.test(t) || /^-recurse$/i.test(t)) recursive = true;
    else if (/^-(path|literalpath)$/i.test(t) && rest[k + 1]) operands.push(rest[++k]);
    else if (!t.startsWith("-") && !t.startsWith("/")) operands.push(rest[k]);
  }
  if (!recursive) return null;
  return operands.length ? operands : null;
}

/**
 * If `argv` is a tree-walking scan, return `{ tool, targets }` (the words
 * naming where it starts); otherwise null.
 */
function scanStartPaths(argv, lang) {
  const name = commandName(argv[0]);
  const rest = argv.slice(1);

  if (lang === "powershell") {
    if (name === "dir" || name === "ls" || name === "gci" || name === "get-childitem") {
      const targets = powershellRecurseStartPaths(rest);
      return targets ? { tool: "Get-ChildItem -Recurse", targets } : null;
    }
    return null;
  }

  if (name === "find") {
    const targets = findStartPaths(rest);
    return targets ? { tool: "find", targets } : null;
  }
  if (name === "grep") {
    const targets = grepStartPaths(rest);
    return targets ? { tool: "grep -r", targets } : null;
  }
  if (name === "rg" || name === "ripgrep") {
    const targets = ripgrepStartPaths(rest);
    return targets ? { tool: "rg", targets } : null;
  }
  if (name === "ls") {
    const targets = lsStartPaths(rest);
    return targets ? { tool: "ls -R", targets } : null;
  }
  if (name === "du") {
    const targets = duStartPaths(rest);
    return targets ? { tool: "du", targets } : null;
  }
  return null;
}

/**
 * Analyse a whole command string. Returns the list of unsafe findings
 * ({ tool, target, reason }), empty when the command is allowed.
 */
export function analyse(command, toolName = "Bash") {
  const findings = [];
  for (const { lang, argv } of simpleCommands(command, toolName)) {
    const hit = scanStartPaths(argv, lang);
    if (!hit) continue;
    for (const target of hit.targets) {
      const reason = unsafeScanRootReason(target);
      if (reason) findings.push({ tool: hit.tool, target: target.text, reason });
    }
  }
  return findings;
}

export function denyReason(findings) {
  const list = findings.map((f) => `  - \`${f.tool}\` starting at \`${f.target}\`: ${f.reason}`).join("\n");
  return `BLOCKED: whole-disk or whole-home tree-walking scan.
${list}

On 2026-09-17 sub-agents left 14 concurrent \`find /\` processes running on this machine. The oldest had been running since 01:08 and had accumulated over 13 CPU-hours; every one of them was consuming close to a full core, and every dispatch brief that day already said "never run a whole-disk find". Every answer those scans were hunting for — a component file, a design-system directory, a specific package under node_modules — was sitting in the project tree and would have taken milliseconds to find there.

A tree-walking scan (find, grep -r/-R, rg, ls -R, du, dir /s, Get-ChildItem -Recurse) must start at a specific, named directory — never a filesystem, drive, or mount root, never a home directory. Search the project tree, the relevant \`node_modules\` package, or another specific directory you can name. Prefer the Glob and Grep tools over shelling out to find/grep at all — they are faster and already scoped.

DO NOT route around this: moving the command into a script file, wrapping it in another shell, piping it through xargs, or asking another agent or session to run it are the same act. If you genuinely need to search the whole disk, STOP and tell the operator exactly what you are looking for and why the project tree doesn't have it.`;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || command === "") return;
  const findings = analyse(command, input.tool_name);
  if (!findings.length) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: denyReason(findings),
      },
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
