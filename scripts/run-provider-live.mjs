#!/usr/bin/env node
// [SEARCH-REPAIR] Runs the LIVE provider suite.
//
// Why a wrapper: this sandbox (and any host behind a TLS-inspecting proxy) has
// its proxy CA in the SYSTEM store, which Node does not read by default, so the
// suite would fail with "unable to verify the first certificate" and look like a
// provider outage. The wrapper adds the system bundle ONLY when it exists - it
// never disables verification - and then runs vitest.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const candidates = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/cert.pem",
];
if (!process.env.NODE_EXTRA_CA_CERTS) {
  const found = candidates.find((p) => existsSync(p));
  if (found) process.env.NODE_EXTRA_CA_CERTS = found;
}
process.env.PROVIDERS_LIVE = process.env.PROVIDERS_LIVE ?? "1";
// vitest.mjs takes "run" as its FIRST argument - a stray "vitest" token would
// be read as a file filter and the process would drop into watch mode.
const args = ["run", "--config", "vitest.providers.config.ts", ...process.argv.slice(2)];
const res = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", ...args], { stdio: "inherit", env: process.env });
process.exit(res.status ?? 1);
