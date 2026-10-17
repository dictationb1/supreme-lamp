# Jules Verification Lab - මෙහෙයුම් මාර්ගෝපදේශය (LAB RUNBOOK)

මෙම ලේඛනය future Jules tasks සහ operators සඳහා Verification Lab, Helper tools, සහ RDP Repair Bridge භාවිතා කරන ආකාරය විස්තර කරයි.

---

## 1. Local / Automated Verification Commands

| Command | Purpose |
|---|---|
| `node --test tests/*.test.js` | Node unit tests සහ PowerShell syntax parse validation |
| `pnpm test:smoke` | Vitest UI smoke tests |
| `GITHUB_WORKSPACE=$PWD python3 tests/run-launch-gates.py` | Python launch gate assertions |
| `node scripts/ensure-rdp-deps.mjs --mode readiness` | Dependency & configuration readiness inspection |
| `node scripts/jules-lab-helper.mjs verify-access` | Authorized GitHub API access verification |
| `node scripts/jules-lab-helper.mjs current-pr` | Current PR SHA, Branch සහ Repo identity |
| `node scripts/jules-lab-helper.mjs dispatch-lab [profile] [sha] [injected]` | Reusable workflow dispatch කිරීම |
| `node scripts/jules-lab-helper.mjs parse-evidence [file] [sha]` | Evidence verification සහ causal failure validation |
| `node scripts/rdp-evidence.mjs` | Machine-readable sanitized evidence (`rdp-lab-evidence.json`) ජනනය කිරීම |

---

## 2. Reusable Lab Workflow (`.github/workflows/rdp-lab.yml`)

`rdp-lab.yml` workflow එක මගින් පරික්ෂණ ප්‍රධාන Profiles 3කට ධාවනය කළ හැක:

1. **`static`**:
   - Static syntax check, PowerShell AST validation, Node unit tests, Vitest UI smoke tests, launch gates.
2. **`windows-integration`**:
   - UI bundle build (`pnpm build`), NLA & balance audit check, local Mission Control dashboard server (`payloads/ghrdp-server.ps1`) ආරම්භ කිරීම, සහ Playwright E2E browser acceptance tests.
3. **`live-integration`**:
   - Real Tailscale enrollment (`tailscale up`), MagicDNS/FQDN resolution check, HTTPS certificate issuance check (`tailscale cert`), RDP-Tcp certificate binding, Dashboard/Web Desktop backend, සහ real browser acceptance.

---

## 3. Failure Classifications & Operator Actions

| Causal Failure Code | Description | Operator Action / Remediation |
|---|---|---|
| `ts-authkey-missing` | `TS_AUTHKEY` secret නොමැත. | GitHub Repo -> Settings -> Secrets and variables -> Actions වෙත ගොස් `TS_AUTHKEY` එකතු කරන්න. |
| `ts-authkey-invalid` | Auth key එක අවලංගු හෝ කල්ඉකුත් වී ඇත. | [Tailscale Admin Keys](https://login.tailscale.com/admin/settings/keys) වෙතින් නව reusable key එකක් සාදා අලුත් කරන්න. |
| `ts-magicdns-off` | MagicDNS අක්‍රිය කර ඇත. | [Tailscale DNS Settings](https://login.tailscale.com/admin/dns) වෙත ගොස් MagicDNS Toggle ON කරන්න. |
| `cert-capability-unavailable` | Tailnet එක තුළ HTTPS Certificates enabled කර නැත. | [Tailscale DNS Settings](https://login.tailscale.com/admin/dns) වෙත ගොස් "Enable HTTPS Certificates" සක්‍රීය කරන්න. |
| `TIMEOUT` | Injected process/startup hang simulation. | Lab execution failure detection. |
| `CERT_INVALID` | Injected certificate failure simulation. | Lab certificate error handling test. |

---

## 4. Jules Repair Bridge (`scripts/jules-repair-bridge.mjs`)

Workflow එකක් අසාර්ථක වූ විට `jules-repair-bridge.mjs` මගින්:
- `sourceContext` (`sources/github/dictationb1/supreme-lamp`) සහ `automationMode: "AUTO_CREATE_PR"` සහිතව Jules API session එකක් dispatch කරයි.
- Deduplication key (`repo/runId/runAttempt`) මගින් duplicate dispatches වළක්වයි.
- Failure evidence sanitized කර Jules API වෙත ලබා දෙයි.
