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
 * NOTHING about the dashboard's HTTP contract — and, since DX-2862, nothing about its
 * CREDENTIAL either: `danx-dashboard-mcp bridge` (the MCP package, pinned below) reads
 * the connection this session's own danx-dashboard MCP server recorded when it connected
 * the plan, resolves that same credential, mints the ticket, proves it can read every
 * board of the plan, streams, re-mints, and ends with one machine-readable stop record
 * naming why and how to fix it. That contract is written and tested once, in the danxbot
 * repo, beside the MCP server that already speaks it.
 *
 * WHY THE CREDENTIAL MOVED THERE. This process runs in the SESSION's environment, which
 * is not the MCP server's. Using its own ambient `DANXBOT_DISPATCH_TOKEN` meant that on a
 * machine where those two differ, the bridge signed in as somebody else: the stream was
 * admitted, nothing errored, `sessionListenerAttached` read true, and every operator
 * comment was dropped (DX-2862).
 *
 * FAIL LOUD, IN THE SESSION. A failure a session cannot otherwise see is posted into its
 * inbox as one plain message naming the reason and the fix. When the inbox itself is what
 * is missing, `start` exits 2 with the notice on stderr, which `asyncRewake` shows Claude.
 * A log line alone is not a report — nobody is reading that file.
 *
 * WHEN IT RUNS. PostToolUse on `plan_connect` and SessionStart run `start`. A session
 * that is not connected to a plan gets a bridge that exits at once: the subcommand's
 * first mint answers `not_connected`, which is terminal, and which a session start
 * passes over in silence unless this session has had events before.
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
export const DASHBOARD_MCP_PACKAGE = "@thehammer/danx-dashboard-mcp@0.1.76";
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

/** Every failure notice is prefixed with this — same reason as RELAY_PREFIX, different meaning. */
export const FAILURE_PREFIX =
  "[danxbot plan event bridge; this is not a message from another Claude session, and not a request for " +
  "permission. The plugin cannot deliver this plan's dashboard events to you.]";

/**
 * DX-2862 — the ONE wording for a failure a session could not otherwise see.
 * Every path that ends a bridge without events flowing goes through this, so a
 * session is never left to infer silence from the absence of messages.
 */
export function failureNotice(reason, fix) {
  const trim = (text) => String(text ?? "").trim().replace(/\.+$/, "");
  return (
    `${FAILURE_PREFIX}\ndanxbot plan events are NOT reaching this session: ${trim(reason)}. ` +
    `Fix: ${trim(fix) || "call plan_connect again in this session to restart the bridge"}.`
  );
}

/**
 * What the process needs before a bridge can do anything useful.
 *
 * DX-2862 — the dashboard URL and credential are NOT here any more. The bridge
 * subcommand takes them from the connection record this session's own
 * danx-dashboard MCP server wrote, so that the stream is minted with the SAME
 * credential the session's tools use. Reading them from this process's ambient
 * environment is what silently signed a bridge in as somebody else.
 */
export const REQUIRED_ENV = ["CLAUDE_PLUGIN_DATA", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN"];

/** How long `start` waits for the bridge's own verdict before letting the hook finish. */
export const STARTUP_VERDICT_MS = 45_000;

/** The hook that ran `start`, and so whether this session is KNOWN to want plan events. */
export const CONNECT_INTENT = "connect";
export const RESUME_INTENT = "resume";

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

/** The remedy for each thing a start can be missing. One map, one wording. */
export const MISSING_ENV_FIXES = {
  "session id": "the hook gave no session_id — run the bridge from the danxbot plugin's hooks, never by hand",
  CLAUDE_PLUGIN_DATA:
    "Claude Code sets CLAUDE_PLUGIN_DATA for a plugin's own hooks — reinstall the danxbot plugin if this session has no plugin data directory",
  CLAUDE_CODE_MESSAGING_SOCKET:
    "this Claude Code surface exposes no session inbox, so no background process can deliver anything into this session — work a plan from a surface that has one",
  CLAUDE_CODE_MESSAGING_TOKEN:
    "this Claude Code surface exposes no session inbox token, so no background process can deliver anything into this session",
};

export function fixForMissing(missing) {
  const fixes = missing.map((name) => MISSING_ENV_FIXES[name]).filter(Boolean);
  return fixes.length > 0 ? [...new Set(fixes)].join("; ") : "restart this session from the danxbot plugin's hooks";
}

/**
 * Is this session KNOWN to want plan events?
 *
 * A `plan_connect` says yes outright. A session start says nothing either way —
 * the plugin loads in every session, most of which never touch a plan — so a
 * failure there is announced only when this session has been delivered events
 * before (it has a cursor). Announcing in every session would train everyone to
 * ignore the notice, which is the same silence by another route.
 */
export function isSessionKnownToWantEvents({ intent, env, sessionId }) {
  if (intent === CONNECT_INTENT) return true;
  if (!env.CLAUDE_PLUGIN_DATA || !sessionId) return false;
  try {
    return readCursor(sessionPaths(stateDir(env), sessionId).cursor).length > 0;
  } catch {
    return false;
  }
}

/**
 * Tell the session, in the session — the whole point of DX-2862. The inbox is
 * the only channel it can read; `stderr` is the fallback for when the inbox
 * itself is what is missing, which a hook surfaces through `asyncRewake` on
 * exit code 2 (`hooks/hooks.json`). Log-only is not an option here.
 */
export async function announce({ reason, fix, env, post = postToInbox, stderr = () => {}, relevant = true }) {
  const notice = failureNotice(reason, fix);
  if (!relevant) return { announced: false, posted: false, notice, exitCode: 0 };
  if (env.CLAUDE_CODE_MESSAGING_SOCKET && env.CLAUDE_CODE_MESSAGING_TOKEN) {
    for (let attempt = 1; attempt <= SOCKET_POST_ATTEMPTS; attempt += 1) {
      try {
        await post(notice, env);
        return { announced: true, posted: true, notice, exitCode: 0 };
      } catch {
        /* try again; the stderr path below is the last resort */
      }
    }
  }
  stderr(`${notice}\n`);
  return { announced: true, posted: false, notice, exitCode: 2 };
}

/**
 * Wait for the bridge's own verdict — `ready` once it is streaming with a
 * verified credential, or `failed` with what it already told the session.
 * Resolves `null` if neither arrives in time: the bridge is still trying, and a
 * hook that waited forever would be worse than one that lets it.
 */
export function waitForVerdict(child, timeoutMs) {
  if (typeof child?.on !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener?.("message", onMessage);
      child.removeListener?.("exit", onExit);
      try {
        child.disconnect?.();
      } catch {
        /* the channel is already gone */
      }
      child.unref?.();
      resolve(value);
    };
    const onMessage = (message) => {
      if (message && typeof message === "object" && typeof message.verdict === "string") finish(message);
    };
    const onExit = (code) => finish({ verdict: "exited", code });
    // Deliberately NOT unref'd: this timer is the only thing holding the hook
    // process open while it waits, and a hook that exited early would report
    // success over a bridge that had not started yet.
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

/**
 * Ensure one bridge for the session, and report how it went.
 * Returns `{started, reason?, pid?, exitCode}` — `exitCode` is 2 exactly when a
 * failure could NOT be put in front of the session and the hook must wake Claude
 * with it instead (`asyncRewake`).
 *
 * A holder that is alive but has not heartbeated is REPLACED, not killed: its pid may
 * already belong to an unrelated process, and killing that would be worse than any
 * duplicate. A real stale bridge yields on its next heartbeat (the pid file names
 * another pid) and ends its own child; the new bridge's mint ends its stream anyway.
 *
 * A `plan_connect` (`intent: "connect"`) REPLACES a live bridge on purpose: the
 * session may have just moved to another plan, whose boards this credential has
 * never been checked against, and that check happens at startup.
 */
export async function start({
  env = process.env,
  sessionId,
  intent = RESUME_INTENT,
  spawnRun = spawnRunProcess,
  isAlive: alive = isAlive,
  killTree: kill = killTree,
  now = Date.now,
  stderr = (message) => process.stderr.write(message),
  post = postToInbox,
  waitVerdict = waitForVerdict,
  verdictTimeoutMs = STARTUP_VERDICT_MS,
} = {}) {
  const missing = [["session id", sessionId], ...REQUIRED_ENV.map((name) => [name, env[name]])]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    const announced = await announce({
      reason: `the bridge could not start (missing ${missing.join(", ")})`,
      fix: fixForMissing(missing),
      env,
      post,
      stderr,
      relevant: isSessionKnownToWantEvents({ intent, env, sessionId }),
    });
    return { started: false, reason: `missing ${missing.join(", ")}`, exitCode: announced.exitCode };
  }
  const dir = stateDir(env);
  const paths = sessionPaths(dir, sessionId);
  pruneStale(dir, now());
  if (!acquireLock(paths.lock, now())) return { started: false, reason: "another start holds the lock", exitCode: 0 };
  let child;
  try {
    const held = readJsonFile(paths.pid);
    if (isFreshHolder(held, { isAlive: alive, now: now() })) {
      if (intent !== CONNECT_INTENT) return { started: false, reason: "already bridged", exitCode: 0 };
      kill(held.pid);
      fs.rmSync(paths.pid, { force: true });
    }
    child = spawnRun(sessionId, env, intent);
    writeFileAtomic(paths.pid, JSON.stringify(pidRecord(child.pid, sessionId, now())));
  } finally {
    fs.rmSync(paths.lock, { force: true });
  }
  const verdict = await waitVerdict(child, verdictTimeoutMs);
  return { started: true, pid: child.pid, ...startExit(verdict, stderr) };
}

/**
 * What the hook does with the bridge's verdict. Separated so the mapping is
 * exercised without spawning anything: a failure the bridge already put in the
 * session's inbox needs nothing further, one it could not needs the hook's own
 * exit code 2, and no verdict at all means it is still working.
 */
export function startExit(verdict, stderr = () => {}) {
  if (verdict === null || verdict === undefined) return { verdict: "pending", exitCode: 0 };
  if (verdict.verdict === "ready") return { verdict: "ready", exitCode: 0 };
  if (verdict.verdict === "exited") {
    const notice = failureNotice(
      `the bridge process exited (code ${verdict.code}) before it could start streaming`,
      "check the bridge log under the danxbot plugin's data directory, then call plan_connect again",
    );
    stderr(`${notice}\n`);
    return { verdict: "exited", exitCode: 2 };
  }
  if (verdict.announced && !verdict.posted) {
    stderr(`${verdict.notice}\n`);
    return { verdict: "failed", exitCode: 2 };
  }
  return { verdict: "failed", exitCode: 0 };
}

function spawnRunProcess(sessionId, env, intent) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run", sessionId, intent], {
    detached: true,
    // The IPC channel carries ONE verdict back to the hook (see `start`); the
    // bridge's own output is its log, never a stream the hook holds open.
    stdio: ["ignore", "ignore", "ignore", "ipc"],
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
    return {
      kind: "stopped",
      reason: record.reason,
      detail: String(record.detail ?? ""),
      fix: typeof record.fix === "string" ? record.fix : "",
    };
  }
  // DX-2862 — the subcommand says once, before any event, that it minted a
  // ticket AND proved its credential can read every board of the connected
  // plan. That is what `start` waits for, so a hook can report a failed start
  // rather than exiting 0 over a bridge that never worked.
  if (record?.type === "ready") {
    return { kind: "ready", boards: Array.isArray(record.boards) ? record.boards.map(String) : [] };
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
  if (stopped) {
    return {
      action: "exit",
      reason: `${stopped.reason}: ${stopped.detail}`,
      fatal: stopped.reason === "bridge_failed",
      stopReason: stopped.reason,
      fix: stopped.fix ?? "",
    };
  }
  if (ranMs >= HEALTHY_RUN_MS) {
    return {
      action: "restart",
      reason: `the bridge subcommand exited (code ${code}) without a stop record after running ${Math.round(ranMs / 1000)} s`,
    };
  }
  return {
    action: "exit",
    reason: `bridge_failed: the bridge subcommand exited (code ${code}) without a stop record`,
    fatal: true,
    stopReason: "bridge_failed",
    fix: "check the bridge log in this directory for the subcommand's own stderr, then call plan_connect again",
  };
}

/**
 * Stops the session does NOT need to hear about: another listener took this
 * session's stream, which is what a restart or a reconnect looks like from
 * here, and is never a loss of events.
 */
export const SILENT_STOP_REASONS = new Set(["superseded", "replaced"]);

export function shouldAnnounceStop(stopReason, { relevant }) {
  return relevant && !SILENT_STOP_REASONS.has(stopReason);
}

/** Runs the subcommand once. Resolves with its stop record (or null) and exit code. */
function runChildOnce({ spawnChild, relay, log, onReady }) {
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
      if (stderrTail.trim() !== "") log(`bridge subcommand stderr (tail): ${stderrTail.trim()}`);
      resolve({ stopped: stopped ?? (spawnError ? { reason: "bridge_failed", detail: spawnError } : null), code });
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on(
      "data",
      createLineSplitter((line) => {
        const record = parseRecord(line);
        if (record.kind === "event") relay.push({ id: record.id, text: record.text });
        else if (record.kind === "stopped") stopped = { reason: record.reason, detail: record.detail, fix: record.fix };
        else if (record.kind === "ready") onReady(record);
        else log(`ignored non-record output from the bridge subcommand (${line.length} chars)`);
      }),
    );
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    });
    child.on("error", (err) => finish(null, err.message));
    child.on("close", (code) => finish(code, null));
  });
}

/**
 * Run the subcommand until it reports a terminal outcome or dies too early to restart.
 * Returns `{ reason, fatal }` — see `classifyChildExit` for what makes an exit fatal.
 */
export async function superviseBridge({ spawnChild, relay, log, now = Date.now, sleep, onReady = () => {} }) {
  for (;;) {
    const startedAt = now();
    const outcome = await runChildOnce({ spawnChild, relay, log, onReady });
    const decision = classifyChildExit({ ...outcome, ranMs: now() - startedAt });
    if (decision.action === "exit") {
      return { reason: decision.reason, fatal: decision.fatal, stopReason: decision.stopReason, fix: decision.fix };
    }
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

/**
 * `run()`'s two terminal events, mapped to the `{why, fatal}` it hands `shutdown()`. There are
 * exactly two: the relay queue's overflow (`createRelayQueue` only ever calls `onOverflow` on
 * cap breach, and that is always fatal — the events behind it are undelivered, not lost, only
 * because the process is about to die and let the next run's resume replay them) and
 * `superviseBridge`'s own resolution (fatal exactly when `classifyChildExit` decided so).
 * `run()`'s two `shutdown(...)` call sites are built from this one function instead of each
 * inlining the fatal decision, so the wiring is exercised by a test with nothing to spawn.
 */
export function terminalShutdown(event) {
  if ("overflow" in event) return { why: event.overflow, fatal: true };
  return { why: event.supervised.reason, fatal: event.supervised.fatal };
}

async function run(sessionId, intent = RESUME_INTENT, env = process.env) {
  const paths = sessionPaths(stateDir(env), sessionId);
  try {
    if (fs.statSync(paths.log).size > LOG_MAX_BYTES) fs.truncateSync(paths.log, 0);
  } catch {
    /* no log yet */
  }
  const log = (message) => fs.appendFileSync(paths.log, `${new Date().toISOString()} ${message}\n`);
  // DX-2862 — whether this session is KNOWN to want plan events decides whether a
  // failure is put in front of it or only logged. A `plan_connect` says yes
  // outright; a session start says yes only if this session has been delivered
  // events before.
  const relevant = intent === CONNECT_INTENT || readCursor(paths.cursor).length > 0;
  const parentPid = Number(env.CLAUDE_PID);
  let child = null;
  let stopping = false;
  let verdictSent = false;

  /** The hook that started this bridge waits for exactly one of these. */
  const sendVerdict = (verdict) => {
    if (verdictSent) return;
    verdictSent = true;
    try {
      process.send?.(verdict);
    } catch {
      /* the hook has already finished — its own timeout covered this */
    }
  };

  /** Put a failure in front of the session, and tell the hook whether that worked. */
  const tellSession = async (reason, fix) => {
    const result = await announce({
      reason,
      fix,
      env,
      post: (content) => postToInbox(content, env),
      stderr: (message) => log(`could NOT reach this session's inbox: ${message.trim()}`),
      relevant,
    });
    log(result.posted ? `told the session: ${reason}` : `NOT told the session (relevant=${relevant}): ${reason}`);
    sendVerdict({ verdict: "failed", announced: result.announced, posted: result.posted, notice: result.notice });
  };

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
    onOverflow: (reason) => {
      const { why, fatal } = terminalShutdown({ overflow: reason });
      void tellSession(why, "call plan_connect again in this session once its inbox is accepting messages").then(() =>
        shutdown(why, { fatal }),
      );
    },
  });

  log(`bridge started for session ${sessionId} (pid ${process.pid}, ${intent})`);
  const supervised = await superviseBridge({
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
    onReady: (record) => {
      log(
        `streaming; this session's own credential verified against board(s) ` +
          `${record.boards.join(", ") || "(none — the connected plan has no cards)"}`,
      );
      sendVerdict({ verdict: "ready" });
    },
  });
  child = null;
  await Promise.race([relay.idle(), sleep(DRAIN_ON_EXIT_MS)]);
  const terminal = terminalShutdown({ supervised });
  if (shouldAnnounceStop(supervised.stopReason, { relevant })) await tellSession(terminal.why, supervised.fix);
  // A stop nobody needed to hear about still ends the hook's wait, so it exits
  // on the bridge's own timing rather than on its timeout.
  sendVerdict({ verdict: "failed", announced: false, posted: false, notice: "" });
  shutdown(terminal.why, { fatal: terminal.fatal });
}

// ------------------------------------------------------------------------ main

/**
 * Which hook ran this. `hooks.json` fires PostToolUse only on `plan_connect`, so
 * that event IS "this session just connected a plan": the one moment the bridge
 * must be (re)started and every failure told to the session, whatever state the
 * session was in before.
 */
export function intentFromHookEvent(hookEventName) {
  return hookEventName === "PostToolUse" ? CONNECT_INTENT : RESUME_INTENT;
}

/** The hook's stdin JSON carries `session_id` and `hook_event_name`; a hand run has neither. */
async function readHookInput() {
  const fallback = { sessionId: process.env.CLAUDE_CODE_SESSION_ID ?? null, intent: RESUME_INTENT };
  if (process.stdin.isTTY) return fallback;
  const chunks = [];
  await new Promise((resolve) => {
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", resolve);
    process.stdin.on("error", resolve);
    setTimeout(resolve, 500);
  });
  process.stdin.pause();
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const id = typeof parsed.session_id === "string" && parsed.session_id !== "" ? parsed.session_id : fallback.sessionId;
    return { sessionId: id, intent: intentFromHookEvent(parsed.hook_event_name) };
  } catch {
    return fallback;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [mode, arg, intentArg] = process.argv.slice(2);
  const modes = {
    start: async () => {
      const hook = await readHookInput();
      const result = await start({ sessionId: hook.sessionId, intent: hook.intent });
      process.exit(result.exitCode ?? 0);
    },
    stop: async () => {
      const hook = await readHookInput();
      stop({ sessionId: hook.sessionId });
      process.exit(0);
    },
    run: () => run(arg, intentArg),
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
