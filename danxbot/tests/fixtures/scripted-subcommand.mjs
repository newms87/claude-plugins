// DX-2953 fixture — a real, spawned stand-in for the `danx-dashboard-mcp bridge`
// subcommand that emits a SCRIPTED sequence of JSON-lines records (the same
// `{type:"ready"|"event"|"stopped"}` shapes `parseRecord` understands) on its
// real stdout, then either exits with a given code or stays alive forever
// (mirroring a degraded child that never exits on its own). Lets a real-process
// test drive `run()`'s onReady/onStopped/onEvent wiring — the DX-2953 marker
// writes — through the REAL runChildOnce/superviseBridge pipeline, not a stub.
//
// Config via SCRIPTED_SUBCOMMAND_CONFIG (JSON): { records: [...], exitCode?: number }.
// Each record is written as one JSON line, one per macrotask tick (so a real
// process boundary separates them, matching how a real child's stdout arrives
// in chunks). `exitCode` omitted => stays alive (`setInterval` keeps the event
// loop open) after emitting every record, exactly like the plain spawn-standin.

const config = JSON.parse(process.env.SCRIPTED_SUBCOMMAND_CONFIG ?? "{}");
const records = Array.isArray(config.records) ? config.records : [];

async function emitAll() {
  for (const record of records) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (typeof config.exitCode === "number") {
    process.exit(config.exitCode);
  }
}

setInterval(() => {}, 1e9);
emitAll();
