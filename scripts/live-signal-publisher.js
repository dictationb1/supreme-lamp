#!/usr/bin/env node
/**
 * [F200 / MC-SIGNAL] Live-run signal publisher for Mission Control.
 *
 * PURPOSE
 * -------
 * The lab has to discover a REAL application run (`.github/workflows/main.yml`,
 * mode=rdp) and open its ACTUAL authenticated Mission Control UI on the Windows
 * client VM. Live workflow logs were measured to be unavailable in the tested
 * paths; check-run output was readable while the app was still running. So the
 * application publishes this run's identity + endpoint here, as a check run
 * named `mission-control-live-signal`, and the dashboard credential travels
 * ONLY as a sealed envelope addressed to the lab's MC-SIGNAL public key.
 *
 * WHAT IS PUBLISHED
 * -----------------
 *   non-secret : repository, run id, run attempt, application SHA, ref,
 *                workflow, job, endpoint(s), UI build SHA (read back from the
 *                SERVED bundle), publish/heartbeat/expiry timestamps,
 *                key id (a fingerprint, never a key), publisher liveness.
 *   encrypted  : the per-run dashboard credential (config.json dashToken).
 *   never      : the RDP password, the VNC password, any Tailscale key, the
 *                MC-SIGNAL private key, the RDP file-signing private key.
 *
 * KEYS ARE NOT INTERCHANGEABLE. The MC-SIGNAL key pair is its own thing:
 *   - app repository VARIABLE  LAB_SIGNAL_PUBKEY      (public, encryption only)
 *   - lab repository SECRET    LAB_SIGNAL_PRIVATE_KEY (private, decrypt only)
 * It is NOT the per-run dash token, NOT the RDP password and NOT the .rdp
 * signing certificate.
 *
 * FAILURE IS NAMED, NEVER SILENT
 * ------------------------------
 * Every failure mode returns a stable code (`mc-signal-*`) and, in publish
 * mode, is written into the check run itself as
 * `integration-failed: <code>` with conclusion `failure`, so a missing
 * variable or a token without `checks: write` is visible to the lab instead of
 * looking like "the run is not up yet".
 *
 * LIVENESS / ANTI-REPLAY
 * ----------------------
 * The check stays in_progress and is re-PATCHed every heartbeat. A consumer
 * MUST require `state === "live"` AND a heartbeat newer than
 * `heartbeatMaxAgeSec` AND `expiresAt` in the future. On normal exit,
 * cancellation, run termination or expiry the publisher PATCHes
 * `state: "closed"` + conclusion `neutral`, and the credential's own
 * `credentialExpiresAt` is in the past. An old check therefore can never be
 * read as a usable current session.
 *
 * USAGE (workflow)
 * ----------------
 *   node scripts/live-signal-publisher.js --config C:\ghrdp\config.json \
 *        --state C:\ghrdp\live-signal\state.json --log C:\ghrdp\live-signal\publisher.log
 *   node scripts/live-signal-publisher.js --close          # final close
 *   node scripts/live-signal-publisher.js --print-key-info # verify the var parses
 *   node scripts/live-signal-publisher.js --self-test      # offline crypto/identity cells
 *   node scripts/live-signal-publisher.js --decrypt <file> --private-key <path>
 *
 * Node >= 18 (global fetch). No dependencies. Nothing in this file may log a
 * credential.
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const VERSION = "F200/1.0.0";
const SCHEMA = "mc-signal/v1";
const CHECK_NAME = "mission-control-live-signal";
const DEFAULT_HEARTBEAT_SEC = 60;
const DEFAULT_HEARTBEAT_MAX_AGE_SEC = 180;

// Stable, named failure codes. The first token after `mc-signal-` is the class;
// consumers may match on the exact string.
const FAILURE_CODES = Object.freeze({
  PUBKEY_MISSING: "mc-signal-pubkey-missing",
  PUBKEY_UNPARSEABLE: "mc-signal-pubkey-unparseable",
  PUBKEY_UNSUPPORTED_ALG: "mc-signal-pubkey-unsupported-alg",
  CONFIG_UNREADABLE: "mc-signal-config-unreadable",
  CREDENTIAL_MISSING: "mc-signal-credential-missing",
  ENDPOINT_MISSING: "mc-signal-endpoint-missing",
  IDENTITY_MISSING: "mc-signal-identity-missing",
  PUBLISH_HTTP: "mc-signal-publish-http",
  TOKEN_UNAUTHORIZED: "mc-signal-token-unauthorized",
  STATE_UNWRITABLE: "mc-signal-state-unwritable",
  UI_STAMP_MISSING: "mc-signal-ui-stamp-missing",
  DECRYPT_FAILED: "mc-signal-decrypt-failed",
  INTERNAL: "mc-signal-internal",
});

class SignalError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SignalError";
    this.code = code;
    this.detail = detail || "";
  }
}

// ---------------------------------------------------------------------------
// canonical JSON (sorted keys, no whitespace) - the AAD contract
// ---------------------------------------------------------------------------
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}

/**
 * The identity that a credential envelope is bound to. AAD = this object's
 * canonical bytes, published verbatim in `envelope.aadB64`, so the consumer
 * does not have to re-derive it - but `verifyEnvelopeBinding` proves the
 * published AAD really matches the published identity.
 */
function canonicalIdentity(signal) {
  return {
    schema: SCHEMA,
    repository: String(signal.repository || ""),
    runId: String(signal.runId || ""),
    runAttempt: Number(signal.runAttempt || 0),
    sha: String(signal.sha || ""),
    keyId: String(signal.keyId || ""),
  };
}

function aadFor(signal) {
  return Buffer.from(stableStringify(canonicalIdentity(signal)), "utf8");
}

// ---------------------------------------------------------------------------
// public key handling
// ---------------------------------------------------------------------------
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}
function fromB64(text) {
  return Buffer.from(String(text).replace(/\s+/g, ""), "base64");
}

/**
 * Accepts the shapes an operator can realistically paste into a repository
 * variable:
 *   - SPKI PEM (`-----BEGIN PUBLIC KEY-----`, real newlines or literal \n)
 *   - base64 DER (SPKI)
 *   - base64 or hex raw 32-byte X25519 key
 *   - any of the above prefixed with `x25519:` / `rsa:` to remove ambiguity
 * Ed25519 is REJECTED by name: it is a signing key and cannot encrypt.
 */
function parsePublicKey(spec) {
  if (spec === undefined || spec === null || String(spec).trim() === "") {
    throw new SignalError(FAILURE_CODES.PUBKEY_MISSING, "LAB_SIGNAL_PUBKEY is empty or undefined");
  }
  let text = String(spec).trim();
  let declared = "";
  const pref = text.match(/^(x25519|rsa|ed25519|spki):/i);
  if (pref) {
    declared = pref[1].toLowerCase();
    text = text.slice(pref[0].length).trim();
  }
  if (text.includes("\\n")) text = text.replace(/\\n/g, "\n");

  let keyObject = null;
  let rawPublic = null;

  if (/-----BEGIN [A-Z ]*PUBLIC KEY-----/.test(text)) {
    try {
      keyObject = crypto.createPublicKey({ key: text, format: "pem" });
    } catch (err) {
      throw new SignalError(FAILURE_CODES.PUBKEY_UNPARSEABLE, "PEM did not parse as a public key");
    }
  } else {
    let buf;
    try {
      buf = /^[0-9a-fA-F]{64}$/.test(text) ? Buffer.from(text, "hex") : fromB64(text);
    } catch {
      buf = Buffer.alloc(0);
    }
    if (buf.length === 32 && declared !== "rsa") {
      rawPublic = buf;
      // raw 32 bytes: X25519 unless the operator says otherwise
      const prefix = declared === "ed25519" ? ED25519_SPKI_PREFIX : X25519_SPKI_PREFIX;
      try {
        keyObject = crypto.createPublicKey({ key: Buffer.concat([prefix, buf]), format: "der", type: "spki" });
      } catch {
        throw new SignalError(FAILURE_CODES.PUBKEY_UNPARSEABLE, "raw 32-byte key did not import");
      }
    } else if (buf.length > 0) {
      try {
        keyObject = crypto.createPublicKey({ key: buf, format: "der", type: "spki" });
      } catch {
        throw new SignalError(
          FAILURE_CODES.PUBKEY_UNPARSEABLE,
          "neither 32-byte raw, base64 DER/SPKI nor PEM"
        );
      }
    } else {
      throw new SignalError(FAILURE_CODES.PUBKEY_UNPARSEABLE, "empty key material after prefix strip");
    }
  }

  const type = keyObject.asymmetricKeyType;
  if (type === "ed25519") {
    throw new SignalError(
      FAILURE_CODES.PUBKEY_UNSUPPORTED_ALG,
      "an Ed25519 key cannot encrypt a credential; set LAB_SIGNAL_PUBKEY to the X25519 (or RSA) public key"
    );
  }
  if (type !== "x25519" && type !== "rsa") {
    throw new SignalError(FAILURE_CODES.PUBKEY_UNSUPPORTED_ALG, `unsupported public key type '${type}'`);
  }
  if (!rawPublic) {
    const der = keyObject.export({ format: "der", type: "spki" });
    if (type === "x25519") rawPublic = der.subarray(der.length - 32);
  }
  const fingerprint = crypto.createHash("sha256").update(
    type === "x25519" ? rawPublic : keyObject.export({ format: "der", type: "spki" })
  ).digest("hex").slice(0, 16);
  return {
    keyObject,
    type,
    rawPublic,
    keyId: type === "x25519" ? `x25519:${fingerprint}` : `rsa:${fingerprint}`,
  };
}

// ---------------------------------------------------------------------------
// sealed envelope: credential in, envelope out
// ---------------------------------------------------------------------------
function sealCredential({ publicKeySpec, plaintext, signal }) {
  const parsed = typeof publicKeySpec === "string" ? parsePublicKey(publicKeySpec) : publicKeySpec;
  const aadBytes = aadFor({ ...signal, keyId: parsed.keyId });
  const pt = Buffer.from(typeof plaintext === "string" ? plaintext : stableStringify(plaintext), "utf8");

  if (parsed.type === "x25519") {
    const eph = crypto.generateKeyPairSync("x25519");
    const ephPubRaw = eph.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: parsed.keyObject });
    const key = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        shared,
        Buffer.concat([ephPubRaw, parsed.rawPublic]),
        Buffer.from(`${SCHEMA} x25519-hkdf-sha256+aes-256-gcm`),
        32
      )
    );
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aadBytes);
    const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: 1,
      alg: "x25519-hkdf-sha256+aes-256-gcm",
      keyId: parsed.keyId,
      epk: b64(ephPubRaw),
      nonce: b64(nonce),
      aadB64: b64(aadBytes),
      ct: b64(ct),
      tag: b64(tag),
    };
  }

  // rsa: RSA-OAEP-SHA256 wraps a fresh content key, AES-256-GCM seals the payload
  const cek = crypto.randomBytes(32);
  const wrapped = crypto.publicEncrypt(
    { key: parsed.keyObject, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    cek
  );
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cek, nonce);
  cipher.setAAD(aadBytes);
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "rsa-oaep-sha256+aes-256-gcm",
    keyId: parsed.keyId,
    wrappedKey: b64(wrapped),
    nonce: b64(nonce),
    aadB64: b64(aadBytes),
    ct: b64(ct),
    tag: b64(tag),
  };
}

/**
 * Decryptor. The lab session can copy this file (or call it) with its own
 * private key; the app never holds that key. Kept in the same module so the
 * encryptor and decryptor cannot drift.
 */
function openCredential({ privateKey, privateKeyPath, envelope, signal }) {
  let priv = privateKey;
  if (!priv) {
    if (!privateKeyPath) throw new SignalError(FAILURE_CODES.DECRYPT_FAILED, "no private key supplied");
    let text = fs.readFileSync(privateKeyPath, "utf8");
    if (text.includes("\\n")) text = text.replace(/\\n/g, "\n");
    try {
      priv = crypto.createPrivateKey({ key: text, format: "pem" });
    } catch {
      try {
        priv = crypto.createPrivateKey({ key: fromB64(text), format: "der", type: "pkcs8" });
      } catch {
        throw new SignalError(FAILURE_CODES.DECRYPT_FAILED, "private key file did not parse (PEM or base64 PKCS#8)");
      }
    }
  }
  if (!envelope || envelope.v !== 1) throw new SignalError(FAILURE_CODES.DECRYPT_FAILED, "envelope.v must be 1");
  const aadBytes = envelope.aadB64 ? fromB64(envelope.aadB64) : aadFor(signal);
  const nonce = fromB64(envelope.nonce);
  const tag = fromB64(envelope.tag);
  const ct = fromB64(envelope.ct);
  let key;
  if (envelope.alg === "x25519-hkdf-sha256+aes-256-gcm") {
    const peerRaw = fromB64(envelope.epk);
    const peer = crypto.createPublicKey({
      key: Buffer.concat([X25519_SPKI_PREFIX, peerRaw]),
      format: "der",
      type: "spki",
    });
    const shared = crypto.diffieHellman({ privateKey: priv, publicKey: peer });
    const selfRaw = crypto.createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
    key = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        shared,
        Buffer.concat([peerRaw, selfRaw]),
        Buffer.from(`${SCHEMA} x25519-hkdf-sha256+aes-256-gcm`),
        32
      )
    );
  } else if (envelope.alg === "rsa-oaep-sha256+aes-256-gcm") {
    key = crypto.privateDecrypt(
      { key: priv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      fromB64(envelope.wrappedKey)
    );
  } else {
    throw new SignalError(FAILURE_CODES.DECRYPT_FAILED, `unknown envelope alg '${envelope.alg}'`);
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aadBytes);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    return { plaintext: out, aad: aadBytes.toString("utf8") };
  } catch {
    throw new SignalError(FAILURE_CODES.DECRYPT_FAILED, "authentication failed (wrong key, tampered envelope or mismatched AAD)");
  }
}

/**
 * Proves the published AAD really binds this credential to this identity.
 * A lab consumer should call this (or compare `envelope.aadB64` with the
 * canonical AAD it builds from the published identity).
 */
function verifyEnvelopeBinding(envelope, signal) {
  if (!envelope || !envelope.aadB64) return false;
  const expected = aadFor({ ...signal, keyId: envelope.keyId || signal.keyId });
  const published = fromB64(envelope.aadB64);
  if (published.length !== expected.length) return false;
  // Both sides are public; timing-safety is not required here, but comparing
  // the full buffer (not a string) keeps encoding differences visible.
  return crypto.timingSafeEqual(published, expected);
}

// ---------------------------------------------------------------------------
// run identity + runtime config
// ---------------------------------------------------------------------------
function readJsonLoose(file) {
  let text = fs.readFileSync(file);
  if (text.length >= 3 && text[0] === 0xef && text[1] === 0xbb && text[2] === 0xbf) text = text.subarray(3);
  return JSON.parse(text.toString("utf8"));
}

function readRuntimeConfig(configPath) {
  let cfg;
  try {
    cfg = readJsonLoose(configPath);
  } catch (err) {
    throw new SignalError(FAILURE_CODES.CONFIG_UNREADABLE, `cannot read ${configPath}: ${err.code || err.message}`);
  }
  return cfg;
}

/** The UI build stamp, read back from the file the browser ACTUALLY receives. */
function readUiStamp(uiPath) {
  try {
    const html = fs.readFileSync(uiPath, "utf8");
    const m = html.match(/name="ghrdp-build"\s+content="([^"]+)"/);
    if (!m) return { sha: "", bytes: Buffer.byteLength(html), file: path.basename(uiPath), stamped: false };
    return { sha: String(m[1]), bytes: Buffer.byteLength(html), file: path.basename(uiPath), stamped: true };
  } catch {
    return { sha: "", bytes: 0, file: path.basename(uiPath), stamped: false };
  }
}

function identityFromEnv(env) {
  const repository = String(env.GITHUB_REPOSITORY || "").trim();
  const runId = String(env.GITHUB_RUN_ID || "").trim();
  const runAttempt = Number(env.GITHUB_RUN_ATTEMPT || 0);
  const sha = String(env.GITHUB_SHA || "").trim();
  if (!repository || !runId || !sha) {
    throw new SignalError(
      FAILURE_CODES.IDENTITY_MISSING,
      "GITHUB_REPOSITORY / GITHUB_RUN_ID / GITHUB_SHA must be set (run this from the workflow, not by hand)"
    );
  }
  return {
    repository,
    runId,
    runAttempt: Number.isFinite(runAttempt) && runAttempt > 0 ? runAttempt : 1,
    sha,
    ref: String(env.GITHUB_REF_NAME || env.GITHUB_REF || "").replace(/^refs\/heads\//, ""),
    workflow: String(env.GITHUB_WORKFLOW || ""),
    job: String(env.GITHUB_JOB || ""),
    runUrl: `https://github.com/${repository}/actions/runs/${runId}`,
  };
}

// ---------------------------------------------------------------------------
// endpoint + credential selection
// ---------------------------------------------------------------------------
function pickEndpoint(cfg) {
  const ip = String(cfg.rdpIp || "").trim();
  const serve = String(cfg.serveUrl || "").trim().replace(/\/+$/, "");
  const funnel = String(cfg.funnelUrl || "").trim().replace(/\/+$/, "");
  const ps = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ? `http://${ip}:7331` : "";
  const primary = serve || ps || funnel;
  if (!primary) {
    throw new SignalError(FAILURE_CODES.ENDPOINT_MISSING, "config.json has no serveUrl and no CGNAT rdpIp");
  }
  return {
    primary,
    transport: serve ? "tailscale-serve" : ps ? "tailnet-ip" : "funnel",
    tailnetIp: ip,
    serve: serve || "",
    funnel: funnel || "",
    port: 7331,
    // The credential is a QUERY PARAM, never a path segment: consumers append
    // `?key=<decrypted dashToken>` and must not log the composed URL.
    authPathTemplate: "/?key={credential}",
  };
}

// ---------------------------------------------------------------------------
// signal assembly
// ---------------------------------------------------------------------------
function buildSignal({ identity, cfg, keyId, envelope, state, reason, nowMs, heartbeatSec, expiresAt }) {
  const endpoint = pickEndpoint(cfg);
  const ui = readUiStamp(cfg.__uiPath || "");
  const now = new Date(nowMs || Date.now());
  const expires = new Date(expiresAt || now.getTime() + 6 * 3600 * 1000);
  const signal = {
    schema: SCHEMA,
    state: state || "live",
    reason: reason || "",
    repository: identity.repository,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    sha: identity.sha,
    ref: identity.ref,
    workflow: identity.workflow,
    job: identity.job,
    runUrl: identity.runUrl,
    ui: {
      sha: ui.sha,
      file: ui.file,
      bytes: ui.bytes,
      stamped: ui.stamped,
      matchesRunSha: Boolean(ui.sha && identity.sha && ui.sha.toLowerCase() === identity.sha.toLowerCase()),
    },
    endpoint,
    startedAt: identity.startedAt || now.toISOString(),
    publishedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    heartbeatSec: Number(heartbeatSec || DEFAULT_HEARTBEAT_SEC),
    heartbeatMaxAgeSec: Math.max(3 * Number(heartbeatSec || DEFAULT_HEARTBEAT_SEC), DEFAULT_HEARTBEAT_MAX_AGE_SEC),
    keyId: keyId || (envelope && envelope.keyId) || "",
    credential: {
      kind: "dash-token",
      queryParam: "key",
      // NEVER the token itself. Only the sealed envelope.
      envelope: envelope || null,
      issuedAt: now.toISOString(),
      // A closed signal's credential is declared dead even if the token is
      // still accepted by the server for a few more seconds.
      credentialExpiresAt: (state === "closed" ? now : expires).toISOString(),
    },
    publisher: {
      version: VERSION,
      host: os.hostname(),
      pid: process.pid,
      node: process.version,
    },
    // Honesty fields: what this signal does and does not claim.
    claims: {
      authenticatedUi: true,
      credentialEncrypted: true,
      transport: "check-run-output",
      liveLogsUsed: false,
    },
  };
  if (envelope) {
    // A stable place for consumers that only look at the top level.
    signal.credentialEnvelope = envelope;
  }
  return signal;
}

function summarize(signal) {
  const e = signal.endpoint || {};
  const uiLine = signal.ui.stamped
    ? `\`${signal.ui.sha}\` (${signal.ui.matchesRunSha ? "matches run SHA" : "DIFFERS from run SHA"})`
    : `not stamped (${signal.ui.file || "ui file missing"})`;
  const cred = signal.credential && signal.credential.envelope
    ? `sealed envelope \`${signal.credential.envelope.alg}\` · keyId \`${signal.credential.envelope.keyId}\``
    : "**MISSING**";
  const stateLine = signal.state === "live"
    ? `**live** (heartbeat < ${signal.heartbeatMaxAgeSec}s required)`
    : `**${signal.state}**${signal.reason ? ` · ${signal.reason}` : ""} — NOT a usable session`;
  return [
    `### MC-SIGNAL ${signal.schema} — ${stateLine}`,
    "",
    `- run: \`${signal.repository}\` **#${signal.runId}** (attempt ${signal.runAttempt}) · sha \`${signal.sha}\` · ref \`${signal.ref || "-"}\``,
    `- endpoint: \`${e.primary}\` (transport: ${e.transport})`,
    `- dashboard credential: ${cred} — decrypted with the lab's \`LAB_SIGNAL_PRIVATE_KEY\`, appended as \`?key=…\``,
    `- ui bundle: ${uiLine}`,
    `- published: \`${signal.publishedAt}\` · expires: \`${signal.expiresAt}\``,
    "",
    "Machine-readable payload is in the **output text** of this check run (a fenced JSON block).",
    "This check carries NO plaintext credential, no RDP password and no key material.",
  ].join("\n");
}

function payloadText(signal) {
  return "```json\n" + JSON.stringify(signal, null, 2) + "\n```\n";
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------
function apiBase(env) {
  return String(env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
}

async function ghRequest(env, method, apiPath, body, fetchImpl, tokenOverride) {
  const token = String(tokenOverride || env.GITHUB_TOKEN || "");
  if (!token) {
    throw new SignalError(FAILURE_CODES.TOKEN_UNAUTHORIZED, "GITHUB_TOKEN is empty; the job needs 'checks: write'");
  }
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new SignalError(FAILURE_CODES.INTERNAL, "global fetch is unavailable (Node >= 18 required)");
  }
  const res = await doFetch(apiBase(env) + apiPath, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": `ghrdp-live-signal/${VERSION}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new SignalError(
        FAILURE_CODES.TOKEN_UNAUTHORIZED,
        `${method} ${apiPath} -> HTTP ${res.status}: the token cannot write check runs (grant 'checks: write' to GITHUB_TOKEN in the workflow permissions block)`
      );
    }
    throw new SignalError(FAILURE_CODES.PUBLISH_HTTP, `${method} ${apiPath} -> HTTP ${res.status} ${json && json.message ? json.message : ""}`.trim());
  }
  return json;
}

async function createCheck(env, signal, fetchImpl) {
  const body = {
    name: CHECK_NAME,
    head_sha: signal.sha,
    status: "in_progress",
    started_at: signal.startedAt,
    external_id: `${signal.repository}#${signal.runId}.${signal.runAttempt}`,
    output: {
      title:
        signal.state === "failed"
          ? `integration-failed: ${signal.reason || FAILURE_CODES.INTERNAL}`
          : `MC-SIGNAL ${signal.state} · run #${signal.runId}.${signal.runAttempt} · ${signal.sha.slice(0, 7)}`,
      summary: summarize(signal),
      text: payloadText(signal),
    },
  };
  const res = await ghRequest(env, "POST", `/repos/${signal.repository}/check-runs`, body, fetchImpl);
  if (!res || !res.id) throw new SignalError(FAILURE_CODES.PUBLISH_HTTP, "check-run create returned no id");
  return Number(res.id);
}

async function updateCheck(env, checkId, signal, fetchImpl) {
  const closed = signal.state !== "live" && signal.state !== "opening";
  const failed = signal.state === "failed";
  const body = {
    status: closed ? "completed" : "in_progress",
    output: {
      title: failed
        ? `integration-failed: ${signal.reason || "mc-signal-internal"}`
        : `MC-SIGNAL ${signal.state} · run #${signal.runId}.${signal.runAttempt} · ${signal.sha.slice(0, 7)}`,
      summary: summarize(signal),
      text: payloadText(signal),
    },
  };
  if (closed) {
    body.conclusion = failed ? "failure" : "neutral";
    body.completed_at = signal.publishedAt;
  }
  await ghRequest(env, "PATCH", `/repos/${signal.repository}/check-runs/${checkId}`, body, fetchImpl);
}

async function runStatus(env, signal, fetchImpl) {
  try {
    const res = await ghRequest(env, "GET", `/repos/${signal.repository}/actions/runs/${signal.runId}`, undefined, fetchImpl);
    return res && res.status ? String(res.status) : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// OPTIONAL event-based wake-up (polling stays the recovery path)
// ---------------------------------------------------------------------------
/**
 * HONEST SCOPE: an application GITHUB_TOKEN cannot write to another repository,
 * and an Actions-created check_run does not reliably trigger another Actions
 * workflow. So wake-up is only possible with an explicit cross-repo credential
 * (LAB_SIGNAL_DISPATCH_TOKEN) and a target repository variable
 * (LAB_SIGNAL_LAB_REPO). Absent either one this is SKIPPED and named as such -
 * never reported as "immediate". The lab's ~10-minute schedule remains the
 * actual discovery mechanism until both are configured.
 */
async function maybeDispatchWakeup({ env, signal, checkId, fetchImpl, log }) {
  const labRepo = String(env.LAB_SIGNAL_LAB_REPO || "").trim();
  const token = String(env.LAB_SIGNAL_DISPATCH_TOKEN || "").trim();
  if (!labRepo) return { attempted: false, ok: false, reason: "no-lab-repo-variable" };
  if (!token) return { attempted: false, ok: false, reason: "no-cross-repo-token" };
  try {
    await ghRequest(
      env,
      "POST",
      `/repos/${labRepo}/dispatches`,
      {
        event_type: "mc-signal-ready",
        client_payload: {
          repository: signal.repository,
          runId: signal.runId,
          runAttempt: signal.runAttempt,
          sha: signal.sha,
          checkName: CHECK_NAME,
          checkId: checkId || null,
        },
      },
      fetchImpl,
      token
    );
    if (log) log.info(`wake-up dispatched to ${labRepo} (repository_dispatch mc-signal-ready)`);
    return { attempted: true, ok: true, repo: labRepo };
  } catch (err) {
    if (log) log.warn(`wake-up dispatch failed (${err.message}) - the lab schedule is still the recovery path`);
    return { attempted: true, ok: false, reason: err instanceof SignalError ? err.code : "dispatch-failed" };
  }
}

// ---------------------------------------------------------------------------
// state file (the workflow step asserts on this)
// ---------------------------------------------------------------------------
function defaultPaths(env) {
  const root = String(env.MC_SIGNAL_ROOT || (process.platform === "win32" ? "C:\\ghrdp" : "/tmp/ghrdp"));
  return {
    config: path.join(root, "config.json"),
    state: path.join(root, "live-signal", "state.json"),
    log: path.join(root, "live-signal", "publisher.log"),
  };
}

function writeState(statePath, patch) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    let prior = {};
    try {
      prior = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {
      prior = {};
    }
    const next = { ...prior, ...patch, updatedAt: new Date().toISOString() };
    fs.writeFileSync(statePath, JSON.stringify(next, null, 2));
    return next;
  } catch (err) {
    throw new SignalError(FAILURE_CODES.STATE_UNWRITABLE, `${statePath}: ${err.code || err.message}`);
  }
}

function makeLogger(logPath) {
  const write = (line) => {
    const text = `${new Date().toISOString()} ${line}`;
    try {
      if (logPath) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(logPath, text + "\n");
      }
    } catch {
      /* logging must never take the publisher down */
    }
    // stdout is captured by the workflow; it carries no credential by design
    process.stdout.write(text + "\n");
  };
  return {
    info: (msg) => write(`[mc-signal] ${msg}`),
    warn: (msg) => write(`[mc-signal] WARN ${msg}`),
    error: (msg) => write(`[mc-signal] ERROR ${msg}`),
  };
}

// ---------------------------------------------------------------------------
// the publisher
// ---------------------------------------------------------------------------
async function publishOnce({ env, signal, checkId, fetchImpl }) {
  if (!checkId) return createCheck(env, signal, fetchImpl);
  await updateCheck(env, checkId, signal, fetchImpl);
  return checkId;
}

/**
 * One full tick: build the signal (identity + endpoint + sealed credential) and
 * publish it. `checkId` is optional and returned so the caller can PATCH.
 */
function buildTickSignal({ env, cfg, checkId, state, reason, nowMs, heartbeatSec, pubkey }) {
  const identity = identityFromEnv(env);
  const parsed = parsePublicKey(pubkey !== undefined ? pubkey : env.LAB_SIGNAL_PUBKEY);
  const dashToken = String((cfg && cfg.dashToken) || "").trim();
  if (!dashToken) {
    throw new SignalError(FAILURE_CODES.CREDENTIAL_MISSING, "config.json has no dashToken yet (the dashboard has not started)");
  }
  const shell = {
    repository: identity.repository,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    sha: identity.sha,
    keyId: parsed.keyId,
  };
  const envelope = sealCredential({
    publicKeySpec: parsed,
    plaintext: JSON.stringify({
      dashTokenQueryParam: "key",
      dashToken,
      issuedAt: new Date(nowMs || Date.now()).toISOString(),
      repository: identity.repository,
      runId: identity.runId,
      runAttempt: identity.runAttempt,
      sha: identity.sha,
    }),
    signal: shell,
  });
  const cfgForBuild = { ...cfg, __uiPath: cfg.__uiPath || "" };
  const signal = buildSignal({
    identity: { ...identity, startedAt: (cfg && cfg.serverStartedAt) || undefined },
    cfg: cfgForBuild,
    keyId: parsed.keyId,
    envelope,
    state: state || "live",
    reason,
    nowMs,
    heartbeatSec,
  });
  signal.checkId = checkId || null;
  return signal;
}

async function runPublisher(opts) {
  const {
    env = process.env,
    argvPaths = {},
    fetchImpl,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    maxTicks = Infinity,
    heartbeatSec = DEFAULT_HEARTBEAT_SEC,
    clock,
  } = opts || {};
  const paths = {
    config: argvPaths.config || defaultPaths(env).config,
    state: argvPaths.state || defaultPaths(env).state,
    log: argvPaths.log || defaultPaths(env).log,
    ui: argvPaths.ui || path.join(path.dirname(argvPaths.config || defaultPaths(env).config), "ui-v2.html"),
  };
  const log = makeLogger(paths.log);
  let checkId = null;
  let closed = false;
  let wakeup = null;

  const closeOnce = async (state, reason) => {
    if (closed) return;
    closed = true;
    try {
      let cfg = {};
      try {
        cfg = readRuntimeConfig(paths.config);
      } catch {
        cfg = {};
      }
      // A closing signal carries NO credential: build it directly instead of
      // through buildTickSignal (which requires a dash token that may already
      // be gone from config.json by the time we close).
      const closingSignal = buildSignal({
        identity: identityFromEnv(env),
        cfg: { ...cfg, __uiPath: paths.ui },
        keyId: "",
        envelope: null,
        state,
        reason,
        nowMs: now(),
        heartbeatSec,
      });
      if (checkId) await updateCheck(env, checkId, closingSignal, fetchImpl);
      writeState(paths.state, {
        published: false,
        state,
        reason,
        checkId,
        lastPublishAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
      });
      log.info(`closed state=${state} reason=${reason} checkId=${checkId || "-"}`);
    } catch (err) {
      const code = err instanceof SignalError ? err.code : FAILURE_CODES.INTERNAL;
      log.error(`close failed ${code}: ${err.message}`);
      writeState(paths.state, { published: false, state: "closed", reason: code, checkId, lastError: code });
    }
  };

  // signal handlers: cancellation must retire the signal, never leave it live
  const onSignal = (name) => {
    void closeOnce("closed", `publisher-${name}`).then(() => process.exit(0));
  };
  if (opts.installSignalHandlers) {
    process.on("SIGTERM", () => onSignal("sigterm"));
    process.on("SIGINT", () => onSignal("sigint"));
  }

  try {
    let startedAt = now();
    const expiresAt = startedAt + 6 * 3600 * 1000;
    for (let tick = 0; tick < maxTicks; tick++) {
      if (tick > 0) await sleep(heartbeatSec * 1000);
      const tickStart = now();
      let cfg;
      try {
        cfg = readRuntimeConfig(paths.config);
      } catch (err) {
        throw err instanceof SignalError ? err : new SignalError(FAILURE_CODES.CONFIG_UNREADABLE, err.message);
      }
      const signal = buildTickSignal({
        env,
        cfg: { ...cfg, __uiPath: paths.ui },
        checkId,
        state: "live",
        nowMs: tickStart,
        heartbeatSec,
      });
      if (!signal.ui.stamped) log.warn(FAILURE_CODES.UI_STAMP_MISSING + ` (${paths.ui})`);
      else if (!signal.ui.matchesRunSha) log.warn(`ui sha ${signal.ui.sha} != run sha ${signal.sha}`);
      checkId = await publishOnce({ env, signal, checkId, fetchImpl });
      writeState(paths.state, {
        published: true,
        state: "live",
        reason: "",
        checkId,
        checkUrl: `https://github.com/${signal.repository}/runs/${checkId}`,
        repository: signal.repository,
        runId: signal.runId,
        runAttempt: signal.runAttempt,
        sha: signal.sha,
        endpoint: signal.endpoint.primary,
        keyId: signal.keyId,
        uiSha: signal.ui.sha,
        uiMatchesRunSha: signal.ui.matchesRunSha,
        lastPublishAt: signal.publishedAt,
        expiresAt: signal.expiresAt,
        heartbeatSec,
        lastError: "",
        pid: process.pid,
      });
      log.info(
        `published checkId=${checkId} run=${signal.runId}.${signal.runAttempt} sha=${signal.sha.slice(0, 7)} endpoint=${signal.endpoint.primary} ui=${signal.ui.sha || "unstamped"} keyId=${signal.keyId}`
      );

      // One wake-up attempt per publisher lifetime (recovery = the lab schedule).
      if (!wakeup) {
        wakeup = await maybeDispatchWakeup({ env, signal, checkId, fetchImpl, log });
        if (!wakeup.attempted) log.info(`wake-up: skipped (${wakeup.reason}) - polling remains the actual mechanism`);
        writeState(paths.state, { wakeup });
      }

      // run-ended / expiry watch: an old signal must never look current
      if (now() >= expiresAt) {
        await closeOnce("closed", "expired");
        return { ok: true, checkId, state: "closed", reason: "expired" };
      }
      if (tick > 0 || opts.watchRunStatus) {
        const status = await runStatus(env, signal, fetchImpl);
        if (status && status !== "in_progress" && status !== "queued" && status !== "requested" && status !== "waiting") {
          await closeOnce("closed", `run-${status}`);
          return { ok: true, checkId, state: "closed", reason: `run-${status}` };
        }
      }
    }
    return { ok: true, checkId, state: "live" };
  } catch (err) {
    const code = err instanceof SignalError ? err.code : FAILURE_CODES.INTERNAL;
    log.error(`${code}: ${err.message}`);
    // publish the FAILURE as a check run so the lab sees a named breakage
    try {
      let cfg = {};
      try {
        cfg = readRuntimeConfig(paths.config);
      } catch {
        cfg = {};
      }
      const identity = identityFromEnv(env);
      const failureSignal = buildSignal({
        identity,
        cfg: { ...cfg, __uiPath: paths.ui },
        keyId: "",
        envelope: null,
        state: "failed",
        reason: code,
        nowMs: now(),
        heartbeatSec,
      });
      const id = await publishOnce({ env, signal: failureSignal, checkId, fetchImpl });
      writeState(paths.state, {
        published: false,
        state: "failed",
        reason: code,
        detail: String(err.message || "").slice(0, 400),
        checkId: id,
        checkUrl: `https://github.com/${failureSignal.repository}/runs/${id}`,
        lastError: code,
      });
      log.error(`published named failure checkId=${id} title=integration-failed: ${code}`);
      return { ok: false, code, checkId: id };
    } catch (publishErr) {
      writeState(paths.state, {
        published: false,
        state: "failed",
        reason: code,
        detail: String(err.message || "").slice(0, 400),
        lastError: code,
      });
      log.error(`could not publish the failure check run: ${publishErr.message}`);
      return { ok: false, code, checkId: null };
    }
  }
}

async function closePublisher({ env = process.env, argvPaths = {}, fetchImpl } = {}) {
  const statePath = argvPaths.state || defaultPaths(env).state;
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    state = {};
  }
  const log = makeLogger(argvPaths.log || defaultPaths(env).log);
  // stop a live publisher first, so it cannot re-PATCH itself back to live
  const pid = Number(state.pid || 0);
  if (pid > 0 && pid !== process.pid) {
    try {
      process.kill(pid, "SIGTERM");
      log.info(`sent SIGTERM to publisher pid=${pid}`);
    } catch (err) {
      log.info(`publisher pid=${pid} not running (${err.code || err.message})`);
    }
  }
  const checkId = Number(state.checkId || 0);
  if (!checkId) {
    log.warn("no check id recorded - nothing to close");
    return { ok: true, closed: false };
  }
  const identity = identityFromEnv(env);
  let cfg = {};
  try {
    cfg = readRuntimeConfig(argvPaths.config || defaultPaths(env).config);
  } catch {
    cfg = {};
  }
  const signal = buildSignal({
    identity,
    cfg: { ...cfg, __uiPath: argvPaths.ui || path.join(path.dirname(argvPaths.config || defaultPaths(env).config), "ui-v2.html") },
    keyId: state.keyId || "",
    envelope: null,
    state: "closed",
    reason: "workflow-step",
  });
  signal.state = "closed";
  await updateCheck(env, checkId, signal, fetchImpl);
  writeState(statePath, {
    published: false,
    state: "closed",
    reason: "workflow-step",
    checkId,
    closedAt: new Date().toISOString(),
  });
  log.info(`closed checkId=${checkId} (conclusion=neutral)`);
  return { ok: true, closed: true, checkId };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function printKeyInfo(spec) {
  try {
    const p = parsePublicKey(spec);
    return {
      ok: true,
      keyId: p.keyId,
      type: p.type,
      bits: p.type === "rsa" ? p.keyObject.asymmetricKeyDetails.modulusLength : 255,
    };
  } catch (err) {
    return { ok: false, code: err instanceof SignalError ? err.code : FAILURE_CODES.INTERNAL, detail: err.message };
  }
}

async function selfTest() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const spec = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const identity = { repository: "o/r", runId: "1", runAttempt: 1, sha: "a".repeat(40), keyId: "x" };
  const parsed = parsePublicKey(spec);
  const envelope = sealCredential({ publicKeySpec: parsed, plaintext: JSON.stringify({ dashToken: "tok" }), signal: identity });
  const opened = openCredential({ privateKey, envelope, signal: { ...identity, keyId: parsed.keyId } });
  const ok = JSON.parse(opened.plaintext).dashToken === "tok" && verifyEnvelopeBinding(envelope, { ...identity, keyId: parsed.keyId });
  process.stdout.write(JSON.stringify({ ok, keyId: parsed.keyId, alg: envelope.alg }) + "\n");
  return ok ? 0 : 2;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args["self-test"]) {
    process.exitCode = await selfTest();
    return;
  }
  if (args["print-key-info"]) {
    const info = printKeyInfo(process.env.LAB_SIGNAL_PUBKEY);
    process.stdout.write(JSON.stringify(info) + "\n");
    process.exitCode = info.ok ? 0 : 2;
    return;
  }
  if (args.decrypt) {
    const envelopePath = String(args.decrypt);
    const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8"));
    const privPath = args["private-key"] || process.env.LAB_SIGNAL_PRIVATE_KEY_FILE;
    try {
      const out = openCredential({ privateKeyPath: privPath, envelope });
      process.stdout.write(out.plaintext + "\n");
      process.exitCode = 0;
    } catch (err) {
      process.stderr.write(`${err instanceof SignalError ? err.code : FAILURE_CODES.DECRYPT_FAILED}: ${err.message}\n`);
      process.exitCode = 3;
    }
    return;
  }
  const paths = {
    config: args.config,
    state: args.state,
    log: args.log,
    ui: args.ui,
  };
  if (args.close) {
    const res = await closePublisher({ argvPaths: paths });
    process.exitCode = res.ok ? 0 : 3;
    return;
  }
  const heartbeatSec = args["heartbeat-sec"] ? Number(args["heartbeat-sec"]) : DEFAULT_HEARTBEAT_SEC;
  const res = await runPublisher({
    argvPaths: paths,
    heartbeatSec,
    maxTicks: args.once ? 1 : Infinity,
    installSignalHandlers: !args.once,
  });
  if (!res.ok) process.exitCode = 2;
}

module.exports = {
  VERSION,
  SCHEMA,
  CHECK_NAME,
  DEFAULT_HEARTBEAT_SEC,
  DEFAULT_HEARTBEAT_MAX_AGE_SEC,
  FAILURE_CODES,
  SignalError,
  stableStringify,
  canonicalIdentity,
  aadFor,
  parsePublicKey,
  sealCredential,
  openCredential,
  verifyEnvelopeBinding,
  readRuntimeConfig,
  readUiStamp,
  identityFromEnv,
  pickEndpoint,
  buildSignal,
  summarize,
  payloadText,
  createCheck,
  updateCheck,
  writeState,
  defaultPaths,
  buildTickSignal,
  maybeDispatchWakeup,
  runPublisher,
  closePublisher,
  printKeyInfo,
  parseArgs,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`mc-signal-internal: ${err && err.message}\n`);
    process.exitCode = 3;
  });
}
