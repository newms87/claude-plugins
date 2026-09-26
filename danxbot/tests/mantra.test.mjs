// mantra.sh — danxbot plugin. DX-3347, gated DX-3275.
// Not connected to a plan: prints only the short plan-workflow nudge.
// Connected (session connection record present): prints danxbot/mantra.md
// verbatim. No-ops on anything else (this hook is wired only to matcher
// "startup|resume|compact", but the script itself also refuses any
// non-SessionStart event name defensively).
// Run with `npm test` (node --test, no dependencies).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(here, "..");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "mantra.sh");
const MANTRA_FILE = path.join(PLUGIN_ROOT, "mantra.md");

let home;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "mantra-test-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function connect(sessionId) {
  const dir = path.join(home, ".config", "danxbot", "plan-sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${sessionId}.json`), JSON.stringify({ schemaVersion: 1 }));
}

function runHook(event, sessionId = "test-session") {
  return spawnSync("bash", [SCRIPT, event], {
    input: JSON.stringify({ session_id: sessionId }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, DANXBOT_PLAN_SESSIONS_HOME: home },
  });
}

describe("mantra.sh", () => {
  test("not connected: prints only the plan-workflow nudge, not the mantra", () => {
    const result = runHook("SessionStart", "not-connected-session");
    assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /danxbot:plan-workflow/);
    assert.match(result.stdout, /ASK the operator/);
    assert.doesNotMatch(result.stdout, /Operating contract/i);
    // ~0.5 KB target (AC 35058) — a hard byte ceiling would be brittle, so this
    // asserts the class of size rather than an exact count.
    assert.ok(
      Buffer.byteLength(result.stdout) < 700,
      `nudge is ${Buffer.byteLength(result.stdout)} bytes, expected well under 700`,
    );
  });

  test("connected: prints mantra.md verbatim", () => {
    connect("connected-session");
    const result = runHook("SessionStart", "connected-session");
    assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
    const expected = readFileSync(MANTRA_FILE, "utf8");
    assert.equal(result.stdout, expected);
  });

  test("mantra.md merges the operating contract, craft and danxbot mantra, and names all three", () => {
    const text = readFileSync(MANTRA_FILE, "utf8");
    assert.match(text, /Operating contract/i);
    assert.match(text, /Craft/i);
    assert.match(text, /zero-context/i);
    assert.match(text, /session start, resume and compaction only/i);
  });

  test("any non-SessionStart event is a silent no-op, connected or not", () => {
    connect("test-session");
    const result = runHook("UserPromptSubmit");
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });
});
