// [P001 / P001B / P002] Backend credential-gate and identity pins.
//
// These tests read the SHIPPED payload and assert the exact contract, so an edit
// that reverts a repair fails here instead of becoming another live-run
// annotation. They are NOT the runtime proof: tests/p001-p002-identity.ps1
// executes the shipped functions against real fixtures on a Windows runner
// (launch-gates `windows-native`), which is where the rotation-state matrix is
// actually exercised.
//
// P001   POST /api/rdp-token compared the bearer against $script:Token, the
//        dashboard credential read ONCE at boot, while main.yml writes
//        dash-token.txt in "Stage files + write config.json" long after the
//        GHRDP-Server task is kicked. Consequences: the current run's
//        credential got 401 while a previous run's credential stayed mintable
//        for the life of the process.
// P001B  GET /api/purge-stale-creds repeated the same gate - and that route
//        hands out a credential-deleting command.
// P002   GET /api/version read config.json `commit`, a key nothing writes,
//        while the workflow writes buildSha; the Scheduled Task inherits no
//        GHRDP_BUILD_SHA/GITHUB_SHA, so the endpoint answered sha="dev" for a
//        server whose exact identity was on disk.
//
// Deliberate corrections over the lab bundle's version of these pins:
//   * the resolver must return ONE current credential, not "file token UNION
//     config token" - a stale config would otherwise re-authorize a credential
//     the token file already replaced;
//   * a revoked credential must not come back when the files disappear;
//   * the deployed identity (config.json buildSha) must outrank a conflicting
//     execution identity, so the endpoint cannot report another build.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SERVER = readFileSync(path.join(ROOT, "payloads/ghrdp-server.ps1"), "utf8");
const GATES = readFileSync(path.join(ROOT, ".github/workflows/launch-gates.yml"), "utf8");

function block(startMarker, endMarker, span = 6000) {
  const i = SERVER.indexOf(startMarker);
  assert.ok(i > 0, `marker not found: ${startMarker}`);
  const j = endMarker ? SERVER.indexOf(endMarker, i) : -1;
  return SERVER.slice(i, j > i ? j : i + span);
}
function fn(name, nextName) {
  return block(`function ${name}`, `function ${nextName}`);
}

const RESOLVER = fn("Get-GhrdpStrictDashTokenCandidates", "Add-F99TokenTelemetry");
const SHAPE = fn("Test-GhrdpDashTokenShape", "Get-GhrdpStrictDashTokenCandidates");
const IDENTITY = fn("Get-GhrdpBuildIdentity", "Get-RequestParts");
const TICKET = block(
  "if ($path -eq '/api/rdp-token' -and $parts.method -eq 'POST') {",
  "# [F27 redeem-route-begin]",
);
const PURGE = block("if ($path -eq '/api/purge-stale-creds') {", "# [U3/U4] POST /api/handler-hello");
const VERSION = block("if ($path -eq '/api/version') {", "if ($path -eq '/api/ping')");

test("P001: the strict routes authorize against a current-credential resolver, not the boot snapshot", () => {
  assert.ok(
    SERVER.includes("function Get-GhrdpStrictDashTokenCandidates"),
    "the strict-route resolver is missing",
  );
  assert.ok(SHAPE.length > 0, "the credential-shape guard is missing");
  for (const route of [TICKET, PURGE]) {
    assert.ok(
      route.includes("Get-GhrdpStrictDashTokenCandidates -SnapshotToken $Token"),
      "a strict route does not consult the current-credential resolver",
    );
    assert.ok(
      !route.includes("$expected = [System.Text.Encoding]::UTF8.GetBytes('Bearer ' + $Token)") &&
        !route.includes("$expectP = [System.Text.Encoding]::UTF8.GetBytes('Bearer ' + $Token)"),
      "a strict route still compares the boot snapshot directly",
    );
    // Constant-time comparison is preserved for every candidate.
    assert.ok(/(Test-TicketBearer \$received \$expected|Test-TicketBearer \$recvP \$expectP)/.test(route), "the constant-time comparison was dropped");
    assert.ok(route.includes("Code 401"), "the 401 refusal path disappeared");
  }
});

test("P001: the resolver returns exactly ONE current credential (never the snapshot∪file∪config union)", () => {
  // dash-token.txt is authoritative: it is written LAST by main.yml and
  // re-validated by Provision-GhrdpVps.ps1.
  assert.ok(RESOLVER.includes("Join-Path $Root 'dash-token.txt'"), "the resolver does not read the token file");
  assert.ok(
    RESOLVER.includes("PSObject.Properties['dashToken']"),
    "the resolver does not read config.json dashToken",
  );
  assert.ok(
    RESOLVER.includes("if (-not $fileTok) {"),
    "config.json is consulted even when the authoritative token file is readable",
  );
  assert.ok(
    RESOLVER.includes("return @($observed)"),
    "the resolver does not settle on the single observed credential",
  );
  // The union form from the lab bundle must not come back.
  assert.ok(
    !RESOLVER.includes("if ($cur.Count -gt 0) { return $cur }"),
    "the union-of-every-source behaviour returned (a stale config could re-authorize a replaced credential)",
  );
  assert.ok(
    !/if \(\$cur -notcontains \$ct\)/.test(RESOLVER),
    "the resolver accumulates both file and config values",
  );
});

test("P001: superseded credentials are revoked and cannot be resurrected by a missing file", () => {
  assert.ok(
    SERVER.includes("$script:DashTokenRevoked = @{}"),
    "the revocation ledger is not initialised",
  );
  assert.ok(
    RESOLVER.includes("$script:DashTokenRevoked[$cur] = $true"),
    "adopting a new credential does not revoke the previous one",
  );
  assert.ok(
    RESOLVER.includes("$script:DashTokenRevoked[$boot] = $true"),
    "the boot snapshot is not revoked once a newer credential is established",
  );
  assert.ok(
    RESOLVER.includes("ContainsKey"),
    "the resolver does not consult the revocation ledger",
  );
  // No source readable -> the LAST ESTABLISHED credential, never a fallback to
  // the boot snapshot after a rotation, and never an unconditional accept.
  const tail = RESOLVER.slice(RESOLVER.indexOf("if ($cur) { return @($cur) }"));
  assert.ok(tail.includes("return @()"), "the resolver does not settle on an empty set");
  assert.ok(!RESOLVER.includes("return $true"), "the resolver decides acceptance itself instead of returning a credential");
  assert.ok(TICKET.includes("$tokOk = $false"), "the ticket route does not default to refusal");
  assert.ok(PURGE.includes("$purgeOk = $false"), "the purge route does not default to refusal");
});

test("P001: the static/bootstrap deployment case stays supported", () => {
  // A process that came up WITH the token file keeps that credential even if
  // the file is later removed and nothing was rotated - the ledger marks it
  // current at boot, so this is not resurrection.
  assert.ok(
    SERVER.includes("$script:DashTokenCurrent = [string]$script:Token"),
    "the boot credential is not seeded as the current credential",
  );
});

test("P001/P001B: the strict routes keep their ordering, telemetry and network restrictions", () => {
  const authIdx = TICKET.indexOf("Get-GhrdpStrictDashTokenCandidates");
  const sourceIdx = TICKET.indexOf("if (-not (Test-TicketSource $source))");
  const dnsIdx = TICKET.indexOf("MagicDNS FQDN missing");
  const mintIdx = TICKET.indexOf("$script:RdpTokens[$newTok]");
  assert.ok(authIdx > 0 && authIdx < sourceIdx, "the tailnet-source check no longer runs after authorization");
  assert.ok(sourceIdx < dnsIdx, "the MagicDNS check moved ahead of the tailnet-source check");
  assert.ok(dnsIdx < mintIdx, "a ticket is minted before the guards");
  assert.ok(TICKET.includes("Code 403"), "the 403 tailnet-source refusal disappeared");
  assert.ok(TICKET.includes("Code 409"), "the 409 MagicDNS refusal disappeared");
  assert.ok(TICKET.includes("rid = $newTok; ttl = 60"), "the {rid,ttl} ticket contract changed");
  assert.ok(TICKET.includes("Add-F99TokenTelemetry -Route '/api/rdp-token'"), "the strict route no longer records token telemetry");
  assert.ok(PURGE.includes("Add-F99TokenTelemetry -Route '/api/purge-stale-creds'"), "the purge route no longer records why a credential was refused");
  // The purge route hands out a command; it must never execute it.
  assert.ok(PURGE.includes("$script:F30PurgeCommand"), "the purge route no longer returns the documented command");
  assert.ok(!/\bInvoke-Expression\b|\bAdd-Type\b|\bcmdkey\b/.test(PURGE), "the purge route executes something instead of returning the command");
  assert.ok(PURGE.includes("olderThanDays = 7"), "the purge response contract changed");
});

test("P002: /api/version reports the deployed identity and never invents one", () => {
  assert.ok(VERSION.includes("Get-GhrdpBuildIdentity"), "the version route does not use the shared identity resolver");
  assert.ok(VERSION.includes("$f85Sha = 'dev'"), "the dev fallback was removed or replaced with a synthetic value");
  assert.ok(/\$f85Sha7 = \$f85Sha/.test(VERSION), "the sha7 derivation is missing");
  assert.ok(/Substring\(0, 7\)/.test(VERSION), "sha7 is not truncated to 7 characters");
  const devIdx = VERSION.indexOf("$f85Sha = 'dev'");
  const resolveIdx = VERSION.indexOf("Get-GhrdpBuildIdentity");
  assert.ok(resolveIdx > 0 && devIdx > resolveIdx, "the dev fallback no longer runs after identity resolution");
  assert.ok(!/[0-9a-f]{40}/.test(VERSION), "the version route hard-codes a commit SHA");
  assert.ok(VERSION.includes("shaSource"), "the identity source is not reported (post-deploy evidence needs it)");
});

test("P002: identity precedence is deployed identity first, then execution, then dev", () => {
  assert.ok(IDENTITY.length > 0, "Get-GhrdpBuildIdentity is missing");
  const build = IDENTITY.indexOf("PSObject.Properties['buildSha']");
  const envOverride = IDENTITY.indexOf("'GHRDP_BUILD_SHA'");
  const githubSha = IDENTITY.indexOf("'GITHUB_SHA'");
  const legacy = IDENTITY.indexOf("'gitCommit'");
  assert.ok(build > 0, "config.json buildSha (the key main.yml writes) is not consulted");
  assert.ok(envOverride > 0 && githubSha > envOverride, "the execution-identity order changed");
  assert.ok(
    build < envOverride,
    "a conflicting execution identity outranks the deployed identity (the endpoint could report another build)",
  );
  assert.ok(legacy > githubSha, "the legacy aliases no longer run last");
  // Every step is validated, and the literal dev is the only invented value.
  assert.ok(IDENTITY.includes("Test-GhrdpShaIdentity"), "identity values are not validated before being reported");
  assert.ok(
    /\[0-9a-fA-F\]\{7,40\}/.test(SERVER.slice(SERVER.indexOf("function Test-GhrdpShaIdentity"), SERVER.indexOf("function Get-GhrdpBuildIdentity"))),
    "the identity validator does not require a real hex sha",
  );
  assert.ok(IDENTITY.includes("$sha = 'dev'") && IDENTITY.includes("$src = 'none'"), "the dev/no-source outcome is missing");
});

test("P002: /api/ping and the F92 version:match check share the same identity", () => {
  const ping = block("if ($path -eq '/api/ping') {", "# [remediation 8C]", 1200);
  assert.ok(ping.includes("Get-GhrdpBuildIdentity"), "/api/ping still reads the unwritten config.json commit key");
  assert.ok(!ping.includes("$cfgP2.commit"), "/api/ping kept the dead commit read");
  const selftest = SERVER.slice(SERVER.indexOf("function Invoke-F92Selftest"), SERVER.indexOf("function Invoke-F92Selftest") + 60000);
  assert.ok(
    selftest.includes("(Get-GhrdpBuildIdentity).sha"),
    "the F92 version:match check still compares against the workflow environment only",
  );
});

test("P001/P002: the repairs leave MC-SIGNAL, the logon observer and the signing path untouched", () => {
  // Pre-existing server behaviour that these repairs must not disturb.
  for (const symbol of [
    "function Get-RdpLogonEventFields",
    "logonType",
    "$Matches[",
    "SSLCertificateSHA1Hash",
    "function Get-F99DashTokenHash",
  ]) {
    assert.ok(SERVER.includes(symbol), `pre-existing server behaviour disappeared: ${symbol}`);
  }
  // The MC-SIGNAL publisher is a separate shipped file and is not part of the
  // strict credential gate; the resolver must not appear there.
  const PUBLISHER = readFileSync(path.join(ROOT, "scripts/live-signal-publisher.js"), "utf8");
  assert.ok(PUBLISHER.includes("mc-signal/v1"), "the MC-SIGNAL schema marker disappeared");
  assert.ok(
    !PUBLISHER.includes("Get-GhrdpStrictDashTokenCandidates"),
    "the strict resolver leaked into the live-signal publisher",
  );
});

test("P001/P002: the runtime matrix exists and is executed by a CI lane", () => {
  assert.ok(existsSync(path.join(__dirname, "p001-p002-identity.ps1")), "the runtime matrix script is missing");
  assert.ok(
    GATES.includes("tests/p001-p002-identity.ps1") || GATES.includes("tests\\p001-p002-identity.ps1"),
    "no CI lane executes the P001/P002 runtime matrix",
  );
});
