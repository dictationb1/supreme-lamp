#!/usr/bin/env node
// scripts/ensure-rdp-deps.mjs
// Permanent, reusable dependency manager and verifier for supreme-lamp RDP workflows.
// Validates UI bundle and F59 prebuilt binaries (aria2c, qbittorrent) against pinned hashes.

import { pathToFileURL } from 'node:url';
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

function getSha256(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const data = readFileSync(filePath);
    return createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    mode: "readiness",
    sha: process.env.GITHUB_SHA || "head",
    outputJson: "rdp-deps-status.json",
    autoBuildUi: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && args[i + 1]) {
      options.mode = args[++i];
    } else if (args[i] === "--sha" && args[i + 1]) {
      options.sha = args[++i];
    } else if (args[i] === "--output-json" && args[i + 1]) {
      options.outputJson = args[++i];
    } else if (args[i] === "--auto-build-ui") {
      options.autoBuildUi = true;
    }
  }
  return options;
}

export function checkDependencies(options = {}) {
  const repoRoot = process.cwd();
  const result = {
    sha: options.sha || "head",
    mode: options.mode || "readiness",
    timestamp: new Date().toISOString(),
    uiBundle: {
      status: "MISSING",
      path: null,
      sizeBytes: 0,
      sha256: null,
      error: null,
    },
    f59Binaries: {
      status: "MISSING",
      assets: {},
      error: null,
    },
    overallVerdict: "PENDING",
  };

  // 1. Check UI bundle
  const possibleUiPaths = [
    join(repoRoot, "dist", "index.html"),
    join(repoRoot, "ui", "dist", "index.html"),
    join(repoRoot, "ui-v2.html"),
  ];

  let uiFound = false;
  for (const p of possibleUiPaths) {
    if (existsSync(p)) {
      try {
        const stat = statSync(p);
        if (stat.isFile() && stat.size > 51200) {
          result.uiBundle.status = "VERIFIED";
          result.uiBundle.path = p;
          result.uiBundle.sizeBytes = stat.size;
          result.uiBundle.sha256 = getSha256(p);
          uiFound = true;
          break;
        } else if (stat.isFile()) {
          result.uiBundle.status = "CORRUPT";
          result.uiBundle.path = p;
          result.uiBundle.sizeBytes = stat.size;
          result.uiBundle.error = `UI bundle size too small (${stat.size} bytes, expected > 51200)`;
          break;
        }
      } catch (err) {
        result.uiBundle.error = err.message;
      }
    }
  }

  if (!uiFound && result.uiBundle.status !== "CORRUPT") {
    result.uiBundle.status = "MISSING";
    result.uiBundle.error = "UI bundle dist/index.html not found";

    if (options.autoBuildUi && options.mode !== "readiness") {
      try {
        console.log("[ensure-rdp-deps] Auto-building UI bundle via pnpm build...");
        execSync("pnpm build", { stdio: "inherit", cwd: repoRoot });
        const builtPath = join(repoRoot, "dist", "index.html");
        if (existsSync(builtPath)) {
          const stat = statSync(builtPath);
          if (stat.isFile() && stat.size > 51200) {
            result.uiBundle.status = "VERIFIED";
            result.uiBundle.path = builtPath;
            result.uiBundle.sizeBytes = stat.size;
            result.uiBundle.sha256 = getSha256(builtPath);
            result.uiBundle.error = null;
          }
        }
      } catch (err) {
        result.uiBundle.status = "BUILD_FAILED";
        result.uiBundle.error = `UI build failed: ${err.message}`;
      }
    }
  }

  // 2. Check F59 prebuilt pins
  const pinsPath = join(repoRoot, "payloads", "f59-prebuilt-pins.json");
  if (!existsSync(pinsPath)) {
    result.f59Binaries.status = "PIN_FILE_MISSING";
    result.f59Binaries.error = "payloads/f59-prebuilt-pins.json is missing";
  } else {
    try {
      const pinsData = JSON.parse(readFileSync(pinsPath, "utf8"));
      const assets = pinsData.assets || {};
      let allVerified = true;
      let missingCount = 0;

      for (const [key, assetInfo] of Object.entries(assets)) {
        const expectedSha = assetInfo.sha256;
        const candidateNames = [
          assetInfo.name,
          assetInfo.extract,
          key,
          key + ".exe",
        ].filter(Boolean);

        let assetStatus = "MISSING";
        let foundPath = null;
        let observedSha = null;

        for (const cName of candidateNames) {
          const possiblePaths = [
            join(repoRoot, "payloads", cName),
            join(repoRoot, "bin", cName),
            join(process.env.RUNNER_TEMP || "/tmp", "ghrdp-stage", cName),
            join(process.env.TEMP || "/tmp", cName),
          ];

          for (const p of possiblePaths) {
            if (existsSync(p) && statSync(p).isFile()) {
              foundPath = p;
              observedSha = getSha256(p);
              if (!expectedSha || expectedSha === "" || observedSha === expectedSha.toLowerCase()) {
                assetStatus = "VERIFIED";
              } else {
                assetStatus = "CHECKSUM_MISMATCH";
              }
              break;
            }
          }
          if (foundPath) break;
        }

        result.f59Binaries.assets[key] = {
          name: assetInfo.name,
          status: assetStatus,
          path: foundPath,
          expectedSha256: expectedSha,
          observedSha256: observedSha,
        };

        if (assetStatus !== "VERIFIED") {
          allVerified = false;
          if (assetStatus === "MISSING") missingCount++;
        }
      }

      if (allVerified) {
        result.f59Binaries.status = "VERIFIED";
      } else if (missingCount === Object.keys(assets).length) {
        result.f59Binaries.status = "MISSING";
      } else {
        result.f59Binaries.status = "PARTIAL";
      }
    } catch (err) {
      result.f59Binaries.status = "PARSE_ERROR";
      result.f59Binaries.error = `Failed to parse pins JSON: ${err.message}`;
    }
  }

  // 3. Compute overall verdict
  if (result.uiBundle.status === "VERIFIED" && (result.f59Binaries.status === "VERIFIED" || Object.keys(result.f59Binaries.assets).length === 0)) {
    result.overallVerdict = "READY";
  } else if (result.mode === "readiness") {
    result.overallVerdict = "READINESS_CHECK_COMPLETE";
  } else {
    result.overallVerdict = "DEPENDENCIES_PENDING";
  }

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs();
  const depResult = checkDependencies(options);

  if (options.outputJson) {
    writeFileSync(options.outputJson, JSON.stringify(depResult, null, 2), "utf8");
    console.log(`[ensure-rdp-deps] Wrote status to ${options.outputJson}`);
  }

  console.log(`[ensure-rdp-deps] UI status: ${depResult.uiBundle.status}`);
  console.log(`[ensure-rdp-deps] F59 binaries status: ${depResult.f59Binaries.status}`);
  console.log(`[ensure-rdp-deps] Overall verdict: ${depResult.overallVerdict}`);

  if (depResult.mode === "readiness") {
    console.log("[ensure-rdp-deps] Readiness mode active: Inspection completed without mutating state or starting RDP.");
    process.exit(0);
  }

  if (depResult.overallVerdict !== "READY") {
    console.warn(`[ensure-rdp-deps] Warning: Dependencies not fully ready for execution mode=${depResult.mode}`);
  }
}
