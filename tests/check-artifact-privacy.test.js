"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

test("Artifact Privacy Scanner: allows docs/ directory and documented placeholders", async () => {
  const { scanDirectory } = await import("../scripts/check-artifact-privacy.mjs");
  const docsDir = path.join(__dirname, "..", "docs");
  const violations = scanDirectory(docsDir);
  assert.deepEqual(violations, [], "Expected clean scan of docs/ directory");
});

test("Artifact Privacy Scanner (negative control): detects Tailscale literal auth key and redacts context", async () => {
  const { scanDirectory } = await import("../scripts/check-artifact-privacy.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-test-"));
  const badFile = path.join(tmp, "secret.txt");
  const secretKey = "tskey-auth-k1234567890abcdef1234567890";
  fs.writeFileSync(badFile, `Key is: ${secretKey}`, "utf8");

  const violations = scanDirectory(tmp);
  fs.rmSync(tmp, { recursive: true, force: true });

  assert.equal(violations.length, 1, "Expected 1 violation");
  assert.equal(violations[0].type, "Tailscale Auth Key");
  assert.ok(!violations[0].redactedMatch.includes(secretKey), "Match must be redacted");
});
