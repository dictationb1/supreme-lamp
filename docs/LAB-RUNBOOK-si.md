# Jules Verification Lab - මෙහෙයුම් මාර්ගෝපදේශය (LAB RUNBOOK)

මෙම ලේඛනය future Jules tasks සහ operators සඳහා Verification Lab සහ Helper tools භාවිතා කරන ආකාරය විස්තර කරයි.

---

## 1. Local / Automated Verification Commands

| Command | Purpose |
|---|---|
| `node --test tests/*.test.js` | Node unit tests සහ PowerShell syntax check |
| `pnpm test:smoke` | Vitest UI smoke tests |
| `GITHUB_WORKSPACE=$PWD python3 tests/run-launch-gates.py` | Python launch gate assertions |
| `node scripts/ensure-rdp-deps.mjs --mode readiness` | Dependency & configuration readiness inspection |
| `node scripts/jules-lab-helper.mjs current-pr` | Current PR සහ Commit SHA හඳුනාගැනීම |
| `node scripts/rdp-evidence.mjs` | Machine-readable sanitized evidence ජනනය කිරීම |

---

## 2. Reusable Workflow (`.github/workflows/rdp-lab.yml`)

`rdp-lab.yml` workflow එක මගින් පරික්ෂණ ප්‍රධාන Profiles 3කට ධාවනය කළ හැක:
1. `static`: Static syntax, PowerShell parse, unit tests, launch gates.
2. `windows-integration`: Windows startup scripts, registry/NLA, local dashboard server සහ Playwright tests.
3. `live-integration`: Real Tailscale auth & cert issuance (Credentials නොමැති විට `BLOCKED` ලෙස වාර්තා කරයි).

---

## 3. Negative Controls & Injected Failures

Lab verification ක්‍රියාවලිය දෝෂ නිවැරදිව හඳුනාගන්නා බව පරීක්ෂා කිරීමට standard failure injection සහය දක්වයි:
* `injected_failure: TS_AUTHKEY_INVALID`
* `injected_failure: TIMEOUT`
* `injected_failure: CERT_INVALID`

මෙමගින් live tailnet එකට හෝ credentials වලට හානි නොකර failure detection තහවුරු කෙරේ.
