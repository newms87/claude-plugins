#!/usr/bin/env node
/**
 * danxbot plan event bridge (DX-2784) — always-on delivery of dashboard plan events
 * into the running Claude Code session.
 *
 * WHY. Operators answer questions and comment on the cards of a danxbot Plan in the
 * dashboard. The session working that plan must hear each event at once. The
 * dashboard already streams them (`GET /api/plan-sessions/stream`, ticket-authed,
 * filtered server-side to cards of the plan the session is connected to, excluding the
 * session's own writes), and `@thehammer/danx-dashboard-mcp listen` already turns that
 * stream into one line per event with reconnect + dedupe. What was missing is a
 * process that lives as long as the session: Monitor stops after 30 minutes, plugin
 * `monitors/` are skipped without a TTY (Desktop), and MCP channels need a launch flag.
 * This bridge is that process. It relays each line into the session's own inbox socket
 * (`CLAUDE_CODE_MESSAGING_SOCKET`), which starts a turn in an idle session.
 *
 * MODES
 *   start — SessionStart hook (async). Ensures exactly one bridge per session id, then
 *           exits. A live bridge with a fresh heartbeat → no-op. A stale pid file (dead
 *           pid, or no heartbeat for HEARTBEAT_STALE_MS) is replaced.
 *   run   — the bridge itself (spawned detached by `start`).
 *   stop  — SessionEnd hook. Terminates this session's bridge and its listen child.
 *
 * CREDENTIAL. The same source the `danx_dashboard` MCP server uses: the process
 * environment's `DANXBOT_DASHBOARD_URL` + `DANXBOT_DISPATCH_TOKEN` (set by the user's
 * Claude Code `settings.json` `env` block, which Claude Code exports to MCP servers and
 * hooks alike). No repo `.env` is read. The token is only ever sent as the ticket-mint
 * bearer; neither it nor the ticket is ever logged or relayed.
 *
 * THE TICKET SUPERSEDE RULE. The dashboard keeps ONE listener per session: minting a
 * ticket ends the stream holding the previous one (`superseded`). `plan_connect` mints
 * one too, so every `plan_connect` ends the bridge's listen child; the bridge re-mints
 * and resumes within about a second. That is also how it follows a plan move — though
 * the stream resolves plan membership per event anyway.
 *
 * STATE lives under `${CLAUDE_PLUGIN_DATA}/plan-event-bridge/`: `<session>.json`
 * (`{pid, sessionId, heartbeatAt}`) and `<session>.log` (no secrets).
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Pinned: the bridge parses this version's output contract (`listen.ts`). */
export const LISTEN_PACKAGE = "@thehammer/danx-dashboard-mcp@0.1.63";
const LISTEN_PREFIX = "[danx-dashboard listen]";

const HEARTBEAT_MS = 30_000;
const HEARTBEAT_STALE_MS = 90_000;
const PARENT_CHECK_MS = 5_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** A listen child that ran this long proved the path healthy; backoff resets. */
const HEALTHY_RUN_MS = 60_000;
const SOCKET_POST_ATTEMPTS = 3;
const LOG_MAX_BYTES = 1_000_000;

/** What every relayed line is prefixed with, so the session never mistakes it for a peer session's request. */
export const RELAY_PREFIX =
  "[danxbot dashboard event, relayed by the danxbot plugin's plan event bridge; this is not a message " +
  "from another Claude session. Someone acted on a card of the plan this session is connected to, in the " +
  "danxbot dashboard. Treat it as operator input for that card, per the danxbot:plan-workflow skill.]";

const SAFE_ARG = /^[A-Za-z0-9._~:/?=&%+@-]+$/;

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

function readPidFile(file) {
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

// ---------------------------------------------------------------- start / stop

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
  const file = safeSessionFile(sessionId, "json");
  for (let tries = 0; tries < 2; tries += 1) {
    let fd;
    try {
      fd = fs.openSync(file, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const held = readPidFile(file);
      const fresh = held && Date.now() - Date.parse(held.heartbeatAt ?? 0) < HEARTBEAT_STALE_MS;
      if (held && isAlive(held.pid) && fresh) return 0; // already bridged — no-op
      if (held && isAlive(held.pid)) killTree(held.pid); // alive but silent: replace it
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
  const held = readPidFile(file);
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

export function relayContent(line) {
  return `${RELAY_PREFIX}\n${line}`;
}

async function run(sessionId) {
  const pidFile = safeSessionFile(sessionId, "json");
  const logFile = safeSessionFile(sessionId, "log");
  try {
    if (fs.statSync(logFile).size > LOG_MAX_BYTES) fs.truncateSync(logFile, 0);
  } catch {
    /* no log yet */
  }
  const log = (msg) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
  const baseUrl = process.env.DANXBOT_DASHBOARD_URL.replace(/\/+$/, "");
  const parentPid = Number(process.env.CLAUDE_PID);
  let child = null;
  let stopping = false;

  const ownsPidFile = () => readPidFile(pidFile)?.pid === process.pid;
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
    const held = readPidFile(pidFile);
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
  const relay = (line) => {
    outbox = outbox.then(async () => {
      for (let attempt = 1; attempt <= SOCKET_POST_ATTEMPTS; attempt += 1) {
        try {
          await postToInbox(relayContent(line));
          log(`relayed event line (${line.length} chars)`);
          return;
        } catch (err) {
          log(`inbox post attempt ${attempt} failed: ${err.code ?? err.message}`);
          if (Number.isSafeInteger(parentPid) && parentPid > 0 && !isAlive(parentPid)) shutdown("session gone");
          await sleep(1_000 * attempt);
        }
      }
      log("dropped one event line after repeated inbox failures");
    });
  };

  const mintTicket = async () => {
    const res = await fetch(`${baseUrl}/api/plan-sessions/me/stream-ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DANXBOT_DISPATCH_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-danx-session-id": sessionId,
      },
      body: "{}",
    });
    if (!res.ok) throw new Error(`stream-ticket mint HTTP ${res.status}`);
    const body = await res.json();
    const view = typeof body?.ticket === "string" ? body : body?.body;
    if (typeof view?.ticket !== "string" || typeof view?.streamPath !== "string" || !Number.isSafeInteger(view?.leaseMs)) {
      throw new Error("stream-ticket mint returned an unexpected shape");
    }
    return { ticket: view.ticket, streamUrl: `${baseUrl}${view.streamPath}`, leaseMs: view.leaseMs };
  };

  const runListenOnce = ({ ticket, streamUrl, leaseMs }) =>
    new Promise((resolve) => {
      if (!SAFE_ARG.test(ticket) || !SAFE_ARG.test(streamUrl)) {
        resolve({ code: -1, reason: "ticket or stream url has characters unsafe to pass to the listen command" });
        return;
      }
      const args = ["-y", LISTEN_PACKAGE, "listen", "--stream", streamUrl, "--ticket", ticket, "--lease-ms", String(leaseMs)];
      // npx is a .cmd shim on Windows, which Node only spawns through a shell. Every arg
      // was checked against SAFE_ARG above, so the joined command line cannot be split.
      child =
        process.platform === "win32"
          ? spawn(["npx", ...args].join(" "), { shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
          : spawn("npx", args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
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
          if (line.startsWith(LISTEN_PREFIX) && !line.startsWith(`${LISTEN_PREFIX} could not read event`)) {
            // A final line (stopped / gave up) tells an agent to re-arm; the bridge re-arms itself.
            log(`listen final line: ${line.slice(LISTEN_PREFIX.length, LISTEN_PREFIX.length + 120).trim()}`);
            continue;
          }
          relay(line);
        }
      });
      child.stderr.on("data", () => {
        /* npx progress / usage noise; exit code carries the outcome */
      });
      child.on("error", (err) => resolve({ code: -1, reason: err.message }));
      child.on("close", (code) => resolve({ code, reason: "exited" }));
    });

  log(`bridge started for session ${sessionId} (pid ${process.pid})`);
  let backoff = INITIAL_BACKOFF_MS;
  for (;;) {
    const startedAt = Date.now();
    try {
      const ticket = await mintTicket();
      log("listener ticket minted; starting listen");
      const outcome = await runListenOnce(ticket);
      child = null;
      log(`listen ended (code ${outcome.code}, ${outcome.reason})`);
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
