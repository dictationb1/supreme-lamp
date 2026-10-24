# අවසාන වාර්තාව — සත්‍යාපිත Lab අළුත්වැඩියා ප්‍රවර්ධනය (සිංහල)

**දිනය:** 2026-10-24 18:55 UTC  
**ශාඛාව:** `arena/292d4e34-supreme-lamp` → `main` වෙත ඒකාබද්ධ විය  
**PR:** https://github.com/dictationb1/supreme-lamp/pull/73 — **MERGED** 2026-10-24T18:54:48Z  
**ඒකාබද්ධ commit:** `d3f13d4 Merge pull request #73 …` (පෙර `112ff86` → `f56b4ff` → `a614b1a` → `0235659` → `60f4a69` → `62afad4` → `d3f13d4`)  
**Lab පදනම (ඓතිහාසික):** `832a82eb` · **වත්මන් main පදනම:** `112ff8653bcca07d90c819badeb9b73b727e1f62` ( වෙනස `docs/status.json` පමණි, සත්‍යාපිත)  
**Lab හිස (pinned):** `d7c90dc81867553c65f862308d799caaaf3cbec7` · **Archive SHA256:** `c0de6455…ca2d2393`  
**Lab archive:** https://codeload.github.com/dictationb1/supreme-lamp-lab/zip/d7c90dc81867553c65f862308d799caaaf3cbec7

---

## 1. යෙදූ පැච් හතර — අනුපිළිවෙල සහ SHA256

| # | ගොනුව | SHA256 (SHA256SUMS අනුව) | මාතෘකාව | තත්ත්වය |
|---|--------|---------------------------|-----------|-----------|
| 1 | `0001-F201-probe-honesty.patch` | `692246ffe364…0657398` | frontend probe honesty (401/403/transport/schema වෙන් කිරීම) | **absent → යෙදුවා** `git -c core.autocrlf=false -c core.eol=lf apply --whitespace=nowarn` — `sha256sum` ගැලපේ |
| 2 | `0002-R1-server-startup-readiness.patch` | `eb9d7efeb001…70b33` | server startup readiness (`server-ready.txt` accept loop ඇතුළත, 30s tick `if/elseif/elseif` එකට) | **absent → යෙදුවා** |
| 3 | `0003-R2-websocket-worker-runspace.patch` | `7eba144c377…fcf939` | bounded WebSocket worker runspace (R2) — `RunspacePool` + Poll EOF | **absent → යෙදුවා** |
| 4 | `0004-R2b-pool-fallback-bounded-truth.patch` | `05f1f416f40b…69a1b1` | pool-unavailable නම් `ws=false` + `Code 503` + `wsReason`, `GHRDP_WS_POOL_RETRY_SEC` 5..300, fallback inline ඉවත් | **absent → යෙදුවා** |

සතරම `series.txt` අනුපිළිවෙලට යෙදුවා, කිසිදු adaptation අවශ්‍ය නොවීය. සුරැකි ගිවිසුම්: MC-SIGNAL publication, credential binding, current-token/revocation, LogonType observer, RDP file signing, launcher install, UI build identity & staging, auth/NLA/TLS/cert validation — කිසිවක් කඩ වී නැත. Lab ශාඛාව සම්පූර්ණයෙන් transplant කළේ නැත; workflow ගොනු පිටපත් කළේ නැත.

## 2. පැච් සමග පැමිණි පරීක්ෂණ

| පැච් | පරීක්ෂණ ගොනුව | ගණන |
|------|----------------|-------|
| 0001 | `src/tests/smoke/f201-probe-honesty.test.tsx` | 8 |
| 0002 | `src/tests/smoke/r1-server-readiness.test.ts` | 3 |
| 0003+0004 | `src/tests/smoke/r2-websocket-worker.test.ts` | 13 |
| මෙම ප්‍රවර්ධනයේ අතිරේක | `src/tests/smoke/ghrdp-handler-gesture.test.ts` | 4 (iframe + `window.open` placeholder + prompt පාඨය) |
| **ඉලක්කගත එකතුව** | | **28** |

`npx vitest run src/tests/smoke/f201… r1… r2… ghrdp-handler…` → **28/28 PASS**. `npx tsc --noEmit` PASS. සම්පූර්ණ `npx vitest run --reporter=dot` → **109 ගොනු / 1395 පරීක්ෂණ PASS** (171s). `VITE_BUILD_SHA=$(git rev-parse HEAD) npm run build` → `ui/dist/index.html` 1,228 kB, single-file OK.

**F201 නිසා i18n:** `src/i18n/en.json` සහ `si.json` හි `overview/diagnostic.probe*` 6ක් + `workspace.dataUnavailable` 1ක් = **+7 යතුරු** එක් විය. `EXPECTED_FLAT_KEYS` `1245 → 1252` ලෙස යාවත්කාලීන කරන ලදී (`tests/f-i18n-parity.test.js`, `merge-hygiene`, `f109`, `f110`, `f110b`).

## 3. Lab වෙතින් රැගෙන ආ පිළිගත් සාක්ෂි

- **R2 පිළිගැනීම:** runs `40091165292`, `40092088400`, `40092300001` — **33 PASS / 0 FAIL / 5 BLOCKED** (`backendKind=actual_application`, `browserWebSocketStubbed=false`, headed).
- **R2b fault-injection (සැබෑ Windows `rdp-lab-client` WIN-NFU1JG4VESE\User, session 1, headed Chromium, `powershell.exe`):** run `40112159586` SUCCESS at lab `01947f029…` — `r2b-r2-fault-report.json` **5/5 PASS**
  - A: පැරණි inline fallback ` /health` 4015 ms, `/ws` 101 — starvation
  - B: අලුත් `ws=false` + `wsReason='websocket worker pool unavailable'` — 6×503 truthful, `p95 58 ms` (samples 8)
  - C: transient (`GHRDP_WS_POOL_RETRY_SEC=8`) — `503 → 101` සහ `ws=true` යථා තත්ත්වයට
  - Variants sha256: old-persistent `6eaa6b…`, new-persistent `9098e2…`, new-transient `47ff58…`

> Lab README හි “R2b runtime proof is pending” යනු යල් පැන ගිය වාක්‍යයකි; `40112159586` යන්ත්‍ර සාක්ෂිය එය නිවැරදි කරයි.

## 4. නිෂ්පාදන build & staging (දේශීය Linux)

- `main.yml` → `preflight` → `ensure-f59-binaries` + `build-ui` (`ui-dist-${GITHUB_SHA}.zip`, SHA256 තහවුරු) → `verify-dependencies` → `rdp` — `C:\ghrdp\ui-v2.html` යනු merged SHA හි `ui/dist/index.html` (`VITE_BUILD_SHA=${GITHUB_SHA}`), fallback නව SHA එකම on-runner build කරයි (වෙන SHA එකක් නොවේ).
- `payloads/ghrdp-server.ps1` — අලුත්වැඩියා කළ server verbatim stage වේ; `C:\ghrdp\server-ready.txt` accept loop ඇතුළත ලියැවේ, bind එකට පෙර නොවේ.
- PowerShell 5.1 parse: Linux හි `System.Management.Automation.Language.Parser` නොමැත, නමුත් `r2-websocket-worker` පරීක්ෂණ + සම්පූර්ණ suite + Windows `rdp-lab-client` හි සැබෑ `powershell.exe` ධාවනයෙන් තහවුරු වී ඇත. `WS 101` / `503` + `wsReason` සහ `/health` `ws`/`wsReason`/`p95` Lab හි 58 ms ලෙස මැන ඇත.

## 5. ඉතිරි සැබෑ අසාර්ථකත්වය — capability lane

පින් කළ bundle හි අවසන් capability run **40112159644** (PR #30 lab, app `4a91c5c2`, lab `01947f0`):

- static 265/265, Windows 265/265, server SUCCESS (`pid 1852 port 7331 phase=ready`), headed dashboard auth/build PASS
- dashboard click → **HTTP 200 ticket `rid 62a4159…` TTL 60 s** `2026-10-24T16:48:31.114Z`
- **production handler beacon: not observed; mstsc: not observed; `PRODUCTION_HANDLER_NOT_OBSERVED`**

සීමිත පරීක්ෂණය (sanitized):
- `launchProto(ghrdp://rdp?...)` ඇමතුම සිදු විය; `ticket.status=200`
- `fireAutoLogin` `POST /api/rdp-token` අවසන් වන තුරු `await` කළ නිසා transient activation ඉකුත් වී, Chrome external-protocol තහවුරු කිරීම අවශ්‍ය විය
- `native-production-launch.png` හි Chrome dialog “Open ghrdp-rdp-launcher? http://100.111.205.116:7331 wants to open this application. [Open] [Cancel]” තවම විවෘතව
- HKCU `Software\Classes\ghrdp\shell\open\command` → `"powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LOCALAPPDATA%\GhrdpLauncher\launch.ps1" -Url "%1"` — `commandVerified=true`, `launcherExeSha256 943ad6…`, `WIN-NFU1JG4VESE\User` session 1
- Ticket තනි-භාවිත 60 s, කල් ඉකුත් වී නැත; `handler-hello-last.json` නැත; `logonPolls=4`, `qwinsta` session නැත
- **නිගමනය:** password/DNS/cert/NLA/listener දෝෂයක් නොවේ — **browser external-protocol consent dialog “Open” click කිරීම play-wright විසින් auto-accept නොකිරීම** නිසාය. RDP මාර්ගය කැඩී ඇති බවට සාක්ෂියක් නොවේ.

**මෙම ප්‍රවර්ධනයේ යෙදූ යෙදුම්-පැත්තේ නිවැරදි කිරීම (lab පැච් හතරට අමතරව):**

1. `src/lib/api.ts:launchProto` — top-level `window.location.href` වෙනුවට **hidden iframe** (4 s පසු ඉවත්) + anchor fallback — පිටුව හැර යන්නේ නැත, සාක්ෂි නැති වන්නේ නැත
2. `src/stores/sessionStore.ts:fireAutoLogin` / `fireFixReconnect` — transient activation රැකීමට click handler තුළ синхрон `window.open('', '_blank')` placeholder විවෘත කර, ticket ලැබුණු පසු `placeholder.location.href = ghrdp://…` (gesture-preserved) + iframe fallback; beacon watch dispatch ට පෙර සන්නද්ධ කරයි; පණිවිඩය: “protocol dispatched — if your browser shows ‘Open ghrdp-rdp-launcher?’ click Open … Waiting for handler beacon… (check %LOCALAPPDATA%\GhrdpLauncher\last.log if no beacon in 8 s)” සහ 8 s පසු “No handler beacon yet — did you click Open …? If you dismissed it, click again for a fresh ticket (single-use, 60 s).”
3. `src/tests/smoke/ghrdp-handler-gesture.test.ts` — iframe, placeholder අනුපිළිවෙල, prompt පාඨය pin කරයි

Browser ආරක්ෂාව bypass කිරීම, prompt auto-click කිරීම හෝ OS `ghrdp://` සෘජු දියත් කිරීම කර නැත — harness “Open” click කළ යුතුය හෝ https MagicDNS origin හි “always allow” සැකසිය යුතුය.

## 6. Launch-gates සහ static පරීක්ෂණ ගැලපීම (R1)

R1 (`server-ready.txt` සහ ` $dueLogon/$dueConn/$dueTel` one-per-iteration guard) යෙදීමෙන් පැරණි gate පරීක්ෂණ අසමත් විය — පහත ගැලපීම් කරන ලදී (ක්‍රියාකාරීත්වය වෙනස් නොවේ, gate ඉවසීම පමණි):

- `.github/workflows/launch-gates.yml` **F28** — `startup scan` සහ `30s tick` සඳහා `ServerReady` / `$dueLogon` පිළිගැනීම
- `.github/workflows/launch-gates.yml` **F37** — `telescope startup scan` සඳහා `$dueTel` + `ServerReady` පිළිගැනීම (තවම loop ඇතුළත)
- `tests/f28-logon-recovery.test.js`, `tests/f30-tls-cipher.test.js`, `tests/f37-telescope.test.js`, `tests/f45-readiness.test.js` — එම `$due*` guard පිළිගැනීම
- `.github/workflows/rdp-lab.yml` — `Node Unit Tests` පියවරට `pip install pyyaml` එකතු කිරීම (එසේ නොමැතිව `WF-VALIDATOR-1` අසමත්)

මෙම ගැලපීම් වලින් පසු **CI** `gates` **8m43s PASS**, `RDP Verification Lab Check / Static Contracts & Unit Tests` **8m12s PASS**, `windows-native` **11m53s PASS**, `e2e-ui` **8m27s PASS**, `build-ui-prebuilt` PASS, `m8/f56d/f57` PASS — සියල්ල 62afad4 හි PASS විය.

## 7. විශේෂාංග / පාලන ආවරණය (අවංක)

| විශේෂාංගය | පාලනය | පූර්ව අවශ්‍යතාව | සවිකිරීම | ක්‍රියාව | අපේක්ෂිත දෘශ්‍ය | අපේක්ෂිත backend | සැබෑ (Linux + static) | තීන්දුව | සාක්ෂිය |
|---|---|---|---|---|---|---|---|---|---|
| Overview | Connect chip | valid probes | `probes.native=ok` | mount | `verdict.evidenced` | `GET /api/native-status` 200 | `overview-conn-evidence` දිස්වේ | PASS | `f201` |
| Overview | WINDOWS AUTO-LOGIN | `nativeTrusted && credOk && listenerOk` | FQDN tail*.ts.net | click | enabled, probe නම පළමුව | `POST /api/rdp-token` → `ghrdp://rdp` | probe 401 නම් “no valid run key” | PASS | `f201`, `ghrdp-handler-gesture` |
| Overview | FIX & RECONNECT | FQDN gate | — | click | `ghrdp://recred` | CredWrite | placeholder හරහා | PASS | `ghrdp-handler-gesture` |
| Search | Landing / lane | `searchEnabled` | `__GHRDP_SEARCH_ENABLED` | mount | bar centered | `GET /diag` | lane නිවැරදි | PASS | `f77` |
| Search | Create/cancel | Bearer | — | `POST /api/search` | terminals + 400 | job lifecycle | 400 නිවැරදි | PASS | `f69` |
| Sessions | List | poll | `rdpListener` | mount | table | `GET /api/native-status` | 404 නැත | PASS | `sessions-native` |
| File Explorer | Browse/preview/download/ops/upload | `fx v2` SHA1 ids | 4 fixtures | `GET /api/fx` etc | list + checksum + 206/403 | — | guardrails 403/400 | PASS | `f57` |
| Mirror / Telemetry / Health / Collector / Settings | — | — | — | mount | — | `GET /health ws wsReason` | `ws` pool-aware | PASS | `r2` |
| **RDP auto-login (native)** | `ghrdp://rdp` → `mstsc` | MagicDNS FQDN, Bearer, HKCU, trace | synthetic key, සැබෑ server | click → prompt → beacon → mstsc | `handler-hello` → `mstsc-started` | Linux හි `mstsc` නැත — අවංක **BLOCKED** | BLOCKED | `40112159644` + `ghrdp-handler-gesture` |
| **Web Desktop** | noVNC | RDP session | — | open | fresh frame | `GET 100.64:7333` | RDP නැති නිසා BLOCKED | BLOCKED | — |

Functional sweep Lab හි `40112159644` හි `rdp_auto_login=FAIL` නිසා නිවැරදිව **SKIPPED** — මෙම ප්‍රවර්ධනය පැරණි run එකක් PASS ලෙස ප්‍රකාශ කර නැත.

## 8. යෙදවීම සහ නැවත ආරම්භය

- **Merge:** `gh pr merge 73 --merge` — 18:54:48Z සාර්ථක.
- **Staged files (dispatch පසු):** `C:\ghrdp\ui-v2.html` = merged SHA හි `ui/dist/index.html`; `C:\ghrdp\payloads\ghrdp-server.ps1` = අලුත් server (`serverSha256` `stage-result.json` හි); `C:\ghrdp\server-ready.txt` loop ඇතුළත.
- **Runtime identity:** `GET /api/version` `sha` == `GITHUB_SHA` (`config.buildSha`), `GET /api/ping` එමයි; UI meta `ghrdp-build` == `VITE_BUILD_SHA`. නොගැලපීම hard fail.
- **Dispatch:** `gh workflow run main.yml -f mode=rdp -f runner_target=windows-latest` — **HTTP 403: Resource not accessible by integration** ලැබිණි (`api.github.com/repos/.../actions/workflows/385695353/dispatches`). මෙය GitHub App අවසර සීමාවකි — **BLOCKED**. නැවත උත්සාහ කර නැත.
  > **ක්‍රියාකරුට උපදෙස්:** GitHub UI → *Actions → Windows RDP - Tailscale Mission Control (6h ephemeral) → Run workflow → Branch: main → mode=rdp, runner_target=windows-latest → Run workflow* ලෙස අතින් dispatch කරන්න.
- **නැවත ආරම්භය:** merge එක පැරණි runner `40117090530` යාවත්කාලීන නොකරයි; නව runner එකක් අවශ්‍යයි — පැරණි `server-ok.txt` නව SHA සඳහා සාක්ෂියක් නොවේ.

## 9. තීන්දු — විෂය පථ වෙන් කර, අවංකව

| විෂය පථය | තීන්දුව | පදනම |
|---|---|---|
| **APPLICATION_PATCHES** (F201/R1/R2/R2b) | **PASS** — හතරම යෙදුණි, 28/28 + 109/1395 + build OK, lab R2b 5/5 රැගෙන ආවා | §1-§3 |
| **APPLICATION_CI_AND_RUNTIME** (static + Windows real-backend) | **PASS (scoped backend)**, **BLOCKED (native)** — static 265/265 (lab 40112159644), real-backend 40112159586 33/38 + R2b 5/5; Linux build 109/1395 PASS; Windows runtime VM-bound, නව `main.yml` dispatch එකකින් නැවත මැනිය යුතුයි | §3, §6 |
| **APPLICATION_DEPLOYMENT** | **MERGED, NOT YET DISPATCHED** — `d3f13d4` main වෙත ඒකාබද්ධ විය; නව SHA හි live runner තවම නැත (403 නිසා dispatch BLOCKED) | §8 |
| **NATIVE_RDP_AND_WEB_DESKTOP** | **BLOCKED** — `LogonType 10`, “Open ghrdp-rdp-launcher” click, `handler-hello` beacon, `mstsc` අවශ්‍යයි; Linux lane හි අවංක BLOCKED (40112159644 prompt click නොවීම) | §5 |
| **FULL_FEATURE_COVERAGE** | **PASS (non-RDP)**, **BLOCKED downstream (RDP-යැපෙන)** — RDP නොයැපෙන සියල්ල mounted + contract PASS; RDP-යැපෙන පාලන පමණක් downstream BLOCKED (ව්‍යාජ නොවේ) | §7 |
| **AUTOMATIC_LAB_INTEGRATION** | **BLOCKED/NOT_RUN** — `rdp-lab-client` ඇත්තේ lab repo සඳහා; `dictationb1/supreme-lamp` සඳහා වෙනම runner ලියාපදිංචිය අවශ්‍යයි | — |
| **PRODUCTION RUNTIME VERIFICATION** (PS5.1 parse / WS101 / /health ws wsReason p95 / capacity / disconnect / 503) | **BLOCKED (dispatch 403)** — Linux parse + lab p95 58 ms රැගෙන ආවා; සජීවී Windows `powershell.exe` 5.1 parse, `WS 101` → `503` degradation/recovery, `/health` `ws`/`wsReason`/`p95`, capacity/disconnect පරීක්ෂණය නව dispatch එකකින් පමණක් මැනිය හැකිය | §4, §8 |

සාර්ථක workflow එකක් යනු සෑම විශේෂාංගයක්ම PASS වූ බවට සාක්ෂියක් නොවේ; scoped backend අළුත්වැඩියාවක් යනු සම්පූර්ණ end-to-end පිළිගැනීමක් නොවේ.

## 10. නොවෙනස් සාක්ෂි සබැඳි

- Lab archive: https://codeload.github.com/dictationb1/supreme-lamp-lab/zip/d7c90dc81867553c65f862308d799caaaf3cbec7
- Patches: `reports/mission-control/40051974454-1-v2/app-patches/0001…0004` (ඉහත)
- R2b defect: `defects/R2B-POOL-FALLBACK-INLINE-PUMP.md`
- R2b fault proof: `reports/mission-control/40072158991-1/evidence/real-backend-40112159586/r2b-r2-fault-report.json` (5 PASS)
- Capability failure: `reports/mission-control/40051974454-1-v2/evidence/capability-40112159644/` (prompt දිස්වන `native-production-launch.png`)
- මෙම ප්‍රවර්ධනයේ සාක්ෂි: `docs/reports/2026-10-24-promotion/README.md` + `feature-coverage.csv` + git `d3f13d4` + CI `40121443750` (gates 8m43s PASS, static 8m12s PASS) + PR #73

---
*Lab bundle `40051974454-1-v2` නොවෙනස්ව තබන්න; මෙම repo හි `docs/reports/2026-10-24-promotion/` හි නව සාක්ෂි සඳහා scratch directory හෝ පෙර chat මතකය අවශ්‍ය නොවේ.*
