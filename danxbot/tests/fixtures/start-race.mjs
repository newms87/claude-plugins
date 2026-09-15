// One contender in the concurrent-start race test: calls the real `start` with a spawn
// that sleeps inside the critical section, so contenders genuinely overlap.
import fs from "node:fs";
import { start } from "../../scripts/plan-event-bridge.mjs";

const fakePid = Number(process.env.RACE_FAKE_PID);
const result = start({
  env: process.env,
  sessionId: process.env.RACE_SESSION,
  isAlive: (pid) => pid === fakePid,
  stderr: () => {},
  spawnRun: () => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.RACE_HOLD_MS));
    fs.appendFileSync(process.env.RACE_SPAWN_LOG, `${process.pid}\n`);
    return { pid: fakePid };
  },
});
process.stdout.write(JSON.stringify(result));
