// Shared "never-exiting process" stand-in (DX-2894 review round 1, finding 6 — this used to
// be defined once in the run-bridge fixture and once again, slightly differently, in the test
// file; the two spawn calls could silently drift). Used both as the CLAUDE_PID parent stand-in
// (tests drive it directly, then kill it to prove the bridge notices) and as the bridge
// subcommand stand-in inside the run-bridge fixture.
import { spawn } from "node:child_process";

/**
 * `stdio` differs by use: the CLAUDE_PID parent stand-in needs nothing (`"ignore"` — nothing
 * ever reads its streams); the bridge subcommand stand-in MUST have piped stdout/stderr,
 * because `run()` always attaches listeners to its child's streams (`runChildOnce` in
 * `plan-event-bridge.mjs`).
 */
export function spawnStandIn({ stdio = "ignore" } = {}) {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9);"], { stdio, windowsHide: true });
}
