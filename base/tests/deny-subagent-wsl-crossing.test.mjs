// base deny-subagent-wsl-crossing hook — sub-agents never cross from Windows into WSL.
// Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wslCrossings } from "../scripts/deny-subagent-wsl-crossing.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "..", "scripts", "deny-subagent-wsl-crossing.mjs");

const crosses = (tool, input) => assert.ok(wslCrossings(tool, input).length > 0, `expected crossing: ${JSON.stringify(input)}`);
const stays = (tool, input) => assert.deepEqual(wslCrossings(tool, input), [], `expected no crossing: ${JSON.stringify(input)}`);

describe("shell commands that reach into WSL", () => {
  test("the incident shape: wsl.exe -- bash -lc from Git Bash", () => {
    crosses("Bash", { command: 'MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash -lc "rsync -a /mnt/c/src/ ~/dx2869/"' });
  });
  test("wsl without .exe", () => crosses("Bash", { command: "wsl -d Ubuntu ls" }));
  test("wsl by full Windows path", () => crosses("PowerShell", { command: "& C:\\Windows\\System32\\wsl.exe -e ls" }));
  test("wsl hidden inside a command substitution", () => crosses("Bash", { command: 'echo "$(wsl.exe -d Ubuntu -- whoami)"' }));
  test("wsl behind cmd /c from PowerShell", () => crosses("PowerShell", { command: "cmd /c wsl --list" }));
  test("a distro launcher", () => crosses("PowerShell", { command: "ubuntu2204.exe run ls" }));
  test("bare bash from PowerShell, which is WSL bash", () => crosses("PowerShell", { command: "bash -c 'ls ~'" }));
  test("a \\\\wsl.localhost path argument from PowerShell", () => {
    crosses("PowerShell", { command: "Copy-Item C:\\src \\\\wsl.localhost\\Ubuntu\\home\\newms\\x -Recurse" });
  });
  test("a //wsl$ path argument from Git Bash", () => crosses("Bash", { command: "cp -r src //wsl$/Ubuntu/tmp/x" }));
  test("each crossing is reported once", () => {
    assert.equal(wslCrossings("Bash", { command: "wsl.exe ls; wsl.exe pwd" }).length, 1);
  });
});

describe("shell commands that stay on Windows or in containers", () => {
  test("Git Bash bash -c", () => stays("Bash", { command: "bash -c 'echo hi'" }));
  test("Git Bash by explicit path from PowerShell", () => stays("PowerShell", { command: "& 'C:\\Program Files\\Git\\usr\\bin\\bash.exe' -c 'ls'" }));
  test("docker run with an explicit mount", () => stays("Bash", { command: 'docker run --rm -v "C:/Users/newms/projects/danxbot-wt/DX-2869:/work" -w /work node:22 npx vitest run' }));
  test("a /mnt/c path in a container command", () => stays("Bash", { command: "docker exec app ls /mnt/c" }));
  test("the word wsl inside a quoted argument", () => stays("Bash", { command: 'grep -rn "wsl.exe" src/' }));
  test("a heredoc mentioning wsl", () => stays("Bash", { command: "cat > notes.md <<'EOF'\nwsl.exe -d Ubuntu\nEOF" }));
});

describe("file tools", () => {
  test("Write into \\\\wsl.localhost crosses", () => crosses("Write", { file_path: "\\\\wsl.localhost\\Ubuntu\\home\\newms\\x.txt", content: "" }));
  test("Edit into //wsl$ crosses", () => crosses("Edit", { file_path: "//wsl$/Ubuntu/home/newms/x.txt" }));
  test("NotebookEdit into \\\\wsl$ crosses", () => crosses("NotebookEdit", { notebook_path: "\\\\wsl$\\Ubuntu\\tmp\\n.ipynb" }));
  test("Write to a Windows path stays", () => stays("Write", { file_path: "C:\\Users\\newms\\projects\\x.txt", content: "" }));
  test("Read of a WSL path is not a write", () => stays("Read", { file_path: "\\\\wsl.localhost\\Ubuntu\\home\\newms\\x.txt" }));
});

describe("hook process contract", () => {
  const run = (payload) => spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(payload), encoding: "utf8" });
  const incident = { tool_name: "Bash", tool_input: { command: "wsl.exe -d Ubuntu -- bash -lc 'ls'" } };

  test("denies a sub-agent's crossing with a reason naming the sanctioned container path", () => {
    const r = run({ ...incident, agent_id: "a68ed1195bd7a0490", agent_type: "danxbot:worker-sonnet-high" });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.equal(out.permissionDecision, "deny");
    assert.match(out.permissionDecisionReason, /docker run --rm -v/);
  });

  test("leaves the main session's crossing alone", () => {
    const r = run(incident);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("prints nothing for a sub-agent command that stays on Windows", () => {
    const r = run({ tool_name: "Bash", tool_input: { command: "git status" }, agent_id: "x" });
    assert.equal(r.stdout, "");
  });
});
