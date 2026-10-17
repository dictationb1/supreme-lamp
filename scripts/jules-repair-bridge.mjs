#!/usr/bin/env node
// scripts/jules-repair-bridge.mjs
// Event-driven Jules API repair bridge logic with deduplication and secret protection.

import { redactSecrets } from "./rdp-evidence.mjs";
import { writeFileSync } from "node:fs";

export function evaluateBridgeDispatch(input = {}) {
  const {
    apiKey = process.env.JULES_API_KEY,
    bridgeEnabled = process.env.BRIDGE_ENABLED !== "false",
    runId = process.env.TRIGGER_RUN_ID || "0",
    runAttempt = process.env.TRIGGER_RUN_ATTEMPT || "1",
    headSha = process.env.TRIGGER_HEAD_SHA || "unknown-sha",
    runUrl = process.env.TRIGGER_RUN_URL || "",
    causalFailure = process.env.CAUSAL_FAILURE || "unknown-failure",
    logsSummary = process.env.LOGS_SUMMARY || "",
  } = input;

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

  const sanitizedLogs = redactSecrets(logsSummary);
  const promptText = `
An automated RDP production run failed on dictationb1/supreme-lamp.
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
    source: "sources/github/dictationb1/supreme-lamp",
    requirePlanApproval: false,
    autoCreatePr: true,
  };

  return {
    status: "READY_TO_DISPATCH",
    deduplicationKey: `dictationb1/supreme-lamp/${runId}/${runAttempt}`,
    payload: apiPayload,
    dispatched: false, // Set to true when actual HTTP POST completes
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const evalRes = evaluateBridgeDispatch();
  console.log(`[jules-repair-bridge] Status: ${evalRes.status}`);

  if (evalRes.status === "BRIDGE_NOT_CONFIGURED") {
    console.log("[jules-repair-bridge] NOTICE: Jules API bridge is not yet configured.");
    if (process.env.GITHUB_STEP_SUMMARY) {
      const summaryText = `
### ⚠️ Jules Repair Bridge Status: BRIDGE_NOT_CONFIGURED

Jules API bridge is currently not active because \`JULES_API_KEY\` secret is absent.

**ක්‍රියාත්මක කිරීමේ පියවර (Activation Steps):**
${evalRes.activationStepsSi.join("\n")}
`;
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, summaryText, { flag: "a" });
    }
  } else if (evalRes.status === "READY_TO_DISPATCH") {
    console.log(`[jules-repair-bridge] Prepared session dispatch for ${evalRes.deduplicationKey}`);
  }
}
