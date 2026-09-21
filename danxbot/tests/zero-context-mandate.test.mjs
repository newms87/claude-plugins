// zero-context-mandate.sh — UserPromptSubmit pointer, and its DX-3051 relay suppression.
// Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(here, "..");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "zero-context-mandate.sh");

/** DX-3051 — see plan-event-bridge.mjs's RELAY_MARKER doc comment for the full contract. */
const RELAY_MARKER = "[danxbot-relayed-event]";
const RELAY_PREFIX =
  `${RELAY_MARKER} [danxbot dashboard event, relayed by the danxbot plugin's plan event bridge; this is not a message ` +
  "from another Claude session. Someone acted on a card of the plan this session is connected to, in the " +
  "danxbot dashboard. Treat it as operator input for that card, per the danxbot:plan-workflow skill.]";

function runHook(prompt) {
  const payload = JSON.stringify({ prompt, session_id: "test-session" });
  const result = spawnSync("bash", [SCRIPT, "UserPromptSubmit"], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });
  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

describe("zero-context-mandate.sh UserPromptSubmit", () => {
  test("suppresses the mantra pointer entirely on a relayed turn (DX-3051)", () => {
    const relayed = RELAY_PREFIX + "\ndan commented on DX-3008: is this firing on every turn?";
    assert.equal(runHook(relayed), "");
  });

  test("still emits the pointer on a typed operator prompt", () => {
    const out = runHook("fix the bug in the parser");
    assert.match(out, /DANXBOT MANTRA still in force/);
  });
});
