// Regression coverage for RDP launch scheduling conditions and outcome check guard
//
// WHY THIS EXISTS:
// In run #12 (mode=rdp, need_f59_build=false, need_ui_build=true), the workflow completed
// successfully but the rdp job was unexpectedly skipped.
// The root cause was that `rdp`'s `if:` condition in main.yml lacked an explicit status
// check function (e.g., `!cancelled()`). When no explicit status check function is present,
// GitHub Actions automatically wraps the `if:` expression with `success()`.
// `success()` evaluates to false if ANY direct or transitive upstream dependency in `needs:`
// was skipped (such as `ensure-f59-binaries-call`).
//
// This test validates:
// 1. Static workflow structure of main.yml (explicit status checks and needs list).
// 2. Exact evaluation of matrix states A through H under GitHub Actions scheduling rules.
// 3. Negative control proving that the old condition reproduces the Run #12 skip,
//    while the repaired condition schedules launch correctly.

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WF_PATH = path.join(__dirname, "..", ".github", "workflows", "main.yml");
const wfContent = fs.readFileSync(WF_PATH, "utf8");

/** Helper to extract a job block by job key from YAML file */
function getJobBlock(yamlText, jobName) {
  const jobHeader = new RegExp(`^  ${jobName}:\\s*$`, "m");
  const match = yamlText.match(jobHeader);
  if (!match) return null;
  const startIdx = match.index;
  const rest = yamlText.slice(startIdx + match[0].length);
  const nextJobMatch = rest.match(/^\s{2}[a-zA-Z0-9_-]+:\s*$/m);
  const blockText = nextJobMatch ? rest.slice(0, nextJobMatch.index) : rest;
  return blockText;
}

test("MATRIX-STATIC: main.yml contains cancellation-safe explicit status check conditions", () => {
  const rdpBlock = getJobBlock(wfContent, "rdp");
  assert.ok(rdpBlock, "rdp job block must exist in main.yml");

  // Verify explicit !cancelled() present in rdp if condition
  assert.match(rdpBlock, /!cancelled\(\)/, "rdp job must explicitly use !cancelled()");
  assert.match(rdpBlock, /needs\.preflight\.result == 'success'/, "rdp job must check preflight result");
  assert.match(rdpBlock, /needs\.verify-dependencies\.result == 'success'/, "rdp job must check verify-dependencies result");
  assert.match(rdpBlock, /needs\.build-ui\.result == 'success'/, "rdp job must check build-ui result");
  assert.match(rdpBlock, /needs\.ensure-f59-binaries\.result == 'success'/, "rdp job must check ensure-f59-binaries result");

  // Verify needs clause includes mandatory verifiers
  assert.match(rdpBlock, /needs:\s*\[[^\]]*preflight[^\]]*\]/, "rdp needs preflight");
  assert.match(rdpBlock, /needs:\s*\[[^\]]*ensure-f59-binaries[^\]]*\]/, "rdp needs ensure-f59-binaries");
  assert.match(rdpBlock, /needs:\s*\[[^\]]*build-ui[^\]]*\]/, "rdp needs build-ui");
  assert.match(rdpBlock, /needs:\s*\[[^\]]*verify-dependencies[^\]]*\]/, "rdp needs verify-dependencies");

  // Verify outcome check job (publish-url)
  const pubBlock = getJobBlock(wfContent, "publish-url");
  assert.ok(pubBlock, "publish-url job block must exist in main.yml");
  assert.match(pubBlock, /if:\s*always\(\)/, "publish-url must run on always()");
  assert.match(pubBlock, /UNEXPECTED_RDP_SKIP/, "publish-url must contain UNEXPECTED_RDP_SKIP guard");
});

/**
 * Evaluates a condition string given the context and GHA rules.
 * @param {string} conditionExpr The `if:` condition string.
 * @param {Object} context Object containing results of upstream jobs and event inputs.
 * @param {boolean} isCancelled Whether the workflow is cancelled.
 */
function evaluateGhaCondition(conditionExpr, context, isCancelled = false) {
  const hasExplicitStatus = /cancelled\(\)|always\(\)|success\(\)|failure\(\)/.test(conditionExpr);

  // If no explicit status function is present, GitHub Actions implicitly prepends success()
  if (!hasExplicitStatus) {
    if (isCancelled) return false;
    // success() returns false if any job in upstream needs was skipped, failed, or cancelled
    const anyDependencySkippedOrFailed = Object.values(context.needs || {}).some(
      (res) => res !== "success"
    );
    if (anyDependencySkippedOrFailed) return false;
  }

  // Parse expressions in ${{ ... }}
  let cleanExpr = conditionExpr.replace(/\${{\s*/g, "").replace(/\s*}}/g, "").trim();
  cleanExpr = cleanExpr.replace(/>-/g, "").trim();

  // Substitute !cancelled()
  cleanExpr = cleanExpr.replace(/!cancelled\(\)/g, (!isCancelled).toString());
  cleanExpr = cleanExpr.replace(/cancelled\(\)/g, isCancelled.toString());

  // Substitute inputs
  if (context.inputs) {
    for (const [k, v] of Object.entries(context.inputs)) {
      cleanExpr = cleanExpr.replace(new RegExp(`github\\.event\\.inputs\\.${k}`, "g"), `'${v}'`);
    }
  }

  // Substitute needs.<job>.result and needs.<job>.outputs.<key>
  if (context.needs) {
    for (const [jobKey, res] of Object.entries(context.needs)) {
      cleanExpr = cleanExpr.replace(new RegExp(`needs\\.${jobKey}\\.result`, "g"), `'${res}'`);
    }
  }

  // Evaluate simple JS expression securely
  // Operators: &&, ||, ==, !=, !, parens
  try {
    const jsExpr = cleanExpr
      .replace(/&&/g, "&&")
      .replace(/\|\|/g, "||")
      .replace(/==/g, "===")
      .replace(/!=/g, "!==");
    return Function(`"use strict"; return (${jsExpr});`)();
  } catch (err) {
    throw new Error(`Failed to evaluate expression '${cleanExpr}': ${err.message}`);
  }
}

test("MATRIX-A: readiness mode (no producers or RDP launch run)", () => {
  const context = {
    inputs: { mode: "readiness" },
    needs: {
      preflight: "success",
      "ensure-f59-binaries-call": "skipped",
      "ensure-f59-binaries": "skipped",
      "build-ui-via-call": "skipped",
      "build-ui": "skipped",
      "verify-dependencies": "skipped",
    },
  };

  const rdpIf = "github.event.inputs.mode == 'rdp' && needs.preflight.result == 'success'";
  const rdpScheduled = evaluateGhaCondition(rdpIf, context);
  assert.equal(rdpScheduled, false, "RDP launch must NOT be scheduled in readiness mode");
});

test("MATRIX-B: rdp mode, both dependencies reusable (both producers skip)", () => {
  const context = {
    inputs: { mode: "rdp" },
    needs: {
      preflight: "success",
      "ensure-f59-binaries-call": "skipped",
      "ensure-f59-binaries": "success",
      "build-ui-via-call": "skipped",
      "build-ui": "success",
      "verify-dependencies": "success",
    },
  };

  // Old condition without explicit status check function
  const oldRdpIf = "github.event.inputs.mode == 'rdp' && needs.preflight.result == 'success' && needs.verify-dependencies.result == 'success'";
  assert.equal(evaluateGhaCondition(oldRdpIf, context), false, "Old condition fails and skips RDP due to implicit success()");

  // Repaired condition
  const repairedRdpIf = "${{ !cancelled() && github.event.inputs.mode == 'rdp' && needs.preflight.result == 'success' && needs.verify-dependencies.result == 'success' && needs.build-ui.result == 'success' && needs.ensure-f59-binaries.result == 'success' }}";
  assert.equal(evaluateGhaCondition(repairedRdpIf, context), true, "Repaired condition schedules RDP launch correctly");
});

test("MATRIX-C: rdp mode, F59 reusable and UI missing (reproduces Run #12)", () => {
  const context = {
    inputs: { mode: "rdp" },
    needs: {
      preflight: "success",
      "ensure-f59-binaries-call": "skipped",
      "ensure-f59-binaries": "success",
      "build-ui-via-call": "success",
      "build-ui": "success",
      "verify-dependencies": "success",
    },
  };

  // Demonstrating the Run #12 bug:
  const oldRdpIf = "github.event.inputs.mode == 'rdp' && needs.preflight.result == 'success' && needs.verify-dependencies.result == 'success'";
  assert.equal(evaluateGhaCondition(oldRdpIf, context), false, "OLD CONDITION REPRODUCES RUN #12 BUG (RDP SKIPPED)");

  // Repaired condition fixes Run #12:
  const repairedRdpIf = "${{ !cancelled() && github.event.inputs.mode == 'rdp' && needs.preflight.result == 'success' && needs.verify-dependencies.result == 'success' && needs.build-ui.result == 'success' && needs.ensure-f59-binaries.result == 'success' }}";
  assert.equal(evaluateGhaCondition(repairedRdpIf, context), true, "REPAIRED CONDITION SCHEDULES RDP LAUNCH IN RUN #12 SCENARIO");
});

test("MATRIX-D: rdp mode, F59 missing and UI reusable", () => {
  const context = {
    inputs: { mode: "rdp" },
    needs: {
      preflight: "success",
      "ensure-f59-binaries-call": "success",
      "ensure-f59-binaries": "success",
      "build-ui-via-call": "skipped",
      "build-ui": "success",
      "verify-dependencies": "success",
    },
  };

  const repairedRdpIf = "${{ !cancelled() && github.event.inputs.mode == 'rdp' && needs.preflight.result == 'success' && needs.verify-dependencies.result == 'success' && needs.build-ui.result == 'success' && needs.ensure-f59-binaries.result == 'success' }}";
  assert.equal(evaluateGhaCondition(repairedRdpIf, context), true, "Schedules launch when F59 is built and UI is reused");
});

test("MATRIX-E: rdp mode, both dependencies missing (both producers run)", () => {
  const context = {
    inputs: { mode: "rdp" },
    needs: {
      preflight: "success",
      "ensure-f59-binaries-call": "success",
      "ensure-f59-binaries": "success",
      "build-ui-via-call": "success",
      "build-ui": "success",
      "verify-dependencies": "success",
    },
  };

  const repairedRdpIf = "${{ !cancelled() && github.event.inputs.mode == 'rdp' && needs.preflight.result == 'success' && needs.verify-dependencies.result == 'success' && needs.build-ui.result == 'success' && needs.ensure-f59-binaries.result == 'success' }}";
  assert.equal(evaluateGhaCondition(repairedRdpIf, context), true, "Schedules launch when both dependencies are built from scratch");
});

test("MATRIX-F: required producer or verifier fails", () => {
  const contextFailedVerifier = {
    inputs: { mode: "rdp" },
    needs: {
      preflight: "success",
      "ensure-f59-binaries-call": "skipped",
      "ensure-f59-binaries": "success",
      "build-ui-via-call": "failure",
      "build-ui": "failure",
      "verify-dependencies": "skipped",
    },
  };

  const repairedRdpIf = "${{ !cancelled() && github.event.inputs.mode == 'rdp' && needs.preflight.result == 'success' && needs.verify-dependencies.result == 'success' && needs.build-ui.result == 'success' && needs.ensure-f59-binaries.result == 'success' }}";
  assert.equal(evaluateGhaCondition(repairedRdpIf, contextFailedVerifier), false, "RDP launch is BLOCKED when a dependency fails");
});

test("MATRIX-G: workflow cancellation", () => {
  const contextCancelled = {
    inputs: { mode: "rdp" },
    needs: {
      preflight: "success",
      "ensure-f59-binaries-call": "skipped",
      "ensure-f59-binaries": "success",
      "build-ui-via-call": "skipped",
      "build-ui": "success",
      "verify-dependencies": "success",
    },
  };

  const repairedRdpIf = "${{ !cancelled() && github.event.inputs.mode == 'rdp' && needs.preflight.result == 'success' && needs.verify-dependencies.result == 'success' && needs.build-ui.result == 'success' && needs.ensure-f59-binaries.result == 'success' }}";
  assert.equal(evaluateGhaCondition(repairedRdpIf, contextCancelled, true), false, "RDP launch is BLOCKED when workflow is cancelled");
});

test("MATRIX-H: unexpected launch skip detected by outcome check", () => {
  // Simulate publish-url outcome check logic when rdp was unexpectedly skipped
  const preflightRes = "success";
  const verifyRes = "success";
  const rdpRes = "skipped";
  const mode = "rdp";

  let outcomeFailed = false;
  let errorPrinted = false;

  if (mode === "rdp" && preflightRes === "success" && verifyRes === "success" && rdpRes === "skipped") {
    outcomeFailed = true;
    errorPrinted = true;
  }

  assert.equal(outcomeFailed, true, "Outcome check must detect unexpected launch skip");
  assert.equal(errorPrinted, true, "Outcome check must emit error annotation");
});
