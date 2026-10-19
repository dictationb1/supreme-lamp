"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const FIXTURES_DIR = path.join(__dirname, "fixtures", "invalid-workflows");

test("WF-VALIDATOR-1: All repository workflows pass validation", async () => {
  const { validateWorkflowsAndScripts } = await import("../scripts/validate-workflows.mjs");
  const res = validateWorkflowsAndScripts([]);
  assert.equal(res.ok, true, `Validation failed on valid repository workflows:\n${res.errors.join("\n")}`);
  assert.ok(res.checkedFiles && res.checkedFiles.length > 0, "checkedFiles inventory must not be empty");
  assert.ok(res.checkedFiles.some(f => f.includes("scripts/")), "checkedFiles must include scripts/");
  assert.ok(res.checkedFiles.some(f => f.includes("payloads/")), "checkedFiles must include payloads/");
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

test("WF-VALIDATOR-8: discoverStandaloneScripts finds scripts in both scripts/ and payloads/ including nested paths", async () => {
  const { discoverStandaloneScripts } = await import("../scripts/validate-workflows.mjs");
  const discovered = discoverStandaloneScripts();
  assert.ok(discovered.length > 0, "Must discover scripts");
  assert.ok(discovered.some(f => f.includes("scripts/f92-smoke-probe.mjs")), "Must discover scripts/f92-smoke-probe.mjs");
  assert.ok(discovered.some(f => f.includes("payloads/ghrdp-server.ps1")), "Must discover payloads/ghrdp-server.ps1");
  assert.ok(discovered.some(f => f.includes("payloads/ghrdp-webrtc/setup.ps1")), "Must discover nested script payloads/ghrdp-webrtc/setup.ps1");
});

test("WF-VALIDATOR-9 (negative control): Detects invalid JavaScript script syntax", async () => {
  const { validateStandaloneScript } = await import("../scripts/validate-workflows.mjs");
  const fs = require("node:fs");
  const tmpBadJs = path.join(__dirname, "fixtures", "tmp_invalid_script.js");
  try {
    fs.mkdirSync(path.dirname(tmpBadJs), { recursive: true });
    fs.writeFileSync(tmpBadJs, "const x = ; // syntax error", "utf8");
    const res = validateStandaloneScript(tmpBadJs);
    assert.equal(res.ok, false, "Expected validator to reject syntax error in JS file");
  } finally {
    try { fs.rmSync(tmpBadJs, { force: true }); } catch {}
  }
});
