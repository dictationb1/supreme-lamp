#!/usr/bin/env node
// scripts/lab-observer.mjs
// Supervisor/collector observer for Windows lab execution.
// Captures phase transitions, process exit codes, heartbeats, service status, and sanitized logs.

import { pathToFileURL } from 'node:url';
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

  // Rule: Non-zero exit code forces FAILED status
  let effectiveStatus = status;
  let effectiveCausal = detail.causal_failure || null;

  if (detail.exit_code !== undefined && detail.exit_code !== 0) {
    effectiveStatus = "FAILED";
    if (!effectiveCausal) {
      effectiveCausal = `exit-code-${detail.exit_code}`;
    }
  }

  state.current_phase = phase;
  state.last_heartbeat = new Date().toISOString();

  // Find existing phase record if present, or add new
  const existingIndex = state.phases.findIndex((p) => p.phase === phase);
  const phaseRecord = {
    phase: phase,
    status: effectiveStatus,
    timestamp: new Date().toISOString(),
    ...detail,
    ...(effectiveCausal ? { causal_failure: effectiveCausal } : {}),
  };

  if (existingIndex >= 0) {
    state.phases[existingIndex] = { ...state.phases[existingIndex], ...phaseRecord };
  } else {
    state.phases.push(phaseRecord);
  }

  if (detail.exit_code !== undefined && detail.command) {
    state.exit_codes[detail.command] = detail.exit_code;
  }

  // Rule: Preserve earliest causal failure and cannot overwrite FAILED/BLOCKED with PASSED
  if (effectiveStatus === "FAILED" || effectiveStatus === "BLOCKED") {
    if (state.first_causal_failure === "none" && effectiveCausal) {
      state.first_causal_failure = effectiveCausal;
    }
    if (effectiveStatus === "FAILED" && state.status !== "BLOCKED") {
      state.status = "FAILED";
    } else if (effectiveStatus === "BLOCKED") {
      state.status = "BLOCKED";
    }
    if (detail.error) {
      state.errors.push(redactSecrets(String(detail.error)));
    }
  } else if (effectiveStatus === "PASSED") {
    if (state.status === "RUNNING") {
      // Check if any other phase had failed
      const hasFailed = state.phases.some((p) => p.status === "FAILED" || p.status === "BLOCKED");
      if (!hasFailed) {
        state.status = "PASSED";
      }
    }
  }

  const sanitizedState = JSON.parse(redactSecrets(JSON.stringify(state)));
  writeFileSync(stateFile, JSON.stringify(sanitizedState, null, 2), "utf8");

  // If GITHUB_STEP_SUMMARY is set, append progress update
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      const summaryText = redactSecrets(
        `[Observer ${new Date().toISOString()}] Phase: **${phase}** | Status: **${effectiveStatus}** ${
          effectiveCausal ? `(Reason: \`${effectiveCausal}\`)` : ""
        }\n`
      );
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryText, "utf8");
    } catch {
      // ignore step summary write failures
    }
  }

  return sanitizedState;
}

export function finishObserver(stateFile, requestedVerdict = "PASSED", requestedCausal = "none") {
  let state;
  if (existsSync(stateFile)) {
    try {
      state = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      state = createInitialObserverState("CLEANUP_AND_FINAL");
    }
  } else {
    state = createInitialObserverState("CLEANUP_AND_FINAL");
  }

  let finalVerdict = requestedVerdict;
  let finalCausal = requestedCausal;

  // Check for any uncompleted phase (left in RUNNING state, ignoring initial phase if later phases ran)
  const uncompleted = state.phases.slice().reverse().find((p) => p.status === "RUNNING" && p.phase !== "CLEANUP_AND_FINAL");
  if (uncompleted && state.phases.length > 1 && uncompleted.phase === state.phases[0].phase) {
    // Initializing phase was superseded by later phases without explicit status update
    uncompleted.status = "PASSED";
  } else if (uncompleted) {
    uncompleted.status = "FAILED";
    uncompleted.causal_failure = uncompleted.causal_failure || `${uncompleted.phase.toLowerCase()}-failed`;
    if (state.first_causal_failure === "none") {
      state.first_causal_failure = uncompleted.causal_failure;
    }
    state.status = "FAILED";
  }

  // Rule: Cleanup success cannot erase a prior test failure
  if (state.status === "FAILED" || state.status === "BLOCKED" || state.first_causal_failure !== "none") {
    finalVerdict = state.status !== "RUNNING" ? state.status : "FAILED";
    finalCausal = state.first_causal_failure !== "none" ? state.first_causal_failure : (requestedCausal !== "none" ? requestedCausal : "lab-execution-failed");
  } else if (finalVerdict === "PASSED") {
    state.status = "PASSED";
  }

  return updateObserverPhase(stateFile, "CLEANUP_AND_FINAL", finalVerdict, {
    causal_failure: finalCausal,
  });
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
    const state = finishObserver(stateFile, finalVerdict, causalFailure);
    console.log(`[lab-observer] Finished with verdict ${state.status} (causal: ${state.first_causal_failure})`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[lab-observer] Error: ${err.message}`);
    process.exit(1);
  });
}
