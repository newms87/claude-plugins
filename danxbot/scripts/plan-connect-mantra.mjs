#!/usr/bin/env node
// PostToolUse hook (matcher: plan_connect) — danxbot plugin. DX-3275.
//
// PLN-11 R-10: before a plan is connected, the danxbot plugin shows only the
// short plan-workflow nudge (`mantra.sh`) — the full mantra applies once the
// session is connected, and the connect ITSELF should surface it immediately
// rather than waiting for the next SessionStart. This is that surface.
//
// Detection is NOT re-derived here. A successful `plan_connect` call writes
// `~/.config/danxbot/plan-sessions/<session>.json` (packages/danx-dashboard-mcp's
// `session-connection.ts`, danxbot repo) before the tool call returns, so by
// the time THIS PostToolUse hook fires the record already exists — checking
// for it (via the same `scripts/lib/plan-connection.mjs` `mantra.sh` and
// `plan-workflow-autoload.sh` use) tells us the connect actually succeeded
// without parsing `tool_response` or touching the network a second time. A
// failed connect never writes the record, so this hook silently emits
// nothing for it — exactly the same as `mantra.sh`'s own "not connected" case.
//
// PostToolUse cannot inject plain stdout (confirmed against
// https://code.claude.com/docs/en/hooks.md — only UserPromptSubmit,
// UserPromptExpansion, SessionStart and PostModelSwitch stdout reaches
// context; see DX-3347 comment 6999's docs citation and
// plan-note-reminder.mjs, this repo's prior art for the same constraint).
// The only effect available is `hookSpecificOutput.additionalContext`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isPlanConnected } from "./lib/plan-connection.mjs";

const MANTRA_PATH = new URL("../mantra.md", import.meta.url);

function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const input = readStdinJson();
  if (!input) return;
  const sessionId = typeof input.session_id === "string" ? input.session_id : null;
  const home = process.env.DANXBOT_PLAN_SESSIONS_HOME || undefined;
  if (!isPlanConnected(sessionId, home)) return; // connect failed, or record not yet visible — stay silent
  let mantra;
  try {
    mantra = readFileSync(MANTRA_PATH, "utf8");
  } catch {
    return; // corrupt install — mantra.sh already fails loud for this on the next SessionStart
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `Plan connected — the full danxbot mantra now applies:\n\n${mantra}`,
      },
    }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
