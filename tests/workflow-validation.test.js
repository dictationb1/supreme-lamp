"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const FIXTURES_DIR = path.join(__dirname, "fixtures", "invalid-workflows");

test("WF-VALIDATOR-1: All repository workflows pass validation", async () => {
  const { validateWorkflowsAndScripts } = await import("../scripts/validate-workflows.mjs");
  const res = validateWorkflowsAndScripts([], { strict: false });
  assert.equal(res.ok, true, `Validation failed on valid repository workflows:\n${res.errors.join("\n")}`);
});

test("WF-VALIDATOR-2 (negative control): Rejects missing operator in if condition (line 244 defect)", async () => {
  const { validateWorkflowsAndScripts } = await import("../scripts/validate-workflows.mjs");
  const fixture = path.join(FIXTURES_DIR, "line244-missing-operator.yml");
  const res = validateWorkflowsAndScripts([fixture], { strict: false });
  assert.equal(res.ok, false, "Expected validator to reject line244-missing-operator.yml fixture");
  assert.ok(
    res.errors.some(e => e.includes("actionlint") || e.includes("YAML") || e.includes("syntax")),
    `Expected error mentioning actionlint or syntax, got: ${JSON.stringify(res.errors)}`
  );
});

test("WF-VALIDATOR-3 (negative control): Rejects missing needs dependency", async () => {
  const { validateWorkflowsAndScripts } = await import("../scripts/validate-workflows.mjs");
  const fixture = path.join(FIXTURES_DIR, "missing-needs.yml");
  const res = validateWorkflowsAndScripts([fixture], { strict: false });
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
  const res = validatePowershellCode(badCode, null, false);
  if (!res.skipped) {
    assert.equal(res.ok, false, "Expected pwsh parser to reject bad backtick escape \\`ui-dist\\`");
  }
});

test("WF-VALIDATOR-5: Rejects duplicate keys in YAML workflow files", async () => {
  const { parseYamlAndExtractRunBlocks } = await import("../scripts/validate-workflows.mjs");
  const tmpYaml = path.join("/tmp", "dup_key_test.yml");
  require("fs").writeFileSync(tmpYaml, `
name: Test
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: step1
        run: echo 1
      - name: step2
        run: echo 2
        name: duplicate_step_name
`, "utf8");

  const res = parseYamlAndExtractRunBlocks(tmpYaml);
  assert.equal(res.ok, false, "Expected duplicate key detection to fail");
  assert.ok(res.error.includes("Duplicate key") || res.error.includes("duplicate"), `Expected duplicate key message, got: ${res.error}`);
});

test("WF-VALIDATOR-6: Correctly handles shell defaults (workflow, job, step, and runner OS)", async () => {
  const { parseYamlAndExtractRunBlocks } = await import("../scripts/validate-workflows.mjs");
  const tmpYaml = path.join("/tmp", "shell_defaults_test.yml");
  require("fs").writeFileSync(tmpYaml, `
name: Test Shell Defaults
on: push
defaults:
  run:
    shell: bash
jobs:
  job_win:
    runs-on: windows-latest
    steps:
      - run: Get-Date
  job_override:
    runs-on: ubuntu-latest
    defaults:
      run:
        shell: pwsh
    steps:
      - run: Write-Host "Hello"
      - shell: bash
        run: echo "Hello"
`, "utf8");

  const res = parseYamlAndExtractRunBlocks(tmpYaml);
  assert.equal(res.ok, true, `Expected valid parse, got error: ${res.error}`);
  assert.equal(res.blocks.length, 3);
  assert.equal(res.blocks[0].shell, "bash"); // inherited from top-level defaults
  assert.equal(res.blocks[1].shell, "pwsh"); // inherited from job-level defaults
  assert.equal(res.blocks[2].shell, "bash"); // step-level override
});

test("WF-VALIDATOR-7: Standalone script validator verifies JavaScript and Bash scripts", async () => {
  const { validateStandaloneScript } = await import("../scripts/validate-workflows.mjs");

  const validJs = path.join("/tmp", "valid_script.mjs");
  require("fs").writeFileSync(validJs, "export const x = 42;\n", "utf8");
  const resJs = validateStandaloneScript(validJs, null, false);
  assert.equal(resJs.ok, true, `Expected valid JS, got: ${resJs.error}`);

  const invalidJs = path.join("/tmp", "invalid_script.mjs");
  require("fs").writeFileSync(invalidJs, "const x = ;\n", "utf8");
  const resInvalidJs = validateStandaloneScript(invalidJs, null, false);
  assert.equal(resInvalidJs.ok, false, "Expected invalid JS syntax to fail node --check");
});
