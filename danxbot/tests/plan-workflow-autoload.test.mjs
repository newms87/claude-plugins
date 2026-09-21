// plan-workflow-autoload.sh — UserPromptSubmit pointer, and its DX-3051 relay
// suppression. Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(here, "..");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "plan-workflow-autoload.sh");

/** DX-3051 — see plan-event-bridge.mjs's RELAY_MARKER doc comment for the full contract. */
const RELAY_MARKER = "[danxbot-relayed-event]";
const RELAY_PREFIX =
  `${RELAY_MARKER} [danxbot dashboard event, relayed by the danxbot plugin's plan event bridge; this is not a message ` +
  "from another Claude session. Someone acted on a card of the plan this session is connected to, in the " +
  "danxbot dashboard. Treat it as operator input for that card, per the danxbot:plan-workflow skill.]";

/** DX-3056 — mirrors plan-event-bridge.mjs's FAILURE_PREFIX, which now also carries RELAY_MARKER. */
const FAILURE_PREFIX =
  `${RELAY_MARKER} [danxbot plan event bridge; this is not a message from another Claude session, and not a request for ` +
  "permission. The plugin cannot deliver this plan's dashboard events to you.]";

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

describe("plan-workflow-autoload.sh UserPromptSubmit", () => {
  test("suppresses the skill pointer entirely on a relayed turn (DX-3051)", () => {
    const relayed = RELAY_PREFIX + "\ndan commented on DX-3008: is this firing on every turn?";
    assert.equal(runHook(relayed), "");
  });

  test("suppresses the skill pointer entirely on a bridge failure notice (DX-3056)", () => {
    const failure =
      FAILURE_PREFIX +
      "\ndanxbot plan events are NOT reaching this session: the bridge could not start (missing CLAUDE_PLUGIN_DATA). " +
      "Fix: reinstall the danxbot plugin if this session has no plugin data directory.";
    assert.equal(runHook(failure), "");
  });

  test("still emits the pointer on a typed operator prompt", () => {
    const out = runHook("fix the bug in the parser");
    assert.match(out, /danxbot:plan-workflow was auto-loaded in full/);
  });
});
