// tests/rdp-cert-classification.test.js
// Regression tests for RDP Certificate Classification and Failure Propagation Contract

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MAIN_YML_PATH = path.join(__dirname, "..", ".github", "workflows", "main.yml");

/**
 * Extracted Certificate Stderr Classifier Function (matching main.yml implementation)
 * @param {string} stderr
 * @returns {{ code: string, isTransient: boolean }}
 */
function classifyCertError(stderr) {
  const certErrText = (stderr || "").trim();
  if (/does not support getting TLS certs|HTTPS certificates disabled|account does not support/i.test(certErrText)) {
    return { code: "cert-capability-unavailable", isTransient: false };
  }
  if (/access denied|unauthorized|forbidden|permission denied/i.test(certErrText)) {
    return { code: "cert-auth-failed", isTransient: false };
  }
  if (/invalid hostname|not a valid domain/i.test(certErrText)) {
    return { code: "cert-invalid-hostname", isTransient: false };
  }
  if (/rate limit|too many requests/i.test(certErrText)) {
    return { code: "cert-rate-limit", isTransient: false };
  }
  if (/ACME|challenge failed|DNS TXT record/i.test(certErrText)) {
    return { code: "cert-acme-failed", isTransient: true };
  }
  return { code: "cert-transient-network", isTransient: true };
}

/**
 * Simulates tailscale cert retry loop execution based on classified errors
 * @param {Array<string>} stderrAttempts
 * @returns {{ attemptsRan: number, finalCode: string, certOk: boolean }}
 */
function simulateCertRetryLoop(stderrAttempts) {
  let certOk = false;
  let certCode = "cert-not-bound";
  let attemptsRan = 0;

  for (let attempt = 1; attempt <= stderrAttempts.length; attempt++) {
    attemptsRan = attempt;
    const stderr = stderrAttempts[attempt - 1];
    if (stderr === "SUCCESS") {
      certOk = true;
      certCode = "ok";
      break;
    }

    const { code, isTransient } = classifyCertError(stderr);
    certCode = code;

    if (!isTransient) {
      break; // Halt attempts immediately on non-transient deterministic errors
    }
  }

  return { attemptsRan, finalCode: certCode, certOk };
}

test("CERT-1: exact current certificate capability error classifies as cert-capability-unavailable and halts immediately", () => {
  const stderr = "getting certs for ghrdp-test.ts.net: your Tailscale account does not support getting TLS certs";
  const result = classifyCertError(stderr);
  assert.strictEqual(result.code, "cert-capability-unavailable");
  assert.strictEqual(result.isTransient, false);

  const loopRes = simulateCertRetryLoop([stderr, stderr, stderr]);
  assert.strictEqual(loopRes.attemptsRan, 1, "Must exit retry loop on attempt 1 for deterministic capability error");
  assert.strictEqual(loopRes.finalCode, "cert-capability-unavailable");
  assert.strictEqual(loopRes.certOk, false);
});

test("CERT-2: permission/authorization failure classifies as cert-auth-failed and halts immediately", () => {
  const stderr = "tailscale cert failed: access denied for tailnet operation";
  const result = classifyCertError(stderr);
  assert.strictEqual(result.code, "cert-auth-failed");
  assert.strictEqual(result.isTransient, false);

  const loopRes = simulateCertRetryLoop([stderr, stderr, stderr]);
  assert.strictEqual(loopRes.attemptsRan, 1);
  assert.strictEqual(loopRes.finalCode, "cert-auth-failed");
});

test("CERT-3: invalid hostname classifies as cert-invalid-hostname and halts immediately", () => {
  const stderr = "getting certs: invalid hostname provided";
  const result = classifyCertError(stderr);
  assert.strictEqual(result.code, "cert-invalid-hostname");
  assert.strictEqual(result.isTransient, false);

  const loopRes = simulateCertRetryLoop([stderr]);
  assert.strictEqual(loopRes.attemptsRan, 1);
  assert.strictEqual(loopRes.finalCode, "cert-invalid-hostname");
});

test("CERT-4: rate limiting classifies as cert-rate-limit and halts immediately", () => {
  const stderr = "error: Let's Encrypt rate limit exceeded for domain";
  const result = classifyCertError(stderr);
  assert.strictEqual(result.code, "cert-rate-limit");
  assert.strictEqual(result.isTransient, false);

  const loopRes = simulateCertRetryLoop([stderr]);
  assert.strictEqual(loopRes.attemptsRan, 1);
  assert.strictEqual(loopRes.finalCode, "cert-rate-limit");
});

test("CERT-5: ACME challenge failure classifies as cert-acme-failed and allows retries", () => {
  const stderr = "ACME DNS TXT record challenge failed to propagate";
  const result = classifyCertError(stderr);
  assert.strictEqual(result.code, "cert-acme-failed");
  assert.strictEqual(result.isTransient, true);

  const loopRes = simulateCertRetryLoop([stderr, stderr, "SUCCESS"]);
  assert.strictEqual(loopRes.attemptsRan, 3, "Transient failure retries until success");
  assert.strictEqual(loopRes.certOk, true);
  assert.strictEqual(loopRes.finalCode, "ok");
});

test("CERT-6: transient network failure classifies as cert-transient-network and retries", () => {
  const stderr = "connection reset by peer / dial tcp timeout";
  const result = classifyCertError(stderr);
  assert.strictEqual(result.code, "cert-transient-network");
  assert.strictEqual(result.isTransient, true);

  const loopRes = simulateCertRetryLoop([stderr, "SUCCESS"]);
  assert.strictEqual(loopRes.attemptsRan, 2);
  assert.strictEqual(loopRes.certOk, true);
});

test("CERT-7: main.yml workflow static assertions for cert classification and F92 failure propagation", () => {
  const mainYml = fs.readFileSync(MAIN_YML_PATH, "utf8");

  // Verify certificate classification markers in main.yml
  assert.ok(mainYml.includes("cert-capability-unavailable"), "main.yml must contain cert-capability-unavailable code");
  assert.ok(mainYml.includes("cert-auth-failed"), "main.yml must contain cert-auth-failed code");
  assert.ok(mainYml.includes("cert-invalid-hostname"), "main.yml must contain cert-invalid-hostname code");
  assert.ok(mainYml.includes("cert-rate-limit"), "main.yml must contain cert-rate-limit code");
  assert.ok(mainYml.includes("cert-acme-failed"), "main.yml must contain cert-acme-failed code");
  assert.ok(mainYml.includes("cert-transient-network"), "main.yml must contain cert-transient-network code");
  assert.ok(mainYml.includes("deterministic non-transient error detected"), "main.yml must log early exit for deterministic error");

  // Verify F92 smoke check failure propagation guard
  assert.ok(mainYml.includes("[f92 smoke] SKIPPED: backend service startup was not reached due to earlier provisioning failure"), "F92 smoke must contain skip guard message");
});
