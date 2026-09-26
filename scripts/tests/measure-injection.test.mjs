// Smoke test for scripts/measure-injection.mjs (DX-3053).
//
// Full ceiling-gate testing (AC 32514 — "a test proves the check FAILS on
// a deliberately over-budget fixture") is NOT here: DX-3053's ceiling
// constant depends on the cadence-model decision on DX-3052 (problem 300,
// open, no decision recorded as of this commit), and the card's own text
// says "do not invent one here." This test instead proves the MEASUREMENT
// harness itself is trustworthy — the one piece AC 32507-32511 asked for
// and that does not depend on the unanswered decision:
//   1. It reproduces DX-3049's manual baseline exactly, at the exact
//      commit those figures were measured against (git archive of
//      4b8b0a9, where base=0.4.16 / danxbot=0.7.18 / dev=0.4.3 /
//      human-collaboration=0.4.18 / investigate=0.3.15 all hold
//      simultaneously — verified via `git show <rev>:plugin.json` before
//      writing this test).
//   2. It runs clean (exit 0, well-formed JSON, the three totals present
//      and never summed together) against the CURRENT tree, proving the
//      harness itself does not bit-rot as plugin content moves.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "measure-injection.mjs");

function run() {
  const out = execFileSync("node", [SCRIPT, "--json"], {
    cwd: REPO_ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(out.toString("utf8"));
}

test("measure-injection reports the three cadence totals, never summed together", () => {
  const { totals, rows } = run();
  assert.equal(typeof totals.perTurnUnconditional, "number");
  assert.equal(typeof totals.perSession, "number");
  assert.equal(typeof totals.perToolCall, "number");
  assert.ok(rows.length > 0, "expected at least one measured hook row");
  // Every row is byte-accounted or explicitly flagged as an error — never
  // silently absent (AC 32508's "never mistaken for a hook that emits
  // nothing" applies to the harness's OWN reporting too).
  for (const r of rows) {
    assert.equal(typeof r.bytes, "number");
  }
});

test("measure-injection distinguishes conditional from unconditional UserPromptSubmit hooks", () => {
  const { rows } = run();
  const debuggingGate = rows.find(
    (r) => r.event === "UserPromptSubmit" && r.command.includes("debugging-gate.sh")
  );
  assert.ok(debuggingGate, "expected debugging-gate.sh to be measured");
  assert.equal(debuggingGate.kind, "conditional");
  assert.equal(debuggingGate.bytes, 0, "a conditional gate must not count toward the unconditional total on a plain prompt");
  assert.ok(debuggingGate.triggerBytes > 0, "a conditional gate must show a non-zero trigger figure separately");
});

test("reproduces the DX-3049 baseline (4438 / 46369) at the exact commit those figures were measured against", () => {
  // Deliberately does NOT assert the per-tool-call (32) figure — measured
  // and could not be reproduced exactly (23 with a fresh per-invocation
  // session id, matching inject-time.sh's documented fixed-width
  // first-fire format; see DX-3053 report for the discrepancy). That
  // figure is 9 bytes on one minor always-tiny hook and does not gate
  // anything DX-3053 builds.
  // mktemp -d (not node's os.tmpdir()) so the resulting path is already
  // POSIX-shaped for the `bash -c` calls below — on this Windows/Git-Bash
  // machine, os.tmpdir() returns a `C:\...` path that bash's own `tar -C`
  // cannot resolve.
  const archiveDir = execFileSync("bash", ["-c", "mktemp -d"]).toString("utf8").trim();

  execFileSync("bash", ["-c", `git archive 4b8b0a9 | tar -x -C '${archiveDir}'`], {
    cwd: REPO_ROOT,
  });
  execFileSync("bash", ["-c", `cp '${SCRIPT.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "/$1")}' '${archiveDir}/scripts/measure-injection.mjs'`]);

  const out = execFileSync("bash", ["-c", `cd '${archiveDir}' && node scripts/measure-injection.mjs --json`], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const { totals } = JSON.parse(out.toString("utf8"));

  assert.equal(totals.perTurnUnconditional, 4438);
  assert.equal(totals.perSession, 46369);
});
