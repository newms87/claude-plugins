// scripts/lint-frontmatter.js — frontmatter validity lint for SKILL.md /
// agent .md files. DX-2986. Run with `npm test` (node --test).
//
// Fixtures are built into a fresh os.tmpdir() directory per test, never
// committed to the repo — a "deliberately broken" .md file living in the
// repo tree would itself need to dodge this lint (and every other repo
// convention) forever, for no benefit over generating it at test time.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { lintRepo } = require("../lint-frontmatter.js");

function makeFixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lint-frontmatter-test-"));
}

function writeSkill(root, name, frontmatterBody) {
  const dir = path.join(root, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\n${frontmatterBody}\n---\n\n# ${name}\n`,
  );
}

function writeAgent(root, name, frontmatterBody) {
  const dir = path.join(root, "agents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${name}.md`),
    `---\n${frontmatterBody}\n---\n\n# ${name}\n`,
  );
}

describe("lintRepo — valid fixture", () => {
  test("a well-formed SKILL.md and agent .md both pass", () => {
    const root = makeFixtureDir();
    writeSkill(root, "good-skill", "name: good-skill\ndescription: A perfectly normal description.");
    writeAgent(root, "good-agent", "name: good-agent\ndescription: A perfectly normal agent description.");

    const { files, errors } = lintRepo(root);

    assert.equal(files.length, 2);
    assert.deepEqual(errors, []);
  });
});

describe("lintRepo — unescaped single quote inside a single-quoted scalar", () => {
  test("fails and names the file", () => {
    const root = makeFixtureDir();
    writeSkill(root, "bad-quote", "name: bad-quote\ndescription: 'this has an unescaped 'quote' inside it'");

    const { errors } = lintRepo(root);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /^skills\/bad-quote\/SKILL\.md:/);
    assert.match(errors[0], /not valid YAML/);
  });
});

describe("lintRepo — missing description key", () => {
  test("fails and names the file", () => {
    const root = makeFixtureDir();
    writeAgent(root, "no-desc", "name: no-desc");

    const { errors } = lintRepo(root);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /^agents\/no-desc\.md:/);
    assert.match(errors[0], /missing required "description" key/);
  });
});

describe("lintRepo — no frontmatter block at all", () => {
  test("fails and names the file", () => {
    const root = makeFixtureDir();
    const dir = path.join(root, "skills", "no-frontmatter");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# no-frontmatter\n\nJust a body, no --- block.\n");

    const { errors } = lintRepo(root);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /^skills\/no-frontmatter\/SKILL\.md:/);
    assert.match(errors[0], /no frontmatter block found/);
  });
});

describe("lintRepo — missing name key", () => {
  test("fails and names the file", () => {
    const root = makeFixtureDir();
    writeSkill(root, "no-name", "description: has a description but no name");

    const { errors } = lintRepo(root);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /^skills\/no-name\/SKILL\.md:/);
    assert.match(errors[0], /missing required "name" key/);
  });
});

describe("lintRepo — ignores non-skill/agent markdown", () => {
  test("a stray README.md under the fixture root is not linted", () => {
    const root = makeFixtureDir();
    fs.writeFileSync(path.join(root, "README.md"), "# not a skill or agent\n");
    writeSkill(root, "good-skill", "name: good-skill\ndescription: fine.");

    const { files, errors } = lintRepo(root);

    assert.equal(files.length, 1);
    assert.deepEqual(errors, []);
  });
});
