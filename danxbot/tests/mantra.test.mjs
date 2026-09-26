// mantra.sh — danxbot plugin. DX-3347.
// Prints danxbot/mantra.md verbatim on SessionStart; no-ops on anything else
// (this hook is wired only to matcher "startup|resume|compact", but the
// script itself also refuses any non-SessionStart event name defensively).
// Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(here, "..");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "mantra.sh");
const MANTRA_FILE = path.join(PLUGIN_ROOT, "mantra.md");

function runHook(event) {
  return spawnSync("bash", [SCRIPT, event], {
    input: JSON.stringify({ session_id: "test-session" }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });
}

describe("mantra.sh", () => {
  test("SessionStart prints mantra.md verbatim", () => {
    const result = runHook("SessionStart");
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

  test("any non-SessionStart event is a silent no-op", () => {
    const result = runHook("UserPromptSubmit");
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  });
});
