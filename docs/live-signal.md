# MC-SIGNAL — the application's live-run signal (F200)

**Scope: application side.** The lab consumes this contract; this repository
publishes it. Nothing here creates, stores or transports a lab private key.

The goal: when the real `.github/workflows/main.yml` runs with `mode=rdp`, the
lab must be able to discover **that run**, and open **its** authenticated Mission
Control UI on the Windows client VM — using the run's own endpoint, its own
dashboard credential, its own application SHA and its own UI build.

A lab-created server is not equivalent and never satisfies this contract.

---

## 1. Transport: a check run, not the logs

```
name : mission-control-live-signal
head : the run's GITHUB_SHA
state: in_progress while the session lives, completed afterwards
```

Live workflow logs were **measured** to be unavailable in the tested paths while
check-run output was readable during the live session. The publisher therefore
writes a check run and re-PATCHes it every `heartbeatSec` (default 60 s). Live-log
scraping is **not** a fallback in this repository (`claims.liveLogsUsed = false`).

Publisher: `scripts/live-signal-publisher.js` (Node ≥ 18, no dependencies).

| where | what |
|---|---|
| `main.yml` step *Publish live Mission Control signal (MC-SIGNAL)* | launches it detached after the backend is up and **before** the keep-alive phase |
| `main.yml` keep-alive tick | restarts it if its `state.json` is stale (> 180 s) or its pid is dead |
| `main.yml` step *Close live Mission Control signal (MC-SIGNAL)* | `if: always()` → closes the check on success, failure **and cancellation** |
| the publisher itself | closes on SIGTERM/SIGINT, on run termination (polls `GET /actions/runs/{id}`) and on its own 6 h expiry |

## 2. Payload

`output.text` is a fenced `json` block; `output.summary` is the human view.
`schema` is `mc-signal/v1`.

```jsonc
{
  "schema": "mc-signal/v1",
  "state": "live",                 // live | closed | failed
  "reason": "",                    // e.g. "run-cancelled", "expired", "mc-signal-pubkey-missing"
  "repository": "dictationb1/supreme-lamp",
  "runId": "1234567890",
  "runAttempt": 2,
  "sha": "<40 hex: the APPLICATION commit this run executes>",
  "ref": "main",
  "workflow": "Windows RDP - Tailscale Mission Control (6h ephemeral)",
  "job": "rdp",
  "runUrl": "https://github.com/dictationb1/supreme-lamp/actions/runs/1234567890",
  "ui": { "sha": "<stamp read back from the SERVED ui-v2.html>", "file": "ui-v2.html",
          "bytes": 123456, "stamped": true, "matchesRunSha": true },
  "endpoint": {
    "primary": "https://runner-abc.tail1234.ts.net",   // serveUrl, else http://<cgnat>:7331, else funnel
    "transport": "tailscale-serve",                    // tailscale-serve | tailnet-ip | funnel
    "tailnetIp": "100.101.102.103",
    "serve": "https://runner-abc.tail1234.ts.net",
    "funnel": "",
    "port": 7331,
    "authPathTemplate": "/?key={credential}"
  },
  "startedAt": "…Z", "publishedAt": "…Z", "expiresAt": "…Z",
  "heartbeatSec": 60, "heartbeatMaxAgeSec": 180,
  "keyId": "x25519:<16 hex fingerprint>",
  "credential": {
    "kind": "dash-token",
    "queryParam": "key",
    "envelope": { … },              // null once state != live
    "issuedAt": "…Z",
    "credentialExpiresAt": "…Z"
  },
  "claims": { "authenticatedUi": true, "credentialEncrypted": true,
              "transport": "check-run-output", "liveLogsUsed": false },
  "publisher": { "version": "F200/1.0.0", "host": "…", "pid": 1234, "node": "v20.x" }
}
```

**Never present in a published payload:** the dashboard token in plaintext, the
RDP password, the VNC password, any Tailscale key, the MC-SIGNAL private key, the
`.rdp` signing private key. Projected by tests (`tests/f200-live-signal.test.js`
F200-9) over every request body.

## 3. Credential envelope (the only secret transport)

The per-run `dashToken` is sealed to the lab's **MC-SIGNAL public key** and bound
to the run identity (AAD), so a credential lifted from one run cannot be replayed
against another.

| `envelope.alg` | when |
|---|---|
| `x25519-hkdf-sha256+aes-256-gcm` | `LAB_SIGNAL_PUBKEY` is an X25519 key (raw 32-byte, SPKI base64/DER, or PEM) |
| `rsa-oaep-sha256+aes-256-gcm` | `LAB_SIGNAL_PUBKEY` is an RSA public key (PEM or base64 SPKI/DER) |

```
x25519:  ephemeral X25519 -> shared = ECDH(eph, lab_pub)
         key   = HKDF-SHA256(shared, salt = eph_pub || lab_pub,
                             info = "mc-signal/v1 x25519-hkdf-sha256+aes-256-gcm", 32)
rsa:     wrappedKey = RSA-OAEP-SHA256(content key);  content key = AES-256-GCM
both:    cipher = AES-256-GCM(key, nonce(12 random));  AAD = envelope.aadB64
```

`envelope.aadB64` is the canonical (sorted-key, no-whitespace) JSON of
`{schema, repository, runId, runAttempt, sha, keyId}`. It is published verbatim so
a consumer does not have to re-derive it — but a consumer SHOULD verify it matches
the published identity (`verifyEnvelopeBinding`).

### Decrypting (lab side)

```bash
# writes the plaintext JSON to stdout: {"dashToken":"…","dashTokenQueryParam":"key",…}
node scripts/live-signal-publisher.js --decrypt envelope.json --private-key /path/to/mc-signal-private.pem
```

Then compose the UI URL — **never log it**:

```
<endpoint.primary>/ + ?key=<dashToken>
```

`--private-key` also accepts `LAB_SIGNAL_PRIVATE_KEY_FILE`. The same module holds
the encryptor and the decryptor, so they cannot drift.

### Key handling

- App: repository **variable** `LAB_SIGNAL_PUBKEY` (public only).
- Lab: repository **secret** `LAB_SIGNAL_PRIVATE_KEY` (never here).
- `keyId` is a SHA-256 **fingerprint** (16 hex), not key material. It changes when
  the key changes, so a rotated lab logs `keyId` mismatch instead of guessing.
- An **Ed25519** public key is refused by name (`mc-signal-pubkey-unsupported-alg`):
  a signing key cannot encrypt. Use the X25519/RSA half of a pair meant for
  encryption.
- Verify a configured value without publishing anything:
  `node scripts/live-signal-publisher.js --print-key-info` →
  `{"ok":true,"keyId":"x25519:…","type":"x25519","bits":255}`.

**Not interchangeable** with: the per-run dashboard credential, the RDP password,
the `.rdp` signing certificate.

## 4. Freshness rules for consumers

A check run is an append-only record; "old but green" must never be read as
"there is a live session now".

Accept a signal only when **all** hold:

1. `state === "live"`;
2. `now - publishedAt < heartbeatMaxAgeSec` (≥ 180 s);
3. `now < expiresAt`;
4. `credential.envelope` is present and decrypts;
5. `keyId` matches the key you are decrypting with.

The publisher actively retires stale signals:

- normal end → `state: "closed"`, `conclusion: "neutral"` (never `success`),
  `credential.envelope: null`, `credentialExpiresAt` = the close time;
- cancellation → same, from the `if: always()` close step **and** the publisher's
  own signal handler;
- workflow run terminated → the publisher notices `GET /actions/runs/{id}` is no
  longer in progress and closes itself;
- 6 h expiry → closes itself.

## 5. Named failures (visible, never silent)

`output.title` becomes `integration-failed: <code>` and `conclusion` is `failure`.

| code | meaning |
|---|---|
| `mc-signal-pubkey-missing` | `LAB_SIGNAL_PUBKEY` is unset/empty |
| `mc-signal-pubkey-unparseable` | not 32-byte raw / base64 DER / PEM |
| `mc-signal-pubkey-unsupported-alg` | e.g. an Ed25519 key |
| `mc-signal-config-unreadable` | `C:\ghrdp\config.json` missing/unreadable |
| `mc-signal-credential-missing` | the dashboard has not written `dashToken` yet |
| `mc-signal-endpoint-missing` | no `serveUrl` and no CGNAT `rdpIp` |
| `mc-signal-token-unauthorized` | the token cannot write check runs (`checks: write`) |
| `mc-signal-ui-stamp-missing` | warning: the served bundle carries no build stamp |
| `mc-signal-state-unwritable` | `C:\ghrdp\live-signal\state.json` could not be written |

The workflow step is `continue-on-error: true` so a broken signal never destroys
an otherwise healthy RDP session — but it shows as a failed step with the named
code, and it never reports success.

Publisher artefacts on the runner: `C:\ghrdp\live-signal\state.json` (machine
readable: `published`, `checkId`, `checkUrl`, `keyId`, `uiSha`, `wakeup`,
`reason`, `detail`) and `C:\ghrdp\live-signal\publisher.log`.

## 6. Wake-up: honest status

- GitHub scheduling is the recovery mechanism and stays: the lab polls roughly
  every ten minutes, and GitHub may delay it further. **Polling is not "instant".**
- An application `GITHUB_TOKEN` **cannot** write to another repository, and an
  Actions-created `check_run` does not reliably trigger another Actions workflow.
- An **optional** event wake-up is implemented: when *both* repository variable
  `LAB_SIGNAL_LAB_REPO` (e.g. `dictationb1/supreme-lamp-lab`) and secret
  `LAB_SIGNAL_DISPATCH_TOKEN` (a credential that may `repository_dispatch` on that
  lab repo) exist, the publisher POSTs `repository_dispatch` / `mc-signal-ready`
  with `{repository, runId, runAttempt, sha, checkName, checkId}`.
- Without both, it logs `wake-up: skipped (no-cross-repo-token)` and records
  `wakeup: {attempted:false}`. **No cross-repo credential exists in this
  repository, and none was invented.** Until one is configured, the schedule is
  the mechanism.

Minimum operator action for instant wake-up (only if wanted):
create the lab-repo credential with `repository_dispatch` rights (classic PAT:
`repo`; fine-grained: *Contents: read and write* on the lab repo), store it as
`LAB_SIGNAL_DISPATCH_TOKEN` here, and set `LAB_SIGNAL_LAB_REPO`.

## 7. Recommended lab consumer algorithm

```
poll: list check runs for repo, name = mission-control-live-signal
      pick the newest by started_at
      if state != live or heartbeat too old or expired -> keep polling
      decode json from output.text
      assert sha == the run's head_sha
      assert ui.sha startswith run sha (or uiMatchesRunSha)
      envelope = credential.envelope ; assert keyId matches our private key
      token = decrypt(envelope) ; assert verifyEnvelopeBinding(envelope, payload)
      open <endpoint.primary>/?key=<token> in the client VM's browser  (never log the URL)
      continue heartbeating: abandon the session the moment state != live
```

## 8. Handoff to the lab session

Files it needs from this repository:

- `scripts/live-signal-publisher.js` — start here; `--decrypt` is the reference
  decryptor, `--self-test` proves the crypto without network.
- `tests/f200-live-signal.test.js` — the executable contract (20 concern cells).
- this document.

Files it must adjust if its existing consumer differs:

- envelope algorithm: this repo emits `x25519-hkdf-sha256+aes-256-gcm` (primary)
  and `rsa-oaep-sha256+aes-256-gcm`; if the lab's `patches/app-live-signal-publisher.js`
  emitted something else, align on the `alg` field rather than the filename —
  the payload is self-describing.
- field names: everything here is stable and versioned by `schema`. If the lab's
  reader expects different names, adapt the reader (do not rename fields here
  without bumping `schema`).

## 9. Production native-RDP signing (F200 §7)

`payloads/ghrdp-rdp-launcher.cs` now signs the `.rdp` it generates, but only when
the **client** has a signing identity configured:

```
%ProgramData%\ghrdp\rdp-signing.json      (preferred)
%LOCALAPPDATA%\ghrdp\rdp-signing.json     (fallback)
{"thumbprint":"<40|64 hex>","required":false,"rdpsignPath":"C:\\Windows\\System32\\rdpsign.exe"}
```

The launcher asserts the certificate exists in the **RDP user's** `CurrentUser\My`
with a private key, runs `rdpsign /sha256 <thumb> <file>`, and requires both exit 0
**and** a `signature:s:` directive before starting `mstsc`. Steps:
`rdp-signed` / `rdp-sign-failed`.

It never creates, imports or trusts a certificate, never stores a key, and never
automates a dialog. `required: true` means "sign or do not launch" (visible
failure). With no metadata the previous unsigned behaviour is unchanged — a signed
`.rdp` is an opt-in, not a new prompt path.

See `docs/MIGRATION.md` §1.11 for the full contract and the one-time bootstrapping
steps the lab performs on the client VM.
