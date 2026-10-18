"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const FIXTURES_DIR = path.join(__dirname, "fixtures", "invalid-workflows");

test("WF-VALIDATOR-1: All repository workflows pass validation", async () => {
  const { validateWorkflowsAndScripts } = await import("../scripts/validate-workflows.mjs");
  const res = validateWorkflowsAndScripts([]);
  assert.equal(res.ok, true, `Validation failed on valid repository workflows:\n${res.errors.join("\n")}`);
});

test("WF-VALIDATOR-2 (negative control): Rejects missing operator in if condition (line 244 defect)", async () => {
  const { validateWorkflowsAndScripts } = await import("../scripts/validate-workflows.mjs");
  const fixture = path.join(FIXTURES_DIR, "line244-missing-operator.yml");
  const res = validateWorkflowsAndScripts([fixture]);
  assert.equal(res.ok, false, "Expected validator to reject line244-missing-operator.yml fixture");
  assert.ok(
    res.errors.some(e => e.includes("actionlint") || e.includes("YAML") || e.includes("syntax")),
    `Expected error mentioning actionlint or syntax, got: ${JSON.stringify(res.errors)}`
  );
});

test("WF-VALIDATOR-3 (negative control): Rejects missing needs dependency", async () => {
  const { validateWorkflowsAndScripts } = await import("../scripts/validate-workflows.mjs");
  const fixture = path.join(FIXTURES_DIR, "missing-needs.yml");
  const res = validateWorkflowsAndScripts([fixture]);
  assert.equal(res.ok, false, "Expected validator to reject missing-needs.yml fixture");
  assert.ok(
    res.errors.some(e => e.includes("nonexistent_job") || e.includes("actionlint")),
    `Expected error mentioning nonexistent_job, got: ${JSON.stringify(res.errors)}`
  );
});

test("WF-VALIDATOR-4 (negative control): Rejects pwsh backtick before u", async () => {
  const { validatePowershellCode } = await import("../scripts/validate-workflows.mjs");
  const badCode = `
$S = $env:GITHUB_STEP_SUMMARY
"- Web UI Bundle (\`ui-dist\`): " | Add-Content -Path $S
`;
  const res = validatePowershellCode(badCode);
  if (!res.skipped) {
    assert.equal(res.ok, false, "Expected pwsh parser to reject bad backtick escape \\`ui-dist\\`");
  }
});
