// DX-2894 fixture — drives the bridge's `run()` in its OWN process, since `run()` ends
// with `process.exit()` on every terminal path and calling it in-process would kill the
// test runner itself. Reads its configuration from RUN_BRIDGE_FIXTURE_CONFIG (JSON) and
// the rest of its environment (CLAUDE_PID, CLAUDE_PLUGIN_DATA, the inbox socket vars)
// exactly as a real hook-spawned bridge would.
//
// The bridge subcommand is always replaced with a real, never-exiting child process
// (never the actual `npx ... bridge` — that would need network access and would hide
// the CLAUDE_PID behavior this fixture exists to exercise) so a test can observe both
// "still running" and "the stub child is gone after shutdown" against real OS processes.
import { spawn } from "node:child_process";
import * as bridge from "../../scripts/plan-event-bridge.mjs";

function neverExitingChild() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9);"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

const config = JSON.parse(process.env.RUN_BRIDGE_FIXTURE_CONFIG ?? "{}");

const deps = {
  spawnSubcommand: () => {
    const child = neverExitingChild();
    process.stdout.write(`fixture-child-pid=${child.pid}\n`);
    return child;
  },
};
if (typeof config.parentCheckMs === "number") deps.parentCheckMs = config.parentCheckMs;

// Simulates a pid reused by an unrelated process: the first read (at bridge startup)
// answers with one start key, every read after (the periodic checks) answers with a
// different one — deterministic, without needing to race the real OS into actually
// recycling a pid inside a test's lifetime.
if (Number.isInteger(config.reuseAfterCalls)) {
  let calls = 0;
  deps.readProcessStartKey = () => {
    calls += 1;
    return calls <= config.reuseAfterCalls ? "fixture-start-key-a" : "fixture-start-key-b";
  };
}

process.stdout.write(`fixture-ready pid=${process.pid}\n`);

bridge.run(config.sessionId, config.intent ?? "resume", process.env, deps).catch((err) => {
  process.stderr.write(`run-bridge fixture failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
