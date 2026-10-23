#!/usr/bin/env node
// scripts/jules-repair-bridge.mjs
// Event-driven Jules API repair bridge logic with HTTP dispatch, durable deduplication, and secret protection.

import { redactSecrets } from "./rdp-evidence.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const INCIDENTS_FILE = process.env.INCIDENTS_TRACKING_FILE || "jules-repair-incidents.json";

export function loadIncidentTracker(filePath = INCIDENTS_FILE) {
  if (existsSync(filePath)) {
    try {
      return JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      return { incidents: {} };
    }
  }
  return { incidents: {} };
}

export function saveIncidentTracker(data, filePath = INCIDENTS_FILE) {
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn(`[jules-repair-bridge] Failed to save incident tracker: ${err.message}`);
  }
}

export function fetchTriggerRunLogs(runId, repo = "dictationb1/supreme-lamp") {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token || !runId || runId === "0") {
    return "No logs available (run ID or GitHub token missing).";
  }

  try {
    const cmd = `gh run view ${runId} --log -R "${repo}"`;
    const res = execSync(cmd, {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: token },
    });
    return redactSecrets(res.slice(0, 4000));
  } catch (err) {
    return `Could not fetch logs for run ${runId}: ${err.message}`;
  }
}

export function evaluateBridgeDispatch(input = {}) {
  const {
    apiKey = process.env.JULES_API_KEY,
    runStatus = process.env.RUN_STATUS || 'completed',
    runConclusion = process.env.RUN_CONCLUSION || 'failure',
    updatedAt = process.env.UPDATED_AT || new Date().toISOString(),
    bridgeEnabled = process.env.BRIDGE_ENABLED !== "false",
    repo = process.env.GITHUB_REPOSITORY || "dictationb1/supreme-lamp",
    branch = process.env.TRIGGER_BRANCH || "main",
    runId = process.env.TRIGGER_RUN_ID || "0",
    runAttempt = process.env.TRIGGER_RUN_ATTEMPT || "1",
    headSha = process.env.TRIGGER_HEAD_SHA || "unknown-sha",
    runUrl = process.env.TRIGGER_RUN_URL || "",
    causalFailure = process.env.CAUSAL_FAILURE || "unknown-failure",
    logsSummary = process.env.LOGS_SUMMARY || "",
  } = input;


  const stallThresholdExceeded = (new Date() - new Date(input.updatedAt || new Date())) > 15 * 60 * 1000;
  const isStalled = input.runStatus === 'in_progress' && stallThresholdExceeded;
  if (input.runStatus === 'in_progress' && !isStalled) {
      return {
          status: "IN_PROGRESS_NOT_STALLED",
          reason: "Run is in progress but has not exceeded stall threshold.",
          dispatched: false
      };
  }

  if (!bridgeEnabled) {
    return {
      status: "DISABLED",
      reason: "BRIDGE_ENABLED is set to false",
      dispatched: false,
    };
  }

  if (!apiKey || apiKey.trim() === "") {
    return {
      status: "BRIDGE_NOT_CONFIGURED",
      reason: "JULES_API_KEY secret is not configured in repository settings.",
      activationStepsSi: [
        "1. Github Repository Settings > Secrets and variables > Actions වෙත යන්න.",
        "2. 'JULES_API_KEY' නමින් නව Repository secret එකක් සාදා ඔබගේ Jules API Key එක ඇතුලත් කරන්න.",
        "3. තහවුරු කිරීමෙන් පසු RDP Failure Bridge ස්වයංක්‍රීයව සක්‍රීය වේ.",
      ],
      dispatched: false,
    };
  }

  const deduplicationKey = `${repo}/${runId}/${runAttempt}`;
  const tracker = loadIncidentTracker(input.incidentsFile || INCIDENTS_FILE);

  if (tracker.incidents && tracker.incidents[deduplicationKey]?.status === "DISPATCHED") {
    return {
      status: "ALREADY_DISPATCHED",
      reason: `Incident ${deduplicationKey} has already been dispatched.`,
      deduplicationKey,
      dispatched: true,
      existingSession: tracker.incidents[deduplicationKey],
    };
  }

  const rawLogs = logsSummary || fetchTriggerRunLogs(runId, repo);
  const sanitizedLogs = redactSecrets(rawLogs);

  const promptText = `
An automated RDP production run failed on ${repo}.
Run URL: ${runUrl}
Commit SHA: ${headSha}
Run ID: ${runId} (Attempt: ${runAttempt})
Causal Failure: ${causalFailure}

Log Summary:
${sanitizedLogs}

Please analyze this failure evidence, reproduce using the reusable lab workflow (.github/workflows/rdp-lab.yml), fix the issue, and submit a PR with verification.
`.trim();

  const apiPayload = {
    prompt: promptText,
    sourceContext: {
      githubRepoContext: {
        startingBranch: branch,
      },
    },
    automationMode: "AUTO_CREATE_PR",
    requirePlanApproval: false,
  };

  return {
    status: "READY_TO_DISPATCH",
    deduplicationKey,
    payload: apiPayload,
    apiKey,
    dispatched: false,
  };
}

export async function dispatchJulesSession(input = {}, fetchFn = globalThis.fetch) {
  const evalRes = evaluateBridgeDispatch(input);
  if (evalRes.status !== "READY_TO_DISPATCH") {
    return evalRes;
  }

  const endpoint = input.apiEndpoint || process.env.JULES_API_ENDPOINT || "https://jules.googleapis.com/v1alpha/sessions";

  try {
    if (!fetchFn) {
      throw new Error("HTTP fetch function is not available in environment");
    }

    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": evalRes.apiKey,
      },
      body: JSON.stringify(evalRes.payload),
    });

    if (res.status === 200 || res.status === 201) {
      const body = await res.json().catch(() => ({}));
      const record = {
        status: "DISPATCHED",
        timestamp: new Date().toISOString(),
        deduplicationKey: evalRes.deduplicationKey,
        sessionId: body.name || body.id || "session-created",
        httpStatus: res.status,
      };

      const tracker = loadIncidentTracker(input.incidentsFile || INCIDENTS_FILE);
      tracker.incidents[evalRes.deduplicationKey] = record;
      saveIncidentTracker(tracker, input.incidentsFile || INCIDENTS_FILE);

      return {
        ...evalRes,
        status: "DISPATCHED",
        dispatched: true,
        sessionId: record.sessionId,
        apiResponse: body,
      };
    } else if (res.status === 401 || res.status === 403) {
      return {
        ...evalRes,
        status: "AUTH_ERROR",
        dispatched: false,
        error: `Jules API rejected authentication (HTTP ${res.status}). Check JULES_API_KEY validity.`,
      };
    } else if (res.status === 429) {
      return {
        ...evalRes,
        status: "RATE_LIMITED",
        dispatched: false,
        error: `Jules API rate limit reached (HTTP 429).`,
      };
    } else {
      const errBody = await res.text().catch(() => "");
      return {
        ...evalRes,
        status: "DISPATCH_FAILED",
        dispatched: false,
        error: `Jules API request failed with status HTTP ${res.status}: ${errBody}`,
      };
    }
  } catch (err) {
    return {
      ...evalRes,
      status: "DISPATCH_ERROR",
      dispatched: false,
      error: `Jules API HTTP dispatch exception: ${err.message}`,
    };
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  dispatchJulesSession().then((res) => {
    console.log(`[jules-repair-bridge] Result Status: ${res.status}`);

    if (res.status === "BRIDGE_NOT_CONFIGURED") {
      console.log("[jules-repair-bridge] NOTICE: Jules API bridge is not configured.");
      if (process.env.GITHUB_STEP_SUMMARY) {
        const summaryText = `
### ⚠️ Jules Repair Bridge Status: BRIDGE_NOT_CONFIGURED

Jules API bridge is currently not active because \`JULES_API_KEY\` secret is absent.

**ක්‍රියාත්මක කිරීමේ පියවර (Activation Steps):**
${res.activationStepsSi.join("\n")}
`;
        writeFileSync(process.env.GITHUB_STEP_SUMMARY, summaryText, { flag: "a" });
      }
    } else if (res.status === "DISPATCHED") {
      console.log(`[jules-repair-bridge] Successfully dispatched session ${res.sessionId} for ${res.deduplicationKey}`);
      if (process.env.GITHUB_STEP_SUMMARY) {
        const summaryText = `
### 🚀 Jules Repair Session Dispatched

- **Incident Key**: \`${res.deduplicationKey}\`
- **Session ID**: \`${res.sessionId}\`
- **Automation Mode**: \`AUTO_CREATE_PR\`
`;
        writeFileSync(process.env.GITHUB_STEP_SUMMARY, summaryText, { flag: "a" });
      }
    } else if (res.error) {
      console.error(`[jules-repair-bridge] Error: ${res.error}`);
    }
  });
}
