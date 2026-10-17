// tests/rdp-evidence-redaction.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("EVIDENCE-1: redactSecrets redacts Tailscale auth key", async () => {
  const { redactSecrets } = await import("../scripts/rdp-evidence.mjs");
  const sample = "Tailscale login failed using tskey-auth-k1234567890abcdef-userkey12345";
  const sanitized = redactSecrets(sample);

  assert.ok(!sanitized.includes("tskey-auth-k1234567890abcdef-userkey12345"));
  assert.ok(sanitized.includes("[REDACTED_TS_AUTHKEY]"));
});

test("EVIDENCE-2: redactSecrets redacts GitHub tokens and PATs", async () => {
  const { redactSecrets } = await import("../scripts/rdp-evidence.mjs");
  const sample = "Found token ghp_1234567890abcdef1234567890abcdef1234 and PAT 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O";
  const sanitized = redactSecrets(sample);

  assert.ok(!sanitized.includes("ghp_1234567890abcdef1234567890abcdef1234"));
  assert.ok(sanitized.includes("[REDACTED_GH_TOKEN]"));
  assert.ok(sanitized.includes("[REDACTED_GH_PAT]"));
});

test("EVIDENCE-3: redactSecrets redacts Authorization headers and env password strings", async () => {
  const { redactSecrets } = await import("../scripts/rdp-evidence.mjs");
  const sample = "Authorization: Bearer secrettoken123 and VNC_PASS=supersecretpassword";
  const sanitized = redactSecrets(sample);

  assert.ok(!sanitized.includes("secrettoken123"));
  assert.ok(!sanitized.includes("supersecretpassword"));
  assert.ok(sanitized.includes("VNC_PASS=[REDACTED]"));
});

test("EVIDENCE-4: createEvidenceRecord returns complete schema with redaction_verified=true", async () => {
  const { createEvidenceRecord } = await import("../scripts/rdp-evidence.mjs");
  const record = createEvidenceRecord({
    first_causal_failure: "ts-authkey-invalid",
    raw_logs_summary: "Failed with tskey-auth-9876543210123456",
  });

  assert.strictEqual(record.first_causal_failure, "ts-authkey-invalid");
  assert.strictEqual(record.redaction_verified, true);
  assert.ok(!JSON.stringify(record).includes("tskey-auth-9876543210123456"));
  assert.ok(record.start_timestamp);
  assert.ok(record.end_timestamp);
});
