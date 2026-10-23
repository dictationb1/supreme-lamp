# F200 / MC-SIGNAL — ප්‍රතිසාධන හා භාරදීමේ ලේඛනය (Recovery & Handoff)

> මෙම ලේඛනය **application repository** (`dictationb1/supreme-lamp`) තුළ තැන්පත් කර ඇත.
> Lab repository (`dictationb1/supreme-lamp-lab`) මෙම session එකට කියවිය නොහැකි විය (HTTP 403/404),
> එබැවින් lab-side contract එක `docs/live-signal.md` තුළ ස්වයං-විස්තරාත්මකව ලියා ඇත.

| අයිතමය | අගය |
|---|---|
| PR | **#29** — https://github.com/dictationb1/supreme-lamp/pull/29 |
| Branch | `arena/de031d85-supreme-lamp` |
| පරීක්ෂා කළ SHA (tested) | `10cd512a4639369e1a6dacc8b1f07d4adfffe9e0` (මෙම ලේඛනය එකතු කිරීමට පෙර) |
| PR checks | `gates` ✅ · `windows-native` ✅ (csc compile) · `proof` ✅ · `e2e-ui` ✅ · `Static Contracts` ✅ · `build-ui-prebuilt` ✅ |
| Merge commit | PR #29 හි සටහන් වේ (මෙම ලේඛනය merge වන revision එකේම ඇත) |

---

## 1. කාර්යය (Goal)

`main.yml` `mode=rdp` ලෙස ධාවනය වන විට, **එම සැබෑ run එකම** lab එකට සොයාගෙන, එහි **සැබෑ authenticated
Mission Control UI** එක client VM එකේ විවෘත කළ හැකි විය යුතුය. Lab එකේ නිර්මාණය කළ වෙනම server එකක් මේ සඳහා
සමාන නොවේ. ඒ සඳහා application එක විසින්:

1. run එකේ අනන්‍යතාව (repository, runId, runAttempt, application SHA, ref, UI build SHA),
2. endpoint එක (serve/funnel/tailnet IP),
3. **encrypted** dashboard credential එක (dashToken),

check run එකක් ලෙස ප්‍රකාශයට පත් කරයි: **`mission-control-live-signal`**.

Live workflow logs පරීක්ෂිත මාර්ගවල කියවිය නොහැකි බව මනිනු ලැබ ඇති බැවින්, transport එක
**check-run output** එකයි. Live-log scraping නැවත හඳුන්වා දී නැත (`claims.liveLogsUsed=false`).

## 2. පෙර තිබූ තත්ත්වය සහ මෙම වෙනස්කම්

**පෙර තිබූ (සුරකින ලද) දේ:**
- Mission Control server, dashboard expose, keep-alive, native RDP launcher (`ghrdp-rdp-launcher.cs`), handler,
  `/api/logon-status` (F95: type 2/10/11), F110b Ed25519 patch signing scaffold, launch gates.
- `main.yml` හි `permissions` block (contents/actions/pages/id-token) — **නොවෙනස්**.

**මෙම වෙනස්කම් (අලුතින් / නිවැරදි කළ):**
| ගොනුව | වෙනස |
|---|---|
| `scripts/live-signal-publisher.js` | **අලුත්**. dependency නැති Node publisher + reference decryptor |
| `.github/workflows/main.yml` | `checks: write`; publish step (readiness → keep-alive අතර); keep-alive supervision; `if: always()` close step; optional wake-up |
| `payloads/ghrdp-server.ps1` | `/api/logon-status` හි **$Matches clobber** නිවැරදි කිරීම; `inboundRdp` / `proofClass` |
| `payloads/ghrdp-rdp-launcher.cs` | **2.9.0.0** — `.rdp` file එක rdpsign.exe වලින් sign කර, `signature:s:` තහවුරු කර mstsc ආරම්භ කරයි |
| `docs/MIGRATION.md` §1.11 | "NOT IMPLEMENTED" → **"IMPLEMENTED (OPT-IN)"** |
| `.github/workflows/launch-gates.yml`, `tests/f19-dns-launcher.test.js`, `tests/f95-root-causes.test.js` | superseded pins **in place** rewrite (delete නොකර) |
| `docs/live-signal.md` | සම්පූර්ණ contract + lab handoff |
| `tests/f200-live-signal.test.js` (23), `tests/f200-logon-observer.test.js` (7) | නව regression |

## 3. Key තත්ත්වය (අගය නොපෙන්වා)

- Application repo **variable**: `LAB_SIGNAL_PUBKEY` — මෙම session එකට **කියවිය නොහැක**
  (`GET /repos/.../actions/variables` → `403 Resource not accessible by integration`).
  එය නැති බව **ඔප්පු නොවේ**; runtime එකේදී publisher එක එය parse කර `keyId` එක report කරයි.
- Lab repo **secret**: `LAB_SIGNAL_PRIVATE_KEY` — application repo එකේ **කිසිසේත්** නොපවතී.
- Key rotate කළේ නැත; අලුතින් generate කළේ නොවේ.
- `node scripts/live-signal-publisher.js --print-key-info` → `{"ok":true,"keyId":"x25519:…"}`.
- සහාය දක්වන ආකෘති: raw 32-byte X25519 (base64/hex), SPKI base64/DER, PEM (සැබෑ හෝ `\n` literal),
  හෝ `x25519:` / `rsa:` prefix. **Ed25519 key එකක් නම්** `mc-signal-pubkey-unsupported-alg` ලෙස පැහැදිලිව
  fail වේ (signing key එකකින් encrypt කළ නොහැක).
- MC-SIGNAL key යනු **dash token එක නොවේ, RDP password එක නොවේ, .rdp signing cert එකද නොවේ.**

## 4. ධාවනය (operator කළ යුතු දේ)

1. Actions → **Windows RDP - Tailscale Mission Control (6h ephemeral)** → *Run workflow*
   → `mode = rdp`.
2. Run එක තුළ `Publish live Mission Control signal (MC-SIGNAL)` step එක බලන්න:
   - සාර්ථක නම්: `MC-SIGNAL published (live)` + `check run:` link + `keyId` + `endpoint` + `uiSha`.
   - අසාර්ථක නම්: `integration-failed: mc-signal-<code>` (step එක රතු, session එක දිගටම ක්‍රියා කරයි).
3. Check run එක: `https://github.com/dictationb1/supreme-lamp/runs/<checkId>` (step summary එකේ ඇත).
4. Session එක අවසන් වූ පසු (හෝ cancel කළ පසු) එම check එක `state: closed`, conclusion `neutral` විය යුතුය.

## 5. Lab එකේ ඊළඟ පියවර (නිශ්චිත)

1. **Consumer**: `docs/live-signal.md` §7 algorithm එක අනුගමනය කරන්න — check runs list → newest →
   `state=live` + heartbeat < 180s + `expiresAt` අනාගතයේ → `output.text` හි fenced JSON → decrypt.
2. **Decrypt**: `node scripts/live-signal-publisher.js --decrypt envelope.json --private-key <lab key>`
   (හෝ එම module එකේ `openCredential()`).
3. **අනන්‍යතාව තහවුරු කිරීම**: `sha` == run head_sha; `ui.sha` == served bundle stamp;
   `verifyEnvelopeBinding(envelope, payload)`.
4. **UI විවෘත කිරීම**: `<endpoint.primary>/?key=<token>` — URL එක log නොකරන්න.
5. **`.rdp` signing bootstrap (client VM, එක් වරක් පමණි)**: පවතින controlled signing cert එකම භාවිතා කරන්න
   (අලුතින් සාදන්න එපා), RDP user ගේ `CurrentUser\My` තුළ private key එක සහිතව තබන්න, එයම
   `TrustedPeople` + `TrustedPublishers` වලට trust කරන්න, පසුව ලියන්න:

   ```json
   { "thumbprint": "<cert thumbprint>", "required": false,
     "rdpsignPath": "C:\\Windows\\System32\\rdpsign.exe" }
   ```

   ගොනුව: `%ProgramData%\ghrdp\rdp-signing.json` (හෝ `%LOCALAPPDATA%\ghrdp\rdp-signing.json`).
   Launcher එක cert එක **සාදන්නේ/import කරන්නේ/trust කරන්නේ නැත**.
6. **Wake-up (අවශ්‍ය නම් පමණි)**: `LAB_SIGNAL_LAB_REPO` variable + `LAB_SIGNAL_DISPATCH_TOKEN` secret
   (lab repo එකට `repository_dispatch` අයිතිය ඇති credential එකක්). නැති විට publisher
   `wake-up: skipped (no-cross-repo-token)` ලෙස **සත්‍යවශයෙන්** වාර්තා කරයි;
   lab schedule එක (~10 min) ප්‍රායෝගික මාර්ගය ලෙසම පවතී. `GITHUB_TOKEN` එකකට වෙනත් repo එකකට
   ලිවිය නොහැක; Actions check_run එකක් තවත් workflow එකක් විශ්වාසදායක ලෙස trigger නොකරයි.

## 6. Fail-visible failure codes

| code | අර්ථය | පළමු පියවර |
|---|---|---|
| `mc-signal-pubkey-missing` | `LAB_SIGNAL_PUBKEY` හිස් | variable එක set කරන්න (public key පමණි) |
| `mc-signal-pubkey-unparseable` | ආකෘතිය වැරදි | `--print-key-info` ධාවනය කරන්න |
| `mc-signal-pubkey-unsupported-alg` | Ed25519 වැනි signing key | X25519/RSA public key එකක් දෙන්න |
| `mc-signal-credential-missing` | dashboard එක `dashToken` ලියා නැත | dashboard readiness එක බලන්න |
| `mc-signal-endpoint-missing` | `serveUrl` සහ CGNAT `rdpIp` දෙකම නැත | Tailscale/expose step එක බලන්න |
| `mc-signal-token-unauthorized` | token එකට `checks: write` නැත | workflow permissions block එක බලන්න |
| `mc-signal-config-unreadable` | `C:\ghrdp\config.json` නැත | ඉහත පළමු fail වූ step එක බලන්න |

State/ලොග්: `C:\ghrdp\live-signal\state.json`, `C:\ghrdp\live-signal\publisher.log`.

## 7. මෙම session එකේ මිනුම් (evidence)

- `node --test tests/*.test.js` → **933 tests · 906 pass · 1 fail · 26 skipped**.
  එකම fail එක `WF-VALIDATOR-3`; එයට අවශ්‍ය pinned `actionlint` binary එක මෙම sandbox එකේ
  download කළ නොහැක (`release-assets.githubusercontent.com` block). Baseline එකේද එම test එකම fail වේ.
- `python3 tests/run-launch-gates.py` → **45 PASS / 5 FAIL**, baseline එකට හරියටම සමාන
  (F56-c ×3, F56-d, F57 — `node_modules`/built assets නැති නිසා). **F19 gate: PASS**.
- `python3 tests/ps-balance-audit.py` → 0 failed; `config-writer-audit.py` → clean.
- GitHub: `gates` ✅, `windows-native` ✅ (step 6 = *F19 launcher DNS-guard decision matrix (csc compile…)* success,
  step 13 = *F28 launcher fallback-gap decision matrix* success), `proof` ✅, `e2e-ui` ✅,
  `Static Contracts & Unit Tests` ✅, `build-ui-prebuilt` ✅.

## 8. මෙම session එකේ අවහිර වූ ක්‍රියා (denied operations)

| ක්‍රියාව | ප්‍රතිඵලය | අවශ්‍ය අවම operator පියවර |
|---|---|---|
| `POST /repos/dictationb1/supreme-lamp/actions/workflows/main.yml/dispatches` (`mode=rdp`) | **403 Resource not accessible by integration** | Actions UI එකෙන් `mode=rdp` run එකක් dispatch කරන්න (හෝ Arena එකේ GitHub සම්බන්ධතාවයට Actions: write දෙන්න) |
| `GET /repos/.../actions/variables` | **403** | variable එක set කර ඇත්දැයි UI එකෙන් තහවුරු කරන්න (අගය මෙහි නොලියන්න) |
| `GET /repos/dictationb1/supreme-lamp-lab` (කියවීම) | **403/404** | lab repo එකට කියවීමේ අයිතිය දෙන්න, නැත්නම් lab session එකේදී `docs/live-signal.md` contract එකට ගැලපීම තහවුරු කරන්න |

## 9. තහවුරු කර නොමැති දේ (සත්‍යවශයෙන්)

- **සම්පූර්ණ automatic pipeline එක VERIFIED නොවේ.** ඒ සඳහා සැබෑ `mode=rdp` run එකක් lab එක විසින්
  පරිභෝජනය කළ යුතුය. මෙම PR එක **application පැත්ත** පමණි.
- Live publication එකක් (සැබෑ check run එකක්) මෙම session එකේදී ප්‍රකාශයට පත් නොවීය — dispatch 403.
- Lab consumer එකේ field නම්/`alg` වෙනස් නම්, reader එක adapt කළ යුතුය (හෝ field නම් වෙනස් කර `schema`
  version එක bump කළ යුතුය).

## 10. Rollback

`git revert <merge-sha>` පමණක් ප්‍රමාණවත්: නව publisher script එක unused වේ, publish/close steps ඉවත් වේ,
`checks: write` ඉවත් වේ, logon-status හා launcher F95/F30 තත්ත්වයටම පවතී (F200 pins superseded in place
නිසා revert එකේදී gates නැවත පැරණි invariant එකට පැමිණේ).
