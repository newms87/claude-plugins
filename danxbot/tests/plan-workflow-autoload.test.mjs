// plan-workflow-autoload.sh — SessionStart full-body injection.
// DX-3347 deleted this script's UserPromptSubmit branch (a per-turn pointer,
// 421 bytes/message, measured DX-3278 comment 6976) along with its shared
// suppression helper (lib/prompt-guard.sh) — R-12 restricted every per-message
// reminder to the mantra.
// DX-3275 / PLN-11 R-10: this hook now stays SILENT on every SessionStart
// source until the session's plan connection record exists — the nudge is
// owned entirely by mantra.sh, so this hook adds nothing before connection.
// Run with `npm test` (node --test, no dependencies).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(here, "..");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "plan-workflow-autoload.sh");

let home;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "plan-workflow-autoload-test-"));
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
  const result = spawnSync("bash", [SCRIPT, event], {
    input: JSON.stringify({ session_id: sessionId }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, DANXBOT_PLAN_SESSIONS_HOME: home },
  });
  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

describe("plan-workflow-autoload.sh", () => {
  test("not connected: SessionStart is a silent no-op", () => {
    assert.equal(runHook("SessionStart", "not-connected-session"), "");
  });

  test("connected: SessionStart injects the full skill body", () => {
    connect("connected-session");
    const out = runHook("SessionStart", "connected-session");
    assert.match(out, /danxbot:plan-workflow AUTO-LOAD ATTEMPTED/);
    assert.ok(out.length > 2000, `expected the full skill body, got ${out.length} bytes`);
  });

  test("UserPromptSubmit is a silent no-op (DX-3347 — per-turn pointer deleted), connected or not", () => {
    connect("test-session");
    assert.equal(runHook("UserPromptSubmit"), "");
  });
});
