"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FIXTURES_DIR = path.join(__dirname, "fixtures", "workflow-validation");

test("Workflow Validator: all real repo workflows and scripts pass validation", async () => {
  const { validateAllWorkflows } = await import("../scripts/validate-workflows.mjs");
  const errors = validateAllWorkflows();
  assert.deepEqual(errors, [], "Expected all real repository workflows to pass validation");
});

test("Workflow Validator (negative control): rejects unquoted line 244 defect fixture", async () => {
  const { validateYamlContent } = await import("../scripts/validate-workflows.mjs");
  const fixturePath = path.join(FIXTURES_DIR, "defect-line244.yml");
  const content = fs.readFileSync(fixturePath, "utf8");
  const res = validateYamlContent(content, "defect-line244.yml");

  assert.equal(res.valid, false, "Expected line 244 defect fixture to be invalid");
  assert.ok(
    res.errors.some((e) => e.includes("YAML syntax error") || e.includes("missing operator")),
    "Expected syntax or missing operator error, got: " + res.errors.join("\n")
  );
});

test("Workflow Validator (negative control): rejects quoted line 244 defect expression", async () => {
  const { validateYamlContent } = await import("../scripts/validate-workflows.mjs");
  const quotedContent = `
name: Quoted Line 244 Defect
on: push
jobs:
  job1:
    runs-on: ubuntu-latest
    if: "!cancelled()  github.event.inputs.mode == 'rdp'"
    steps:
      - run: echo "test"
`;
  const res = validateYamlContent(quotedContent, "quoted-defect.yml");

  assert.equal(res.valid, false, "Expected quoted line 244 defect expression to be invalid");
  assert.ok(
    res.errors.some((e) => e.includes("missing operator between '!cancelled()' and 'github.event.inputs.mode'")),
    "Expected missing operator error, got: " + res.errors.join("\n")
  );
});

test("Workflow Validator (negative control): rejects missing needs dependency fixture", async () => {
  const { validateYamlContent } = await import("../scripts/validate-workflows.mjs");
  const fixturePath = path.join(FIXTURES_DIR, "missing-needs.yml");
  const content = fs.readFileSync(fixturePath, "utf8");
  const res = validateYamlContent(content, "missing-needs.yml");

  assert.equal(res.valid, false, "Expected missing needs fixture to be invalid");
  assert.ok(
    res.errors.some((e) => e.includes("references non-existent need 'non_existent_job'")),
    "Expected missing need error, got: " + res.errors.join("\n")
  );
});

test("Workflow Validator (negative control): rejects unclosed expression fixture", async () => {
  const { validateYamlContent } = await import("../scripts/validate-workflows.mjs");
  const fixturePath = path.join(FIXTURES_DIR, "unclosed-expr.yml");
  const content = fs.readFileSync(fixturePath, "utf8");
  const res = validateYamlContent(content, "unclosed-expr.yml");

  assert.equal(res.valid, false, "Expected unclosed expression fixture to be invalid");
  assert.ok(
    res.errors.some((e) => e.includes("Unclosed '${{' expression")),
    "Expected unclosed expression error, got: " + res.errors.join("\n")
  );
});
