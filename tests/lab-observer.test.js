// tests/lab-observer.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TEST_STATE_FILE = path.join(__dirname, "test-observer-status.json");

function cleanup() {
  if (fs.existsSync(TEST_STATE_FILE)) {
    fs.unlinkSync(TEST_STATE_FILE);
  }
}

test.beforeEach(cleanup);
test.afterEach(cleanup);

test("OBSERVER-1: non-zero exit code forces FAILED phase status and sets causal failure", async () => {
  const { createInitialObserverState, updateObserverPhase } = await import("../scripts/lab-observer.mjs");

  const state = createInitialObserverState("TEST_PHASE");
  fs.writeFileSync(TEST_STATE_FILE, JSON.stringify(state, null, 2), "utf8");

  const updated = updateObserverPhase(TEST_STATE_FILE, "TEST_COMMAND", "PASSED", {
    command: "vitest",
    exit_code: 1,
    causal_failure: "smoke-tests-failed",
  });

  assert.strictEqual(updated.status, "FAILED");
  assert.strictEqual(updated.first_causal_failure, "smoke-tests-failed");
  assert.strictEqual(updated.phases[updated.phases.length - 1].status, "FAILED");
});

test("OBSERVER-2: test failure followed by successful finish/cleanup preserves FAILED verdict", async () => {
  const { createInitialObserverState, updateObserverPhase, finishObserver } = await import("../scripts/lab-observer.mjs");

  const state = createInitialObserverState("STATIC");
  fs.writeFileSync(TEST_STATE_FILE, JSON.stringify(state, null, 2), "utf8");

  updateObserverPhase(TEST_STATE_FILE, "TEST_SUITE", "FAILED", {
    causal_failure: "assertion-failed",
    error: "Line 305: expected row text",
  });

  const finalState = finishObserver(TEST_STATE_FILE, "PASSED", "none");

  assert.strictEqual(finalState.status, "FAILED");
  assert.strictEqual(finalState.first_causal_failure, "assertion-failed");
});

test("OBSERVER-3: uncompleted RUNNING phase automatically converts to FAILED on finish", async () => {
  const { createInitialObserverState, updateObserverPhase, finishObserver } = await import("../scripts/lab-observer.mjs");

  const state = createInitialObserverState("CONFIGURATION_PRESENT");
  fs.writeFileSync(TEST_STATE_FILE, JSON.stringify(state, null, 2), "utf8");

  updateObserverPhase(TEST_STATE_FILE, "SMOKE_TESTS", "RUNNING");

  // Step failed before calling updateObserverPhase with PASSED
  const finalState = finishObserver(TEST_STATE_FILE, "PASSED", "none");

  assert.strictEqual(finalState.status, "FAILED");
  assert.strictEqual(finalState.first_causal_failure, "smoke_tests-failed");
});

test("OBSERVER-4: fully successful selected profile yields PASSED verdict", async () => {
  const { createInitialObserverState, updateObserverPhase, finishObserver } = await import("../scripts/lab-observer.mjs");

  const state = createInitialObserverState("CONFIGURATION_PRESENT");
  fs.writeFileSync(TEST_STATE_FILE, JSON.stringify(state, null, 2), "utf8");

  updateObserverPhase(TEST_STATE_FILE, "UNIT_TESTS", "PASSED", { exit_code: 0, command: "node-test" });
  updateObserverPhase(TEST_STATE_FILE, "SMOKE_TESTS", "PASSED", { exit_code: 0, command: "vitest" });

  const finalState = finishObserver(TEST_STATE_FILE, "PASSED", "none");

  assert.strictEqual(finalState.status, "PASSED");
  assert.strictEqual(finalState.first_causal_failure, "none");
});

test("OBSERVER-5: BLOCKED status is preserved over FAILED and retained on finish", async () => {
  const { createInitialObserverState, updateObserverPhase, finishObserver } = await import("../scripts/lab-observer.mjs");

  const state = createInitialObserverState("CONFIGURATION_PRESENT");
  fs.writeFileSync(TEST_STATE_FILE, JSON.stringify(state, null, 2), "utf8");

  updateObserverPhase(TEST_STATE_FILE, "TAILSCALE_ENROLL", "BLOCKED", {
    causal_failure: "ts-authkey-missing",
    error: "TS_AUTHKEY secret missing",
  });

  const finalState = finishObserver(TEST_STATE_FILE, "PASSED", "none");

  assert.strictEqual(finalState.status, "BLOCKED");
  assert.strictEqual(finalState.first_causal_failure, "ts-authkey-missing");
});
