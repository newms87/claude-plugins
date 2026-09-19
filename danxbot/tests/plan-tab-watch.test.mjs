// danxbot plan-tab-watch hook — PostToolUse(plan_connect) `capture` +
// UserPromptSubmit `check`. DX-2995. Run with `npm test` (node --test).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNudge, isValidSessionId } from "../scripts/plan-tab-watch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "..", "scripts", "plan-tab-watch.mjs");

let home;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "plan-tab-watch-test-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function run(mode, payload) {
  return spawnSync(process.execPath, [SCRIPT, mode], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, DANXBOT_PLAN_TAB_WATCH_HOME: home },
  });
}

function writeConnection(sessionId, dashboardUrl = "https://danxbot.sageus.ai") {
  const dir = path.join(home, ".config", "danxbot", "plan-sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${sessionId}.json`), JSON.stringify({ dashboardUrl }));
}

describe("isValidSessionId", () => {
  test("accepts a real session id shape", () => {
    assert.equal(isValidSessionId("eae1b219-a47a-471b-9081-563a31c5476f"), true);
  });
  test("rejects path traversal / non-string / missing", () => {
    assert.equal(isValidSessionId("../../etc/passwd"), false);
    assert.equal(isValidSessionId(""), false);
    assert.equal(isValidSessionId(undefined), false);
    assert.equal(isValidSessionId(42), false);
  });
});

describe("buildNudge", () => {
  test("names the exact plan URL and both open tools, never asks the operator", () => {
    const text = buildNudge("https://danxbot.sageus.ai/plans/2");
    assert.match(text, /tabs_context/);
    assert.match(text, /https:\/\/danxbot\.sageus\.ai\/plans\/2/);
    assert.match(text, /navigate/);
    assert.match(text, /preview_start/);
    assert.doesNotMatch(text, /ask the operator first$/m);
    assert.match(text, /Never ask the operator first/);
  });
});

describe("capture — caches the plan id from the plan_connect call", () => {
  test("valid plan_connect call writes state; a later check then fires", () => {
    const sessionId = "sess-capture-1";
    const c = run("capture", {
      session_id: sessionId,
      tool_name: "mcp__danx-dashboard__plan_connect",
      tool_input: { plan_id: 2, title: "test session" },
    });
    assert.equal(c.status, 0);

    writeConnection(sessionId);
    const chk = run("check", { session_id: sessionId });
    assert.equal(chk.status, 0);
    const out = JSON.parse(chk.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /\/plans\/2/);
  });

  test("missing plan_id in tool_input never crashes and writes nothing usable", () => {
    const sessionId = "sess-capture-2";
    const c = run("capture", { session_id: sessionId, tool_input: {} });
    assert.equal(c.status, 0);
    writeConnection(sessionId);
    const chk = run("check", { session_id: sessionId });
    assert.equal(chk.status, 0);
    assert.equal(chk.stdout, "");
  });

  test("invalid session id is refused, not path-joined", () => {
    const c = run("capture", {
      session_id: "../../evil",
      tool_input: { plan_id: 1 },
    });
    assert.equal(c.status, 0);
    assert.equal(c.stdout, "");
  });
});

describe("check — silent by default, fires once, then suppresses", () => {
  test("silent: not connected at all (no session-connection record)", () => {
    const sessionId = "sess-check-1";
    run("capture", { session_id: sessionId, tool_input: { plan_id: 3 } });
    // No writeConnection() call — session-connection record absent.
    const chk = run("check", { session_id: sessionId });
    assert.equal(chk.status, 0);
    assert.equal(chk.stdout, "");
  });

  test("silent: connected, but capture never ran this session (no plan id known)", () => {
    const sessionId = "sess-check-2";
    writeConnection(sessionId);
    const chk = run("check", { session_id: sessionId });
    assert.equal(chk.status, 0);
    assert.equal(chk.stdout, "");
  });

  test("fires exactly once, then silent on an immediate second check (suppression window)", () => {
    const sessionId = "sess-check-3";
    writeConnection(sessionId);
    run("capture", { session_id: sessionId, tool_input: { plan_id: 9 } });

    const first = run("check", { session_id: sessionId });
    assert.equal(first.status, 0);
    assert.match(JSON.parse(first.stdout).hookSpecificOutput.additionalContext, /\/plans\/9/);

    const second = run("check", { session_id: sessionId });
    assert.equal(second.status, 0);
    assert.equal(second.stdout, "", "second check within the suppression window must stay silent");
  });

  test("never exits non-zero and never blocks on malformed JSON input", () => {
    const r = run("check", "{not valid json");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("never exits non-zero on empty stdin", () => {
    const r = run("check", "");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("unknown mode arg is silent, not an error", () => {
    const r = run("bogus-mode", { session_id: "sess-x" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});
