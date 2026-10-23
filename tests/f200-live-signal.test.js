// [F200 / MC-SIGNAL] Application-side live-run signal: executed cells + wiring pins.
// Run: node --test tests/f200-live-signal.test.js
//
// Why this file exists: the lab must discover a REAL main.yml run (mode=rdp) and
// open its ACTUAL authenticated Mission Control UI. Check-run output was the
// measured-readable transport; live logs were not. These cells EXECUTE the
// shipped publisher (scripts/live-signal-publisher.js) - crypto, identity,
// publication, close and failure paths - against an in-memory GitHub API, and
// pin the workflow wiring so a future edit cannot silently drop the publisher.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const pub = require("../scripts/live-signal-publisher.js");

const mainYml = fs.readFileSync(".github/workflows/main.yml", "utf8");
const publisherSrc = fs.readFileSync("scripts/live-signal-publisher.js", "utf8");

const RUN_ID = "1234567890";
const RUN_ATTEMPT = "2";
const SHA = "b".repeat(40);
const DASH_TOKEN = "dash-token-PLAINTEXT-MUST-NOT-LEAK-42";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mc-signal-"));
}

function envFor(extra = {}) {
  return {
    GITHUB_REPOSITORY: "dictationb1/supreme-lamp",
    GITHUB_RUN_ID: RUN_ID,
    GITHUB_RUN_ATTEMPT: RUN_ATTEMPT,
    GITHUB_SHA: SHA,
    GITHUB_REF_NAME: "main",
    GITHUB_WORKFLOW: "Windows RDP - Tailscale Mission Control (6h ephemeral)",
    GITHUB_JOB: "rdp",
    GITHUB_TOKEN: "ghs_fake_token",
    GITHUB_API_URL: "https://api.github.test",
    ...extra,
  };
}

function makeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return {
    spec: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64"),
    publicKey,
    privateKey,
  };
}

function writeRuntime(dir, overrides = {}) {
  const cfg = {
    rdpIp: "100.101.102.103",
    rdpUser: "rdpuser",
    rdpPass: "RDP-PASSWORD-MUST-NOT-LEAK",
    dashToken: DASH_TOKEN,
    serveUrl: "https://runner-abc.tail1234.ts.net",
    funnelUrl: "",
    commit: SHA,
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, "config.json"), "\ufeff" + JSON.stringify(cfg, null, 2));
  fs.writeFileSync(
    path.join(dir, "ui-v2.html"),
    `<html><head><meta name="ghrdp-build" content="${SHA}"></head><body>ui</body></html>`
  );
  return cfg;
}

/** In-memory GitHub API: records every request body for leak scans. */
function fakeGitHub() {
  const calls = [];
  let nextId = 9001;
  const fetchImpl = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method, body, headers: (init && init.headers) || {} });
    if (init.method === "POST" && /\/check-runs$/.test(url)) {
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: nextId++ }) };
    }
    if (init.method === "PATCH" && /\/check-runs\/\d+$/.test(url)) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: nextId }) };
    }
    if (init.method === "GET" && /\/actions\/runs\//.test(url)) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: "in_progress" }) };
    }
    if (init.method === "POST" && /\/dispatches$/.test(url)) {
      return { ok: true, status: 204, text: async () => "" };
    }
    return { ok: false, status: 500, text: async () => JSON.stringify({ message: "unexpected" }) };
  };
  return {
    calls,
    fetchImpl,
    created: () => calls.filter((c) => c.method === "POST" && /\/check-runs$/.test(c.url)),
    patched: () => calls.filter((c) => c.method === "PATCH"),
    allText: () => JSON.stringify(calls),
  };
}

// ---------------------------------------------------------------------------
// §1 crypto: the envelope is the ONLY credential transport
// ---------------------------------------------------------------------------
test("F200-1 x25519 envelope round-trips the dash token and leaks nothing", () => {
  const kp = makeKeypair();
  const identity = { repository: "o/r", runId: "1", runAttempt: 1, sha: SHA, keyId: "" };
  const parsed = pub.parsePublicKey(kp.spec);
  const envelope = pub.sealCredential({
    publicKeySpec: parsed,
    plaintext: JSON.stringify({ dashToken: DASH_TOKEN }),
    signal: identity,
  });
  assert.equal(envelope.alg, "x25519-hkdf-sha256+aes-256-gcm");
  assert.ok(!JSON.stringify(envelope).includes(DASH_TOKEN), "the envelope carries the token in plaintext");
  assert.ok(pub.verifyEnvelopeBinding(envelope, { ...identity, keyId: envelope.keyId }), "AAD does not bind identity");
  // tampering with the identity breaks the binding (no decrypt needed)
  assert.ok(!pub.verifyEnvelopeBinding(envelope, { ...identity, runId: "999", keyId: envelope.keyId }));
  const out = pub.openCredential({
    privateKey: kp.privateKey,
    envelope,
    signal: { ...identity, keyId: envelope.keyId },
  });
  assert.equal(JSON.parse(out.plaintext).dashToken, DASH_TOKEN);
  // the wrong key must fail closed
  const other = makeKeypair();
  assert.throws(
    () => pub.openCredential({ privateKey: other.privateKey, envelope, signal: { ...identity, keyId: envelope.keyId } }),
    (err) => err.code === pub.FAILURE_CODES.DECRYPT_FAILED
  );
});

test("F200-2 RSA-OAEP envelope round-trips and is alg-tagged", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const spec = publicKey.export({ format: "pem", type: "spki" }).toString();
  const identity = { repository: "o/r", runId: "2", runAttempt: 1, sha: SHA, keyId: "" };
  const parsed = pub.parsePublicKey(spec);
  assert.equal(parsed.type, "rsa");
  const envelope = pub.sealCredential({ publicKeySpec: parsed, plaintext: JSON.stringify({ dashToken: DASH_TOKEN }), signal: identity });
  assert.equal(envelope.alg, "rsa-oaep-sha256+aes-256-gcm");
  assert.ok(!JSON.stringify(envelope).includes(DASH_TOKEN));
  const out = pub.openCredential({ privateKey, envelope, signal: { ...identity, keyId: envelope.keyId } });
  assert.equal(JSON.parse(out.plaintext).dashToken, DASH_TOKEN);
});

test("F200-3 public-key formats parse; an Ed25519 signing key is REFUSED by name", () => {
  const kp = makeKeypair();
  const rawB64 = kp.spec;
  const hex = kp.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const derB64 = kp.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const pem = kp.publicKey.export({ format: "pem", type: "spki" }).toString();
  const ids = [
    pub.parsePublicKey(rawB64).keyId,
    pub.parsePublicKey(hex).keyId,
    pub.parsePublicKey(derB64).keyId,
    pub.parsePublicKey(pem).keyId,
    pub.parsePublicKey(pem.replace(/\n/g, "\\n")).keyId,
    pub.parsePublicKey("x25519:" + rawB64).keyId,
  ];
  assert.equal(new Set(ids).size, 1, "the same X25519 key must fingerprint identically in every accepted format");

  const ed = crypto.generateKeyPairSync("ed25519").publicKey;
  assert.throws(
    () => pub.parsePublicKey(ed.export({ format: "pem", type: "spki" }).toString()),
    (err) => err.code === pub.FAILURE_CODES.PUBKEY_UNSUPPORTED_ALG,
    "an Ed25519 key cannot encrypt; it must be refused, not silently misused"
  );
  assert.throws(() => pub.parsePublicKey(""), (err) => err.code === pub.FAILURE_CODES.PUBKEY_MISSING);
  assert.throws(() => pub.parsePublicKey("not-a-key-at-all"), (err) => err.code === pub.FAILURE_CODES.PUBKEY_UNPARSEABLE);
});

test("F200-4 rotation changes the keyId (so a re-keyed lab can tell which key to use)", () => {
  const a = pub.parsePublicKey(makeKeypair().spec).keyId;
  const b = pub.parsePublicKey(makeKeypair().spec).keyId;
  assert.notEqual(a, b);
  assert.match(a, /^x25519:[0-9a-f]{16}$/);
});

// ---------------------------------------------------------------------------
// §2 identity, endpoint, UI stamp
// ---------------------------------------------------------------------------
test("F200-5 signal identity comes from the real run, not from the lab", () => {
  const dir = tmpDir();
  const cfg = writeRuntime(dir);
  const identity = pub.identityFromEnv(envFor());
  const signal = pub.buildSignal({
    identity,
    cfg: { ...cfg, __uiPath: path.join(dir, "ui-v2.html") },
    keyId: "x25519:0000000000000000",
    envelope: { v: 1, alg: "x25519-hkdf-sha256+aes-256-gcm", keyId: "x25519:0000000000000000", aadB64: "", epk: "", nonce: "", ct: "", tag: "" },
  });
  assert.equal(signal.repository, "dictationb1/supreme-lamp");
  assert.equal(signal.runId, RUN_ID);
  assert.equal(signal.runAttempt, 2);
  assert.equal(signal.sha, SHA);
  assert.equal(signal.ref, "main");
  assert.equal(signal.runUrl, `https://github.com/dictationb1/supreme-lamp/actions/runs/${RUN_ID}`);
  assert.equal(signal.ui.sha, SHA);
  assert.equal(signal.ui.matchesRunSha, true);
  assert.equal(signal.endpoint.primary, "https://runner-abc.tail1234.ts.net");
  assert.equal(signal.endpoint.transport, "tailscale-serve");
  assert.equal(signal.endpoint.authPathTemplate, "/?key={credential}");
  assert.equal(signal.claims.liveLogsUsed, false, "live-log scraping must not be restored as a transport");
});

test("F200-6 endpoint falls back to the tailnet IP, and a missing endpoint is a NAMED failure", () => {
  const dir = tmpDir();
  const cfg = writeRuntime(dir, { serveUrl: "", funnelUrl: "" });
  const ep = pub.pickEndpoint(cfg);
  assert.equal(ep.primary, "http://100.101.102.103:7331");
  assert.equal(ep.transport, "tailnet-ip");
  assert.throws(
    () => pub.pickEndpoint({ rdpIp: "10.0.0.5", serveUrl: "" }),
    (err) => err.code === pub.FAILURE_CODES.ENDPOINT_MISSING
  );
});

test("F200-7 an unstamped UI bundle is reported as unstamped, never as a matching sha", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "ui-v2.html"), "<html><body>no stamp</body></html>");
  const stamp = pub.readUiStamp(path.join(dir, "ui-v2.html"));
  assert.equal(stamp.stamped, false);
  assert.equal(stamp.sha, "");
});

// ---------------------------------------------------------------------------
// §3 publication against a fake GitHub API
// ---------------------------------------------------------------------------
test("F200-8 publisher creates then heartbeats the mission-control-live-signal check run", async () => {
  const dir = tmpDir();
  const kp = makeKeypair();
  writeRuntime(dir);
  const gh = fakeGitHub();
  let clock = Date.parse("2026-10-23T00:00:00Z");
  const res = await pub.runPublisher({
    env: envFor({ LAB_SIGNAL_PUBKEY: kp.spec }),
    argvPaths: { config: path.join(dir, "config.json"), state: path.join(dir, "state.json"), log: path.join(dir, "pub.log"), ui: path.join(dir, "ui-v2.html") },
    fetchImpl: gh.fetchImpl,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    heartbeatSec: 60,
    maxTicks: 2,
  });
  assert.equal(res.ok, true);
  const created = gh.created();
  assert.equal(created.length, 1);
  assert.equal(created[0].body.name, "mission-control-live-signal");
  assert.equal(created[0].body.head_sha, SHA);
  assert.equal(created[0].body.status, "in_progress");
  assert.match(created[0].body.external_id, /dictationb1\/supreme-lamp#1234567890\.2/);
  assert.ok(gh.patched().length >= 1, "a heartbeat PATCH was not published");

  // the payload the lab parses out of the OUTPUT TEXT
  const text = gh.patched()[gh.patched().length - 1].body.output.text;
  const json = JSON.parse(text.replace(/^```json\n/, "").replace(/\n```\n?$/, ""));
  assert.equal(json.schema, "mc-signal/v1");
  assert.equal(json.state, "live");
  assert.equal(json.runId, RUN_ID);
  assert.equal(json.runAttempt, 2);
  assert.equal(json.sha, SHA);
  assert.equal(json.ui.sha, SHA);
  assert.equal(json.credential.kind, "dash-token");
  assert.ok(json.credential.envelope && json.credential.envelope.ct, "the credential envelope is missing");
  assert.equal(json.credential.envelope.keyId, pub.parsePublicKey(kp.spec).keyId);
  assert.ok(json.heartbeatMaxAgeSec >= 180);

  // readable while the app is still running: the state file is written each tick
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.equal(state.published, true);
  assert.equal(state.state, "live");
  assert.equal(state.checkId, created[0] && 9001);
  assert.match(state.checkUrl, /^https:\/\/github\.com\/dictationb1\/supreme-lamp\/runs\/9001$/);
});

test("F200-9 NO plaintext credential, RDP password or key material reaches the API", async () => {
  const dir = tmpDir();
  const kp = makeKeypair();
  writeRuntime(dir);
  const gh = fakeGitHub();
  await pub.runPublisher({
    env: envFor({ LAB_SIGNAL_PUBKEY: kp.spec }),
    argvPaths: { config: path.join(dir, "config.json"), state: path.join(dir, "state.json"), log: path.join(dir, "pub.log"), ui: path.join(dir, "ui-v2.html") },
    fetchImpl: gh.fetchImpl,
    now: () => Date.parse("2026-10-23T00:00:00Z"),
    sleep: async () => {},
    maxTicks: 1,
  });
  const everything = gh.allText();
  assert.ok(!everything.includes(DASH_TOKEN), "the dash token leaked in plaintext to the check run");
  assert.ok(!everything.includes("RDP-PASSWORD-MUST-NOT-LEAK"), "the RDP password leaked to the check run");
  assert.ok(!everything.includes(kp.spec), "the MC-SIGNAL public key was copied into the payload");
  const logText = fs.readFileSync(path.join(dir, "pub.log"), "utf8");
  assert.ok(!logText.includes(DASH_TOKEN), "the dash token leaked into the publisher log");
  assert.ok(!logText.includes("ghs_fake_token"), "the GitHub token leaked into the publisher log");
});

test("F200-10 a missing LAB_SIGNAL_PUBKEY is published as a NAMED integration failure", async () => {
  const dir = tmpDir();
  writeRuntime(dir);
  const gh = fakeGitHub();
  const res = await pub.runPublisher({
    env: envFor(),
    argvPaths: { config: path.join(dir, "config.json"), state: path.join(dir, "state.json"), log: path.join(dir, "pub.log"), ui: path.join(dir, "ui-v2.html") },
    fetchImpl: gh.fetchImpl,
    now: () => Date.parse("2026-10-23T00:00:00Z"),
    sleep: async () => {},
    maxTicks: 1,
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, pub.FAILURE_CODES.PUBKEY_MISSING);
  const created = gh.created();
  assert.equal(created.length, 1, "the failure must still be published as a check run");
  assert.equal(created[0].body.name, "mission-control-live-signal");
  assert.match(created[0].body.output.title, /^integration-failed: mc-signal-pubkey-missing$/);
  // the failing run is closed as a failure immediately (nothing to keep alive)
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.equal(state.published, false);
  assert.equal(state.state, "failed");
  assert.equal(state.reason, "mc-signal-pubkey-missing");
});

test("F200-11 a missing dash credential is a NAMED failure, not a silent skip", async () => {
  const dir = tmpDir();
  const kp = makeKeypair();
  writeRuntime(dir, { dashToken: "" });
  const gh = fakeGitHub();
  const res = await pub.runPublisher({
    env: envFor({ LAB_SIGNAL_PUBKEY: kp.spec }),
    argvPaths: { config: path.join(dir, "config.json"), state: path.join(dir, "state.json"), log: path.join(dir, "pub.log"), ui: path.join(dir, "ui-v2.html") },
    fetchImpl: gh.fetchImpl,
    maxTicks: 1,
    sleep: async () => {},
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, pub.FAILURE_CODES.CREDENTIAL_MISSING);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")).reason, "mc-signal-credential-missing");
});

test("F200-12 a token without checks:write is named, with the exact fix in the message", async () => {
  const dir = tmpDir();
  const kp = makeKeypair();
  writeRuntime(dir);
  const denyingFetch = async () => ({
    ok: false,
    status: 403,
    text: async () => JSON.stringify({ message: "Resource not accessible by integration" }),
  });
  const res = await pub.runPublisher({
    env: envFor({ LAB_SIGNAL_PUBKEY: kp.spec }),
    argvPaths: { config: path.join(dir, "config.json"), state: path.join(dir, "state.json"), log: path.join(dir, "pub.log"), ui: path.join(dir, "ui-v2.html") },
    fetchImpl: denyingFetch,
    maxTicks: 1,
    sleep: async () => {},
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, pub.FAILURE_CODES.TOKEN_UNAUTHORIZED);
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.equal(state.reason, "mc-signal-token-unauthorized");
  assert.match(state.detail, /checks: write/);
});

// ---------------------------------------------------------------------------
// §4 closing: an old signal can never look like a live session
// ---------------------------------------------------------------------------
test("F200-13 close PATCHes completed/neutral, drops the envelope and expires the credential", async () => {
  const dir = tmpDir();
  const kp = makeKeypair();
  writeRuntime(dir);
  const gh = fakeGitHub();
  const paths = { config: path.join(dir, "config.json"), state: path.join(dir, "state.json"), log: path.join(dir, "pub.log"), ui: path.join(dir, "ui-v2.html") };
  await pub.runPublisher({
    env: envFor({ LAB_SIGNAL_PUBKEY: kp.spec }),
    argvPaths: paths,
    fetchImpl: gh.fetchImpl,
    now: () => Date.parse("2026-10-23T01:00:00Z"),
    sleep: async () => {},
    maxTicks: 1,
  });
  const closeRes = await pub.closePublisher({ env: envFor(), argvPaths: paths, fetchImpl: gh.fetchImpl });
  assert.equal(closeRes.closed, true);
  const last = gh.patched()[gh.patched().length - 1].body;
  assert.equal(last.status, "completed");
  assert.equal(last.conclusion, "neutral", "a closed session must not conclude success");
  assert.match(last.output.summary, /closed/);
  assert.match(last.output.summary, /NOT a usable session/);
  const json = JSON.parse(last.output.text.replace(/^```json\n/, "").replace(/\n```\n?$/, ""));
  assert.equal(json.state, "closed");
  assert.equal(json.credential.envelope, null, "a closed signal must not carry a decryptable credential");
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.equal(state.published, false);
  assert.equal(state.state, "closed");
});

test("F200-14 a finished workflow run is detected and the signal closes itself", async () => {
  const dir = tmpDir();
  const kp = makeKeypair();
  writeRuntime(dir);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method });
    if (init.method === "POST") return { ok: true, status: 201, text: async () => JSON.stringify({ id: 4321 }) };
    if (init.method === "PATCH") return { ok: true, status: 200, text: async () => JSON.stringify({ id: 4321 }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: "completed" }) };
  };
  let clock = Date.parse("2026-10-23T02:00:00Z");
  const res = await pub.runPublisher({
    env: envFor({ LAB_SIGNAL_PUBKEY: kp.spec }),
    argvPaths: { config: path.join(dir, "config.json"), state: path.join(dir, "state.json"), log: path.join(dir, "pub.log"), ui: path.join(dir, "ui-v2.html") },
    fetchImpl,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    maxTicks: 5,
    watchRunStatus: true,
  });
  assert.equal(res.state, "closed");
  assert.equal(res.reason, "run-completed");
  assert.ok(calls.some((c) => c.method === "GET" && /\/actions\/runs\//.test(c.url)));
});

test("F200-15 summarize() is human-readable while live and carries no secret", () => {
  const dir = tmpDir();
  const cfg = writeRuntime(dir);
  const signal = pub.buildSignal({
    identity: pub.identityFromEnv(envFor()),
    cfg: { ...cfg, __uiPath: path.join(dir, "ui-v2.html") },
    keyId: "x25519:0123456789abcdef",
    envelope: { v: 1, alg: "x25519-hkdf-sha256+aes-256-gcm", keyId: "x25519:0123456789abcdef", aadB64: "AA==", epk: "AA==", nonce: "AA==", ct: "AA==", tag: "AA==" },
  });
  const summary = pub.summarize(signal);
  assert.match(summary, /mission-control|MC-SIGNAL/);
  assert.match(summary, /sealed envelope/);
  assert.ok(!summary.includes(DASH_TOKEN));
  assert.ok(!summary.includes("RDP-PASSWORD-MUST-NOT-LEAK"));
});

// ---------------------------------------------------------------------------
// §5 workflow wiring: the publisher must run in the REAL rdp job, before keep-alive
// ---------------------------------------------------------------------------
function stepIndex(name) {
  const idx = mainYml.indexOf(`- name: ${name}`);
  assert.ok(idx > 0, `main.yml step not found: ${name}`);
  return idx;
}

test("F200-16 main.yml grants checks: write and keeps every existing permission", () => {
  const perm = mainYml.slice(mainYml.indexOf("\npermissions:"), mainYml.indexOf("\njobs:"));
  assert.match(perm, /^\s+checks:\s+write\b/m, "checks: write is missing - the publisher cannot publish");
  for (const keep of ["contents: write", "actions: write", "pages: write", "id-token: write"]) {
    assert.ok(perm.includes(keep), `existing permission dropped: ${keep}`);
  }
});

test("F200-17 the publisher runs in the rdp job AFTER readiness and BEFORE keep-alive", () => {
  const readiness = stepIndex("Service Readiness Check (Pre-Keepalive)");
  const publish = stepIndex("Publish live Mission Control signal (MC-SIGNAL)");
  const keepAlive = stepIndex("Keep-alive 5h30");
  assert.ok(readiness < publish, "the publisher must run after the backend is up");
  assert.ok(publish < keepAlive, "the publisher must be launched before the long keep-alive phase");
  const block = mainYml.slice(publish, keepAlive);
  assert.ok(block.includes("live-signal-publisher.js"), "the step does not launch the shipped publisher");
  assert.ok(/nodeCmd\.Source|node\.exe/.test(block), "the step does not resolve node.exe explicitly");
  assert.ok(block.includes("LAB_SIGNAL_PUBKEY: ${{ vars.LAB_SIGNAL_PUBKEY }}"), "the repo VARIABLE is not wired");
  assert.ok(block.includes("checks: write") || block.includes("GITHUB_TOKEN"), "the step has no API token");
  assert.ok(block.includes("continue-on-error: true"), "a publication failure must be visible without killing the session");
  assert.ok(/::error( |::)/.test(block), "a publication failure must be annotated as a named integration failure");
  assert.ok(block.includes("integration-failed"), "the annotation must name the failure class");
});

test("F200-18 a close step runs with if: always() so cancellation retires the signal", () => {
  const idx = mainYml.indexOf("- name: Close live Mission Control signal (MC-SIGNAL)");
  assert.ok(idx > 0, "close step missing");
  const lookahead = mainYml.slice(idx, idx + 1400);
  assert.match(lookahead, /if: \$\{\{ always\(\)/, "the close step must run even when the job is cancelled");
  assert.ok(lookahead.includes("--close"), "the close step must call the publisher's close mode");
  const keepAlive = stepIndex("Keep-alive 5h30");
  assert.ok(idx > keepAlive, "the close step must come after keep-alive");
});

test("F200-19 the publisher is supervised during the live session (keep-alive restarts it)", () => {
  const keepAlive = mainYml.indexOf("- name: Keep-alive 5h30");
  const closeStep = mainYml.indexOf("- name: Close live Mission Control signal (MC-SIGNAL)");
  const body = mainYml.slice(keepAlive, closeStep);
  assert.ok(/live-signal[\\/]state\.json/.test(body), "keep-alive does not read the publisher state file");
  assert.ok(/Invoke-McSignalSupervise|mc-signal/.test(body), "keep-alive has no MC-SIGNAL supervision hook");
});

test("F200-20 the publisher never reads workflow logs as its transport", () => {
  assert.ok(!/download.*logs|logs_url|gh run view --log/i.test(publisherSrc), "the publisher fell back to live-log scraping");
  assert.equal(pub.CHECK_NAME, "mission-control-live-signal");
  // the transport is the check-run API
  assert.match(publisherSrc, /\/check-runs/);
});

// ---------------------------------------------------------------------------
// §6 wake-up is OPTIONAL and honestly labelled
// ---------------------------------------------------------------------------
test("F200-21 wake-up is SKIPPED (not faked) when no cross-repo credential exists", async () => {
  const dir = tmpDir();
  const kp = makeKeypair();
  writeRuntime(dir);
  const gh = fakeGitHub();
  await pub.runPublisher({
    env: envFor({ LAB_SIGNAL_PUBKEY: kp.spec, LAB_SIGNAL_LAB_REPO: "" }),
    argvPaths: { config: path.join(dir, "config.json"), state: path.join(dir, "state.json"), log: path.join(dir, "pub.log"), ui: path.join(dir, "ui-v2.html") },
    fetchImpl: gh.fetchImpl,
    maxTicks: 1,
    sleep: async () => {},
  });
  assert.ok(!gh.calls.some((c) => /\/dispatches$/.test(c.url)), "a dispatch was attempted without a cross-repo token");
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.equal(state.wakeup.attempted, false);
  assert.equal(state.wakeup.reason, "no-lab-repo-variable");
  const log = fs.readFileSync(path.join(dir, "pub.log"), "utf8");
  assert.match(log, /wake-up: skipped/);
});

test("F200-22 wake-up dispatches with ITS OWN token (never the application GITHUB_TOKEN)", async () => {
  const dir = tmpDir();
  const kp = makeKeypair();
  writeRuntime(dir);
  const gh = fakeGitHub();
  await pub.runPublisher({
    env: envFor({
      LAB_SIGNAL_PUBKEY: kp.spec,
      LAB_SIGNAL_LAB_REPO: "dictationb1/supreme-lamp-lab",
      LAB_SIGNAL_DISPATCH_TOKEN: "pat-cross-repo",
    }),
    argvPaths: { config: path.join(dir, "config.json"), state: path.join(dir, "state.json"), log: path.join(dir, "pub.log"), ui: path.join(dir, "ui-v2.html") },
    fetchImpl: gh.fetchImpl,
    maxTicks: 1,
    sleep: async () => {},
  });
  const dispatch = gh.calls.find((c) => /\/repos\/dictationb1\/supreme-lamp-lab\/dispatches$/.test(c.url));
  assert.ok(dispatch, "repository_dispatch was not attempted");
  assert.equal(dispatch.headers.Authorization, "Bearer pat-cross-repo");
  assert.equal(dispatch.body.event_type, "mc-signal-ready");
  assert.equal(dispatch.body.client_payload.runId, RUN_ID);
  assert.equal(dispatch.body.client_payload.checkName, "mission-control-live-signal");
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.equal(state.wakeup.attempted, true);
  assert.equal(state.wakeup.ok, true);
});

test("F200-23 close with no recorded check id is a no-op, not a crash", async () => {
  const dir = tmpDir();
  const gh = fakeGitHub();
  const res = await pub.closePublisher({
    env: envFor(),
    argvPaths: { config: path.join(dir, "config.json"), state: path.join(dir, "nope.json"), log: path.join(dir, "x.log") },
    fetchImpl: gh.fetchImpl,
  });
  assert.equal(res.ok, true);
  assert.equal(res.closed, false);
});
