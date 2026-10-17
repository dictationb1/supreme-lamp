#!/usr/bin/env node
// scripts/lab-observer.mjs
// Supervisor/collector observer for Windows lab execution.
// Captures phase transitions, process exit codes, heartbeats, service status, and sanitized logs.

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { redactSecrets } from "./rdp-evidence.mjs";

export function createInitialObserverState(phase = "INITIALIZING") {
  return {
    version: "1.0.0",
    repository: process.env.GITHUB_REPOSITORY || "dictationb1/supreme-lamp",
    source_sha: process.env.GITHUB_SHA || "unknown-sha",
    run_id: String(process.env.GITHUB_RUN_ID || "0"),
    run_attempt: String(process.env.GITHUB_RUN_ATTEMPT || "1"),
    runner_os: process.platform,
    status: "RUNNING", // RUNNING | PASSED | FAILED | BLOCKED | OBSERVABILITY_LOST
    start_timestamp: new Date().toISOString(),
    last_heartbeat: new Date().toISOString(),
    current_phase: phase,
    phases: [
      {
        phase: phase,
        status: "RUNNING",
        timestamp: new Date().toISOString(),
      },
    ],
    exit_codes: {},
    errors: [],
    observations: [],
    first_causal_failure: "none",
  };
}

export function updateObserverPhase(stateFile, phase, status, detail = {}) {
  let state;
  if (existsSync(stateFile)) {
    try {
      state = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      state = createInitialObserverState(phase);
    }
  } else {
    state = createInitialObserverState(phase);
  }

  state.current_phase = phase;
  state.last_heartbeat = new Date().toISOString();

  const phaseRecord = {
    phase: phase,
    status: status,
    timestamp: new Date().toISOString(),
    ...detail,
  };

  state.phases.push(phaseRecord);

  if (detail.exit_code !== undefined && detail.command) {
    state.exit_codes[detail.command] = detail.exit_code;
  }

  if (status === "FAILED" || status === "BLOCKED") {
    if (state.first_causal_failure === "none" && detail.causal_failure) {
      state.first_causal_failure = detail.causal_failure;
    }
    if (status === "FAILED" && state.status !== "BLOCKED") {
      state.status = "FAILED";
    } else if (status === "BLOCKED") {
      state.status = "BLOCKED";
    }
    if (detail.error) {
      state.errors.push(redactSecrets(String(detail.error)));
    }
  }

  const sanitizedState = JSON.parse(redactSecrets(JSON.stringify(state)));
  writeFileSync(stateFile, JSON.stringify(sanitizedState, null, 2), "utf8");

  // If GITHUB_STEP_SUMMARY is set, append progress update
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      const summaryText = redactSecrets(
        `[Observer ${new Date().toISOString()}] Phase: **${phase}** | Status: **${status}** ${
          detail.causal_failure ? `(Reason: \`${detail.causal_failure}\`)` : ""
        }\n`
      );
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryText, "utf8");
    } catch {
      // ignore step summary write failures
    }
  }

  return sanitizedState;
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || "heartbeat";
  const stateFile = process.env.OBSERVER_STATE_FILE || "rdp-observer-status.json";

  if (action === "init") {
    const phase = args[1] || "INITIALIZING";
    const state = createInitialObserverState(phase);
    writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
    console.log(`[lab-observer] Initialized observer state file ${stateFile} at phase ${phase}`);
  } else if (action === "update") {
    const phase = args[1] || "IN_PROGRESS";
    const status = args[2] || "RUNNING";
    const causalFailure = args[3] || null;
    const errorMsg = args[4] || null;

    updateObserverPhase(stateFile, phase, status, {
      causal_failure: causalFailure,
      error: errorMsg,
    });
    console.log(`[lab-observer] Updated phase ${phase} -> ${status}`);
  } else if (action === "heartbeat") {
    let state;
    if (existsSync(stateFile)) {
      try {
        state = JSON.parse(readFileSync(stateFile, "utf8"));
      } catch {
        state = createInitialObserverState();
      }
    } else {
      state = createInitialObserverState();
    }
    state.last_heartbeat = new Date().toISOString();
    writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
    console.log(`[lab-observer] Heartbeat updated at ${state.last_heartbeat}`);
  } else if (action === "finish") {
    const finalVerdict = args[1] || "PASSED";
    const causalFailure = args[2] || "none";
    updateObserverPhase(stateFile, "CLEANUP_AND_FINAL", finalVerdict, {
      causal_failure: causalFailure,
    });
    console.log(`[lab-observer] Finished with verdict ${finalVerdict}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[lab-observer] Error: ${err.message}`);
    process.exit(1);
  });
}
