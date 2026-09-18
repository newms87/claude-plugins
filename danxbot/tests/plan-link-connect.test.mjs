// danxbot plan-link-connect hook — UserPromptSubmit, fires on a pasted danxbot
// plan URL. DX-2860. Run with `npm test` (node --test, no dependencies).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPlanId, buildDirective } from "../scripts/plan-link-connect.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "..", "scripts", "plan-link-connect.mjs");

describe("extractPlanId — fires on a real pasted plan link", () => {
  test("bare https link", () => {
    assert.equal(extractPlanId("https://danxbot.sageus.ai/plans/2"), "2");
  });
  test("link embedded in a sentence", () => {
    assert.equal(
      extractPlanId("hey can you pick up https://danxbot.sageus.ai/plans/17 and get going"),
      "17",
    );
  });
  test("link with a trailing path segment", () => {
    assert.equal(extractPlanId("https://danxbot.sageus.ai/plans/42/cards"), "42");
  });
  test("link with a trailing query string", () => {
    assert.equal(extractPlanId("https://danxbot.sageus.ai/plans/42?tab=records"), "42");
  });
  test("link with a trailing fragment", () => {
    assert.equal(extractPlanId("https://danxbot.sageus.ai/plans/42#goals"), "42");
  });
  test("plain http (not https) still matches", () => {
    assert.equal(extractPlanId("http://danxbot.sageus.ai/plans/9"), "9");
  });
  test("first of two links wins", () => {
    assert.equal(
      extractPlanId("https://danxbot.sageus.ai/plans/1 or maybe https://danxbot.sageus.ai/plans/2"),
      "1",
    );
  });
});

describe("extractPlanId — stays silent on everything else", () => {
  test("no URL at all", () => {
    assert.equal(extractPlanId("please fix the login bug"), null);
  });
  test("a URL with no /plans/ segment", () => {
    assert.equal(extractPlanId("see https://danxbot.sageus.ai/issues/DX-2860"), null);
  });
  test("a plans-looking path with no scheme is not a pasted link", () => {
    assert.equal(extractPlanId("check the plans/2 directory on disk"), null);
  });
  test("/plans/ with no digits", () => {
    assert.equal(extractPlanId("https://danxbot.sageus.ai/plans/pricing"), null);
  });
  test("empty string", () => {
    assert.equal(extractPlanId(""), null);
  });
  test("non-string / missing prompt", () => {
    assert.equal(extractPlanId(undefined), null);
    assert.equal(extractPlanId(null), null);
    assert.equal(extractPlanId(42), null);
  });
});

describe("buildDirective", () => {
  test("names the plan id and the connect steps, without calling anything itself", () => {
    const text = buildDirective("7");
    assert.match(text, /plan id 7/);
    assert.match(text, /get_session\(\{session_id:"self"\}\)/);
    assert.match(text, /plan_connect\(\{plan_id: 7/);
    assert.match(text, /made no dashboard call/);
    assert.doesNotMatch(text, /Monitor/);
    assert.doesNotMatch(text, /listener\.command/);
  });
});

describe("hook process contract", () => {
  const run = (payload) =>
    spawnSync(process.execPath, [SCRIPT], {
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      encoding: "utf8",
    });

  test("fires: prints the directive for a prompt containing a plan URL (AC1 fire case)", () => {
    const r = run({ prompt: "let's work on https://danxbot.sageus.ai/plans/5 now", hook_event_name: "UserPromptSubmit" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Pasted danxbot plan link detected \(plan id 5\)/);
  });

  test("silent: prints nothing for a prompt with no plan URL (AC1 silent case)", () => {
    const r = run({ prompt: "what's the status of the login fix?", hook_event_name: "UserPromptSubmit" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("silent: prints nothing for a prompt with an unrelated URL", () => {
    const r = run({ prompt: "see https://example.com/plans-overview for context", hook_event_name: "UserPromptSubmit" });
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

  test("never exits non-zero when prompt is missing entirely", () => {
    const r = run({ hook_event_name: "UserPromptSubmit" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  test("never exits non-zero when the whole payload is a JSON array, not an object", () => {
    const r = run([1, 2, 3]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});

// --- Bite proof: this is the assertion that would fail if the pattern
// regressed to matching ANY "/plans/N" text regardless of scheme, which would
// false-fire on ordinary file paths and prose.
describe("bite proof — a scheme is required, not just the /plans/<digits> shape", () => {
  test("no scheme, no match, even with digits", () => {
    assert.equal(extractPlanId("open danxbot.sageus.ai/plans/2 in your browser"), null);
  });
});
