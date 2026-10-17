#!/usr/bin/env node
// scripts/jules-lab-helper.mjs
// Permanent, reusable CLI helper for Jules sessions to manage lab runs and inspect evidence.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

function getGhToken() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
}

function getRepo() {
  return process.env.GITHUB_REPOSITORY || "dictationb1/supreme-lamp";
}

export function execGhApi(endpoint, options = {}) {
  const token = getGhToken();
  if (!token) {
    throw new Error("GH_TOKEN or GITHUB_TOKEN is required for GitHub API access");
  }
  const method = options.method || "GET";
  const bodyData = options.body ? JSON.stringify(options.body) : null;

  let cmd = `gh api -X ${method} "${endpoint}"`;
  if (bodyData) {
    cmd += ` --input -`;
  }

  try {
    const res = execSync(cmd, {
      input: bodyData || undefined,
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: token },
    });
    return res ? JSON.parse(res) : {};
  } catch (err) {
    throw new Error(`GitHub API error on ${endpoint}: ${err.message}`);
  }
}

export function getCurrentPrInfo() {
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    return { sha, branch, repo: getRepo() };
  } catch {
    return { sha: process.env.GITHUB_SHA || "unknown", branch: "unknown", repo: getRepo() };
  }
}

export function verifyAccess() {
  const token = getGhToken();
  if (!token) {
    return { authorized: false, mode: "READ_ONLY", reason: "GitHub API token is absent" };
  }

  try {
    const repo = getRepo();
    const res = execGhApi(`repos/${repo}`);
    return {
      authorized: true,
      repo: res.full_name || repo,
      permissions: res.permissions || {},
    };
  } catch (err) {
    return { authorized: false, mode: "UNAUTHORIZED", error: err.message };
  }
}

export function dispatchLab(options = {}) {
  const repo = options.repo || getRepo();
  const profile = options.profile || "static";
  const sourceSha = options.sourceSha || options.sha || getCurrentPrInfo().sha;
  const injectedFailure = options.injectedFailure || "NONE";
  const ref = options.branch || getCurrentPrInfo().branch || "main";

  const endpoint = `repos/${repo}/actions/workflows/rdp-lab.yml/dispatches`;
  const body = {
    ref: ref,
    inputs: {
      profile: profile,
      source_sha: sourceSha,
      injected_failure: injectedFailure,
    },
  };

  execGhApi(endpoint, { method: "POST", body });
  return { dispatched: true, profile, sourceSha, injectedFailure, repo, ref };
}

export async function waitLabRun(repo = getRepo(), targetSha = null, pollIntervalMs = 5000, maxWaitMs = 300000) {
  const sha = targetSha || getCurrentPrInfo().sha;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const runsRes = execGhApi(`repos/${repo}/actions/runs?workflow_id=rdp-lab.yml&event=workflow_dispatch`);
      const runs = runsRes.workflow_runs || [];
      const matchingRun = runs.find((r) => r.head_sha === sha || r.head_commit?.id === sha);

      if (matchingRun) {
        if (matchingRun.status === "completed") {
          return {
            completed: true,
            runId: matchingRun.id,
            conclusion: matchingRun.conclusion,
            htmlUrl: matchingRun.html_url,
          };
        }
      }
    } catch (err) {
      console.warn(`[jules-lab-helper] Poll error: ${err.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { completed: false, error: "Timed out waiting for lab run to complete" };
}

export function parseEvidence(filePath, expectedSha = null) {
  if (!existsSync(filePath)) {
    return { valid: false, error: `Evidence file missing at ${filePath}` };
  }

  try {
    const data = JSON.parse(readFileSync(filePath, "utf8"));
    if (expectedSha && data.source_sha !== expectedSha) {
      return {
        valid: false,
        error: `Evidence SHA mismatch: expected ${expectedSha}, found ${data.source_sha}`,
        evidence: data,
      };
    }

    if (!data.phase || !data.start_timestamp) {
      return {
        valid: false,
        error: "Evidence file is missing required phase or timestamp measurements",
        evidence: data,
      };
    }

    const causal = data.first_causal_failure || "none";
    let verdict = "PASSED";
    if (causal === "ts-authkey-missing" || causal === "ts-magicdns-off" || causal === "cert-capability-unavailable") {
      verdict = "BLOCKED";
    } else if (causal !== "none") {
      verdict = "FAILED";
    }

    return {
      valid: true,
      verdict: verdict,
      firstCausalFailure: causal,
      evidence: data,
    };
  } catch (err) {
    return { valid: false, error: `Malformed evidence JSON: ${err.message}` };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  if (command === "current-pr") {
    const info = getCurrentPrInfo();
    console.log(JSON.stringify(info, null, 2));
  } else if (command === "parse-evidence") {
    const filePath = args[1] || "rdp-lab-evidence.json";
    const expectedSha = args[2] || null;
    const res = parseEvidence(filePath, expectedSha);
    console.log(JSON.stringify(res, null, 2));
  } else if (command === "verify-access") {
    const res = verifyAccess();
    console.log(JSON.stringify(res, null, 2));
  } else if (command === "dispatch-lab") {
    const profile = args[1] || "static";
    const sha = args[2] || null;
    const injected = args[3] || "NONE";
    const res = dispatchLab({ profile, sourceSha: sha, injectedFailure: injected });
    console.log(JSON.stringify(res, null, 2));
  } else if (command === "wait-run") {
    const sha = args[1] || null;
    const res = await waitLabRun(getRepo(), sha);
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log("Usage: node scripts/jules-lab-helper.mjs <command>");
    console.log("Commands: current-pr | parse-evidence [file] [sha] | verify-access | dispatch-lab [profile] [sha] [injected] | wait-run [sha]");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[jules-lab-helper] Error: ${err.message}`);
    process.exit(1);
  });
}
