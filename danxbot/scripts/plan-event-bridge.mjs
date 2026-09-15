#!/usr/bin/env node
/**
 * danxbot plan event bridge (DX-2784) — delivers a danxbot Plan's dashboard events
 * into the Claude Code session connected to it.
 *
 * WHY. Operators answer questions and comment on the cards of a danxbot Plan in the
 * dashboard, and the session working that plan must hear each event at once. Monitor
 * stops after 30 minutes, plugin `monitors/` are skipped without a TTY (Desktop), and
 * MCP channels need a launch flag — so a process that lives as long as the session
 * relays each event into the session's own inbox socket (`CLAUDE_CODE_MESSAGING_SOCKET`),
 * which starts a turn in an idle session.
 *
 * WHAT THIS SCRIPT OWNS, AND WHAT IT DOES NOT. It owns process lifecycle (one bridge per
 * session, start / stop / yield), the delivered-id cursor, and the inbox post. It knows
 * NOTHING about the dashboard's HTTP contract: `danx-dashboard-mcp bridge` (the MCP
 * package, pinned below) mints the ticket, streams, re-mints, and ends with one
 * machine-readable stop record naming why. That contract is written and tested once,
 * in the danxbot repo, beside the MCP server that already speaks it.
 *
 * WHEN IT RUNS. PostToolUse on `plan_connect` and SessionStart run `start`. A session
 * that is not connected to a plan gets a bridge that exits at once: the subcommand's
 * first mint answers `not_connected`, which is terminal. A session without the inbox
 * socket or the dashboard credential gets no process at all.
 *
 * MODES
 *   start — the hooks. Under an exclusive-create lock: a live holder with a fresh
 *           heartbeat → no-op; otherwise spawn `run` and record its pid.
 *   run   — the bridge itself: supervises the subcommand, relays its events.
 *   stop  — SessionEnd. Signals a live holder, whose SIGTERM handler ends its child.
 *
 * STATE lives under `${CLAUDE_PLUGIN_DATA}/plan-event-bridge/`, one set per session:
 * `<session>.pid.json` (`{pid, sessionId, heartbeatAt}`), `<session>.lock` (held only
 * during `start`), `<session>.cursor.json` (`{deliveredIds}`, kept across SessionEnd so
 * a resumed session continues) and `<session>.log` (no secrets). Every write is
 * write-then-rename. Files untouched for STALE_STATE_MS are pruned — the dashboard
 * keeps only a week of events, so an older cursor cannot resume anything.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The ONE place the MCP package version this plugin runs is named. DX-2784: it must be
 * the version published with the `bridge` subcommand; move it to the version that
 * release actually publishes.
 */
export const DASHBOARD_MCP_PACKAGE = "@thehammer/danx-dashboard-mcp@0.1.64";
export const BRIDGE_SUBCOMMAND = "bridge";

export const HEARTBEAT_MS = 30_000;
export const HEARTBEAT_STALE_MS = 90_000;
const PARENT_CHECK_MS = 5_000;
/** A start that crashed mid-claim leaves its lock; one older than this is taken over. */
export const LOCK_STALE_MS = 30_000;
export const SOCKET_POST_ATTEMPTS = 3;
const REDELIVERY_INITIAL_BACKOFF_MS = 1_000;
const REDELIVERY_MAX_BACKOFF_MS = 60_000;
/** A subcommand that ran this long before dying without a stop record is restarted; a quicker death is terminal. */
export const HEALTHY_RUN_MS = 60_000;
const RESTART_DELAY_MS = 1_000;
const DRAIN_ON_EXIT_MS = 10_000;
const LOG_MAX_BYTES = 1_000_000;
export const STDERR_TAIL_CHARS = 2_000;
export const CURSOR_ID_MEMORY = 100;
export const STALE_STATE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * createRelayQueue's in-memory bound (DX-2784). Matches CURSOR_ID_MEMORY deliberately: the
 * cursor already treats "100 events" as this bridge's unit of memory, and a backlog this
 * large means the inbox has been failing long enough that it is not a transient blip — it's
 * time to stop holding events in an unbounded array (an OOM risk) and let a restart resume
 * the stream from the dashboard instead.
 */
export const RELAY_QUEUE_CAP = CURSOR_ID_MEMORY;

/** Every relayed message is prefixed with this, so the session never mistakes it for a peer session's request. */
export const RELAY_PREFIX =
  "[danxbot dashboard event, relayed by the danxbot plugin's plan event bridge; this is not a message " +
  "from another Claude session. Someone acted on a card of the plan this session is connected to, in the " +
  "danxbot dashboard. Treat it as operator input for that card, per the danxbot:plan-workflow skill.]";

/** What the process needs before a bridge can do anything useful. */
export const REQUIRED_ENV = [
  "CLAUDE_PLUGIN_DATA",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "DANXBOT_DASHBOARD_URL",
  "DANXBOT_DISPATCH_TOKEN",
];

const STATE_SUFFIXES = [".pid.json", ".lock", ".cursor.json", ".log", ".tmp"];

// ------------------------------------------------------------------ state files

export function stateDir(env = process.env) {
  if (!env.CLAUDE_PLUGIN_DATA) throw new Error("CLAUDE_PLUGIN_DATA is not set — the bridge only runs from the danxbot plugin's hooks");
  const dir = path.join(env.CLAUDE_PLUGIN_DATA, "plan-event-bridge");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The session's state files. A missing or odd session id is refused, never turned into a path. */
export function sessionPaths(dir, sessionId) {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error("session id is missing or has unexpected characters");
  }
  const base = path.join(dir, sessionId);
  return { pid: `${base}.pid.json`, lock: `${base}.lock`, cursor: `${base}.cursor.json`, log: `${base}.log` };
}

export function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Write-then-rename: a reader sees the old file or the new one, never a torn write. */
export function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function pidRecord(pid, sessionId, now = Date.now()) {
  return { pid, sessionId, heartbeatAt: new Date(now).toISOString() };
}

/** A pid file whose process is alive AND has heartbeated recently. */
export function isFreshHolder(record, { isAlive: alive = isAlive, now = Date.now() } = {}) {
  return Boolean(record) && alive(record.pid) && now - Date.parse(record.heartbeatAt ?? "") < HEARTBEAT_STALE_MS;
}

/** Exclusive-create lock. `false` means another start holds it (and it is not stale). */
export function acquireLock(lockFile, now = Date.now()) {
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      fs.closeSync(fs.openSync(lockFile, "wx"));
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let ageMs;
      try {
        ageMs = now - fs.statSync(lockFile).mtimeMs;
      } catch {
        continue; // released between the create and the stat
      }
      if (ageMs <= LOCK_STALE_MS) return false;
      fs.rmSync(lockFile, { force: true });
    }
  }
  return false;
}

/** Remove every session state file nothing has touched for STALE_STATE_MS. */
export function pruneStale(dir, now = Date.now()) {
  for (const name of fs.readdirSync(dir)) {
    if (!STATE_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > STALE_STATE_MS) fs.rmSync(file, { force: true });
    } catch {
      /* removed by another start */
    }
  }
}

// ------------------------------------------------------------------- processes

export function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * End a process and its descendants. On Windows `taskkill /T` walks the tree. On POSIX
 * the signal goes to the process GROUP — the run process and the subcommand are each
 * spawned detached, so each leads its own group.
 */
export function killTree(pid) {
  if (!isAlive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

// ---------------------------------------------------------------- start / stop

/**
 * Ensure one bridge for the session. Returns `{started, reason?, pid?}`.
 *
 * A holder that is alive but has not heartbeated is REPLACED, not killed: its pid may
 * already belong to an unrelated process, and killing that would be worse than any
 * duplicate. A real stale bridge yields on its next heartbeat (the pid file names
 * another pid) and ends its own child; the new bridge's mint ends its stream anyway.
 */
export function start({
  env = process.env,
  sessionId,
  spawnRun = spawnRunProcess,
  isAlive: alive = isAlive,
  now = Date.now,
  stderr = (message) => process.stderr.write(message),
} = {}) {
  const missing = [["session id", sessionId], ...REQUIRED_ENV.map((name) => [name, env[name]])]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    stderr(`danxbot plan event bridge not started: missing ${missing.join(", ")}\n`);
    return { started: false, reason: `missing ${missing.join(", ")}` };
  }
  const dir = stateDir(env);
  const paths = sessionPaths(dir, sessionId);
  pruneStale(dir, now());
  if (!acquireLock(paths.lock, now())) return { started: false, reason: "another start holds the lock" };
  try {
    if (isFreshHolder(readJsonFile(paths.pid), { isAlive: alive, now: now() })) {
      return { started: false, reason: "already bridged" };
    }
    const child = spawnRun(sessionId, env);
    writeFileAtomic(paths.pid, JSON.stringify(pidRecord(child.pid, sessionId, now())));
    return { started: true, pid: child.pid };
  } finally {
    fs.rmSync(paths.lock, { force: true });
  }
}

function spawnRunProcess(sessionId, env) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run", sessionId], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env,
  });
  child.unref();
  return child;
}

/** SessionEnd: end a live, heartbeating holder (never a stale pid that may be reused) and drop its pid file. */
export function stop({ env = process.env, sessionId, isAlive: alive = isAlive, killTree: kill = killTree, now = Date.now } = {}) {
  if (!env.CLAUDE_PLUGIN_DATA || typeof sessionId !== "string" || sessionId === "") return { stopped: false };
  const paths = sessionPaths(stateDir(env), sessionId);
  const held = readJsonFile(paths.pid);
  const live = isFreshHolder(held, { isAlive: alive, now: now() });
  if (live) kill(held.pid);
  fs.rmSync(paths.pid, { force: true });
  return { stopped: live };
}

// ------------------------------------------------------------------------- run

/** One heartbeat. Yields (calls `shutdown`) when the pid file names another bridge. */
export function heartbeatTick({ paths, selfPid, sessionId, now = Date.now(), shutdown }) {
  const held = readJsonFile(paths.pid);
  if (held && held.pid !== selfPid) {
    shutdown("another bridge owns this session");
    return false;
  }
  writeFileAtomic(paths.pid, JSON.stringify(pidRecord(selfPid, sessionId, now)));
  return true;
}

/** Post one user message into this session's inbox. The server replies with nothing. */
export function postToInbox(content, env = process.env) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(env.CLAUDE_CODE_MESSAGING_SOCKET);
    sock.setTimeout(10_000);
    sock.on("timeout", () => sock.destroy(new Error("inbox socket timeout")));
    sock.on("error", reject);
    sock.on("close", (hadError) => {
      if (!hadError) resolve();
    });
    sock.on("connect", () => {
      const frames =
        JSON.stringify({ type: "auth", token: env.CLAUDE_CODE_MESSAGING_TOKEN }) +
        "\n" +
        JSON.stringify({ type: "user", message: { role: "user", content } }) +
        "\n";
      sock.end(frames);
    });
  });
}

export function relayContent(text) {
  return `${RELAY_PREFIX}\n${text}`;
}

/** The ids already delivered for the session, oldest first: positive integers only, newest CURSOR_ID_MEMORY. */
export function readCursor(file) {
  const ids = readJsonFile(file)?.deliveredIds;
  return Array.isArray(ids) ? ids.filter((id) => Number.isSafeInteger(id) && id > 0).slice(-CURSOR_ID_MEMORY) : [];
}

/** Record one delivered id — deduped, capped, atomic. */
export function recordDelivered(file, id) {
  const ids = readCursor(file).filter((known) => known !== id);
  ids.push(id);
  writeFileAtomic(file, JSON.stringify({ deliveredIds: ids.slice(-CURSOR_ID_MEMORY) }));
}

export function resumeArgs(resumeIds) {
  return resumeIds.length > 0 ? ["--resume-ids", resumeIds.join(",")] : [];
}

/**
 * The subcommand's environment: the dashboard credential and session id it needs to
 * mint, and NOT the inbox token or socket, which only this process uses.
 */
export function childEnv(env, sessionId) {
  const out = { ...env, CLAUDE_CODE_SESSION_ID: sessionId };
  delete out.CLAUDE_CODE_MESSAGING_TOKEN;
  delete out.CLAUDE_CODE_MESSAGING_SOCKET;
  return out;
}

/**
 * The command that runs the subcommand — never through a shell. On Windows `npx` is a
 * `.cmd` shim Node can only start via `cmd.exe`, so run npm's own JS entry with this
 * node instead; elsewhere `npx` is an executable and is spawned directly.
 */
export function bridgeCommand({ resumeIds, platform = process.platform, execPath = process.execPath, exists = fs.existsSync }) {
  const args = ["-y", DASHBOARD_MCP_PACKAGE, BRIDGE_SUBCOMMAND, ...resumeArgs(resumeIds)];
  if (platform !== "win32") return { command: "npx", args };
  const npxCli = path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (!exists(npxCli)) throw new Error(`npx not found: expected ${npxCli} next to ${execPath}`);
  return { command: execPath, args: [npxCli, ...args] };
}

/** One stdout line of the subcommand, classified. */
export function parseRecord(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return { kind: "junk" };
  }
  if (record?.type === "event" && typeof record.text === "string") {
    return { kind: "event", id: Number.isSafeInteger(record.id) && record.id > 0 ? record.id : null, text: record.text };
  }
  if (record?.type === "stopped" && typeof record.reason === "string") {
    return { kind: "stopped", reason: record.reason, detail: String(record.detail ?? "") };
  }
  return { kind: "junk" };
}

/** Feeds complete lines to `onLine`, however the stream happens to split its chunks. */
export function createLineSplitter(onLine) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line !== "") onLine(line);
      nl = buffer.indexOf("\n");
    }
  };
}

/**
 * Ordered delivery into the inbox. An event is recorded in the cursor only AFTER its
 * post succeeds. A post that fails every attempt is logged loudly and stays at the head
 * of the queue — later events wait behind it, so the cursor never runs ahead of a lost
 * event — and is retried with backoff. If the bridge exits first, the event was never
 * recorded, so the next bridge's resume replays it.
 *
 * The queue is bounded at `cap` (default RELAY_QUEUE_CAP): while the head keeps failing,
 * every event behind it piles up in memory with nothing draining it, so an unbounded array
 * here is a real OOM risk on a long enough outage. Overflow is NOT a silent drop — dropping
 * the oldest or newest queued event would lose it for good, with no record anywhere that it
 * ever existed. Instead `onOverflow(reason)` fires once (never enqueuing the event that
 * would have exceeded the cap) so the caller can end the process on a clearly logged reason.
 * Because none of the queued events — including the one that triggered the overflow — were
 * ever `record`ed, the cursor never advanced past them, so the next bridge run's resume
 * naturally re-streams them from the dashboard: deferred to the next process lifetime, never
 * lost.
 */
export function createRelayQueue({ post, record, log, sleep, isStopped = () => false, cap = RELAY_QUEUE_CAP, onOverflow = () => {} }) {
  const queue = [];
  let running = null;
  let overflowed = false;

  const drain = async () => {
    let backoff = REDELIVERY_INITIAL_BACKOFF_MS;
    while (queue.length > 0 && !isStopped()) {
      const event = queue[0];
      let lastError = null;
      let posted = false;
      for (let attempt = 1; attempt <= SOCKET_POST_ATTEMPTS && !posted; attempt += 1) {
        try {
          await post(relayContent(event.text));
          posted = true;
        } catch (err) {
          lastError = err;
          if (attempt < SOCKET_POST_ATTEMPTS) await sleep(1_000 * attempt);
        }
      }
      if (posted) {
        queue.shift();
        if (event.id !== null) record(event.id);
        log(`relayed event ${event.id ?? "(no id)"} (${event.text.length} chars)`);
        backoff = REDELIVERY_INITIAL_BACKOFF_MS;
        continue;
      }
      log(
        `INBOX POST FAILED for event ${event.id ?? "(no id)"} after ${SOCKET_POST_ATTEMPTS} attempts ` +
          `(${lastError?.code ?? lastError?.message}); NOT recorded — holding it and ${queue.length - 1} later ` +
          `event(s) for redelivery in ${backoff} ms`,
      );
      await sleep(backoff);
      backoff = Math.min(REDELIVERY_MAX_BACKOFF_MS, backoff * 2);
    }
  };

  const kick = () => {
    if (running) return;
    running = drain().finally(() => {
      running = null;
      if (queue.length > 0 && !isStopped()) kick();
    });
  };

  return {
    push(event) {
      if (overflowed) return;
      if (queue.length >= cap) {
        overflowed = true;
        const reason =
          `relay queue overflow: ${cap} events are undelivered and the inbox has been failing since event ` +
          `${queue[0]?.id ?? "(no id)"}; exiting without recording any of them so the next bridge run's resume ` +
          "replays them from the dashboard";
        log(`FATAL: ${reason}`);
        onOverflow(reason);
        return;
      }
      queue.push(event);
      kick();
    },
    /** Resolves when the queue is empty (or delivery stopped). */
    async idle() {
      while (running) await running;
    },
    pending: () => queue.length,
  };
}

/**
 * What to do when the subcommand exits: `exit` the bridge with a reason, or `restart` it.
 * An exit carries `fatal`: true for a `bridge_failed` stop (the subcommand's own spawn/mint
 * failure) or a death too quick to have produced any stop record at all; false for every
 * clean stop record the subcommand reports on purpose (`not_connected`, `superseded`,
 * `revoked`, ...). `run()` threads this straight through to `shutdown()`'s own exit code —
 * see `exitCodeForShutdown` — so nothing here duplicates that decision.
 */
export function classifyChildExit({ stopped, code, ranMs }) {
  if (stopped) return { action: "exit", reason: `${stopped.reason}: ${stopped.detail}`, fatal: stopped.reason === "bridge_failed" };
  if (ranMs >= HEALTHY_RUN_MS) {
    return {
      action: "restart",
      reason: `the bridge subcommand exited (code ${code}) without a stop record after running ${Math.round(ranMs / 1000)} s`,
    };
  }
  return { action: "exit", reason: `bridge_failed: the bridge subcommand exited (code ${code}) without a stop record`, fatal: true };
}

/** Runs the subcommand once. Resolves with its stop record (or null) and exit code. */
function runChildOnce({ spawnChild, relay, log, redact }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnChild();
    } catch (err) {
      resolve({ stopped: { reason: "bridge_failed", detail: err.message }, code: null });
      return;
    }
    let stopped = null;
    let stderrTail = "";
    let settled = false;
    const finish = (code, spawnError) => {
      if (settled) return;
      settled = true;
      if (stderrTail.trim() !== "") log(`bridge subcommand stderr (tail): ${redact(stderrTail.trim())}`);
      resolve({ stopped: stopped ?? (spawnError ? { reason: "bridge_failed", detail: spawnError } : null), code });
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on(
      "data",
      createLineSplitter((line) => {
        const record = parseRecord(line);
        if (record.kind === "event") relay.push({ id: record.id, text: record.text });
        else if (record.kind === "stopped") stopped = { reason: record.reason, detail: record.detail };
        else log(`ignored non-record output from the bridge subcommand (${line.length} chars)`);
      }),
    );
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    });
    child.on("error", (err) => finish(null, redact(err.message)));
    child.on("close", (code) => finish(code, null));
  });
}

/**
 * Run the subcommand until it reports a terminal outcome or dies too early to restart.
 * Returns `{ reason, fatal }` — see `classifyChildExit` for what makes an exit fatal.
 */
export async function superviseBridge({ spawnChild, relay, log, now = Date.now, sleep, redact = (text) => text }) {
  for (;;) {
    const startedAt = now();
    const outcome = await runChildOnce({ spawnChild, relay, log, redact });
    const decision = classifyChildExit({ ...outcome, ranMs: now() - startedAt });
    if (decision.action === "exit") return { reason: decision.reason, fatal: decision.fatal };
    log(`restarting the bridge subcommand: ${decision.reason}`);
    await sleep(RESTART_DELAY_MS);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The process exit code for a shutdown, so a FATAL condition (a relay-queue overflow, a
 * subcommand that never produced a stop record) is distinguishable from a normal stop
 * (SessionEnd, yielding to a fresher bridge, the parent process ending, a clean stop record
 * like `not_connected`) by anything watching this process's exit code alone. The ONE call
 * site (`shutdown`, in `run()`) decides `fatal` from where it was called, never duplicating
 * this mapping.
 */
export function exitCodeForShutdown(fatal) {
  return fatal ? 1 : 0;
}

async function run(sessionId, env = process.env) {
  const paths = sessionPaths(stateDir(env), sessionId);
  try {
    if (fs.statSync(paths.log).size > LOG_MAX_BYTES) fs.truncateSync(paths.log, 0);
  } catch {
    /* no log yet */
  }
  const token = env.DANXBOT_DISPATCH_TOKEN;
  const redact = (text) => (token ? text.split(token).join("[redacted]") : text);
  const log = (message) => fs.appendFileSync(paths.log, `${new Date().toISOString()} ${redact(message)}\n`);
  const parentPid = Number(env.CLAUDE_PID);
  let child = null;
  let stopping = false;

  const shutdown = (why, { fatal = false } = {}) => {
    if (stopping) return;
    stopping = true;
    log(`exiting: ${why}`);
    if (child) killTree(child.pid);
    if (readJsonFile(paths.pid)?.pid === process.pid) fs.rmSync(paths.pid, { force: true });
    process.exit(exitCodeForShutdown(fatal));
  };
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => shutdown(`received ${signal}`));

  const beat = () => {
    try {
      heartbeatTick({ paths, selfPid: process.pid, sessionId, shutdown });
    } catch (err) {
      log(`heartbeat write failed: ${err.message}`);
    }
  };
  beat();
  setInterval(beat, HEARTBEAT_MS);
  if (Number.isSafeInteger(parentPid) && parentPid > 0) {
    setInterval(() => {
      if (!isAlive(parentPid)) shutdown(`Claude Code process ${parentPid} is gone`);
    }, PARENT_CHECK_MS);
  } else {
    log("warning: CLAUDE_PID not set; relying on SessionEnd to stop");
  }

  const relay = createRelayQueue({
    post: (content) => postToInbox(content, env),
    record: (id) => recordDelivered(paths.cursor, id),
    log,
    sleep,
    isStopped: () => stopping,
    onOverflow: (reason) => shutdown(reason, { fatal: true }),
  });

  log(`bridge started for session ${sessionId} (pid ${process.pid})`);
  const { reason, fatal } = await superviseBridge({
    spawnChild: () => {
      const resumeIds = readCursor(paths.cursor);
      const { command, args } = bridgeCommand({ resumeIds });
      child = spawn(command, args, {
        env: childEnv(env, sessionId),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      log(`bridge subcommand started${resumeIds.length > 0 ? `, resuming after event ${Math.max(...resumeIds)}` : ""}`);
      return child;
    },
    relay,
    log,
    sleep,
    redact,
  });
  child = null;
  await Promise.race([relay.idle(), sleep(DRAIN_ON_EXIT_MS)]);
  shutdown(reason, { fatal });
}

// ------------------------------------------------------------------------ main

/** The hook's stdin JSON carries `session_id`; a hand run has none. */
async function readHookSessionId() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  await new Promise((resolve) => {
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", resolve);
    process.stdin.on("error", resolve);
    setTimeout(resolve, 500);
  });
  process.stdin.pause();
  try {
    const id = JSON.parse(Buffer.concat(chunks).toString("utf8")).session_id;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [mode, arg] = process.argv.slice(2);
  const resolveSessionId = async () => (await readHookSessionId()) ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
  const modes = {
    start: async () => {
      start({ sessionId: await resolveSessionId() });
      process.exit(0);
    },
    stop: async () => {
      stop({ sessionId: await resolveSessionId() });
      process.exit(0);
    },
    run: () => run(arg),
  };
  const main = modes[mode];
  if (!main) {
    process.stderr.write("usage: plan-event-bridge.mjs start|stop|run <session-id>\n");
    process.exit(2);
  }
  Promise.resolve()
    .then(main)
    .catch((err) => {
      process.stderr.write(`danxbot plan event bridge ${mode} failed: ${err.message}\n`);
      process.exit(1);
    });
}
