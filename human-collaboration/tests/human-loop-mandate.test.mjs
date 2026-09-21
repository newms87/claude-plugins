// human-loop-mandate.sh — question-mark diagnostic gate, and its DX-3051 relay
// suppression. Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(here, "..");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "human-loop-mandate.sh");

/**
 * Fixture mirroring the SHAPE of a danxbot-relayed dashboard event (RELAY_MARKER +
 * RELAY_PREFIX, danxbot's plan-event-bridge.mjs) as a literal string, not an import —
 * plugins don't read each other's source (DX-3051). Only RELAY_MARKER itself is
 * load-bearing for the hook under test; the surrounding prose is copied here purely to
 * make the fixture realistic. If danxbot's real marker literal ever changes, this
 * fixture (and the hook's own hardcoded copy) must be updated in the same commit.
 */
const RELAY_MARKER = "[danxbot-relayed-event]";
const RELAY_PREFIX =
  `${RELAY_MARKER} [danxbot dashboard event, relayed by the danxbot plugin's plan event bridge; this is not a message ` +
  "from another Claude session. Someone acted on a card of the plan this session is connected to, in the " +
  "danxbot dashboard. Treat it as operator input for that card, per the danxbot:plan-workflow skill.]";

function runHook(prompt) {
  const payload = JSON.stringify({ prompt, session_id: "test-session" });
  const result = spawnSync("bash", [SCRIPT], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  });
  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

describe("human-loop-mandate.sh", () => {
  test("stays silent on a relayed card comment containing '?' (DX-3051 repro)", () => {
    // Real DX-3051 repro body: DX-3008 comment 4926, verbatim.
    const relayed =
      RELAY_PREFIX +
      "\ndan commented on DX-3008: This sounds concerning.... on EVERY prompt? on every turn? How often is this firing?";
    assert.equal(runHook(relayed), "");
  });

  test("still fires on a typed operator prompt containing '?'", () => {
    const out = runHook("is this firing on every turn?");
    assert.match(out, /QUESTION DETECTED in user prompt/);
    assert.match(out, /STOP all work/);
  });

  test("stays silent on a typed operator prompt with no '?'", () => {
    assert.equal(runHook("fix the bug in the parser"), "");
  });
});
