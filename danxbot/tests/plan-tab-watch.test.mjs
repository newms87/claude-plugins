// danxbot plan-tab-watch hook — PostToolUse(plan_connect) `capture` only.
// DX-2995, trimmed DX-3347: the `check` mode (a once-per-turn UserPromptSubmit
// poll, 282 bytes/message whenever it fired) is deleted — R-12 restricted
// every per-message reminder to the mantra. Run with `npm test` (node --test).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSessionId } from "../scripts/plan-tab-watch.mjs";

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

function watchStateFile(sessionId) {
  return path.join(home, ".config", "danxbot", "plan-tab-watch", `${sessionId}.json`);
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

describe("capture — caches the plan id from the plan_connect call", () => {
  test("valid plan_connect call writes state", () => {
    const sessionId = "sess-capture-1";
    const c = run("capture", {
      session_id: sessionId,
      tool_name: "mcp__danx-dashboard__plan_connect",
      tool_input: { plan_id: 2, title: "test session" },
    });
    assert.equal(c.status, 0);
    assert.equal(c.stdout, "");
    const state = JSON.parse(readFileSync(watchStateFile(sessionId), "utf8"));
    assert.equal(state.planId, 2);
  });

  test("missing plan_id in tool_input never crashes and writes nothing", () => {
    const sessionId = "sess-capture-2";
    const c = run("capture", { session_id: sessionId, tool_input: {} });
    assert.equal(c.status, 0);
    assert.throws(() => readFileSync(watchStateFile(sessionId), "utf8"));
  });

  test("invalid session id is refused, not path-joined", () => {
    const c = run("capture", {
      session_id: "../../evil",
      tool_input: { plan_id: 1 },
    });
    assert.equal(c.status, 0);
    assert.equal(c.stdout, "");
  });

  test("never exits non-zero and never blocks on malformed JSON input", () => {
    const r = run("capture", "{not valid json");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("never exits non-zero on empty stdin", () => {
    const r = run("capture", "");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});

describe("removed mode", () => {
  test("`check` (DX-3347: deleted) and any other unknown mode arg are silent, not an error", () => {
    const r = run("check", { session_id: "sess-x" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");

    const r2 = run("bogus-mode", { session_id: "sess-x" });
    assert.equal(r2.status, 0);
    assert.equal(r2.stdout, "");
  });
});
