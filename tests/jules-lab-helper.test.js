// tests/jules-lab-helper.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

test("HELPER-1: getCurrentPrInfo returns valid git SHA and repo", async () => {
  const { getCurrentPrInfo } = await import("../scripts/jules-lab-helper.mjs");
  const info = getCurrentPrInfo();

  assert.ok(info.sha);
  assert.ok(info.repo);
  assert.strictEqual(typeof info.sha, "string");
});

test("HELPER-2: parseEvidence validates SHA and extracts first causal failure", async () => {
  const { parseEvidence } = await import("../scripts/jules-lab-helper.mjs");
  const tmpPath = path.join(__dirname, "tmp-evidence.json");

  const sampleEvidence = {
    source_sha: "commit-abc-123",
    first_causal_failure: "ts-authkey-invalid",
    redaction_verified: true,
  };

  fs.writeFileSync(tmpPath, JSON.stringify(sampleEvidence), "utf8");

  try {
    const validRes = parseEvidence(tmpPath, "commit-abc-123");
    assert.strictEqual(validRes.valid, true);
    assert.strictEqual(validRes.firstCausalFailure, "ts-authkey-invalid");

    const mismatchRes = parseEvidence(tmpPath, "commit-different-sha");
    assert.strictEqual(mismatchRes.valid, false);
    assert.ok(mismatchRes.error.includes("SHA mismatch"));
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});
