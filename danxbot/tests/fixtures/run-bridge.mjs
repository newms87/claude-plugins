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
import * as bridge from "../../scripts/plan-event-bridge.mjs";
import { spawnStandIn } from "./spawn-standin.mjs";

const config = JSON.parse(process.env.RUN_BRIDGE_FIXTURE_CONFIG ?? "{}");

const deps = {
  spawnSubcommand: () => {
    const child = spawnStandIn({ stdio: ["ignore", "pipe", "pipe"] });
    process.stdout.write(`fixture-child-pid=${child.pid}\n`);
    return child;
  },
};
if (typeof config.parentCheckMs === "number") deps.parentCheckMs = config.parentCheckMs;
if (typeof config.startKeyCheckMs === "number") deps.startKeyCheckMs = config.startKeyCheckMs;
if (typeof config.unreadableLimit === "number") deps.unreadableLimit = config.unreadableLimit;

// These four `readProcessStartKey` stand-ins are mutually exclusive — each exercises one
// DX-2894 review-round-1 scenario deterministically, without racing the real OS.
if (config.startupUnreadable) {
  // Every read — the startup read AND every periodic one — fails. Exercises the loud
  // startup refusal (never reaches the periodic checks at all).
  deps.readProcessStartKey = (pid, opts) => {
    opts?.onFailure?.(new Error("stub: simulated unreadable start key"));
    return Promise.resolve(null);
  };
} else if (Number.isInteger(config.reuseAfterCalls)) {
  // Simulates a pid reused by an unrelated process: the first `reuseAfterCalls` reads (the
  // startup read, plus however many periodic ticks land before the swap) answer with one
  // start key; every read after answers with a different one — deterministic, without
  // needing to race the real OS into actually recycling a pid inside a test's lifetime.
  let calls = 0;
  deps.readProcessStartKey = () => {
    calls += 1;
    return Promise.resolve(calls <= config.reuseAfterCalls ? "fixture-start-key-a" : "fixture-start-key-b");
  };
} else if (config.unreadableAfterStartup) {
  // The startup read succeeds (so the bridge actually arms its periodic checks); every read
  // after that fails — exercises the "N consecutive unreadable attempts" fatal path without
  // needing the parent to genuinely become unreadable that many times in a row for real.
  let calls = 0;
  deps.readProcessStartKey = (pid, opts) => {
    calls += 1;
    if (calls === 1) return Promise.resolve("fixture-start-key-ok");
    opts?.onFailure?.(new Error("stub: simulated unreadable start key"));
    return Promise.resolve(null);
  };
} else if (config.instrumentStartKey) {
  // Delegates to the REAL platform read (real CIM / `/proc` / `ps` against the real
  // CLAUDE_PID stand-in), but also announces every call on stdout so a test can prove at
  // least one periodic start-key verification actually happened, without needing its own
  // stub.
  deps.readProcessStartKey = async (pid, opts) => {
    const result = await bridge.readProcessStartKey(pid, opts);
    process.stdout.write(`fixture-start-key-check result=${result === null ? "null" : "ok"}\n`);
    return result;
  };
}

process.stdout.write(`fixture-ready pid=${process.pid}\n`);

bridge.run(config.sessionId, config.intent ?? "resume", process.env, deps).catch((err) => {
  process.stderr.write(`run-bridge fixture failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
