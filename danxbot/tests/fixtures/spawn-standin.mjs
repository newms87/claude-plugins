// Shared "never-exiting process" stand-in (DX-2894) — one definition so the CLAUDE_PID parent
// stand-in and the bridge subcommand stand-in can never silently drift apart. Used both as the
// CLAUDE_PID parent stand-in (tests drive it directly, then kill it to prove the bridge
// notices) and as the bridge subcommand stand-in inside the run-bridge fixture.
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
