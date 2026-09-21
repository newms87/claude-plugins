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
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as bridge from "../../scripts/plan-event-bridge.mjs";
import { spawnStandIn } from "./spawn-standin.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(process.env.RUN_BRIDGE_FIXTURE_CONFIG ?? "{}");

const deps = {
  // DX-2953 — `config.scriptedRecords`, when present, spawns
  // `scripted-subcommand.mjs` instead of the plain never-emitting stand-in, so
  // a test can drive the REAL onReady/onStopped/onEvent wiring in `run()`
  // (the DX-2953 marker writes) through a real child process's real stdout,
  // not a stub. `config.scriptedExitCode` (optional) makes it exit after
  // emitting every record; omitted, it stays alive like the plain stand-in.
  spawnSubcommand: Array.isArray(config.scriptedRecords)
    ? () => {
        const child = spawn(process.execPath, [path.join(here, "scripted-subcommand.mjs")], {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env: { ...process.env, SCRIPTED_SUBCOMMAND_CONFIG: JSON.stringify({ records: config.scriptedRecords, exitCode: config.scriptedExitCode }) },
        });
        process.stdout.write(`fixture-child-pid=${child.pid}\n`);
        return child;
      }
    : () => {
        const child = spawnStandIn({ stdio: ["ignore", "pipe", "pipe"] });
        process.stdout.write(`fixture-child-pid=${child.pid}\n`);
        return child;
      },
};
if (typeof config.parentCheckMs === "number") deps.parentCheckMs = config.parentCheckMs;
if (typeof config.startKeyCheckMs === "number") deps.startKeyCheckMs = config.startKeyCheckMs;
if (typeof config.startKeyTimeoutMs === "number") deps.startKeyTimeoutMs = config.startKeyTimeoutMs;
if (typeof config.unreadableLimit === "number") deps.unreadableLimit = config.unreadableLimit;
// DX-2894: `run()` already takes `platform` as an injectable arg (used in production to
// decide win32/linux/darwin/unsupported) — this just threads the fixture's own config value
// through to that SAME existing parameter, no test-only branch in production code.
if (typeof config.platform === "string") deps.platform = config.platform;

// These `readProcessStartKey` stand-ins are mutually exclusive — each exercises one DX-2894
// review-round scenario deterministically, without racing the real OS.
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
  // CLAUDE_PID stand-in), but also announces every call on stdout, NUMBERED, so a test can
  // tell the one-time STARTUP read (index 1 — the same `readProcessStartKey` override `run()`
  // uses before it ever arms the periodic timer) apart from a genuine PERIODIC check (index
  // >= 2). DX-2894: an unnumbered log line would let a test pass on the startup read alone
  // even with the periodic check deleted entirely.
  let calls = 0;
  deps.readProcessStartKey = async (pid, opts) => {
    calls += 1;
    const index = calls;
    const result = await bridge.readProcessStartKey(pid, opts);
    process.stdout.write(`fixture-start-key-check index=${index} result=${result === null ? "null" : "ok"}\n`);
    return result;
  };
} else if (config.parentDiesDuringStartupRead) {
  // Simulates the parent exiting in the window between `run()`'s pre-read `alive(parentPid)`
  // check and the startup start-key read resolving: the FIRST `isAlive` call (that pre-read
  // check) reports alive, every call after reports gone, while the read itself always fails
  // exactly as a genuinely-dead parent's would — deterministic, without needing to kill a
  // real stand-in inside that exact window.
  let aliveCalls = 0;
  deps.isAlive = () => {
    aliveCalls += 1;
    return aliveCalls === 1;
  };
  deps.readProcessStartKey = (pid, opts) => {
    opts?.onFailure?.(new Error("stub: simulated unreadable start key (parent gone)"));
    return Promise.resolve(null);
  };
} else if (config.slowUnreadable) {
  // DX-2894 (test support): the startup read succeeds (call 1, so the bridge actually arms
  // the periodic checks) — every read after that is SLOW (config.slowUnreadableDelayMs,
  // deliberately much longer than the fixture's own startKeyCheckMs) and always fails.
  // Reports whether more than one such slow read was ever in flight at once: the periodic
  // check must self-reschedule only after its own read settles, never fire again on a fixed
  // cadence while a prior read is still pending.
  let calls = 0;
  let inFlight = 0;
  deps.readProcessStartKey = async (pid, opts) => {
    calls += 1;
    if (calls === 1) return "fixture-start-key-slow-ok";
    inFlight += 1;
    process.stdout.write(`fixture-slow-read-start calls=${calls} inFlight=${inFlight}\n`);
    if (inFlight > 1) process.stdout.write("fixture-slow-read-OVERLAP\n");
    await new Promise((resolve) => setTimeout(resolve, config.slowUnreadableDelayMs ?? 200));
    inFlight -= 1;
    opts?.onFailure?.(new Error("stub: simulated slow unreadable start key"));
    process.stdout.write(`fixture-slow-read-end calls=${calls}\n`);
    return null;
  };
}

process.stdout.write(`fixture-ready pid=${process.pid}\n`);

bridge.run(config.sessionId, config.intent ?? "resume", process.env, deps).catch((err) => {
  process.stderr.write(`run-bridge fixture failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
