#!/usr/bin/env node
/**
 * danxbot plan event bridge (DX-2784) — delivery of dashboard plan events into a
 * Claude Code session that is connected to a danxbot Plan.
 *
 * WHY. Operators answer questions and comment on the cards of a danxbot Plan in the
 * dashboard. The session working that plan must hear each event at once. The
 * dashboard already streams them (`GET /api/plan-sessions/stream`, ticket-authed,
 * filtered server-side to cards of the plan the session is connected to, excluding the
 * session's own writes), and `@thehammer/danx-dashboard-mcp listen` already turns that
 * stream into one JSON record per event with reconnect + dedupe. What was missing is a
 * process that lives as long as the session: Monitor stops after 30 minutes, plugin
 * `monitors/` are skipped without a TTY (Desktop), and MCP channels need a launch flag.
 * This bridge is that process. It relays each event's text into the session's own inbox
 * socket (`CLAUDE_CODE_MESSAGING_SOCKET`), which starts a turn in an idle session.
 *
 * ONLY FOR A CONNECTED SESSION, AND EVENT-DRIVEN. Two hooks run `start`:
 *   - PostToolUse on `plan_connect` (the session just connected);
 *   - SessionStart (startup / resume / clear / compact), which starts it only when ONE
 *     read of `GET /api/plans/mine` says the session is already connected.
 * An unconnected session — including every dispatched worker that never connects —
 * never gets a bridge. A running bridge exits when the dashboard says the session is
 * not connected (the ticket mint answers 409 `session_not_connected`), when its stream
 * is superseded / replaced / revoked, when its credential is refused, when Claude Code
 * exits, or on SessionEnd.
 *
 * MODES
 *   start — the hooks (async). A live bridge with a fresh heartbeat → no-op. Otherwise
 *           checks the connection, then claims the session's pid file and spawns `run`.
 *   run   — the bridge itself (spawned detached by `start`).
 *   stop  — SessionEnd hook. Terminates this session's bridge and its listen child.
 *
 * CREDENTIAL. The same source the `danx_dashboard` MCP server uses: the process
 * environment's `DANXBOT_DASHBOARD_URL` + `DANXBOT_DISPATCH_TOKEN`. No repo `.env` is
 * read. The token is only ever sent as a bearer to the dashboard; the listen child gets
 * the TICKET, in its environment (`DANX_DASHBOARD_LISTEN_TICKET`), never on its command
 * line, and never the token. Neither is ever logged or relayed.
 *
 * ONE TICKET PER SESSION. The dashboard keeps one listener per session: minting a ticket
 * ends the stream holding the previous one (`superseded`). The bridge is the only minter
 * (`plan_connect` no longer mints), so a superseded bridge has been replaced by another
 * holder and exits instead of fighting it.
 *
 * RESUME. Every event record carries its id. After relaying it, the bridge stores the
 * newest `CURSOR_ID_MEMORY` delivered ids in `<session>.cursor.json`, and passes them to
 * each new `listen` as `--resume-ids`: the highest becomes the first `Last-Event-ID` and
 * the rest keep the dashboard's commit-order overlap from relaying a duplicate. The
 * dashboard floors that replay at the session's first ticket, so a restarted bridge — a
 * new process, a re-minted ticket, a resumed session — loses nothing.
 *
 * STATE lives under `${CLAUDE_PLUGIN_DATA}/plan-event-bridge/`: `<session>.json`
 * (`{pid, sessionId, heartbeatAt}`), `<session>.cursor.json` (`{deliveredIds}`, kept
 * across SessionEnd so a resume continues; pruned after CURSOR_RETENTION_MS, the
 * dashboard's own replay retention) and `<session>.log` (no secrets).
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pinned: the bridge parses this version's output contract (`listen.ts`: ticket in
 * `DANX_DASHBOARD_LISTEN_TICKET`, `--resume-ids`, JSON Lines). DX-2784 — this must be the
 * version published WITH that contract; set it to the version the release actually
 * publishes.
 */
export const LISTEN_PACKAGE = "@thehammer/danx-dashboard-mcp@0.1.64";
const LISTEN_TICKET_ENV = "DANX_DASHBOARD_LISTEN_TICKET";

const HEARTBEAT_MS = 30_000;
const HEARTBEAT_STALE_MS = 90_000;
const PARENT_CHECK_MS = 5_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** A listen child that ran this long proved the path healthy; backoff resets. */
const HEALTHY_RUN_MS = 60_000;
const SOCKET_POST_ATTEMPTS = 3;
const LOG_MAX_BYTES = 1_000_000;
const CHECK_TIMEOUT_MS = 10_000;
/** Delivered ids kept for resume — far more than the dashboard's 30 s replay overlap can re-send. */
const CURSOR_ID_MEMORY = 100;
/** The dashboard keeps a week of events; a cursor older than that cannot resume anything. */
const CURSOR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** What every relayed line is prefixed with, so the session never mistakes it for a peer session's request. */
export const RELAY_PREFIX =
  "[danxbot dashboard event, relayed by the danxbot plugin's plan event bridge; this is not a message " +
  "from another Claude session. Someone acted on a card of the plan this session is connected to, in the " +
  "danxbot dashboard. Treat it as operator input for that card, per the danxbot:plan-workflow skill.]";

const SAFE_ARG = /^[A-Za-z0-9._~:/?=&%+@,-]+$/;

/** Listen stop reasons after which another holder owns the session's stream, or the operator silenced it. */
const FINAL_STOP_REASONS = new Set(["superseded", "replaced", "revoked"]);

function stateDir() {
  const data = process.env.CLAUDE_PLUGIN_DATA;
  if (!data) throw new Error("CLAUDE_PLUGIN_DATA is not set — the bridge only runs from the danxbot plugin's hooks");
  const dir = path.join(data, "plan-event-bridge");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeSessionFile(sessionId, ext) {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error("session id has unexpected characters");
  return path.join(stateDir(), `${sessionId}.${ext}`);
}

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Kill a process and its descendants (the listen child runs under npx/cmd). */
function killTree(pid) {
  if (!isAlive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
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
}

/** The hook's stdin JSON carries `session_id`; a hand run has none. */
async function readHookSessionId() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  const done = new Promise((resolve) => {
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", resolve);
    process.stdin.on("error", resolve);
    setTimeout(resolve, 500);
  });
  await done;
  process.stdin.pause();
  try {
    const id = JSON.parse(Buffer.concat(chunks).toString("utf8")).session_id;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

async function resolveSessionId() {
  return (await readHookSessionId()) ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
}

function dashboardBase() {
  return process.env.DANXBOT_DASHBOARD_URL.replace(/\/+$/, "");
}

/** The headers every dashboard call carries: the credential and this session's identity. */
function dashboardHeaders(sessionId) {
  return {
    Authorization: `Bearer ${process.env.DANXBOT_DISPATCH_TOKEN}`,
    Accept: "application/json",
    "x-danx-session-id": sessionId,
  };
}

/** A dashboard error body's `error` code, or null. The v2 envelope may be wrapped in `body`. */
async function errorCode(res) {
  try {
    const body = await res.json();
    return body?.error ?? body?.body?.error ?? null;
  } catch {
    return null;
  }
}

/**
 * ONE read: is this session connected to a plan? `GET /api/plans/mine` (bare — cheap
 * scalars) answers 200 when it is and 409 `session_not_connected` when it is not.
 * Returns `"connected"`, `"not_connected"`, or a string describing why it could not tell.
 */
export async function checkConnected(sessionId) {
  let res;
  try {
    res = await fetch(`${dashboardBase()}/api/plans/mine`, {
      headers: dashboardHeaders(sessionId),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch (err) {
    return `connection check failed: ${err.message}`;
  }
  if (res.ok) {
    await res.body?.cancel();
    return "connected";
  }
  const code = await errorCode(res);
  return res.status === 409 && code === "session_not_connected"
    ? "not_connected"
    : `connection check HTTP ${res.status}${code ? ` ${code}` : ""}`;
}

// ---------------------------------------------------------------- start / stop

/** Delete cursors the dashboard can no longer resume from. */
function pruneStaleCursors() {
  const dir = stateDir();
  const cutoff = Date.now() - CURSOR_RETENTION_MS;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".cursor.json")) continue;
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    } catch {
      /* raced another start */
    }
  }
}

async function start() {
  const sessionId = await resolveSessionId();
  const missing = [
    ["session id", sessionId],
    ["CLAUDE_CODE_MESSAGING_SOCKET", process.env.CLAUDE_CODE_MESSAGING_SOCKET],
    ["CLAUDE_CODE_MESSAGING_TOKEN", process.env.CLAUDE_CODE_MESSAGING_TOKEN],
    ["DANXBOT_DASHBOARD_URL", process.env.DANXBOT_DASHBOARD_URL],
    ["DANXBOT_DISPATCH_TOKEN", process.env.DANXBOT_DISPATCH_TOKEN],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    process.stderr.write(`danxbot plan event bridge not started: missing ${missing.join(", ")}\n`);
    return 0;
  }
  pruneStaleCursors();
  const file = safeSessionFile(sessionId, "json");
  const held = readJsonFile(file);
  if (held && isAlive(held.pid) && Date.now() - Date.parse(held.heartbeatAt ?? 0) < HEARTBEAT_STALE_MS) {
    return 0; // already bridged — no-op, no network
  }
  const connection = await checkConnected(sessionId);
  if (connection === "not_connected") return 0;
  if (connection !== "connected") {
    process.stderr.write(`danxbot plan event bridge not started: ${connection}\n`);
    return 0;
  }
  for (let tries = 0; tries < 2; tries += 1) {
    let fd;
    try {
      fd = fs.openSync(file, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const current = readJsonFile(file);
      const fresh = current && Date.now() - Date.parse(current.heartbeatAt ?? 0) < HEARTBEAT_STALE_MS;
      if (current && isAlive(current.pid) && fresh) return 0; // another start won the race
      if (current && isAlive(current.pid)) killTree(current.pid); // alive but silent: replace it
      fs.rmSync(file, { force: true });
      continue;
    }
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run", sessionId], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env,
    });
    fs.writeSync(fd, JSON.stringify({ pid: child.pid, sessionId, heartbeatAt: new Date().toISOString() }));
    fs.closeSync(fd);
    child.unref();
    return 0;
  }
  process.stderr.write("danxbot plan event bridge: could not claim the session pid file\n");
  return 1;
}

async function stop() {
  const sessionId = await resolveSessionId();
  if (!sessionId) return 0;
  const file = safeSessionFile(sessionId, "json");
  const held = readJsonFile(file);
  if (held && held.sessionId === sessionId) killTree(held.pid);
  fs.rmSync(file, { force: true });
  return 0;
}

// ------------------------------------------------------------------------- run

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

/** The ids a previous listener for this session delivered, oldest first. */
export function readCursor(file) {
  const ids = readJsonFile(file)?.deliveredIds;
  return Array.isArray(ids) ? ids.filter((id) => Number.isSafeInteger(id) && id > 0).slice(-CURSOR_ID_MEMORY) : [];
}

/** Record one delivered id, atomically (a crash mid-write never leaves a torn cursor). */
export function recordDelivered(file, id) {
  const ids = readCursor(file).filter((known) => known !== id);
  ids.push(id);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ deliveredIds: ids.slice(-CURSOR_ID_MEMORY) }));
  fs.renameSync(tmp, file);
}

/** The environment the listen child runs with: the ticket in, every credential it does not need out. */
export function listenEnv(ticket, env = process.env) {
  const childEnv = { ...env, [LISTEN_TICKET_ENV]: ticket };
  delete childEnv.DANXBOT_DISPATCH_TOKEN;
  delete childEnv.CLAUDE_CODE_MESSAGING_TOKEN;
  return childEnv;
}

async function run(sessionId) {
  const pidFile = safeSessionFile(sessionId, "json");
  const logFile = safeSessionFile(sessionId, "log");
  const cursorFile = safeSessionFile(sessionId, "cursor.json");
  try {
    if (fs.statSync(logFile).size > LOG_MAX_BYTES) fs.truncateSync(logFile, 0);
  } catch {
    /* no log yet */
  }
  const log = (msg) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
  const baseUrl = dashboardBase();
  const parentPid = Number(process.env.CLAUDE_PID);
  let child = null;
  let stopping = false;

  const ownsPidFile = () => readJsonFile(pidFile)?.pid === process.pid;
  const shutdown = (why) => {
    if (stopping) return;
    stopping = true;
    log(`exiting: ${why}`);
    if (child) killTree(child.pid);
    if (ownsPidFile()) fs.rmSync(pidFile, { force: true });
    process.exit(0);
  };

  // Heartbeat, and yield if another bridge claimed the session.
  setInterval(() => {
    const held = readJsonFile(pidFile);
    if (held && held.pid !== process.pid) return shutdown("another bridge owns this session");
    fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, sessionId, heartbeatAt: new Date().toISOString() }));
  }, HEARTBEAT_MS);
  fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, sessionId, heartbeatAt: new Date().toISOString() }));

  if (Number.isSafeInteger(parentPid) && parentPid > 0) {
    setInterval(() => {
      if (!isAlive(parentPid)) shutdown(`Claude Code process ${parentPid} is gone`);
    }, PARENT_CHECK_MS);
  } else {
    log("warning: CLAUDE_PID not set; relying on SessionEnd to stop");
  }

  let outbox = Promise.resolve();
  const relay = (text, id) => {
    outbox = outbox.then(async () => {
      let posted = false;
      for (let attempt = 1; attempt <= SOCKET_POST_ATTEMPTS && !posted; attempt += 1) {
        try {
          await postToInbox(relayContent(text));
          posted = true;
          log(`relayed event ${id ?? "(no id)"} (${text.length} chars)`);
        } catch (err) {
          log(`inbox post attempt ${attempt} failed: ${err.code ?? err.message}`);
          if (Number.isSafeInteger(parentPid) && parentPid > 0 && !isAlive(parentPid)) shutdown("session gone");
          await sleep(1_000 * attempt);
        }
      }
      if (!posted) log(`dropped event ${id ?? "(no id)"} after repeated inbox failures`);
      // Recorded either way: a resume must not replay into an inbox that already refused it three times.
      if (id !== null) recordDelivered(cursorFile, id);
    });
  };

  /** A ticket, or `{final: reason}` when the dashboard says this bridge must not keep trying. */
  const mintTicket = async () => {
    const res = await fetch(`${baseUrl}/api/plan-sessions/me/stream-ticket`, {
      method: "POST",
      headers: { ...dashboardHeaders(sessionId), "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) {
      const code = await errorCode(res);
      if (res.status === 409 && code === "session_not_connected") return { final: "the session is not connected to a plan" };
      if (res.status === 401 || res.status === 403) return { final: `the dashboard refused the credential (HTTP ${res.status})` };
      throw new Error(`stream-ticket mint HTTP ${res.status}${code ? ` ${code}` : ""}`);
    }
    const body = await res.json();
    const view = typeof body?.ticket === "string" ? body : body?.body;
    if (typeof view?.ticket !== "string" || typeof view?.streamPath !== "string" || !Number.isSafeInteger(view?.leaseMs)) {
      throw new Error("stream-ticket mint returned an unexpected shape");
    }
    return { ticket: view.ticket, streamUrl: `${baseUrl}${view.streamPath}`, leaseMs: view.leaseMs };
  };

  /** Runs one listen child to its end. Resolves with the stop reason it reported, or null. */
  const runListenOnce = ({ ticket, streamUrl, leaseMs }) =>
    new Promise((resolve) => {
      const resumeIds = readCursor(cursorFile);
      const args = ["-y", LISTEN_PACKAGE, "listen", "--stream", streamUrl, "--lease-ms", String(leaseMs)];
      if (resumeIds.length > 0) args.push("--resume-ids", resumeIds.join(","));
      if (!args.every((arg) => SAFE_ARG.test(arg))) {
        resolve({ reason: null, detail: "the stream url has characters unsafe to pass to the listen command" });
        return;
      }
      const env = listenEnv(ticket);
      // npx is a .cmd shim on Windows, which Node only spawns through a shell. Every arg
      // was checked against SAFE_ARG above, so the joined command line cannot be split.
      child =
        process.platform === "win32"
          ? spawn(["npx", ...args].join(" "), { shell: true, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] })
          : spawn("npx", args, { detached: true, env, stdio: ["ignore", "pipe", "pipe"] });
      log(`listen started${resumeIds.length > 0 ? `, resuming after event ${Math.max(...resumeIds)}` : ""}`);
      let stopped = { reason: null, detail: "listen exited without a stop record" };
      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        let nl = buffer.indexOf("\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (line === "") continue;
          let record;
          try {
            record = JSON.parse(line);
          } catch {
            log(`unexpected non-JSON listen output (${line.length} chars) — not relayed`);
            continue;
          }
          if (record?.type === "event" && typeof record.text === "string") {
            relay(record.text, Number.isSafeInteger(record.id) ? record.id : null);
          } else if (record?.type === "stopped" && typeof record.reason === "string") {
            stopped = { reason: record.reason, detail: String(record.detail ?? "") };
          } else {
            log("unexpected listen record — not relayed");
          }
        }
      });
      child.stderr.on("data", () => {
        /* npx progress / usage noise; the stop record and exit code carry the outcome */
      });
      child.on("error", (err) => resolve({ reason: null, detail: err.message }));
      child.on("close", (code) => resolve({ ...stopped, detail: `${stopped.detail} (exit ${code})` }));
    });

  log(`bridge started for session ${sessionId} (pid ${process.pid})`);
  let backoff = INITIAL_BACKOFF_MS;
  for (;;) {
    const startedAt = Date.now();
    try {
      const minted = await mintTicket();
      if (minted.final) return shutdown(minted.final);
      log("listener ticket minted");
      const outcome = await runListenOnce(minted);
      child = null;
      log(`listen stopped: ${outcome.reason ?? "no reason"} — ${outcome.detail}`);
      await outbox;
      if (FINAL_STOP_REASONS.has(outcome.reason)) return shutdown(`the dashboard ended this session's stream (${outcome.reason})`);
    } catch (err) {
      log(`ticket/listen failure: ${err.message}`);
    }
    if (stopping) return;
    backoff = Date.now() - startedAt >= HEALTHY_RUN_MS ? INITIAL_BACKOFF_MS : Math.min(MAX_BACKOFF_MS, backoff * 2);
    await sleep(backoff);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------------------ main

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [mode, arg] = process.argv.slice(2);
  const main = { start, stop, run: () => run(arg) }[mode];
  if (!main) {
    process.stderr.write("usage: plan-event-bridge.mjs start|stop|run <session-id>\n");
    process.exit(2);
  }
  Promise.resolve(main()).then(
    (code) => {
      if (mode !== "run") process.exit(code ?? 0);
    },
    (err) => {
      process.stderr.write(`danxbot plan event bridge ${mode} failed: ${err.message}\n`);
      process.exit(1);
    },
  );
}
