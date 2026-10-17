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

function execGhApi(endpoint, options = {}) {
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
    return JSON.parse(res);
  } catch (err) {
    throw new Error(`GitHub API error on ${endpoint}: ${err.message}`);
  }
}

export function getCurrentPrInfo() {
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    return { sha, branch, repo: getRepo() };
  } catch (err) {
    return { sha: process.env.GITHUB_SHA || "unknown", branch: "unknown", repo: getRepo() };
  }
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
    return {
      valid: true,
      verdict: data.first_causal_failure === "none" ? "PASSED" : "FAILED",
      firstCausalFailure: data.first_causal_failure,
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
    const token = getGhToken();
    if (token) {
      console.log("[jules-lab-helper] GitHub API token is PRESENT.");
    } else {
      console.log("[jules-lab-helper] GitHub API token is ABSENT (read-only mode).");
    }
  } else {
    console.log("Usage: node scripts/jules-lab-helper.mjs <command>");
    console.log("Commands: current-pr | parse-evidence [file] [sha] | verify-access");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[jules-lab-helper] Error: ${err.message}`);
    process.exit(1);
  });
}
