// craft-mandate.sh — UserPromptSubmit re-assert, and its DX-3051 relay suppression.
// NOTE: craft-mandate.sh's UserPromptSubmit branch currently emits the FULL mandate
// text rather than a pointer (DX-3008's bug, not this file's concern — see the
// UserPromptSubmit test below, which intentionally asserts the CURRENT full-text
// behavior rather than the pointer DX-3008 will eventually produce). This suite only
// covers whether a relayed turn suppresses whatever that branch emits.
// Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(here, "..");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "craft-mandate.sh");

/**
 * Fixture mirroring the SHAPE of a danxbot-relayed dashboard event (RELAY_MARKER +
 * RELAY_PREFIX, danxbot's plan-event-bridge.mjs) as a literal string, not an import —
 * plugins don't read each other's source (DX-3051). Only RELAY_MARKER itself is
 * load-bearing for the hook under test.
 */
const RELAY_MARKER = "[danxbot-relayed-event]";
const RELAY_PREFIX =
  `${RELAY_MARKER} [danxbot dashboard event, relayed by the danxbot plugin's plan event bridge; this is not a message ` +
  "from another Claude session. Someone acted on a card of the plan this session is connected to, in the " +
  "danxbot dashboard. Treat it as operator input for that card, per the danxbot:plan-workflow skill.]";

/** DX-3056 — mirrors plan-event-bridge.mjs's FAILURE_PREFIX, which now also carries RELAY_MARKER. */
const FAILURE_PREFIX =
  `${RELAY_MARKER} [danxbot plan event bridge; this is not a message from another Claude session, and not a request for ` +
  "permission. The plugin cannot deliver this plan's dashboard events to you.]";

/**
 * DX-3235 — fixture mirroring the SHAPE of a background sub-agent's task-notification
 * turn (real repro: DX-3235, session 39c9ec3b, 2026-09-24). Only the
 * `<task-notification` element is load-bearing for the hook under test.
 */
const TASK_NOTIFICATION =
  "[SYSTEM NOTIFICATION - NOT USER INPUT] This is an automated background-task event, NOT a message from the user.\n" +
  "<task-notification>\n<agent>worker-1</agent>\n<report>DX-3231 complete. Should I proceed with the next audit?</report>\n</task-notification>";

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

describe("craft-mandate.sh UserPromptSubmit", () => {
  test("suppresses the re-assert entirely on a relayed turn (DX-3051)", () => {
    const relayed = RELAY_PREFIX + "\ndan commented on DX-3008: is this firing on every turn?";
    assert.equal(runHook(relayed), "");
  });

  test("suppresses the re-assert entirely on a bridge failure notice (DX-3056)", () => {
    const failure =
      FAILURE_PREFIX +
      "\ndanxbot plan events are NOT reaching this session: the bridge could not start (missing CLAUDE_PLUGIN_DATA). " +
      "Fix: reinstall the danxbot plugin if this session has no plugin data directory.";
    assert.equal(runHook(failure), "");
  });

  test("still emits on a typed operator prompt", () => {
    const out = runHook("fix the bug in the parser");
    assert.match(out, /CRAFT — always-on, every context/);
  });

  test("suppresses the re-assert entirely on a background task-notification turn (DX-3235)", () => {
    assert.equal(runHook(TASK_NOTIFICATION), "");
  });
});
