#!/usr/bin/env node
// PostToolUse hook — danxbot plugin. DX-2917.
//
// Reminds the agent, right after it does something that MIGHT be a plan
// milestone, to consider writing a plan note (plan_add_note). Fires only
// after:
//   - mcp__danx_dashboard__issue_transition / mcp__danx-dashboard__issue_transition,
//     and only when tool_input.action === "complete" (a card reaching Done);
//   - plan_add_record / plan_update_record (a goal, rule or caveat landed);
//   - plan_add_architecture_section / plan_update_architecture_section
//     (a design fact landed);
//   under EITHER MCP prefix (mcp__danx_dashboard__ or mcp__danx-dashboard__ —
//   both are live consumer prefixes for the same server, see
//   .claude/rules/dashboard.md "The tool prefix is mcp__danx-dashboard__*").
//
// PostToolUse cannot block a tool call (it already ran) — see the official
// hooks docs (https://code.claude.com/docs/en/hooks, PostToolUse section):
// the only effect available is `hookSpecificOutput.additionalContext`, a
// string appended to what Claude sees about the tool result. This hook never
// writes anything else, never reads the network, and treats any parse or
// runtime failure as "stay silent" rather than surfacing an error — a
// reminder is never worth risking the turn.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REMINDER =
  "Milestone? If this card or record change matters to the operator, write a plan note (plan_add_note, title <=60 chars, body <=250 chars). Skip routine steps.";

// Matches both `mcp__danx_dashboard__<tool>` and `mcp__danx-dashboard__<tool>`
// for exactly the five tools this hook cares about.
const TOOL_PATTERN =
  /^mcp__danx[_-]dashboard__(issue_transition|plan_add_record|plan_update_record|plan_add_architecture_section|plan_update_architecture_section)$/;

/** The matched tool's bare name (e.g. "issue_transition"), or null when tool_name isn't one of the watched tools. */
export function toolKind(toolName) {
  if (typeof toolName !== "string") return null;
  const m = TOOL_PATTERN.exec(toolName);
  return m ? m[1] : null;
}

/** Whether this exact (tool_name, tool_input) pair should get the reminder. */
export function shouldRemind(toolName, toolInput) {
  const kind = toolKind(toolName);
  if (!kind) return false;
  // issue_transition fires on every action (pickup, block, ready, ...); only
  // "complete" is a card reaching Done, which is the one milestone shape.
  if (kind === "issue_transition") return toolInput?.action === "complete";
  return true;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  try {
    if (!shouldRemind(input?.tool_name, input?.tool_input)) return;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: REMINDER,
        },
      }),
    );
  } catch {
    // Never let a hook bug surface as a failed/blocked tool call.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
