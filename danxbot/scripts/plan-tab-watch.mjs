#!/usr/bin/env node
// Plan-tab watch hook — danxbot plugin. DX-2995.
//
// THE PROBLEM. danxbot:plan-workflow tells every plan-connected session to
// keep `https://<dashboard>/plans/<id>` open in the Claude desktop app's
// in-app browser, and to reopen it every turn it goes missing. That is only
// an instruction — nothing enforced it, and on 2026-09-18 a fresh session
// given a plan link never opened the page at all.
//
// THE EXPERIMENT THIS CARD RAN FIRST (recorded in full on DX-2995). The card
// asked whether an `mcp_tool` hook could call `mcp__Claude_Browser__tabs_context`
// directly — no model turn needed. The official hooks docs
// (https://code.claude.com/docs/en/hooks) confirm `mcp_tool` hooks cannot run
// at all on SessionStart/Setup (servers aren't wired up yet), but never state
// whether a HOST-PROVIDED server (the desktop app's own Browser pane, never
// declared in any `.mcp.json`) is addressable as "a configured MCP server" the
// way a `.mcp.json`/plugin-bundled one is. That specific question needs a live
// fresh desktop session to answer and could not be run from this dispatch (see
// the card's comments for the full record) — so this hook does NOT gamble on
// it. It ships the branch the card's own step 3 names for exactly this case:
// a documented, always-available mechanism that puts the check in the model's
// hands via `additionalContext`, not an unverified autonomous MCP call.
//
// TWO HOOKS, ONE FILE, ONE ARGV MODE (mirrors zero-context-mandate.sh's
// event-name argv convention):
//
//   `capture` — PostToolUse hook matched on plan_connect. The session's own
//   `~/.config/danxbot/plan-sessions/<id>.json` record (owned by
//   packages/danx-dashboard-mcp's session-connection.ts) proves a session is
//   CONNECTED but carries no plan id (checked directly, see DX-2995 comment
//   4829) — so this hook reads `tool_input.plan_id` off the SAME call the
//   agent already made and caches `{planId, lastNudgedAt: null}` into its own
//   file. It never touches session-connection.ts's file.
//
//   `check` — UserPromptSubmit hook, once per turn. Silent unless BOTH: (a)
//   the session-connection record exists (real proof of connection — a stale
//   plan-tab-watch cache from an old session is never trusted alone), and (b)
//   this hook's own cache has a planId (i.e. `capture` already ran this
//   session). Then, unless nudged within SUPPRESS_MS, emits ONE additionalContext
//   directive telling the model to check tabs and reopen if needed, and stamps
//   the nudge time. The stamp is OPTIMISTIC (written on asking, not on a
//   confirmed reopen) because a UserPromptSubmit hook cannot observe what the
//   model does after its turn starts — the same trade-off the card's own
//   design notes accepted. This bounds AC "at most one check/reopen per turn"
//   trivially (one hook invocation per prompt) and keeps the no-plan case and
//   the suppressed case both byte-cheap (empty stdout, no model context added).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SUPPRESS_MS = 10 * 60 * 1000; // 10 minutes — see file header on why this is optimistic, not confirmed.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function sessionConnectionPath(sessionId, home = homedir()) {
  return join(home, ".config", "danxbot", "plan-sessions", `${sessionId}.json`);
}

function watchStatePath(sessionId, home = homedir()) {
  return join(home, ".config", "danxbot", "plan-tab-watch", `${sessionId}.json`);
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

/** The directive text injected when a nudge is due. Exported so the test can assert its shape. */
export function buildNudge(planUrl) {
  return (
    `Plan-tab check (DX-2995, hook-triggered, do this once then continue): call tabs_context. ` +
    `If no open tab shows ${planUrl}, open it now with navigate (or preview_start if no pane is ` +
    `open yet). Never ask the operator first — reopening it is standing-authorized.`
  );
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

function runCheck(input, home, now) {
  const sessionId = input?.session_id;
  if (!isValidSessionId(sessionId)) return;

  // (a) Real proof of connection — never trust our own cache alone.
  const connection = readJsonSafe(sessionConnectionPath(sessionId, home));
  if (!connection || !connection.dashboardUrl) return;

  // (b) Our own cache must know which plan.
  const watchDir = join(home, ".config", "danxbot", "plan-tab-watch");
  const state = readJsonSafe(watchStatePath(sessionId, home));
  if (!state || state.planId === undefined || state.planId === null) return;

  if (state.lastNudgedAt && now - state.lastNudgedAt < SUPPRESS_MS) return;

  const planUrl = `${connection.dashboardUrl.replace(/\/+$/, "")}/plans/${state.planId}`;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: buildNudge(planUrl),
      },
    }),
  );

  try {
    mkdirSync(watchDir, { recursive: true });
    writeFileSync(watchStatePath(sessionId, home), JSON.stringify({ ...state, lastNudgedAt: now }));
  } catch {
    // Losing the stamp only costs an extra nudge next turn — never worth failing the hook over.
  }
}

function main() {
  const mode = process.argv[2];
  const input = readStdinJson();
  if (!input) return; // malformed/empty stdin — never block or guess
  const home = process.env.DANXBOT_PLAN_TAB_WATCH_HOME || homedir();
  try {
    if (mode === "capture") runCapture(input, home);
    else if (mode === "check") runCheck(input, home, Date.now());
  } catch {
    // A hook bug must never surface as a failed/blocked tool call or turn.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
