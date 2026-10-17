// tests/jules-repair-bridge.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

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

test("BRIDGE-3: produces sanitized API payload with sourceContext and required flags", async () => {
  const { evaluateBridgeDispatch } = await import("../scripts/jules-repair-bridge.mjs");
  const tmpTracker = path.join(__dirname, "tmp-incidents-1.json");

  try {
    const res = evaluateBridgeDispatch({
      apiKey: "test-api-key-123",
      bridgeEnabled: true,
      runId: "12345",
      runAttempt: "1",
      headSha: "abcdef123456",
      logsSummary: "Failed with tskey-auth-secretkey12345",
      incidentsFile: tmpTracker,
    });

    assert.strictEqual(res.status, "READY_TO_DISPATCH");
    assert.strictEqual(res.deduplicationKey, "dictationb1/supreme-lamp/12345/1");
    assert.strictEqual(res.payload.requirePlanApproval, false);
    assert.strictEqual(res.payload.automationMode, "AUTO_CREATE_PR");
    assert.strictEqual(res.payload.sourceContext.source, "sources/github/dictationb1/supreme-lamp");
    assert.ok(!res.payload.prompt.includes("tskey-auth-secretkey12345"));
    assert.ok(res.payload.prompt.includes("[REDACTED_TS_AUTHKEY]"));
  } finally {
    if (fs.existsSync(tmpTracker)) fs.unlinkSync(tmpTracker);
  }
});

test("BRIDGE-4: performs HTTP POST dispatch and handles 201 response", async () => {
  const { dispatchJulesSession } = await import("../scripts/jules-repair-bridge.mjs");
  const tmpTracker = path.join(__dirname, "tmp-incidents-2.json");

  const mockFetch = async (url, opts) => {
    assert.strictEqual(opts.method, "POST");
    assert.strictEqual(opts.headers["X-Goog-Api-Key"], "valid-key-xyz");
    const body = JSON.parse(opts.body);
    assert.strictEqual(body.automationMode, "AUTO_CREATE_PR");
    return {
      status: 201,
      json: async () => ({ name: "sessions/session-999" }),
    };
  };

  try {
    const res = await dispatchJulesSession(
      {
        apiKey: "valid-key-xyz",
        bridgeEnabled: true,
        runId: "8888",
        runAttempt: "1",
        incidentsFile: tmpTracker,
      },
      mockFetch
    );

    assert.strictEqual(res.status, "DISPATCHED");
    assert.strictEqual(res.dispatched, true);
    assert.strictEqual(res.sessionId, "sessions/session-999");

    // Second call should return ALREADY_DISPATCHED
    const res2 = await dispatchJulesSession(
      {
        apiKey: "valid-key-xyz",
        bridgeEnabled: true,
        runId: "8888",
        runAttempt: "1",
        incidentsFile: tmpTracker,
      },
      mockFetch
    );

    assert.strictEqual(res2.status, "ALREADY_DISPATCHED");
    assert.strictEqual(res2.dispatched, true);
  } finally {
    if (fs.existsSync(tmpTracker)) fs.unlinkSync(tmpTracker);
  }
});

test("BRIDGE-5: handles 401/403 auth errors and 429 rate limiting", async () => {
  const { dispatchJulesSession } = await import("../scripts/jules-repair-bridge.mjs");
  const tmpTracker = path.join(__dirname, "tmp-incidents-3.json");

  const mock401Fetch = async () => ({
    status: 401,
    text: async () => "Unauthorized key",
  });

  try {
    const res = await dispatchJulesSession(
      {
        apiKey: "invalid-key",
        bridgeEnabled: true,
        runId: "9999",
        runAttempt: "1",
        incidentsFile: tmpTracker,
      },
      mock401Fetch
    );

    assert.strictEqual(res.status, "AUTH_ERROR");
    assert.strictEqual(res.dispatched, false);
    assert.ok(res.error.includes("HTTP 401"));
  } finally {
    if (fs.existsSync(tmpTracker)) fs.unlinkSync(tmpTracker);
  }
});
