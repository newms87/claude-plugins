// plan-connect-mantra.mjs — PostToolUse(plan_connect) — DX-3275.
// Surfaces the full mantra the instant plan_connect succeeds, via the
// PostToolUse JSON envelope (hookSpecificOutput.additionalContext — plain
// stdout is not shown for this event, see plan-note-reminder.mjs's prior
// art and DX-3347 comment 6999's docs citation). Detection is the same
// connection-record check mantra.sh and plan-workflow-autoload.sh use.
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
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "plan-connect-mantra.mjs");
const MANTRA_FILE = path.join(PLUGIN_ROOT, "mantra.md");

let home;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "plan-connect-mantra-test-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function connect(sessionId) {
  const dir = path.join(home, ".config", "danxbot", "plan-sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${sessionId}.json`), JSON.stringify({ schemaVersion: 1 }));
}

function run(payload) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, DANXBOT_PLAN_SESSIONS_HOME: home },
  });
}

describe("plan-connect-mantra.mjs", () => {
  test("connect succeeded (record exists): emits the mantra via additionalContext", () => {
    connect("sess-ok");
    const r = run({ session_id: "sess-ok", tool_name: "mcp__danx-dashboard__plan_connect", tool_input: {} });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
    const mantra = readFileSync(MANTRA_FILE, "utf8");
    assert.ok(out.hookSpecificOutput.additionalContext.includes(mantra));
  });

  test("connect failed (no record): silent, no stdout at all", () => {
    const r = run({ session_id: "sess-failed", tool_name: "mcp__danx-dashboard__plan_connect", tool_input: {} });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
  });

  test("underscore MCP prefix variant is handled identically to the hyphen one", () => {
    connect("sess-underscore");
    const r = run({ session_id: "sess-underscore", tool_name: "mcp__danx_dashboard__plan_connect", tool_input: {} });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    // DX-3351: length threshold tracks the live mantra.md size (brevity pass shrank it
    // from ~4235 to ~2.5KB) rather than a hardcoded magic number that goes stale on edit.
    const mantraLen = readFileSync(MANTRA_FILE, "utf8").length;
    assert.ok(out.hookSpecificOutput.additionalContext.length > mantraLen);
  });

  test("never crashes on malformed or empty stdin", () => {
    const r1 = spawnSync(process.execPath, [SCRIPT], {
      input: "{not valid json",
      encoding: "utf8",
      env: { ...process.env, DANXBOT_PLAN_SESSIONS_HOME: home },
    });
    assert.equal(r1.status, 0);
    assert.equal(r1.stdout, "");

    const r2 = spawnSync(process.execPath, [SCRIPT], {
      input: "",
      encoding: "utf8",
      env: { ...process.env, DANXBOT_PLAN_SESSIONS_HOME: home },
    });
    assert.equal(r2.status, 0);
    assert.equal(r2.stdout, "");
  });
});
