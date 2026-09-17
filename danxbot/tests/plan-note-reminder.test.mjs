// danxbot plan-note-reminder hook — PostToolUse reminder after a card
// reaches Done or a plan record/architecture section lands. DX-2917.
// Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toolKind, shouldRemind } from "../scripts/plan-note-reminder.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "..", "scripts", "plan-note-reminder.mjs");

const WATCHED_TOOLS = [
  "issue_transition",
  "plan_add_record",
  "plan_update_record",
  "plan_add_architecture_section",
  "plan_update_architecture_section",
];

describe("toolKind — both MCP prefixes, every watched tool", () => {
  for (const tool of WATCHED_TOOLS) {
    test(`matches mcp__danx_dashboard__${tool}`, () => {
      assert.equal(toolKind(`mcp__danx_dashboard__${tool}`), tool);
    });
    test(`matches mcp__danx-dashboard__${tool}`, () => {
      assert.equal(toolKind(`mcp__danx-dashboard__${tool}`), tool);
    });
  }

  test("returns null for an unmatched tool", () => {
    assert.equal(toolKind("mcp__danx_dashboard__issue_comment"), null);
    assert.equal(toolKind("mcp__danx-dashboard__plan_add_card"), null);
    assert.equal(toolKind("Bash"), null);
    assert.equal(toolKind("mcp__danx_dashboard__issue_transitions"), null); // no trailing match
    assert.equal(toolKind("xmcp__danx_dashboard__issue_transition"), null); // no leading match
  });

  test("returns null for non-string / missing tool_name", () => {
    assert.equal(toolKind(undefined), null);
    assert.equal(toolKind(null), null);
    assert.equal(toolKind(42), null);
  });
});

describe("shouldRemind — matched cases", () => {
  for (const prefix of ["mcp__danx_dashboard__", "mcp__danx-dashboard__"]) {
    test(`${prefix}issue_transition with action:complete reminds`, () => {
      assert.equal(shouldRemind(`${prefix}issue_transition`, { action: "complete" }), true);
    });
    test(`${prefix}plan_add_record reminds regardless of input`, () => {
      assert.equal(shouldRemind(`${prefix}plan_add_record`, { kind: "goal", body: "x" }), true);
    });
    test(`${prefix}plan_update_record reminds`, () => {
      assert.equal(shouldRemind(`${prefix}plan_update_record`, {}), true);
    });
    test(`${prefix}plan_add_architecture_section reminds`, () => {
      assert.equal(shouldRemind(`${prefix}plan_add_architecture_section`, {}), true);
    });
    test(`${prefix}plan_update_architecture_section reminds`, () => {
      assert.equal(shouldRemind(`${prefix}plan_update_architecture_section`, {}), true);
    });
  }
});

describe("shouldRemind — unmatched tools stay silent", () => {
  test("issue_comment", () => assert.equal(shouldRemind("mcp__danx_dashboard__issue_comment", {}), false));
  test("issue_create", () => assert.equal(shouldRemind("mcp__danx-dashboard__issue_create", {}), false));
  test("plan_add_card", () => assert.equal(shouldRemind("mcp__danx_dashboard__plan_add_card", {}), false));
  test("plan_add_note itself", () => assert.equal(shouldRemind("mcp__danx-dashboard__plan_add_note", {}), false));
  test("Bash", () => assert.equal(shouldRemind("Bash", { command: "ls" }), false));
  test("Edit", () => assert.equal(shouldRemind("Edit", {}), false));
});

describe("shouldRemind — issue_transition non-complete actions stay silent", () => {
  for (const action of ["pickup", "ready", "block", "unready", "rollback_pickup", "archive", "cancel"]) {
    test(`action:${action}`, () => {
      assert.equal(shouldRemind("mcp__danx_dashboard__issue_transition", { action }), false);
    });
  }
  test("missing action", () => assert.equal(shouldRemind("mcp__danx_dashboard__issue_transition", {}), false));
  test("missing tool_input entirely", () => assert.equal(shouldRemind("mcp__danx_dashboard__issue_transition", undefined), false));
});

describe("hook process contract", () => {
  const run = (payload) =>
    spawnSync(process.execPath, [SCRIPT], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
    });

  test("prints the reminder for issue_transition complete", () => {
    const r = run({ tool_name: "mcp__danx_dashboard__issue_transition", tool_input: { action: "complete" } });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.match(out.hookSpecificOutput.additionalContext, /plan_add_note/);
  });

  test("prints the reminder for the hyphenated prefix too", () => {
    const r = run({ tool_name: "mcp__danx-dashboard__plan_add_record", tool_input: { kind: "rule" } });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /plan_add_note/);
  });

  test("prints nothing and exits 0 for an unmatched tool", () => {
    const r = run({ tool_name: "Bash", tool_input: { command: "git status" } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("prints nothing and exits 0 for issue_transition action:pickup", () => {
    const r = run({ tool_name: "mcp__danx_dashboard__issue_transition", tool_input: { action: "pickup" } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("never exits non-zero and never blocks on malformed JSON input", () => {
    const r = run("{not valid json");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("never exits non-zero on empty stdin", () => {
    const r = run("");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("never exits non-zero when tool_input is missing entirely", () => {
    const r = run({ tool_name: "mcp__danx_dashboard__issue_transition" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("never exits non-zero when the whole payload is a JSON array, not an object", () => {
    const r = run([1, 2, 3]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});

// --- Bite proof: these two assertions are the ones that would fail if the
// matcher regressed to "any issue_transition" or dropped a prefix/tool. Keep
// them easy to spot for a future editor who tightens the pattern.
describe("bite proof — the matcher is exact, not permissive", () => {
  test("a lookalike tool name with an extra character does not match", () => {
    assert.equal(toolKind("mcp__danx_dashboard__issue_transitionx"), null);
    assert.equal(toolKind("mcp__danx_dashboard__xissue_transition"), null);
  });
  test("a third, unrelated MCP prefix does not match", () => {
    assert.equal(toolKind("mcp__other_dashboard__issue_transition"), null);
  });
});
