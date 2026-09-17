// base deny-whole-disk-scan hook — blocks tree-walking scans (find, grep -r,
// rg, ls -R, du, dir /s, Get-ChildItem -Recurse) whose starting path is a
// filesystem/drive/mount root or a home directory.
// Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyse, unsafeScanRootReason } from "../scripts/deny-whole-disk-scan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "..", "scripts", "deny-whole-disk-scan.mjs");

const blocked = (cmd, tool = "Bash") => assert.ok(analyse(cmd, tool).length > 0, `expected BLOCK: ${cmd}`);
const allowed = (cmd, tool = "Bash") => assert.deepEqual(analyse(cmd, tool), [], `expected ALLOW: ${cmd}`);

describe("the 2026-09-17 incident commands are blocked verbatim", () => {
  test("find / -maxdepth 6 -iname flytebot-design-system -type d", () => {
    blocked("find / -maxdepth 6 -iname flytebot-design-system -type d");
  });
  test("find / -iname Tag.tsx", () => blocked("find / -iname Tag.tsx"));
  test("find / -iname Pagination*.tsx", () => blocked("find / -iname Pagination*.tsx"));
  test("find / -iname *ChatSessionBar*", () => blocked("find / -iname *ChatSessionBar*"));
  test("find / -path */node_modules/@flytedan* -iname *CsiBadge*", () => {
    blocked("find / -path */node_modules/@flytedan* -iname *CsiBadge*");
  });
});

describe("find", () => {
  test("blocks find / with no other args", () => blocked("find /"));
  test("blocks find on a drive root", () => blocked("find 'C:\\' -name x.ts"));
  test("blocks find on /mnt/c", () => blocked("find /mnt/c -iname x"));
  test("blocks find on the Git Bash root form", () => blocked("find /c -iname x"));
  test("blocks find on a WSL UNC distro root", () => blocked("find //wsl$/Ubuntu/ -iname x"));
  test("blocks find on bare ~", () => blocked("find ~ -name x"));
  test("blocks find on $HOME", () => blocked('find "$HOME" -name x'));
  test("blocks find on a home directory", () => blocked("find /home/newms -iname x"));
  test("blocks find on a Users home directory", () => blocked("find /Users/dan -iname x"));
  test("blocks find on a Windows home directory", () => blocked('find "C:\\Users\\newms" -iname x'));

  test("allows find on a specific deep project path", () => allowed("find /c/Users/newms/projects/platform -name '*.ts'"));
  test("allows find on the current directory", () => allowed("find . -name x"));
  test("allows find on a specific relative folder", () => allowed("find ./storage/logs -name '*.log'"));
  test("allows find on a specific subfolder of home", () => allowed("find ~/projects/platform -name x"));
  test("allows find on a specific subfolder via $HOME", () => allowed('find "$HOME/projects/platform" -name x'));
  test("allows find with no starting point at all", () => allowed("find -iname x"));
});

describe("grep -r / -R", () => {
  test("blocks grep -r on the root", () => blocked("grep -r 'TODO' /"));
  test("blocks grep -R on a home directory", () => blocked("grep -R 'TODO' /home/newms"));
  test("blocks bundled -rn on the root", () => blocked("grep -rn 'TODO' /"));
  test("blocks grep --recursive on a Windows home", () => blocked('grep --recursive "TODO" "C:\\Users\\newms"'));
  test("blocks grep -r with the pattern given via -e", () => blocked("grep -r -e 'TODO' /"));

  test("allows grep -r on a specific project folder", () => allowed("grep -rn 'rm -rf' src/"));
  test("allows grep -r with no path (defaults to cwd)", () => allowed("grep -r 'TODO'"));
  test("allows non-recursive grep on the root", () => allowed("grep 'TODO' /"));
});

describe("rg / ripgrep", () => {
  test("blocks a bare rg on the root", () => blocked("rg secret /"));
  test("blocks rg on a home directory", () => blocked("rg secret /home/newms"));
  test("blocks rg with the pattern given via -e", () => blocked("rg -e secret /"));
  test("blocks ripgrep on $HOME", () => blocked('ripgrep secret "$HOME"'));

  test("allows rg on a specific project folder", () => allowed("rg secret src/"));
  test("allows rg with no path (defaults to cwd)", () => allowed("rg secret"));
});

describe("ls -R", () => {
  test("blocks ls -R on the root", () => blocked("ls -R /"));
  test("blocks bundled -laR on a home directory", () => blocked("ls -laR /home/newms"));
  test("blocks ls --recursive on ~", () => blocked("ls --recursive ~"));

  test("allows ls -R on a specific project folder", () => allowed("ls -R ./dist"));
  test("allows plain ls (no -R) on the root", () => allowed("ls /"));
});

describe("du", () => {
  test("blocks du on the root", () => blocked("du -sh /"));
  test("blocks du on a home directory", () => blocked("du -sh /home/newms"));
  test("blocks bare du on $HOME", () => blocked('du "$HOME"'));

  test("allows du on a specific project folder", () => allowed("du -sh ./node_modules"));
  test("allows du with no operand (defaults to cwd)", () => allowed("du -sh"));
});

describe("cmd.exe dir /s", () => {
  test("blocks dir /s on a drive root", () => blocked("cmd /c dir /s C:\\", "PowerShell"));
  test("blocks dir /s on a home directory", () => blocked("cmd /c dir /s C:\\Users\\newms", "PowerShell"));
  test("allows dir /s on a specific deep folder", () => allowed("cmd /c dir /s C:\\Users\\newms\\projects\\platform", "PowerShell"));
  test("allows plain dir (no /s) on a drive root", () => allowed("cmd /c dir C:\\", "PowerShell"));
});

describe("PowerShell Get-ChildItem -Recurse", () => {
  test("blocks Get-ChildItem -Recurse on a drive root", () => blocked("Get-ChildItem -Recurse C:\\", "PowerShell"));
  test("blocks gci -Recurse on $env:USERPROFILE", () => blocked("gci -Recurse $env:USERPROFILE", "PowerShell"));
  test("blocks the dir alias with -Recurse on a drive root", () => blocked("dir -Recurse C:\\", "PowerShell"));
  test("blocks -Path form on a home directory", () => blocked("Get-ChildItem -Recurse -Path C:\\Users\\newms", "PowerShell"));

  test("allows Get-ChildItem -Recurse on a specific deep folder", () => {
    allowed("Get-ChildItem -Recurse C:\\Users\\newms\\projects\\platform\\ssap", "PowerShell");
  });
  test("allows Get-ChildItem without -Recurse on a drive root", () => allowed("Get-ChildItem C:\\", "PowerShell"));
});

describe("wrapped forms", () => {
  test("blocks find / inside bash -c", () => blocked('bash -c "find / -iname Tag.tsx"'));
  test("blocks find / inside wsl.exe (no explicit shell)", () => blocked("wsl.exe find / -iname Tag.tsx"));
  test("blocks find / inside wsl.exe -d Ubuntu -- bash -lc", () => {
    blocked('wsl.exe -d Ubuntu -- bash -lc "find / -iname Tag.tsx"');
  });
  test("blocks grep -r / behind sudo", () => blocked("sudo grep -r 'secret' /"));
  test("blocks find / behind env assignments", () => blocked("FOO=1 env BAR=2 find / -iname x"));
  test("blocks find / piped through xargs on the left of the pipe", () => {
    blocked("find / -iname '*.log' | xargs grep -l ERROR");
  });
  test("blocks a root grep target fed to the command behind xargs", () => {
    blocked("cat list.txt | xargs -I{} grep -r 'ERROR' /");
  });
  test("blocks find / inside docker exec", () => blocked("docker exec -w /app app bash -c 'find / -iname x'"));
});

describe("text that only looks like a scan is not a command", () => {
  test("heredoc bodies are data", () => allowed("cat > notes.md <<'EOF'\nnever run find / -iname x\nEOF\necho done"));
  test("comments are ignored", () => allowed("ls -la # find / -iname x"));
  test("quoted arguments to echo are ignored", () => allowed('echo "find / -iname x"'));
});

describe("unsafeScanRootReason protects roots, homes and their aliases", () => {
  const lit = (text, dynamic = false) => unsafeScanRootReason({ text, dynamic });
  const roots = [
    "/", "/home", "/home/newms", "/Users/dan", "/mnt", "/mnt/c", "/mnt/c/Users", "/c", "/c/Users/newms",
    "C:", "C:/", "C:\\", "C:\\Users", "C:\\Users\\newms", "~", "~/", "$HOME", "${HOME}", "$HOME/",
    "$env:USERPROFILE", "%USERPROFILE%", "//wsl$/Ubuntu/", "//wsl.localhost/Ubuntu/home/newms",
  ];
  for (const p of roots) test(`protects ${p}`, () => assert.ok(lit(p), `expected a reason for ${p}`));

  const safe = [
    "/tmp/x", "/home/newms/projects", "/mnt/c/Users/newms/projects", "/c/Users/newms/projects/platform",
    "C:\\Users\\newms\\projects\\platform", "node_modules", "./dist", "~/projects/platform", "$HOME/projects",
    "${HOME}/projects", "//wsl.localhost/Ubuntu/home/newms/scratch", ".",
  ];
  for (const p of safe) test(`allows ${p}`, () => assert.equal(lit(p), null, `expected no reason for ${p}`));
});

describe("hook process contract", () => {
  const run = (payload) => spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(payload), encoding: "utf8" });

  test("prints a PreToolUse deny decision naming the starting path for a blocked Bash command", () => {
    const r = run({ tool_name: "Bash", tool_input: { command: "find / -iname Tag.tsx" } });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /find/);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /14 concurrent/);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /13 CPU-hours/);
  });

  test("prints nothing and exits 0 for an allowed command", () => {
    const r = run({ tool_name: "Bash", tool_input: { command: "find ./src -name '*.ts'" } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("checks PowerShell tool input with PowerShell parsing", () => {
    const r = run({ tool_name: "PowerShell", tool_input: { command: "Get-ChildItem -Recurse C:\\" } });
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
  });
});
