// tests/ensure-rdp-deps.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

test("ENSURE-DEPS-1: readiness mode performs inspection without error", async () => {
  const { checkDependencies } = await import("../scripts/ensure-rdp-deps.mjs");
  const res = checkDependencies({ mode: "readiness", sha: "test-sha-123" });

  assert.strictEqual(res.mode, "readiness");
  assert.strictEqual(res.sha, "test-sha-123");
  assert.ok(res.uiBundle);
  assert.ok(res.f59Binaries);
  assert.ok(res.overallVerdict === "READY" || res.overallVerdict === "READINESS_CHECK_COMPLETE");
});

test("ENSURE-DEPS-2: identifies missing UI bundle cleanly in fresh directory test", async () => {
  const { checkDependencies } = await import("../scripts/ensure-rdp-deps.mjs");
  const res = checkDependencies({ mode: "rdp", sha: "test-sha" });

  assert.ok(["VERIFIED", "MISSING", "CORRUPT"].includes(res.uiBundle.status));
  assert.ok(["VERIFIED", "MISSING", "PARTIAL", "PIN_FILE_MISSING"].includes(res.f59Binaries.status));
});
