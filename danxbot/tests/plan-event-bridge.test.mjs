// danxbot plan event bridge (DX-2784) — lifecycle, cursor, relay and supervision.
// Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as bridge from "../scripts/plan-event-bridge.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SESSION = "11111111-2222-4333-8444-555555555555";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "peb-test-"));
}

function env(dataDir, overrides = {}) {
  return {
    CLAUDE_PLUGIN_DATA: dataDir,
    CLAUDE_CODE_MESSAGING_SOCKET: "socket-path",
    CLAUDE_CODE_MESSAGING_TOKEN: "inbox-secret",
    DANXBOT_DASHBOARD_URL: "https://dash.example",
    DANXBOT_DISPATCH_TOKEN: "dispatch-secret",
    ...overrides,
  };
}

function pathsFor(dataDir) {
  return bridge.sessionPaths(bridge.stateDir({ CLAUDE_PLUGIN_DATA: dataDir }), SESSION);
}

function writePid(dataDir, record) {
  fs.writeFileSync(pathsFor(dataDir).pid, JSON.stringify(record));
}

const noSleep = async () => {};

// ------------------------------------------------------------- 1. single instance

describe("single-instance lock", () => {
  test("the lock is exclusive until released", () => {
    const lock = pathsFor(tmpDir()).lock;
    assert.equal(bridge.acquireLock(lock), true);
    assert.equal(bridge.acquireLock(lock), false);
    fs.rmSync(lock);
    assert.equal(bridge.acquireLock(lock), true);
  });

  test("a start sees the lock held and does nothing", () => {
    const dataDir = tmpDir();
    fs.writeFileSync(pathsFor(dataDir).lock, "");
    let spawned = 0;
    const result = bridge.start({ env: env(dataDir), sessionId: SESSION, spawnRun: () => ({ pid: ++spawned }), stderr: () => {} });
    assert.deepEqual(result, { started: false, reason: "another start holds the lock" });
    assert.equal(spawned, 0);
  });

  test("concurrent starts in separate processes spawn exactly one bridge", async () => {
    const dataDir = tmpDir();
    const spawnLog = path.join(dataDir, "spawns.txt");
    fs.writeFileSync(spawnLog, "");
    const contenders = Array.from({ length: 6 }, () =>
      spawn(process.execPath, [path.join(here, "fixtures", "start-race.mjs")], {
        env: {
          ...process.env,
          ...env(dataDir),
          RACE_SESSION: SESSION,
          RACE_FAKE_PID: String(process.pid),
          RACE_SPAWN_LOG: spawnLog,
          RACE_HOLD_MS: "700",
        },
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
    const results = await Promise.all(
      contenders.map(async (child) => {
        let out = "";
        child.stdout.on("data", (chunk) => (out += chunk));
        await once(child, "close");
        return JSON.parse(out);
      }),
    );
    const spawns = fs.readFileSync(spawnLog, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(spawns.length, 1, `expected one spawn, got ${spawns.length}: ${JSON.stringify(results)}`);
    assert.equal(results.filter((r) => r.started).length, 1);
    assert.equal(fs.existsSync(pathsFor(dataDir).lock), false, "the lock is released");
  });

  test("a lock left by a crashed start is taken over once it is stale", () => {
    const lock = pathsFor(tmpDir()).lock;
    fs.writeFileSync(lock, "");
    const old = new Date(Date.now() - bridge.LOCK_STALE_MS - 5_000);
    fs.utimesSync(lock, old, old);
    assert.equal(bridge.acquireLock(lock), true);
  });
});

// ------------------------------------------------------------- 2. stale takeover

describe("stale holder takeover", () => {
  const startWith = (dataDir, alivePids) => {
    const spawned = [];
    const result = bridge.start({
      env: env(dataDir),
      sessionId: SESSION,
      isAlive: (pid) => alivePids.includes(pid),
      spawnRun: () => {
        spawned.push(7777);
        return { pid: 7777 };
      },
      stderr: () => {},
    });
    return { result, spawned };
  };

  test("a live holder with a fresh heartbeat is left alone", () => {
    const dataDir = tmpDir();
    writePid(dataDir, bridge.pidRecord(4242, SESSION));
    const { result, spawned } = startWith(dataDir, [4242]);
    assert.deepEqual(result, { started: false, reason: "already bridged" });
    assert.deepEqual(spawned, []);
  });

  test("a dead holder is taken over, even with a fresh heartbeat", () => {
    const dataDir = tmpDir();
    writePid(dataDir, bridge.pidRecord(4242, SESSION));
    const { result, spawned } = startWith(dataDir, []);
    assert.deepEqual(result, { started: true, pid: 7777 });
    assert.deepEqual(spawned, [7777]);
    assert.equal(bridge.readJsonFile(pathsFor(dataDir).pid).pid, 7777);
  });

  test("a live holder whose heartbeat is stale is taken over", () => {
    const dataDir = tmpDir();
    writePid(dataDir, bridge.pidRecord(4242, SESSION, Date.now() - bridge.HEARTBEAT_STALE_MS - 1_000));
    const { result, spawned } = startWith(dataDir, [4242]);
    assert.deepEqual(result, { started: true, pid: 7777 });
    assert.deepEqual(spawned, [7777]);
    assert.equal(bridge.readJsonFile(pathsFor(dataDir).pid).pid, 7777);
  });

  test("isFreshHolder needs both a live pid and a recent heartbeat", () => {
    const now = Date.now();
    const alive = () => true;
    assert.equal(bridge.isFreshHolder(bridge.pidRecord(1, SESSION, now), { isAlive: alive, now }), true);
    assert.equal(bridge.isFreshHolder(bridge.pidRecord(1, SESSION, now), { isAlive: () => false, now }), false);
    assert.equal(bridge.isFreshHolder(bridge.pidRecord(1, SESSION, now - bridge.HEARTBEAT_STALE_MS - 1), { isAlive: alive, now }), false);
    assert.equal(bridge.isFreshHolder({ pid: 1 }, { isAlive: alive, now }), false);
    assert.equal(bridge.isFreshHolder(null, { isAlive: alive, now }), false);
  });

  test("stop signals a live heartbeating holder, never a stale pid, and always removes the pid file", () => {
    const dataDir = tmpDir();
    const killed = [];
    writePid(dataDir, bridge.pidRecord(4242, SESSION));
    bridge.stop({ env: env(dataDir), sessionId: SESSION, isAlive: () => true, killTree: (pid) => killed.push(pid) });
    assert.deepEqual(killed, [4242]);
    assert.equal(fs.existsSync(pathsFor(dataDir).pid), false);

    writePid(dataDir, bridge.pidRecord(4343, SESSION, Date.now() - bridge.HEARTBEAT_STALE_MS - 1_000));
    bridge.stop({ env: env(dataDir), sessionId: SESSION, isAlive: () => true, killTree: (pid) => killed.push(pid) });
    assert.deepEqual(killed, [4242]);
    assert.equal(fs.existsSync(pathsFor(dataDir).pid), false);
  });
});

// ----------------------------------------------------------------- 3. run yields

describe("heartbeat", () => {
  test("yields when the pid file names another bridge, and does not overwrite it", () => {
    const dataDir = tmpDir();
    const paths = pathsFor(dataDir);
    writePid(dataDir, bridge.pidRecord(9999, SESSION));
    const reasons = [];
    const ok = bridge.heartbeatTick({ paths, selfPid: 1234, sessionId: SESSION, shutdown: (why) => reasons.push(why) });
    assert.equal(ok, false);
    assert.deepEqual(reasons, ["another bridge owns this session"]);
    assert.equal(bridge.readJsonFile(paths.pid).pid, 9999);
  });

  test("refreshes its own record atomically when the pid file names itself", () => {
    const dataDir = tmpDir();
    const paths = pathsFor(dataDir);
    writePid(dataDir, bridge.pidRecord(1234, SESSION, 0));
    const reasons = [];
    const now = Date.parse("2026-09-15T05:00:00.000Z");
    assert.equal(bridge.heartbeatTick({ paths, selfPid: 1234, sessionId: SESSION, now, shutdown: (why) => reasons.push(why) }), true);
    assert.deepEqual(reasons, []);
    assert.deepEqual(bridge.readJsonFile(paths.pid), { pid: 1234, sessionId: SESSION, heartbeatAt: "2026-09-15T05:00:00.000Z" });
    assert.deepEqual(fs.readdirSync(path.dirname(paths.pid)).filter((n) => n.endsWith(".tmp")), []);
  });
});

// ---------------------------------------------------- 4. terminal vs retry exits

/** A fake subcommand: writes stdout/stderr chunks, then closes with `code`. */
function fakeChild({ stdout = [], stderr = "", code = 0 } = {}) {
  const child = new EventEmitter();
  child.pid = 5150;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  setImmediate(async () => {
    for (const chunk of stdout) child.stdout.write(chunk);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    await Promise.all([once(child.stdout, "end"), once(child.stderr, "end")]);
    child.emit("close", code);
  });
  return child;
}

const recordLine = (record) => `${JSON.stringify(record)}\n`;

function spyRelay() {
  const pushed = [];
  return { pushed, relay: { push: (event) => pushed.push(event) } };
}

describe("subcommand exit handling", () => {
  test("any stop record is terminal, whatever the reason", () => {
    for (const reason of ["not_connected", "unauthorized", "mint_refused", "mint_bad_response", "superseded", "replaced", "revoked", "refused"]) {
      assert.deepEqual(bridge.classifyChildExit({ stopped: { reason, detail: "d" }, code: 1, ranMs: 10 * 60_000 }), {
        action: "exit",
        reason: `${reason}: d`,
      });
    }
  });

  test("a quick death without a stop record is terminal; one after a healthy run is restarted", () => {
    assert.equal(bridge.classifyChildExit({ stopped: null, code: 1, ranMs: 500 }).action, "exit");
    assert.match(bridge.classifyChildExit({ stopped: null, code: 1, ranMs: 500 }).reason, /^bridge_failed/);
    assert.equal(bridge.classifyChildExit({ stopped: null, code: null, ranMs: bridge.HEALTHY_RUN_MS }).action, "restart");
  });

  test("supervision restarts after a healthy crash and exits on the next stop record", async () => {
    let clock = 0;
    const spawns = [];
    const logs = [];
    const { relay } = spyRelay();
    const reason = await bridge.superviseBridge({
      spawnChild: () => {
        spawns.push(clock);
        if (spawns.length === 1) {
          clock += bridge.HEALTHY_RUN_MS + 1_000;
          return fakeChild({ code: null });
        }
        return fakeChild({ stdout: [recordLine({ type: "stopped", reason: "not_connected", detail: "the session is not connected to a plan" })], code: 1 });
      },
      relay,
      log: (m) => logs.push(m),
      now: () => clock,
      sleep: noSleep,
    });
    assert.equal(reason, "not_connected: the session is not connected to a plan");
    assert.equal(spawns.length, 2);
    assert.ok(logs.some((m) => m.startsWith("restarting the bridge subcommand")));
  });

  test("an npx E404 is a terminal reason with its stderr tail logged, never a retry loop, and the token is redacted", async () => {
    const logs = [];
    let spawns = 0;
    const { relay } = spyRelay();
    const reason = await bridge.superviseBridge({
      spawnChild: () => {
        spawns += 1;
        return fakeChild({ stderr: `npm error code E404\nnpm error 404 Not Found - dispatch-secret\n`, code: 1 });
      },
      relay,
      log: (m) => logs.push(m),
      now: () => 0,
      sleep: noSleep,
      redact: (text) => text.split("dispatch-secret").join("[redacted]"),
    });
    assert.match(reason, /^bridge_failed: .*code 1/);
    assert.equal(spawns, 1);
    const tail = logs.find((m) => m.startsWith("bridge subcommand stderr (tail): "));
    assert.match(tail, /E404/);
    assert.doesNotMatch(tail, /dispatch-secret/);
  });

  test("a stderr tail is capped", async () => {
    const logs = [];
    await bridge.superviseBridge({
      spawnChild: () => fakeChild({ stderr: "x".repeat(bridge.STDERR_TAIL_CHARS * 3), code: 1 }),
      relay: spyRelay().relay,
      log: (m) => logs.push(m),
      now: () => 0,
      sleep: noSleep,
    });
    const tail = logs.find((m) => m.startsWith("bridge subcommand stderr (tail): "));
    assert.equal(tail.length, "bridge subcommand stderr (tail): ".length + bridge.STDERR_TAIL_CHARS);
  });

  test("a spawn that throws (npx not found) is terminal", async () => {
    const reason = await bridge.superviseBridge({
      spawnChild: () => {
        throw new Error("npx not found: expected X next to Y");
      },
      relay: spyRelay().relay,
      log: () => {},
      now: () => 0,
      sleep: noSleep,
    });
    assert.equal(reason, "bridge_failed: npx not found: expected X next to Y");
  });
});

// -------------------------------------------------------------------- 5. cursor

describe("cursor", () => {
  test("drops ids that are not positive integers and keeps only the newest CURSOR_ID_MEMORY", () => {
    const file = pathsFor(tmpDir()).cursor;
    const many = Array.from({ length: bridge.CURSOR_ID_MEMORY + 50 }, (_, i) => i + 1);
    fs.writeFileSync(file, JSON.stringify({ deliveredIds: [0, -1, "7", 1.5, null, ...many] }));
    const ids = bridge.readCursor(file);
    assert.equal(ids.length, bridge.CURSOR_ID_MEMORY);
    assert.equal(ids[0], 51);
    assert.equal(ids.at(-1), bridge.CURSOR_ID_MEMORY + 50);
  });

  test("an unreadable or missing cursor is empty", () => {
    const file = pathsFor(tmpDir()).cursor;
    assert.deepEqual(bridge.readCursor(file), []);
    fs.writeFileSync(file, "{torn");
    assert.deepEqual(bridge.readCursor(file), []);
  });

  test("records dedupe (a re-recorded id moves to newest) and stay capped", () => {
    const file = pathsFor(tmpDir()).cursor;
    for (let id = 1; id <= bridge.CURSOR_ID_MEMORY + 5; id += 1) bridge.recordDelivered(file, id);
    bridge.recordDelivered(file, 50);
    const ids = bridge.readCursor(file);
    assert.equal(ids.length, bridge.CURSOR_ID_MEMORY);
    assert.equal(ids.filter((id) => id === 50).length, 1);
    assert.equal(ids.at(-1), 50);
    // 1..105 keeps 6..105; re-recording 50 moves it rather than adding one, so 6 is still the oldest.
    assert.equal(ids[0], 6);
  });

  test("a record is written to a temp file and renamed into place", () => {
    const file = pathsFor(tmpDir()).cursor;
    const writes = [];
    const renames = [];
    const realWrite = fs.writeFileSync;
    const realRename = fs.renameSync;
    fs.writeFileSync = (target, ...rest) => {
      writes.push(String(target));
      return realWrite(target, ...rest);
    };
    fs.renameSync = (from, to) => {
      renames.push([String(from), String(to)]);
      return realRename(from, to);
    };
    try {
      bridge.recordDelivered(file, 3);
    } finally {
      fs.writeFileSync = realWrite;
      fs.renameSync = realRename;
    }
    assert.equal(writes.includes(file), false, "never written in place");
    assert.deepEqual(renames.map(([, to]) => to), [file]);
    assert.equal(renames[0][0], writes[0]);
    assert.deepEqual(bridge.readCursor(file), [3]);
  });

  test("--resume-ids is built from the cursor, and absent when it is empty", () => {
    const posix = { platform: "linux" };
    assert.deepEqual(bridge.bridgeCommand({ resumeIds: [], ...posix }), {
      command: "npx",
      args: ["-y", bridge.DASHBOARD_MCP_PACKAGE, "bridge"],
    });
    const file = pathsFor(tmpDir()).cursor;
    bridge.recordDelivered(file, 41);
    bridge.recordDelivered(file, 42);
    assert.deepEqual(bridge.bridgeCommand({ resumeIds: bridge.readCursor(file), ...posix }).args.slice(-2), ["--resume-ids", "41,42"]);
  });
});

// ---------------------------------------------------------- 6. env and command

describe("subcommand environment and command", () => {
  test("the child env carries the dashboard credential and session, not the inbox token or socket", () => {
    const child = bridge.childEnv(env("/data", { PATH: "/bin" }), SESSION);
    assert.equal(child.DANXBOT_DISPATCH_TOKEN, "dispatch-secret");
    assert.equal(child.DANXBOT_DASHBOARD_URL, "https://dash.example");
    assert.equal(child.CLAUDE_CODE_SESSION_ID, SESSION);
    assert.equal(child.PATH, "/bin");
    assert.equal("CLAUDE_CODE_MESSAGING_TOKEN" in child, false);
    assert.equal("CLAUDE_CODE_MESSAGING_SOCKET" in child, false);
  });

  test("no secret ever appears in the command's arguments", () => {
    const secrets = ["dispatch-secret", "inbox-secret"];
    for (const platform of ["linux", "win32"]) {
      const { command, args } = bridge.bridgeCommand({ resumeIds: [1, 2], platform, execPath: "C:\\node\\node.exe", exists: () => true });
      const joined = [command, ...args].join(" ");
      for (const secret of secrets) assert.equal(joined.includes(secret), false);
    }
  });

  test("on Windows the subcommand runs through node and npm's JS entry, never a shell; a missing entry is an error", () => {
    const execPath = path.join("C:", "nodejs", "node.exe");
    const npxCli = path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npx-cli.js");
    assert.deepEqual(bridge.bridgeCommand({ resumeIds: [9], platform: "win32", execPath, exists: (p) => p === npxCli }), {
      command: execPath,
      args: [npxCli, "-y", bridge.DASHBOARD_MCP_PACKAGE, "bridge", "--resume-ids", "9"],
    });
    assert.throws(() => bridge.bridgeCommand({ resumeIds: [], platform: "win32", execPath, exists: () => false }), /npx not found/);
  });
});

// ---------------------------------------------------------------- 7. inbox post

test("postToInbox sends the auth frame then the user message, one JSON object per line", async () => {
  const address =
    process.platform === "win32"
      ? `\\\\.\\pipe\\peb-test-${process.pid}-${Date.now()}`
      : path.join(tmpDir(), "inbox.sock");
  let received = "";
  const server = net.createServer((sock) => {
    sock.setEncoding("utf8");
    sock.on("data", (chunk) => (received += chunk));
  });
  await new Promise((resolve) => server.listen(address, resolve));
  try {
    await bridge.postToInbox("hello from the bridge", { CLAUDE_CODE_MESSAGING_SOCKET: address, CLAUDE_CODE_MESSAGING_TOKEN: "inbox-secret" });
  } finally {
    server.close();
  }
  const lines = received.split("\n");
  assert.equal(lines.at(-1), "");
  assert.deepEqual(lines.slice(0, -1).map((line) => JSON.parse(line)), [
    { type: "auth", token: "inbox-secret" },
    { type: "user", message: { role: "user", content: "hello from the bridge" } },
  ]);
});

// ------------------------------------------------------------ 8. output parsing

describe("output parsing", () => {
  test("lines are reassembled across arbitrary chunk splits and CRLF", () => {
    const lines = [];
    const feed = bridge.createLineSplitter((line) => lines.push(line));
    feed('{"type":"ev');
    feed('ent","id":1,"text":"a"}\r\n{"type":"event","id":2,');
    feed('"text":"b"}\n\n');
    feed('{"partial":');
    assert.deepEqual(lines, ['{"type":"event","id":1,"text":"a"}', '{"type":"event","id":2,"text":"b"}']);
  });

  test("records are classified; non-JSON and unknown shapes are junk", () => {
    assert.deepEqual(bridge.parseRecord('{"type":"event","id":3,"text":"t"}'), { kind: "event", id: 3, text: "t" });
    assert.deepEqual(bridge.parseRecord('{"type":"event","id":null,"text":"t"}'), { kind: "event", id: null, text: "t" });
    assert.deepEqual(bridge.parseRecord('{"type":"event","id":0,"text":"t"}'), { kind: "event", id: null, text: "t" });
    assert.deepEqual(bridge.parseRecord('{"type":"stopped","reason":"revoked","detail":"d"}'), { kind: "stopped", reason: "revoked", detail: "d" });
    assert.deepEqual(bridge.parseRecord("npm warn exec something"), { kind: "junk" });
    assert.deepEqual(bridge.parseRecord('{"type":"event","id":3}'), { kind: "junk" });
  });

  test("supervision relays events in order, ignores junk, and hands an id-less event on with id null", async () => {
    const { pushed, relay } = spyRelay();
    const logs = [];
    await bridge.superviseBridge({
      spawnChild: () =>
        fakeChild({
          stdout: [
            '{"type":"event","id":1,"te',
            'xt":"one"}\nnot json\n',
            recordLine({ type: "event", id: null, text: "no id" }),
            recordLine({ type: "stopped", reason: "superseded", detail: "d" }),
          ],
        }),
      relay,
      log: (m) => logs.push(m),
      now: () => 0,
      sleep: noSleep,
    });
    assert.deepEqual(pushed, [
      { id: 1, text: "one" },
      { id: null, text: "no id" },
    ]);
    assert.ok(logs.some((m) => m.startsWith("ignored non-record output")));
  });

  test("an id-less event is relayed but never recorded", async () => {
    const posted = [];
    const recorded = [];
    const queue = bridge.createRelayQueue({
      post: async (content) => posted.push(content),
      record: (id) => recorded.push(id),
      log: () => {},
      sleep: noSleep,
    });
    queue.push({ id: null, text: "no id" });
    queue.push({ id: 8, text: "eight" });
    await queue.idle();
    assert.deepEqual(posted, [bridge.relayContent("no id"), bridge.relayContent("eight")]);
    assert.deepEqual(recorded, [8]);
  });
});

// --------------------------------------------------------- 9. failed post

describe("delivery failures", () => {
  test("an event whose post fails is NOT recorded, holds later events, is logged loudly, and is redelivered", async () => {
    const posted = [];
    const recorded = [];
    const logs = [];
    let failuresLeft = bridge.SOCKET_POST_ATTEMPTS;
    const queue = bridge.createRelayQueue({
      post: async (content) => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          assert.deepEqual(recorded, [], "nothing is recorded while the head is failing");
          throw Object.assign(new Error("pipe closed"), { code: "EPIPE" });
        }
        posted.push(content);
      },
      record: (id) => recorded.push(id),
      log: (m) => logs.push(m),
      sleep: noSleep,
    });
    queue.push({ id: 1, text: "one" });
    queue.push({ id: 2, text: "two" });
    await queue.idle();
    assert.ok(logs.some((m) => /^INBOX POST FAILED for event 1 after 3 attempts \(EPIPE\); NOT recorded — holding it and 1 later event/.test(m)));
    assert.deepEqual(posted, [bridge.relayContent("one"), bridge.relayContent("two")]);
    assert.deepEqual(recorded, [1, 2]);
  });

  test("a bridge that stops while the head keeps failing leaves the event unrecorded for the next bridge", async () => {
    const recorded = [];
    let stopped = false;
    const queue = bridge.createRelayQueue({
      post: async () => {
        throw new Error("no inbox");
      },
      record: (id) => recorded.push(id),
      log: () => {},
      sleep: async () => {
        stopped = true;
      },
      isStopped: () => stopped,
    });
    queue.push({ id: 5, text: "five" });
    await queue.idle();
    assert.deepEqual(recorded, []);
    assert.equal(queue.pending(), 1);
  });
});

// ---------------------------------------------------------- 10. start gate

describe("start gate", () => {
  test("missing environment or session id starts nothing", () => {
    for (const [label, overrides, sessionId] of [
      ["no inbox socket", { CLAUDE_CODE_MESSAGING_SOCKET: "" }, SESSION],
      ["no dispatch token", { DANXBOT_DISPATCH_TOKEN: undefined }, SESSION],
      ["no dashboard url", { DANXBOT_DASHBOARD_URL: "" }, SESSION],
      ["no session id", {}, undefined],
    ]) {
      let spawned = 0;
      const errors = [];
      const result = bridge.start({
        env: env(tmpDir(), overrides),
        sessionId,
        spawnRun: () => ({ pid: ++spawned }),
        stderr: (m) => errors.push(m),
      });
      assert.equal(result.started, false, label);
      assert.equal(spawned, 0, label);
      assert.match(errors.join(""), /not started: missing/, label);
    }
  });

  test("a missing or odd session id is never turned into a state path", () => {
    assert.throws(() => bridge.sessionPaths("/data", undefined), /session id is missing/);
    assert.throws(() => bridge.sessionPaths("/data", "../escape"), /unexpected characters/);
  });

  test("a session that is not connected ends the bridge on the first stop record, without a restart", async () => {
    let spawns = 0;
    const reason = await bridge.superviseBridge({
      spawnChild: () => {
        spawns += 1;
        return fakeChild({ stdout: [recordLine({ type: "stopped", reason: "not_connected", detail: "the session is not connected to a plan" })], code: 1 });
      },
      relay: spyRelay().relay,
      log: () => {},
      now: () => 0,
      sleep: noSleep,
    });
    assert.equal(reason, "not_connected: the session is not connected to a plan");
    assert.equal(spawns, 1);
  });
});

// --------------------------------------------------------------- pruning

test("stale state files are pruned; fresh ones and other files are kept", () => {
  const dataDir = tmpDir();
  const dir = bridge.stateDir({ CLAUDE_PLUGIN_DATA: dataDir });
  const old = new Date(Date.now() - bridge.STALE_STATE_MS - 60_000);
  const oldFiles = ["a.log", "a.pid.json", "a.cursor.json", "a.lock", "a.pid.json.1.2.tmp"];
  const freshFiles = ["b.log", "b.pid.json", "b.cursor.json"];
  for (const name of [...oldFiles, ...freshFiles, "notes.txt"]) fs.writeFileSync(path.join(dir, name), "{}");
  for (const name of [...oldFiles, "notes.txt"]) fs.utimesSync(path.join(dir, name), old, old);
  bridge.pruneStale(dir);
  assert.deepEqual(fs.readdirSync(dir).sort(), [...freshFiles, "notes.txt"].sort());
});
