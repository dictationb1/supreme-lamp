// [F200 §6] Application logon observer: the `$Matches` clobber, proven.
// Run: node --test tests/f200-logon-observer.test.js
//
// THE DEFECT (present on main before this change):
//   payloads/ghrdp-server.ps1 /api/logon-status did
//       if ($msg -notmatch 'Logon Type:\s+(2|10|11)\b') { continue }
//       if ($userQ -and $msg -notmatch [regex]::Escape($userQ)) { continue }
//       $ltSeen = [string]$Matches[1]
//   PowerShell rewrites the automatic $Matches variable on EVERY -match, so the
//   SECOND (user) regex - which has no capture group - destroyed the LogonType
//   capture. The route then reported logonType='' for a real type-10 session and
//   the UI said "no type-10 4624" while a desktop was on screen.
//
// HOW THIS FILE PROVES IT WITHOUT A POWERSHELL INTERPRETER (none exists here):
//   1. The shipped block is EXTRACTED verbatim between the F200 §6 markers and
//      pinned: the type must be captured into a local BEFORE the user filter,
//      `$Matches` must not appear at all, and `inboundRdp` must be derived from
//      the captured TYPE, never from the source IP.
//   2. A decision MIRROR executes both orderings (defective vs repaired) with
//      the regexes read out of the shipped source, against synthetic rendered
//      4624 messages. The defective order yields logonType='' - that is the
//      mutation the assertions below catch - and the repaired order yields the
//      true type.
//   3. The deployed revision is proven to be payloads/ghrdp-server.ps1 itself:
//      main.yml stages that exact file to C:\ghrdp, so a fix living only in a
//      lab patch could not pass this test.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

const server = fs.readFileSync("payloads/ghrdp-server.ps1", "utf8");
const mainYml = fs.readFileSync(".github/workflows/main.yml", "utf8");

const BEGIN = "# [F200 §6 logon-status-begin]";
const END = "# [F200 §6 logon-status-end]";

function block() {
  const a = server.indexOf(BEGIN);
  const b = server.indexOf(END);
  assert.ok(a > 0 && b > a, "the F200 §6 logon-status markers are missing from the shipped server");
  return server.slice(a, b);
}

function codeOnly(src) {
  return src
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

function psRegex(literal) {
  // translate a PowerShell single-quoted regex literal body into a JS RegExp
  return new RegExp(literal);
}

function captureLiteral(src, needle) {
  const i = src.indexOf(needle);
  assert.ok(i > 0, `regex literal not found near: ${needle}`);
  const rest = src.slice(i + needle.length);
  const m = rest.match(/^'([^']*)'/);
  assert.ok(m, `no PowerShell single-quoted literal after: ${needle}`);
  return m[1];
}

// ---------------------------------------------------------------------------
// §1 the shipped block is the REPAIRED shape
// ---------------------------------------------------------------------------
test("F200-24 the shipped /api/logon-status block captures the type BEFORE the user filter", () => {
  const src = codeOnly(block());
  const typeIdx = src.indexOf("$ltThis = [string]$ltM.Groups[1].Value");
  const userIdx = src.indexOf("if ($userQ -and $msg -notmatch [regex]::Escape($userQ))");
  const seenIdx = src.indexOf("$ltSeen = $ltThis");
  assert.ok(typeIdx > 0, "the type is not captured into a local ($ltThis)");
  assert.ok(userIdx > 0, "the user filter disappeared");
  assert.ok(seenIdx > 0, "$ltSeen is not assigned from the captured local");
  assert.ok(typeIdx < userIdx, "capture must happen BEFORE the user filter (this is the clobber order)");
  assert.ok(userIdx < seenIdx, "$ltSeen must be assigned after the filter, from the local - not from $Matches");
});

test("F200-25 the repaired block reads $Matches NOWHERE (the clobber is impossible)", () => {
  // $Matches appears only inside the explanatory comment that documents the bug
  const code = codeOnly(block());
  assert.ok(!/\$Matches\b/.test(code), "$Matches is still read in executable code - a later -match can clobber it again");
  assert.ok(!/\$Matches\[1\]/.test(code));
  // both match sites use [regex]::Match, which never touches $Matches
  assert.ok(code.includes("[regex]::Match($msg, 'Logon Type:"));
  assert.ok(code.includes("[regex]::Match($msg, 'Source Network Address:"));
});

test("F200-26 inbound RDP is derived from the LOGON TYPE, never from the IP address", () => {
  const src = block();
  assert.ok(src.includes("$inboundRdp = ([string]$ltSeen -eq '10')"), "inboundRdp must be a type comparison");
  const inboundLine = src.split("\n").find((l) => l.includes("$inboundRdp ="));
  assert.ok(inboundLine && !/\$ip\b/.test(inboundLine), "inboundRdp must not be derived from the source IP");
  // and the badge classes are named, not inferred
  assert.ok(src.includes("$proofClass = 'desktop-only-not-rdp'"));
  assert.ok(src.includes("$proofClass = 'remote-interactive'"));
});

test("F200-27 the fix is in the file the workflow actually DEPLOYS", () => {
  // main.yml stages payloads/ghrdp-server.ps1 to the runner; a lab-only patch
  // would never reach the runner.
  assert.match(
    mainYml,
    /cp "\$GITHUB_WORKSPACE\/payloads\/ghrdp-server\.ps1" "\$RUNNER_TEMP\/ghrdp-stage\/ghrdp-server\.ps1"/
  );
  assert.match(mainYml, /Copy-Item -Path \(Join-Path \$stage '\*'\) -Destination \$root -Recurse -Force/);
  assert.ok(server.includes("logonKind"), "the deployed server must expose the captured kind");
  assert.ok(server.includes("inboundRdp"), "the deployed server must expose inboundRdp");
});

// ---------------------------------------------------------------------------
// §2 execute both orderings against synthetic 4624 messages
// ---------------------------------------------------------------------------
const LOGON_RE = psRegex(captureLiteral(server, "[regex]::Match($msg, "));
const ipLiteral = server.match(/\[regex\]::Match\(\$msg, '(Source Network Address:[^']*)'\)/);
assert.ok(ipLiteral, "the source-IP regex literal is missing from the server");
const IP_RE = psRegex(ipLiteral[1]);

function message({ type, user, ip }) {
  const lines = [
    "An account was successfully logged on.",
    "",
    "\tSubject:",
    "\t\tSecurity ID:\t\tS-1-5-18",
    "",
    "\tLogon Information:",
    "\t\tLogon Type:\t\t" + type,
    "\t\tRestricted Admin Mode:\t-",
    "",
    "\tNew Logon:",
    "\t\tSecurity ID:\t\tS-1-5-21-1-2-3-1001",
    "\t\tAccount Name:\t\t" + user,
    "\t\tAccount Domain:\t\tRUNNER",
    "",
    "\tNetwork Information:",
    "\t\tSource Network Address:\t" + ip,
    "",
  ];
  return lines.join("\r\n");
}

/** The DEFECTIVE order that shipped on main: type read from the last $Matches. */
function defective(msg, userQ) {
  let connected = false;
  let ltSeen = "";
  let ip = "";
  let lastMatches = null;
  if (msg.match(LOGON_RE) === null) return { connected, logonType: ltSeen, ip };
  lastMatches = msg.match(LOGON_RE);
  if (userQ && msg.match(new RegExp(userQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))) === null) {
    return { connected, logonType: ltSeen, ip };
  }
  // PowerShell: the user -match above REPLACED $Matches with a no-group match
  lastMatches = msg.match(new RegExp(userQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  connected = true;
  ltSeen = lastMatches && lastMatches[1] ? lastMatches[1] : "";
  const ipm = msg.match(IP_RE);
  if (ipm) ip = ipm[1];
  return { connected, logonType: ltSeen, ip };
}

/** The REPAIRED order that ships now: capture into a local first. */
function repaired(msg, userQ) {
  let connected = false;
  let ltSeen = "";
  let ip = "";
  const ltM = msg.match(LOGON_RE);
  if (!ltM) return { connected, logonType: ltSeen, ip, inboundRdp: false };
  const ltThis = ltM[1];
  if (userQ && msg.match(new RegExp(userQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))) === null) {
    return { connected, logonType: ltSeen, ip, inboundRdp: false };
  }
  connected = true;
  ltSeen = ltThis;
  const ipm = msg.match(IP_RE);
  if (ipm) ip = ipm[1];
  return { connected, logonType: ltSeen, ip, inboundRdp: ltSeen === "10" };
}

test("F200-28 the DEFECTIVE ordering loses the type (this is what the fix addresses)", () => {
  const msg = message({ type: 10, user: "runneradmin", ip: "100.101.102.103" });
  const bad = defective(msg, "runneradmin");
  assert.equal(bad.connected, true);
  assert.equal(bad.logonType, "", "the defective ordering should report an EMPTY type - if it does not, this test no longer models the bug");
});

test("F200-29 the REPAIRED ordering reports the ACTUAL type and the right proof class", () => {
  const rdp = repaired(message({ type: 10, user: "runneradmin", ip: "100.101.102.103" }), "runneradmin");
  assert.equal(rdp.connected, true);
  assert.equal(rdp.logonType, "10");
  assert.equal(rdp.inboundRdp, true);
  assert.equal(rdp.ip, "100.101.102.103");

  const console = repaired(message({ type: 2, user: "runneradmin", ip: "-" }), "runneradmin");
  assert.equal(console.connected, true);
  assert.equal(console.logonType, "2", "an autologon (type 2) must be reported as 2, not silently as RDP");
  assert.equal(console.inboundRdp, false, "a console logon must NEVER be reported as inbound RDP");

  const cached = repaired(message({ type: 11, user: "runneradmin", ip: "-" }), "runneradmin");
  assert.equal(cached.logonType, "11");
  assert.equal(cached.inboundRdp, false);

  const network = repaired(message({ type: 3, user: "runneradmin", ip: "10.1.2.3" }), "runneradmin");
  assert.equal(network.connected, false, "network/service logons stay excluded");

  const otherUser = repaired(message({ type: 10, user: "someone-else", ip: "100.1.1.1" }), "runneradmin");
  assert.equal(otherUser.connected, false, "the user filter must still narrow the search");
});

test("F200-30 an IP address alone never yields a type-10 verdict", () => {
  // Type 2 from the tailnet address is still a console logon.
  const sneaky = repaired(message({ type: 2, user: "runneradmin", ip: "100.101.102.103" }), "runneradmin");
  assert.equal(sneaky.logonType, "2");
  assert.equal(sneaky.inboundRdp, false);
  // and a type-10 event whose Source Network Address is '-' is still RDP
  const noIp = repaired(message({ type: 10, user: "runneradmin", ip: "-" }), "runneradmin");
  assert.equal(noIp.logonType, "10");
  assert.equal(noIp.inboundRdp, true);
});
