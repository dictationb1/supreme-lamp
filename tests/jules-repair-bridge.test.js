// tests/jules-repair-bridge.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("BRIDGE-1: returns BRIDGE_NOT_CONFIGURED when JULES_API_KEY is missing", async () => {
  const { evaluateBridgeDispatch } = await import("../scripts/jules-repair-bridge.mjs");
  const res = evaluateBridgeDispatch({ apiKey: "", bridgeEnabled: true });

  assert.strictEqual(res.status, "BRIDGE_NOT_CONFIGURED");
  assert.strictEqual(res.dispatched, false);
  assert.ok(res.activationStepsSi.length > 0);
});

test("BRIDGE-2: respects bridgeEnabled=false disable switch", async () => {
  const { evaluateBridgeDispatch } = await import("../scripts/jules-repair-bridge.mjs");
  const res = evaluateBridgeDispatch({ apiKey: "some-key", bridgeEnabled: false });

  assert.strictEqual(res.status, "DISABLED");
  assert.strictEqual(res.dispatched, false);
});

test("BRIDGE-3: produces sanitized API payload with correct flags", async () => {
  const { evaluateBridgeDispatch } = await import("../scripts/jules-repair-bridge.mjs");
  const res = evaluateBridgeDispatch({
    apiKey: "test-api-key-123",
    bridgeEnabled: true,
    runId: "12345",
    runAttempt: "1",
    headSha: "abcdef123456",
    logsSummary: "Failed with tskey-auth-secretkey12345",
  });

  assert.strictEqual(res.status, "READY_TO_DISPATCH");
  assert.strictEqual(res.deduplicationKey, "dictationb1/supreme-lamp/12345/1");
  assert.strictEqual(res.payload.requirePlanApproval, false);
  assert.strictEqual(res.payload.autoCreatePr, true);
  assert.ok(!res.payload.prompt.includes("tskey-auth-secretkey12345"));
  assert.ok(res.payload.prompt.includes("[REDACTED_TS_AUTHKEY]"));
});
