#!/usr/bin/env node
// PreToolUse deny hook — a SUB-AGENT never crosses from Windows into WSL.
//
// Background: on 2026-09-15 a danxbot builder sub-agent (card DX-2869) wanted
// Linux verification and improvised a "WSL rsync scratch-copy" of its Windows
// worktree into the WSL home. The copy's destination reached rsync as `/`, and
// `rsync --delete` spent thirteen minutes deleting everything the user could
// write under the WSL root and, through /mnt/c, on Windows (see
// deny-unsafe-recursive-delete.mjs for the delete-side guard). Nothing in the
// sub-agent's brief asked for WSL; the sanctioned Linux path — the one the
// orchestrator used right afterwards — is a throwaway container with an
// explicit mount.
//
// Rule: a sub-agent does its Linux work in a container (`docker run --rm -v
// <path>:/work ...`), never by reaching into the WSL distro. Blocked for
// sub-agents only (hook input carries `agent_id` inside a sub-agent; the main
// session, which the operator is watching, is unaffected):
//   - running wsl.exe / wslconfig.exe / a distro launcher, at any nesting depth;
//   - from PowerShell, a bare `bash` — it resolves to C:\Windows\system32\bash.exe,
//     which IS WSL (Git Bash is only reached by its explicit path);
//   - any command argument naming a \\wsl$ or \\wsl.localhost path;
//   - Write / Edit / NotebookEdit on a \\wsl$ or \\wsl.localhost path.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandName, simpleCommands } from "./lib/shell-commands.mjs";

const WSL_LAUNCHERS = /^(wsl|wslconfig|wslg|ubuntu[0-9.]*|debian|kali|opensuse.*|sles.*|fedora.*|alpine)$/;
const WSL_UNC = /^(\\\\|\/\/)(wsl\$|wsl\.localhost)(\\|\/|$)/i;
const FILE_WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

/** Every way this tool call reaches into WSL, as short human descriptions. */
export function wslCrossings(toolName, toolInput) {
  if (FILE_WRITE_TOOLS.has(toolName)) {
    const target = toolInput?.file_path ?? toolInput?.notebook_path ?? "";
    return WSL_UNC.test(target) ? [`writes a file inside the WSL filesystem (\`${target}\`)`] : [];
  }
  if (toolName !== "Bash" && toolName !== "PowerShell") return [];
  const command = toolInput?.command;
  if (typeof command !== "string" || command === "") return [];

  const crossings = [];
  for (const { lang, argv } of simpleCommands(command, toolName)) {
    const name = commandName(argv[0]);
    if (WSL_LAUNCHERS.test(name)) crossings.push(`runs \`${argv[0].text}\``);
    else if (lang === "powershell" && name === "bash" && !/[\\/]git[\\/]/i.test(argv[0].text)) {
      crossings.push("runs `bash` from PowerShell, which resolves to C:\\Windows\\system32\\bash.exe — WSL");
    }
    for (const word of argv) {
      if (WSL_UNC.test(word.text)) crossings.push(`names a path inside the WSL filesystem (\`${word.text}\`)`);
    }
  }
  return [...new Set(crossings)];
}

export function denyReason(crossings) {
  return `BLOCKED: sub-agents do not cross from Windows into WSL.
${crossings.map((c) => `  - this call ${c}`).join("\n")}

An improvised WSL rsync copy has previously deleted content across the WSL root and, through /mnt/c, on Windows too — the risk this guard exists to close.

Do Linux work in a throwaway container with an explicit mount instead, e.g. \`docker run --rm -v "C:/path/to/worktree:/work" -w /work <image> <command>\`, using the image and test services the repo's own docs name.

If the task genuinely needs something inside the WSL distro, STOP and return that need to the orchestrating session in your report — do not route around this through a script, a scheduled task, or another agent.`;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  if (!input?.agent_id) return; // main session: the operator is in the loop
  const crossings = wslCrossings(input.tool_name, input.tool_input);
  if (!crossings.length) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: denyReason(crossings),
      },
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
