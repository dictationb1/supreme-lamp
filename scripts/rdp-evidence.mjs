#!/usr/bin/env node
// scripts/rdp-evidence.mjs
// Structured, machine-readable evidence collector with measured secret redaction and runner measurement preservation.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SECRET_PATTERNS = [
  { pattern: /tskey-auth-[a-zA-Z0-9_-]+/gi, replacement: "[REDACTED_TS_AUTHKEY]" },
  { pattern: /tskey-api-[a-zA-Z0-9_-]+/gi, replacement: "[REDACTED_TS_APIKEY]" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/gi, replacement: "[REDACTED_GH_TOKEN]" },
  { pattern: /gho_[a-zA-Z0-9]{36}/gi, replacement: "[REDACTED_GH_TOKEN]" },
  { pattern: /github_pat_[a-zA-Z0-9_]{82}/gi, replacement: "[REDACTED_GH_PAT]" },
  { pattern: /Bearer\s+[A-Za-z0-9_.-]+/gi, replacement: "Bearer [REDACTED_BEARER_TOKEN]" },
  { pattern: /Basic\s+[A-Za-z0-9+/=]+/gi, replacement: "Basic [REDACTED_BASIC_AUTH]" },
  { pattern: /X-Goog-Api-Key:\s*[a-zA-Z0-9_-]+/gi, replacement: "X-Goog-Api-Key: [REDACTED_JULES_KEY]" },
  { pattern: /-----BEGIN\s+[A-Z\s]+PRIVATE\s+KEY-----[\s\S]*?-----END\s+[A-Z\s]+PRIVATE\s+KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
  { pattern: /(VNC_PASS|RENTRY_EDIT_PASSWORD|TS_AUTHKEY|JULES_API_KEY)=["']?[^"'\s\r\n]+["']?/gi, replacement: "$1=[REDACTED]" },
  { pattern: /"password"\s*:\s*"[^"]+"/gi, replacement: '"password": "[REDACTED]"' },
];

const UNREDANTED_DETECTORS = [
  /tskey-auth-[a-zA-Z0-9_-]+/i,
  /tskey-api-[a-zA-Z0-9_-]+/i,
  /ghp_[a-zA-Z0-9]{36}/i,
  /github_pat_[a-zA-Z0-9_]{82}/i,
  /X-Goog-Api-Key:\s*[a-zA-Z0-9_-]+/i,
];

export function redactSecrets(text) {
  if (typeof text !== "string") return text;
  let sanitized = text;
  for (const item of SECRET_PATTERNS) {
    sanitized = sanitized.replace(item.pattern, item.replacement);
  }
  return sanitized;
}

export function measureRedactionVerification(record) {
  const jsonStr = typeof record === "string" ? record : JSON.stringify(record);
  for (const detector of UNREDANTED_DETECTORS) {
    if (detector.test(jsonStr)) {
      return false;
    }
  }
  return true;
}

export function createEvidenceRecord(input = {}) {
  const startTime = input.start_timestamp ? new Date(input.start_timestamp).getTime() : Date.now();
  const endTime = input.end_timestamp ? new Date(input.end_timestamp).getTime() : Date.now();

  const rawRecord = {
    repository: input.repository || process.env.GITHUB_REPOSITORY || "dictationb1/supreme-lamp",
    source_sha: input.source_sha || process.env.GITHUB_SHA || "unknown-sha",
    workflow_sha: input.workflow_sha || process.env.GITHUB_SHA || "unknown-sha",
    run_id: String(input.run_id || process.env.GITHUB_RUN_ID || "0"),
    run_attempt: String(input.run_attempt || process.env.GITHUB_RUN_ATTEMPT || "1"),
    job: input.job || process.env.GITHUB_JOB || "rdp-lab-job",
    phase: input.phase || process.env.LAB_PHASE || "investigation",
    runner_os: input.runner_os || process.env.RUNNER_OS || process.platform,
    tool_versions: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      ...(input.tool_versions || {}),
    },
    start_timestamp: new Date(startTime).toISOString(),
    end_timestamp: new Date(endTime).toISOString(),
    elapsed_ms: Math.max(0, endTime - startTime),
    command_exit_codes: input.command_exit_codes || {},
    first_causal_failure: input.first_causal_failure || process.env.CAUSAL_FAILURE || "none",
    observed_findings: input.observed_findings || [],
    suspected_findings: input.suspected_findings || [],
    unknown_findings: input.unknown_findings || [],
    collection_errors: input.collection_errors || [],
    freshness: new Date().toISOString(),
    artifact_identity: input.artifact_identity || "none",
    cleanup_outcome: input.cleanup_outcome || "UNKNOWN",
    raw_logs_summary: input.raw_logs_summary || "",
    redaction_verified: false,
  };

  const jsonStr = JSON.stringify(rawRecord, null, 2);
  const sanitizedJsonStr = redactSecrets(jsonStr);
  const finalRecord = JSON.parse(sanitizedJsonStr);

  finalRecord.redaction_verified = measureRedactionVerification(JSON.stringify(finalRecord));
  return finalRecord;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputPath = process.argv[2] || "rdp-lab-evidence.json";
  let input = {
    phase: process.env.LAB_PHASE || "live-check",
    first_causal_failure: process.env.CAUSAL_FAILURE || "none",
  };

  // If observer state file exists, merge measurements
  const observerFile = "rdp-observer-status.json";
  if (existsSync(observerFile)) {
    try {
      const obs = JSON.parse(readFileSync(observerFile, "utf8"));
      input = {
        ...input,
        runner_os: obs.runner_os || input.runner_os,
        start_timestamp: obs.start_timestamp,
        command_exit_codes: obs.exit_codes || {},
        observed_findings: obs.phases || [],
        collection_errors: obs.errors || [],
        first_causal_failure: obs.first_causal_failure !== "none" ? obs.first_causal_failure : input.first_causal_failure,
        cleanup_outcome: obs.status === "PASSED" ? "SUCCESS" : obs.status === "FAILED" ? "PARTIAL_CLEANUP" : "UNKNOWN",
      };
    } catch {
      // ignore parse errors
    }
  }

  const evidence = createEvidenceRecord(input);
  writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`[rdp-evidence] Written sanitized evidence record to ${outputPath} (redaction_verified=${evidence.redaction_verified})`);
}
