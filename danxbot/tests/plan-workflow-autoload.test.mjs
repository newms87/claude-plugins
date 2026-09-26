// plan-workflow-autoload.sh — SessionStart full-body injection.
// DX-3347 deleted this script's UserPromptSubmit branch (a per-turn pointer,
// 421 bytes/message, measured DX-3278 comment 6976) along with its shared
// suppression helper (lib/prompt-guard.sh) — R-12 restricted every per-message
// reminder to the mantra. This suite now covers only what remains: the
// SessionStart injection, and that any other event argv is a silent no-op.
// Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(here, "..");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "plan-workflow-autoload.sh");

function runHook(event, payload = { session_id: "test-session" }) {
  const result = spawnSync("bash", [SCRIPT, event], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });
  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

describe("plan-workflow-autoload.sh", () => {
  test("SessionStart injects the full skill body", () => {
    const out = runHook("SessionStart");
    assert.match(out, /danxbot:plan-workflow AUTO-LOAD ATTEMPTED/);
    assert.ok(out.length > 2000, `expected the full skill body, got ${out.length} bytes`);
  });

  test("UserPromptSubmit is now a silent no-op (DX-3347 — per-turn pointer deleted)", () => {
    assert.equal(runHook("UserPromptSubmit"), "");
  });
});
