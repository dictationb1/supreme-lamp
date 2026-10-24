// [V4 / 2026-10-25] THE PRODUCTION LOGON-COLLECTOR DATA CONTRACT.
// Run: node --test tests/f204-logon-correlation.test.js
//
// WHY THIS FILE EXISTS. The Overview derived "Connection failed" from a bare
// `authLast.result`, so a 4625 that belonged to another account - or to an
// attempt that had already been superseded by a successful logon - decided this
// client's state. Fixing that needs the SERVER to publish identity, freshness
// and correlation, because that is the only place the Security log exists.
//
// This suite pins the shipped PowerShell contract:
//   * what is extracted (and what is deliberately NOT extracted),
//   * what the reduction is allowed to correlate on,
//   * which fields the client may rely on,
//   * and that the whole scanner stays Windows PowerShell 5.1 compatible.
//
// It does NOT pretend to run PowerShell: the executable behavioural cases live
// in src/tests/smoke/v4-conn-correlation.test.ts, driven by fixtures that match
// this contract. `node --test` in CI has no Windows host; the same functions are
// exercised for real by the dispatched run's /health + /api/native-status
// (evidence recorded in docs/reports/2026-10-25-mission-control-ui-repair/).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const server = fs.readFileSync("payloads/ghrdp-server.ps1", "utf8");
const block = server.slice(
  server.indexOf("# [F28 §1 scanner-begin]"),
  server.indexOf("# [F28 §1 scanner-end]")
);

const fnFields = block.slice(
  block.indexOf("function Get-RdpLogonEventFields"),
  block.indexOf("function Get-RdpLogonSubMeaning")
);
const fnReduce = block.slice(
  block.indexOf("function Get-RdpLogonAuthLast"),
  block.indexOf("function Update-RdpLogonAuthLast")
);
const fnTick = block.slice(
  block.indexOf("function Update-RdpLogonAuthLast"),
  block.indexOf("function Get-RdpLogonCollectorState")
);
const fnSession = block.slice(
  block.indexOf("function Get-GhrdpSessionEvidence"),
  block.indexOf("function Update-RdpLogonAuthLast")
);

test("V4-PS-1 the scanner block is present and non-trivial", () => {
  assert.ok(block.length > 4000, "the scanner block is missing or truncated");
  assert.ok(fnReduce.length > 2000, "Get-RdpLogonAuthLast is missing");
  assert.ok(fnFields.length > 500, "Get-RdpLogonEventFields is missing");
});

test("V4-PS-2 the extractor takes the identity Windows actually writes", () => {
  for (const tok of [
    "EventRecordID", // stable incident identity
    "TargetUserName", // whose logon it was
    "LogonType", // 2 / 10 / 11
    "SubStatus", // WHY it failed
    "Status", // coarse fallback when SubStatus is absent
    "IpAddress", // source, redacted below
  ]) {
    assert.ok(fnFields.includes(tok), "the extractor no longer reads " + tok);
  }
  // ...and never a password field of any spelling.
  assert.doesNotMatch(fnFields, /"Password"|PasswordValue|ClearText|RDP_PASS|ChangePassword/i);
  // The domain is still not stored (F28 privacy rule kept).
  assert.ok(!/TargetDomainName/.test(fnFields), "the extractor started storing the domain");
});

test("V4-PS-3 a non-tailnet source is reduced to a class, never stored", () => {
  assert.ok(fnFields.includes("public-redacted"), "the public-address redaction class is gone");
  assert.match(fnFields, /100[\s\S]{0,80}64/, "the tailnet v4 range check is missing");
  assert.ok(fnFields.includes("fd7a:115c:a1e0"), "the tailnet v6 range check is missing");
  // 127.0.0.1 / ::1 must never be treated as a comparable client source.
  assert.ok(fnFields.includes("127.0.0.1"), "loopback is no longer excluded from the source field");
});

test("V4-PS-4 the reduction correlates by account, not machine-wide", () => {
  // ExpectedUser is an input, read from config by the tick.
  assert.ok(/param\([^)]*ExpectedUser/.test(fnReduce), "Get-RdpLogonAuthLast does not accept the intended account");
  assert.ok(fnTick.includes("-ExpectedUser $expectedUser"), "the tick does not pass the intended account");
  assert.ok(fnTick.includes("$cfgLogon.rdpUser"), "the tick does not read rdpUser from config");
  // Both UPN ("user@host") and DOMAIN\\user forms must normalize to the same key.
  assert.ok(fnReduce.includes("Split('@')"), "UPN normalization is missing");
  assert.ok(fnReduce.includes("LastIndexOf('\\\\')") || fnReduce.includes("LastIndexOf('\\')"),
    "DOMAIN\\user normalization is missing");
  // A non-matching event is EXCLUDED and COUNTED - not silently used.
  assert.match(fnReduce, /userMatch -eq 'no'[\s\S]{0,160}continue/, "a foreign user's event is not excluded");
  assert.match(fnReduce, /srcMatch -eq 'mismatch'[\s\S]{0,160}continue/, "a foreign source's event is not excluded");
  assert.ok(fnReduce.includes("$excludedUser++"), "excluded events are not counted");
  assert.ok(fnReduce.includes("$undecidable++"), "unresolvable events are not counted separately");
});

test("V4-PS-5 machine-wide counts survive next to the correlated verdict", () => {
  // Diagnostic history must not be thrown away with the client-specific verdict.
  for (const tok of ["count4624   = $c4624", "count4625   = $c4625", "correlation   = $correlation", "correlationNote = $correlationNote"]) {
    assert.ok(fnReduce.includes(tok), "the published contract lost: " + tok);
  }
});

test("V4-PS-6 a matching success supersedes an older matching failure", () => {
  assert.match(fnReduce, /\$okWhen -ge \$failWhen/, "a success no longer supersedes an older rejection");
  assert.match(fnReduce, /\$result = 'success'/, "the success branch is gone");
});

test("V4-PS-7 remote-interactive proof is tracked separately from 'a desktop exists'", () => {
  assert.ok(fnReduce.includes("remoteWhen"), "the LogonType-10 tracker is missing");
  assert.match(fnReduce, /-eq '10'/, "the type-10 comparison is missing");
  assert.ok(fnReduce.includes("remoteInteractive = [bool]$remoteInteractive"), "remoteInteractive is not published");
  assert.ok(fnReduce.includes("remote = [pscustomobject]@{"), "the remote evidence block is not published");
  // 2 and 11 stay ACCEPTED as desktops (R1), they are just not remote proof.
  assert.ok(server.includes("$script:GhrdpInteractiveLogonTypes = @('2', '10', '11')"),
    "R1's accepted logon types were changed");
});

test("V4-PS-8 the failure reason consults Status as well as SubStatus", () => {
  assert.match(fnReduce, /Get-RdpLogonSubMeaning -Code \$sub -Status \$status/, "Status is not passed to the classifier");
  assert.ok(/param\(\[string\]\$Code, \[string\]\$Status/.test(server), "the classifier signature was not extended");
  // Every non-password cause has its own meaning - none of them is 'wrong-password'.
  for (const pair of [
    "0XC0000234' { return 'account-locked'",
    "0XC0000072' { return 'account-disabled'",
    "0XC0000071' { return 'credential-expired'",
    "0XC000015B' { return 'logon-type-denied'",
    "0XC000006E' { return 'account-restriction'",
  ]) {
    assert.ok(server.includes(pair), "the classifier lost: " + pair);
  }
});

test("V4-PS-9 session liveness is collected as its OWN fact", () => {
  assert.ok(fnSession.includes("quser.exe"), "the Terminal Services evidence source is gone");
  assert.ok(fnSession.includes("rdp-tcp"), "the rdp-tcp session-name test is gone");
  assert.ok(fnSession.includes("logonTs"), "the session creation time is not collected");
  // The session block is attached to the SAME object the client reads, but as a
  // sub-object: a 4624 and a live session never collapse into one field.
  assert.ok(fnTick.includes("-NotePropertyName session"), "the tick does not attach session evidence");
  assert.ok(fnTick.includes("Depth 6"), "the persisted JSON depth cannot carry the session block");
  // A quser failure must be an explicit error, not "no session".
  assert.ok(fnSession.includes("quser-unavailable"), "a missing quser is not reported as an error");
});

test("V4-PS-10 the collector stays bounded and honest about its own reading", () => {
  assert.ok(fnReduce.includes("AddSeconds(120)"), "the future-skew bound is gone");
  assert.ok(fnReduce.includes("$scanTs = (Get-Date)"), "scanTs is no longer stamped unconditionally");
  assert.ok(fnTick.includes("'security-log-unreadable'"), "an unreadable Security log is no longer reported");
  assert.ok(fnTick.includes("$script:F28LastProbeError = $probeErr"), "the probe error is no longer published");
});

test("V4-PS-11 Windows PowerShell 5.1 compatibility (no PS7-only syntax)", () => {
  const ps7Only = [
    [/\?\?=/, "null-coalescing assignment (PS7)"],
    [/\?\?/, "null-coalescing operator (PS7)"],
    [/\?\./, "null-conditional access (PS7)"],
    [/-Parallel\b/, "ForEach-Object -Parallel (PS7)"],
    [/\bJoin-String\b/, "Join-String (PS7)"],
    [/\bConvertFrom-Json\b[^\n]*-AsHashtable/, "ConvertFrom-Json -AsHashtable (PS7)"],
    [/\bGet-Content\b[^\n]*-AsByteStream/, "Get-Content -AsByteStream (PS7)"],
  ];
  for (const [re, name] of ps7Only) {
    assert.doesNotMatch(block, re, "the scanner uses " + name + ", which PS 5.1 cannot run");
  }
  // Ternary `$x ? y : z` is a PS7-ism too; the scanner must use if/else.
  const ternary = /\$[A-Za-z_][A-Za-z0-9_.]*\s+\?\s+[^\n]+:\s+[^\n]+/;
  assert.doesNotMatch(fnReduce, ternary, "the reduction uses a PS7 ternary");
});

test("V4-PS-12 the client-side contract can read every field this publishes", () => {
  // Guard against the two sides drifting: each backend field the hook maps must
  // appear in the shipped PowerShell object.
  const mapped = [
    "result", "sub", "status", "eventTs", "scanTs", "subMeaning", "logonType",
    "recordId", "targetUser", "expectedUser", "userMatched", "source",
    "sourceMatch", "correlation", "excludedUser", "excludedSource",
    "remoteInteractive",
  ];
  for (const key of mapped) {
    assert.match(fnReduce, new RegExp("\\b" + key + "\\s*="), "backend never publishes " + key);
  }
});
