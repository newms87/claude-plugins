// base lib/shell-commands — the shared view of every command a tool call runs.
// Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { commandName, simpleCommands } from "../scripts/lib/shell-commands.mjs";

const names = (command, tool) => simpleCommands(command, tool).map((c) => c.argv.map((w) => w.text).join(" "));

describe("simpleCommands", () => {
  test("splits a chain into its commands", () => {
    assert.deepEqual(names("cd /tmp && ls -la; echo done | tee x"), ["cd /tmp", "ls -la", "echo done", "tee x"]);
  });

  test("reports a wrapper and the command it runs", () => {
    assert.deepEqual(names("sudo -u root env A=1 timeout 5 rm -r x"), [
      "sudo -u root env A=1 timeout 5 rm -r x",
      "env A=1 timeout 5 rm -r x",
      "timeout 5 rm -r x",
      "rm -r x",
    ]);
  });

  test("unwraps bash -c, wsl.exe and docker exec into their inner commands", () => {
    const got = names("wsl.exe -d Ubuntu -- bash -lc 'docker exec -w /app web bash -c \"make test\"'");
    assert.deepEqual(got, [
      "wsl.exe -d Ubuntu -- bash -lc docker exec -w /app web bash -c \"make test\"",
      "bash -lc docker exec -w /app web bash -c \"make test\"",
      "docker exec -w /app web bash -c make test",
      "bash -c make test",
      "make test",
    ]);
  });

  test("marks the command behind xargs as taking its operands from stdin", () => {
    const [, inner] = simpleCommands("find . -name x | xargs -0 rm -rf").slice(1);
    assert.equal(inner.argv[0].text, "rm");
    assert.equal(inner.stdinTargets, true);
  });

  test("checks the inside of a command substitution", () => {
    assert.ok(names('echo "$(rm -rf "$X")"').includes("rm -rf $X"));
  });

  test("treats heredoc bodies as data", () => {
    assert.deepEqual(names("cat > f <<'EOF'\nrm -rf /\nEOF\nls"), ["cat > f", "ls"]);
  });

  test("marks variables, substitutions, globs and ~ as dynamic, and plain words as literal", () => {
    const [cmd] = simpleCommands('ls "$A" $(pwd) *.txt ~/x plain \'$lit\'');
    assert.deepEqual(cmd.argv.slice(1).map((w) => w.dynamic), [true, true, true, true, false, false]);
  });

  test("parses PowerShell and strips the & call operator", () => {
    assert.deepEqual(names("& 'C:\\Tools\\x.exe' -a; Remove-Item -Recurse $p", "PowerShell"), ["C:\\Tools\\x.exe -a", "Remove-Item -Recurse $p"]);
  });

  test("unwraps powershell -Command and cmd /c", () => {
    const got = names('powershell -NoProfile -Command "cmd /c rd /s /q C:\\x"');
    assert.ok(got.includes("rd /s /q C:\\x"), JSON.stringify(got));
  });
});

describe("commandName", () => {
  test("normalizes paths, case and .exe", () => {
    assert.equal(commandName({ text: "C:\\Windows\\System32\\WSL.EXE" }), "wsl");
    assert.equal(commandName({ text: "/usr/bin/rsync" }), "rsync");
  });
});
