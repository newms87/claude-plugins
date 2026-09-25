#!/usr/bin/env node
// PreToolUse Bash|PowerShell deny hook — recursive deletes and mirror-syncs
// whose target is not a literal, specific path.
//
// Background: on 2026-09-15 at 23:29:39Z a danxbot builder agent (card
// DX-2869) ran a background "WSL rsync scratch-copy for Linux verification"
// meant to land in ~/dx2869. The destination reached rsync as `/`. `rsync
// --delete` makes the destination an exact mirror of the source, so for
// thirteen minutes it deleted everything under the WSL root the user could
// write: gpt-manager, danx and danxbot's repos in WSL, and — through /mnt/c —
// every Windows Claude Code transcript and several Windows project trees
// (mutagen then synced the WSL-side deletions into the Windows mirrors). Its
// own output read `rsync: [generator] delete_file: unlink(mnt/c/Users/...)
// failed: Permission denied`; a sandbox run of `rsync -a --delete src/ <root>/`
// reproduced that output line for line. The exact command text is unknown
// because the rsync deleted the transcript that held it — the likeliest shape
// is a destination built from a variable that expanded empty (`$DEST/` -> `/`).
//
// Rule: a command that deletes recursively (rm -r, find -delete, rsync
// --delete*, Remove-Item -Recurse, rd /s, robocopy /MIR|/PURGE) must name its
// target as a LITERAL path, and that path must not be a filesystem/drive/mount
// root, a home directory, or an ancestor of one. A variable is only accepted
// in the fail-loud `${NAME:?}` form followed by a literal path segment, because
// bash aborts on that expansion when NAME is empty instead of collapsing to `/`.
// Wrapped commands (bash -c, wsl.exe, docker exec, xargs, ...) are checked too;
// see lib/shell-commands.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandName, simpleCommands } from "./lib/shell-commands.mjs";
import { protectedPathReason } from "./lib/protected-paths.mjs";

// ---------------------------------------------------------------------------
// Target safety.
// ---------------------------------------------------------------------------

const DYNAMIC_REASON =
  "it is built from a variable, command substitution, glob or ~ that is only resolved at run time — an empty or unexpected value turns it into `/` or a home directory";

/**
 * Decide whether one delete/mirror target word is acceptable.
 * Returns null when safe, or a short human reason when not.
 */
export function unsafeTargetReason(word) {
  if (word.dynamic) {
    // The one accepted dynamic form: `${NAME:?...}` (or `${NAME?...}`) followed
    // by a literal path segment. bash aborts on an empty/unset NAME instead of
    // collapsing the path, and the trailing segment keeps it off a bare root.
    const guarded = /^\$\{[A-Za-z_][A-Za-z0-9_]*:?\?[^}]*\}\/+([^/$`*?[~][^$`*?[]*)$/.exec(word.text);
    if (!guarded || /^\.{1,2}$/.test(guarded[1].split("/")[0])) return DYNAMIC_REASON;
    return null;
  }
  if (word.text.trim() === "") return "it is empty, which some tools resolve to the current directory or root";

  const p = word.text.replace(/\\/g, "/");
  if (/(^|\/)\.\.(\/|$)/.test(p)) return "it climbs with `..`, so the real target depends on the working directory";
  if (/^\.\/*$/.test(p)) return "it is the current directory itself, whose location is not visible in the command";
  return protectedPathReason(p);
}

// ---------------------------------------------------------------------------
// Destructive command recognition.
// ---------------------------------------------------------------------------

const RSYNC_ARG_OPTIONS = new Set([
  "-e", "-f", "-T", "-B", "-M", "--rsh", "--rsync-path", "--exclude", "--include", "--exclude-from",
  "--include-from", "--filter", "--files-from", "--temp-dir", "--partial-dir", "--link-dest", "--copy-dest",
  "--compare-dest", "--backup-dir", "--suffix", "--chmod", "--chown", "--usermap", "--groupmap", "--timeout",
  "--contimeout", "--port", "--password-file", "--log-file", "--log-file-format", "--out-format", "--bwlimit",
  "--max-size", "--min-size", "--max-delete", "--modify-window", "--iconv", "--checksum-choice",
  "--compress-choice", "--compress-level", "--skip-compress", "--block-size", "--info", "--debug", "--outbuf",
  "--sockopts", "--write-batch", "--only-write-batch", "--read-batch", "--protocol", "--address",
  "--remote-option", "--stop-after", "--stop-at",
]);

const POWERSHELL_REMOVE = new Set(["remove-item", "ri", "rm", "del", "erase", "rd", "rmdir"]);

/**
 * If `argv` is a recursive delete or mirror-sync, return `{ tool, targets }`
 * (the words naming what it deletes into); otherwise null.
 */
function destructiveTargets(argv, lang) {
  const name = commandName(argv[0]);
  const rest = argv.slice(1);

  if (lang === "powershell") {
    if (POWERSHELL_REMOVE.has(name)) {
      let recursive = false;
      const targets = [];
      for (let k = 0; k < rest.length; k++) {
        const t = rest[k].text;
        if (/^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(t) || (/^\/s$/i.test(t) && (name === "rd" || name === "rmdir"))) recursive = true;
        else if (/^-(path|literalpath|lp|pspath)$/i.test(t) && rest[k + 1]) targets.push(rest[++k]);
        else if (!/^[-/]/.test(t)) targets.push(rest[k]);
      }
      if (!recursive) return null;
      const split = targets.flatMap((w) => (w.text.includes(",") ? w.text.split(",").filter(Boolean).map((text) => ({ text, dynamic: w.dynamic })) : [w]));
      return { tool: `${argv[0].text} (recursive)`, targets: split };
    }
    if (name === "robocopy") {
      if (!rest.some((w) => /^\/(mir|purge)$/i.test(w.text))) return null;
      const positional = rest.filter((w) => !w.text.startsWith("/"));
      return { tool: "robocopy /MIR", targets: positional.slice(1, 2) };
    }
    return null;
  }

  if (name === "rm") {
    let recursive = false;
    let optionsDone = false;
    const targets = [];
    for (const w of rest) {
      if (!optionsDone && w.text === "--") optionsDone = true;
      else if (!optionsDone && w.text === "--recursive") recursive = true;
      else if (!optionsDone && /^-[a-zA-Z]+$/.test(w.text)) recursive ||= /[rR]/.test(w.text);
      else if (!optionsDone && w.text.startsWith("--")) continue;
      else targets.push(w);
    }
    return recursive ? { tool: "rm -r", targets } : null;
  }

  if (name === "find") {
    const exprStart = rest.findIndex((w) => /^[-(!]/.test(w.text));
    const starts = exprStart === -1 ? rest : rest.slice(0, exprStart);
    const expr = exprStart === -1 ? [] : rest.slice(exprStart);
    const deletes = expr.some((w, k) => w.text === "-delete" || (/^-(exec|execdir|ok|okdir)$/.test(w.text) && expr[k + 1] && commandName(expr[k + 1]) === "rm"));
    return deletes ? { tool: "find -delete", targets: starts.length ? starts : [{ text: ".", dynamic: false }] } : null;
  }

  if (name === "rsync") {
    let deletes = false;
    const operands = [];
    for (let k = 0; k < rest.length; k++) {
      const t = rest[k].text;
      if (t === "--del" || /^--delete(-[a-z]+)?$/.test(t)) deletes = true;
      else if (RSYNC_ARG_OPTIONS.has(t)) k++;
      else if (!t.startsWith("-")) operands.push(rest[k]);
    }
    if (!deletes || !operands.length) return null;
    const dest = operands[operands.length - 1];
    // host:path / user@host:path — the path part is what gets mirrored into.
    const remote = /^(?:[^/:]*@)?([^/:]{2,}):(.*)$/.exec(dest.text);
    return { tool: "rsync --delete", targets: [remote ? { text: remote[2] || ".", dynamic: dest.dynamic } : dest] };
  }

  return null;
}

/**
 * Analyse a whole command string for the given tool. Returns the list of
 * unsafe findings ({ tool, target, reason }), empty when the command is allowed.
 */
export function analyse(command, toolName = "Bash") {
  const findings = [];
  for (const { lang, argv, stdinTargets } of simpleCommands(command, toolName)) {
    const hit = destructiveTargets(argv, lang);
    if (!hit) continue;
    if (stdinTargets) {
      findings.push({ tool: hit.tool, target: "(read from stdin by xargs)", reason: "its targets are piped in at run time, so none of them can be checked" });
      continue;
    }
    for (const target of hit.targets) {
      const reason = unsafeTargetReason(target);
      if (reason) findings.push({ tool: hit.tool, target: target.text, reason });
    }
  }
  return findings;
}

export function denyReason(findings) {
  const list = findings.map((f) => `  - \`${f.tool}\` target \`${f.target}\`: ${f.reason}`).join("\n");
  return `BLOCKED: recursive delete or mirror-sync with an unsafe target.
${list}

An rsync --delete run with a destination that silently expanded to \`/\` has previously deleted content across the WSL root and, through /mnt/c, on Windows too — the risk this guard exists to close.

A recursive delete or mirror-sync must name its target as a LITERAL, specific path — never a filesystem, drive or mount root, a home directory, or an ancestor of one. If the path must come from a variable, use the fail-loud form \`"\${NAME:?}/specific-folder"\`: bash aborts on an empty NAME instead of collapsing to \`/\`. For scratch copies use a dedicated folder such as \`/tmp/<task>-<id>\` or the session scratchpad, spelled out in full.

DO NOT route around this: moving the command into a script file, piping targets through xargs, or asking another agent or session to run it are the same act. If this is a genuine false positive, STOP and tell the operator exactly what you were trying to delete and why.`;
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
