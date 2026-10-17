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

test("HELPER-2: parseEvidence validates SHA, measurements, and causal failure", async () => {
  const { parseEvidence } = await import("../scripts/jules-lab-helper.mjs");
  const tmpPath = path.join(__dirname, "tmp-evidence.json");

  const sampleEvidence = {
    source_sha: "commit-abc-123",
    phase: "windows-integration",
    start_timestamp: new Date().toISOString(),
    first_causal_failure: "cert-capability-unavailable",
    redaction_verified: true,
  };

  fs.writeFileSync(tmpPath, JSON.stringify(sampleEvidence), "utf8");

  try {
    const validRes = parseEvidence(tmpPath, "commit-abc-123");
    assert.strictEqual(validRes.valid, true);
    assert.strictEqual(validRes.verdict, "BLOCKED");
    assert.strictEqual(validRes.firstCausalFailure, "cert-capability-unavailable");

    const mismatchRes = parseEvidence(tmpPath, "commit-different-sha");
    assert.strictEqual(mismatchRes.valid, false);
    assert.ok(mismatchRes.error.includes("SHA mismatch"));
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

test("HELPER-3: verifyAccess returns READ_ONLY when token is absent", async () => {
  const originalToken = process.env.GH_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;

  try {
    const { verifyAccess } = await import("../scripts/jules-lab-helper.mjs");
    const res = verifyAccess();
    assert.strictEqual(res.authorized, false);
    assert.strictEqual(res.mode, "READ_ONLY");
  } finally {
    if (originalToken) process.env.GH_TOKEN = originalToken;
  }
});

test("HELPER-4: parseEvidence rejects incomplete records missing phase or timestamps", async () => {
  const { parseEvidence } = await import("../scripts/jules-lab-helper.mjs");
  const tmpPath = path.join(__dirname, "tmp-incomplete-evidence.json");

  const incompleteEvidence = {
    source_sha: "commit-abc-123",
    first_causal_failure: "none",
  };

  fs.writeFileSync(tmpPath, JSON.stringify(incompleteEvidence), "utf8");

  try {
    const res = parseEvidence(tmpPath, "commit-abc-123");
    assert.strictEqual(res.valid, false);
    assert.ok(res.error.includes("missing required phase or timestamp"));
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});
