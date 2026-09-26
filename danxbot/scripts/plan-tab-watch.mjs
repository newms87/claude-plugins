#!/usr/bin/env node
// Plan-tab watch hook — danxbot plugin. DX-2995.
//
// WHY THIS EXISTS. danxbot:plan-workflow instructs every plan-connected
// session to keep `https://<dashboard>/plans/<id>` open in the Claude
// desktop app's in-app browser and reopen it whenever it goes missing.
//
// `capture` — the only mode left (DX-3347 deleted the `check` mode, a
// once-per-turn UserPromptSubmit poll that cost 282 bytes/message whenever it
// fired — R-12 restricted every per-message reminder to the mantra). PostToolUse
// hook matched on plan_connect. The session's own
// `~/.config/danxbot/plan-sessions/<id>.json` record (owned by
// packages/danx-dashboard-mcp's session-connection.ts) proves a session is
// CONNECTED but carries no plan id — so this hook reads `tool_input.plan_id`
// off the SAME call the agent already made and caches
// `{planId, lastNudgedAt: null}` into its own file. It never touches
// session-connection.ts's file. The cached state is kept (not deleted) for
// forward compatibility with a future MCP-response-driven reopen check.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function watchStatePath(sessionId, home = homedir()) {
  return join(home, ".config", "danxbot", "plan-tab-watch", `${sessionId}.json`);
}

function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

/** Whether `sessionId` is safe to use as a path segment. */
export function isValidSessionId(sessionId) {
  return typeof sessionId === "string" && SESSION_ID_PATTERN.test(sessionId);
}

function runCapture(input, home) {
  const sessionId = input?.session_id;
  const planId = input?.tool_input?.plan_id;
  if (!isValidSessionId(sessionId) || planId === undefined || planId === null) return;
  const dir = join(home, ".config", "danxbot", "plan-tab-watch");
  mkdirSync(dir, { recursive: true });
  writeFileSync(watchStatePath(sessionId, home), JSON.stringify({ planId, lastNudgedAt: null }));
}

function main() {
  const mode = process.argv[2];
  const input = readStdinJson();
  if (!input) return; // malformed/empty stdin — never block or guess
  const home = process.env.DANXBOT_PLAN_TAB_WATCH_HOME || homedir();
  try {
    if (mode === "capture") runCapture(input, home);
  } catch {
    // A hook bug must never surface as a failed/blocked tool call or turn.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
