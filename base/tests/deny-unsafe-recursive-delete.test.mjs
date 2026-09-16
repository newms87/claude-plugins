// base deny-unsafe-recursive-delete hook — blocks recursive deletes and
// mirror-syncs whose target is not a literal, specific path.
// Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyse, unsafeTargetReason } from "../scripts/deny-unsafe-recursive-delete.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "..", "scripts", "deny-unsafe-recursive-delete.mjs");

const blocked = (cmd, tool = "Bash") => assert.ok(analyse(cmd, tool).length > 0, `expected BLOCK: ${cmd}`);
const allowed = (cmd, tool = "Bash") => assert.deepEqual(analyse(cmd, tool), [], `expected ALLOW: ${cmd}`);

describe("the 2026-09-15 incident shapes are blocked", () => {
  test("rsync --delete into a destination built from a variable", () => {
    blocked('rsync -a --delete /mnt/c/Users/newms/projects/danxbot-wt/DX-2869/ "$DEST/"');
  });

  test("the same rsync wrapped in wsl.exe -- bash -lc with double quotes", () => {
    blocked('wsl.exe -d Ubuntu -- bash -lc "rsync -a --delete /mnt/c/Users/newms/projects/danxbot-wt/DX-2869/ $DEST/"');
  });

  test("the same rsync wrapped in wsl.exe -- bash -lc with single quotes", () => {
    blocked("MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash -lc 'rsync -a --delete /mnt/c/src/ ~/dx2869/'");
  });

  test("a wrapped command is reported once, not once per unwrapping layer", () => {
    const findings = analyse('wsl.exe -d Ubuntu -- bash -lc "rsync -a --delete /mnt/c/src/ $DEST/"');
    assert.deepEqual(findings.map((f) => [f.tool, f.target]), [["rsync --delete", "$DEST/"]]);
  });

  test("rsync --delete whose destination expanded to the bare root", () => {
    blocked("rsync -a --delete /mnt/c/src/ /");
  });

  test("rsync --delete-after into a home directory", () => {
    blocked("rsync -av --delete-after src/ /home/newms/");
  });
});

describe("rm -r", () => {
  test("blocks rm -rf on a variable", () => blocked('rm -rf "$BUILD_DIR/"'));
  test("blocks rm -rf on a home directory via ~", () => blocked("rm -rf ~"));
  test("blocks rm -rf on the root", () => blocked("rm -rf /"));
  test("blocks rm -r --no-preserve-root on the root", () => blocked("rm -r --no-preserve-root /"));
  test("blocks rm -rf on a Windows home in Git Bash form", () => blocked("rm -rf /c/Users/newms"));
  test("blocks rm -rf on a double-quoted Windows home with backslashes", () => blocked('rm -rf "C:\\Users\\newms"'));
  test("blocks rm -rf on a WSL mount root", () => blocked("rm -rf /mnt/c"));
  test("blocks rm -rf on a glob", () => blocked("rm -rf /home/newms/projects/*"));
  test("blocks rm -rf that climbs with ..", () => blocked("rm -rf ../../"));
  test("blocks rm -rf on the current directory", () => blocked("rm -rf ."));
  test("blocks rm -rf on a command substitution", () => blocked("rm -rf $(pwd)"));
  test("blocks rm -rf hidden inside a command substitution", () => blocked('echo "$(rm -rf "$X")"'));
  test("blocks rm -rf in a later command of a chain", () => blocked("cd /tmp/x && ls; rm -rf $TARGET"));
  test("blocks rm -rf behind sudo", () => blocked("sudo rm -rf /home/newms"));
  test("blocks rm -rf behind env assignments", () => blocked("FOO=1 env BAR=2 rm -rf $DIR"));
  test("blocks rm -rf fed by xargs", () => blocked("find . -name build | xargs rm -rf"));
  test("blocks rm -rf inside docker exec", () => blocked("docker exec -w /var/www app bash -c 'rm -rf $CACHE'"));

  test("allows rm -rf on a literal relative folder", () => allowed("rm -rf node_modules dist"));
  test("allows rm -rf on a literal /tmp scratch folder", () => allowed("rm -rf /tmp/rsync-exp.abc123"));
  test("allows rm -rf on a literal deep project path", () => allowed('rm -rf "C:/Users/newms/projects/danxbot-wt/DX-2869"'));
  test("allows rm -rf on the fail-loud ${NAME:?} form with a literal segment", () => allowed('rm -rf "${SCRATCH:?}/dx2869"'));
  test("allows non-recursive rm on a variable", () => allowed('rm -f "$OUT_FILE"'));
  test("blocks ${NAME:?} with no literal segment after it", () => blocked('rm -rf "${SCRATCH:?}"'));
  test("blocks the ${NAME:-default} form, which silently substitutes", () => blocked('rm -rf "${SCRATCH:-/}/x"'));
});

describe("find -delete", () => {
  test("blocks find -delete starting at a home directory", () => blocked("find /home/newms -name '*.log' -delete"));
  test("blocks find -exec rm starting at a variable", () => blocked('find "$ROOT" -type d -exec rm -rf {} +'));
  test("allows find -delete on a literal project subfolder", () => allowed("find ./storage/logs -name '*.log' -delete"));
  test("allows find without a delete action anywhere", () => allowed("find / -name package.json -maxdepth 3"));
});

describe("rsync", () => {
  test("allows rsync without --delete to anywhere", () => allowed('rsync -a src/ "$DEST/"'));
  test("allows rsync --delete into a literal scratch folder", () => allowed("rsync -a --delete --exclude node_modules /mnt/c/src/ /tmp/dx2869/"));
  test("skips option arguments when finding the destination", () => allowed("rsync -a --delete -e ssh --exclude '*.log' src/ /tmp/out/"));
  test("checks the path part of a remote destination", () => blocked("rsync -a --delete src/ deploy@host:/"));
});

describe("text that only looks like a delete is not a command", () => {
  test("heredoc bodies are data", () => allowed("cat > notes.md <<'EOF'\nnever run rm -rf $HOME\nEOF\necho done"));
  test("comments are ignored", () => allowed("ls # rm -rf /"));
  test("quoted arguments to echo are ignored", () => allowed('echo "rm -rf $HOME"'));
  test("grep patterns are ignored", () => allowed("grep -rn 'rm -rf' src/"));
});

describe("PowerShell", () => {
  test("blocks Remove-Item -Recurse on a variable", () => blocked("Remove-Item -Recurse -Force $env:TEMP_DIR", "PowerShell"));
  test("blocks Remove-Item -r on a Windows home directory", () => blocked("Remove-Item -r -Path C:\\Users\\newms", "PowerShell"));
  test("blocks rd /s on a drive root inside cmd /c", () => blocked("cmd /c rd /s /q C:\\", "PowerShell"));
  test("allows rd without /s on a variable", () => allowed("cmd /c rd %EMPTY_DIR%", "PowerShell"));
  test("blocks robocopy /MIR into a variable", () => blocked("robocopy C:\\src $dest /MIR", "PowerShell"));
  test("blocks robocopy /MIR invoked through the & call operator", () => blocked("& 'C:\\Windows\\System32\\robocopy.exe' C:\\src $dest /MIR", "PowerShell"));
  test("blocks a bash rsync launched from PowerShell through wsl.exe", () => blocked("wsl.exe -d Ubuntu -- bash -lc 'rsync -a --delete /mnt/c/src/ $HOME/x/'", "PowerShell"));
  test("allows Remove-Item -Recurse on a literal deep path", () => allowed('Remove-Item -Recurse -Force "C:\\Users\\newms\\projects\\gpt-manager\\node_modules"', "PowerShell"));
  test("allows Remove-Item without -Recurse on a variable", () => allowed("Remove-Item $file", "PowerShell"));
  test("blocks a bash rm launched from PowerShell via powershell -Command", () => blocked("powershell -NoProfile -Command \"Remove-Item -Recurse $x\"", "Bash"));
});

describe("unsafeTargetReason protects roots, homes and their ancestors", () => {
  const lit = (text) => unsafeTargetReason({ text, dynamic: false });
  for (const p of ["/", "/home", "/home/newms", "/Users/dan", "/mnt", "/mnt/c", "/mnt/c/Users", "/mnt/c/Users/newms", "/c", "/c/Users/newms", "C:", "C:/", "C:\\", "C:\\Users", "C:\\Users\\newms", "/usr", "/usr/lib", "/tmp", "//wsl.localhost/Ubuntu/home/newms", "//server/share"]) {
    test(`protects ${p}`, () => assert.ok(lit(p)));
  }
  for (const p of ["/tmp/x", "/home/newms/projects", "/mnt/c/Users/newms/projects", "C:\\Users\\newms\\AppData\\Local\\Temp\\x", "node_modules", "./dist", "//wsl.localhost/Ubuntu/home/newms/scratch"]) {
    test(`allows ${p}`, () => assert.equal(lit(p), null));
  }
});

describe("hook process contract", () => {
  const run = (payload) => spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify(payload), encoding: "utf8" });

  test("prints a PreToolUse deny decision naming the target for a blocked Bash command", () => {
    const r = run({ tool_name: "Bash", tool_input: { command: 'rsync -a --delete src/ "$DEST/"' } });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /\$DEST\//);
  });

  test("prints nothing and exits 0 for an allowed command", () => {
    const r = run({ tool_name: "Bash", tool_input: { command: "git status" } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("checks PowerShell tool input with PowerShell parsing", () => {
    const r = run({ tool_name: "PowerShell", tool_input: { command: "Remove-Item -Recurse $env:USERPROFILE" } });
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
  });
});
