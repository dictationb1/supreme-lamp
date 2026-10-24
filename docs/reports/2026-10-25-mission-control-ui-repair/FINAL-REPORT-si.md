# අවසාන වාර්තාව — Mission Control සත්‍ය තත්ත්ව හා සිදුවීම් අළුත්වැඩියාව

**දිනය:** 2026-10-25 (UTC)
**ශාඛාව:** `arena/b462ed7a-supreme-lamp` → `main`
**PR:** https://github.com/dictationb1/supreme-lamp/pull/79
**පදනම (main):** `451e8136c97f80563df5cf40fc9f6ed9f05eaa4d`
**පරීක්ෂිත කේත SHA:** `af483d2e7771df1055224edf7636518c2d1b61ac` (මෙම වාර්තාව ලියන විට; PR එකේ අවසන් SHA ට වඩා මෙය කලින් විය හැක — `manifest.json` බලන්න)
**මුල් පදනමේ PR #73:** `d3f13d48d548c66e213a94364cb7f0ab9ac3158a` (MERGED) — F201/R1/R2/R2b සුරැකිණි

---

## 1. APPLICATION_REPAIRS (යෙදුම් අළුත්වැඩියා)

| # | ගොනුව | වෙනස |
|---|---|---|
| 1 | `payloads/ghrdp-server.ps1` | F28 logon collector: `EventRecordID`, `Status`, `TargetUserName`, redacted source උපුටා ගනී; ගිණුම අනුව අඩු කිරීම (machine-wide counts රඳවා); `correlation`, `recordId`, `userMatched`, `sourceMatch`, `remoteInteractive`, `remote{}` පළ කරයි; `quser` මගින් Terminal Services සාක්ෂිය `session{}` ලෙස වෙන් කරයි; `Status` සහ `SubStatus` දෙකම වර්ග කරයි; PS 5.1 අනුකූල. |
| 2 | `src/lib/overview/readiness.ts` | නව `console` තත්ත්වය; success සහ failure දෙකටම **එකම** freshness නීතිය; `correlation`, `failureClass`, `eventAtMs`, `notices`; වෙනත් ගිණුමක ප්‍රතික්ෂේපයක් මෙම සේවාලාභියා අසාර්ථක නොකරයි; සජීවී `rdp-tcp` session එකක් අලුත් අසාර්ථක උත්සාහයකින් වැසෙන්නේ නැත. |
| 3 | `src/lib/overview/issues.ts` | සිදුවීමේ වේලාවෙන් දින ගැනීම (`occurredAtMs`), ස්ථාවර `incidentKey`, `confirmed` යනු සම්බන්ධ + නවීන විට පමණි, SubStatus-නිශ්චිත වචන, WebSocket තත්ත්ව 6ක්, `native-lost` ස්තරය. |
| 4 | `src/lib/overview/incidents.ts`, `src/stores/incidentStore.ts` | පිරිසිදු incident ledger + browser-local acks. නැවත-පෝලිමෙන් වයස නොවෙනස්; producer නතර කළ විට `resolvedAt`; **acknowledge ≠ resolve**. |
| 5 | `src/stores/telemetryStore.ts`, `src/hooks/useDashboardPolling.ts` | `/health` හි `wsReason` පාවිච්චි කර `wsAvailability` පළ කිරීම; `serverClockKnown` — සාක්ෂිය එක් කාල පදනමක් මත සංසන්දනය. |
| 6 | `src/hooks/useConnectionVerdict.ts`, `src/pages/Overview.tsx`, `src/components/overview/TroubleshootSummary.tsx` | සියලු නව ක්ෂේත්‍ර සම්බන්ධ කිරීම; incident ledger නිරීක්ෂණය; පේළියකට acknowledge පාලනය; `data-incident-key` / `data-occurred-at` / `data-acknowledged`. |
| 7 | `src/i18n/en.json`, `si.json` | +15 යතුරු (දෙකෙහිම සමාන). `EXPECTED_FLAT_KEYS` 1252 → **1267**. |
| 8 | `.github/workflows/launch-gates.yml`, `autologin-lab.yml` | IpAddress තහනම පටු කර (රහස් තහනම තදින්ම) + Windows lab එකේදී නව correlation ගිවිසුම **ධාවනය කර** පරීක්ෂා කිරීම. |

## 2. STATUS_AND_INCIDENT_ACCURACY (තත්ත්ව හා සිදුවීම් නිරවද්‍යතාව)

| පෙර | දැන් | සාක්ෂිය |
|---|---|---|
| ඕනෑම 4625 එකක් “Connection failed” | ගිණුම/මූලාශ්‍රය නොගැලපෙන 4625 **INFO ඉතිහාසය**; සම්බන්ධතාව තීරණය නොකරයි | `v4-conn-correlation` (V4-1), `v4-incident-ui` (V4-UI-1) |
| `observedAtMs = serverNowMs` → “0s ago” | සිදුවීමේ `eventTs`; පෝලිම් 10කින් පසුත් වයස වැඩි වේ | V4-6, V4-UI-1 (10800s), V4-UI-4 |
| “the host rejected the stored credential”, `confirmed` | SubStatus අනුව වචන; `confirmed` = සම්බන්ධ + නවීන. Locked/disabled/expired පාස්වර්ඩ් දෝෂයක් නොවේ | V4-5 (12 කේස්) |
| success සඳහා පමණක් freshness | success **සහ** failure දෙකටම `current/stale/undated` | V4-3 |
| LogonType 2/11 = “connected” | නව `console` තත්ත්වය; `rdp-tcp#N` session සාක්ෂියක් ඇත්නම් පමණි “connected” | V4-2 (4 කේස්) |
| `wsAvailable=false` = “/ws නැත” | තත්ත්ව 6ක් | V4-UI-3 (4 කේස්) |
| native-status poll එක අසාර්ථක විට පැරණි දත්ත “සජීවී” ලෙස | `native-lost` අනතුරු ඇඟවීම + කියවීමේ වයස | `issues.ts` (deriveIssues 2b) |

## 3. FEATURE_OPERATION_COVERAGE (විශේෂාංග ක්‍රියාකාරී ආවරණය)

**සත්‍ය තත්ත්වය:** මෙම සැසියේදී ඍජුව පරීක්ෂා කළ හැක්කේ පෙරහුරු-මට්ටමේ
හැසිරීම්, build සහ ස්ථිති ගිවිසුම් පමණි. සජීවී backend එකක් මෙම
පරිසරයේ නොමැති බැවින් **UI → backend ක්‍රියාකාරී පිළිගැනීම NOT_RUN** වේ.
`acceptance-matrix.csv` හි සෑම පේළියකම සත්‍ය තත්ත්වය සටහන් කර ඇත;
"mounts" හෝ "renders" මගින් කිසිදු පේළියක් PASS නොවේ.

2026-10-24 වාර්තාවේ “FULL_FEATURE_COVERAGE PASS” යන ප්‍රකාශය **ප්‍රතික්ෂේප**
කරන ලදී: `coverage-audit.csv` හි එහි PASS පේළි 17 නැවත ශ්‍රේණිගත කර ඇත
(මුල් ගොනුව ඉවත් නොකර, එයම ඉතිහාසය ලෙස රඳවා).

## 4. NATIVE_RDP (දේශීය RDP)

* **වෙනසක් නැත.** listener, NLA/CredSSP, cert/thumbprint, ticket mint/redeem,
  `.rdp` signing, launcher beacon මාර්ග කිසිවක් ස්පර්ශ කර නොමැත
  (`git diff` පරාසය: collector හා UI පමණි).
* පරිශීලකයා වාර්තා කරන සාර්ථක සම්බන්ධතාව **regression constraint** ලෙස
  රඳවා ඇත. මෙම සැසියේදී නැවත පරීක්ෂා කර නැත (NOT_RUN) — පරිශීලක සැසිය
  කඩා නොදැමීම සඳහා.
* නව තත්ත්ව ආකෘතිය RDP සාර්ථක වූ විට **“connected”** පෙන්වීමට ඉඩ දෙයි:
  LogonType 10 හෝ `rdp-tcp#N` Active session (V4-2).

## 5. WEB_DESKTOP

* Web Desktop තත්ත්වය දැන් `wsAvailability` සහ native probe තත්ත්වයෙන්
  වෙන් වේ; manual viewing-mode ලේබලය machine-observed සම්බන්ධතාව ලෙස
  තවදුරටත් ඉදිරිපත් නොවේ (පෙර R2/V3 වැඩවල කොටසක්; මෙම PR එය වෙනස් නොකරයි).
* සජීවී stream (frame/pixel) පරීක්ෂාව **NOT_RUN** — RDP session එකක් සහිත
  Windows host අවශ්‍යයි.

## 6. APPLICATION_DEPLOYMENT (යෙදුම් ප්‍රතිනියෝජනය)

* PR #79 පවතින අතර CI (`gates`, `e2e-ui`, `windows-native`, `proof`,
  `build-ui-prebuilt`, lab static) ධාවනය වේ.
* **මෙම පරිසරයේ** `vite build` සාර්ථක: `ui/dist/index.html` 1,245,750 bytes,
  SHA256 මුල් 16 අක්ෂර `3aa06e22f854330b`. build SHA කේතයට සම්බන්ධ නොකළ
  local එකකි; නිල deployment එක `main.yml` (mode=rdp,
  runner_target=windows-latest) මගින් සිදු වේ.
* නිල `main.yml` dispatch එකක් මෙම සැසියේදී **උත්සාහ කර නොමැත** (පහත 8 වගන්තිය බලන්න),
  එබැවින් නව කේත ක්‍රියාත්මක වන බවට run එකක් සාක්ෂියක් ලෙස **නොපවසයි**.

## 7. USER_VM_VERIFICATION (පරිශීලක VM සත්‍යාපනය)

* ඉතිහාසික VM: `rdp-lab-client`, `WIN-NFU1JG4VESE\User`, session 1.
* මෙම සැසියට එම VM වෙත ඍජු ප්‍රවේශයක් **නොමැත**. එබැවින්:
  * user-VM මත කිසිදු පරීක්ෂණයක් සිදු කළ බව නොපවසයි;
  * hosted/headless ධාවන පරිශීලක ඩෙස්ක්ටොප් පරීක්ෂණ ලෙස නොසැලකේ;
  * අවශ්‍ය එකම මෙහෙයුම් පියවර: Windows runner එකක් මත
    `autologin-lab.yml` (හෝ `main.yml`) ධාවනය කර නව V4 assertions සහිත
    lab පියවර සමත් වන බව තහවුරු කිරීම.
* නව lab assertions (`.github/workflows/autologin-lab.yml` §V) **Windows මතම**
  ධාවනය වන පරිදි ලියා ඇත: `recordId` උපුටා ගැනීම, සම්බන්ධ නොවන විට
  correlation=unavailable, ගැලපෙන ප්‍රතික්ෂේපය failed, වෙනත් ගිණුමක
  ප්‍රතික්ෂේපය `result=none` + machine-wide count රඳවා ගැනීම, type-2
  remote proof නොවේ, type-10 remote proof වේ.

## 8. AUTOMATIC_LAB_INTEGRATION (ස්වයංක්‍රීය lab සම්බන්ධතාව)

* lab repository (`supreme-lamp-lab`) **වෙනස් කර නැත**; ලිවීමේ අවසර ඉල්ලා නැත.
* මෙම වාර්තාව application repository තුළම රඳවා ඇති බැවින් පසුව ධාවනය වන
  lab/main සැසියකට immutable ලෙස ලබාගත හැක.
* `main.yml` dispatch: මෙම සැසියේදී **උත්සාහ කර නොමැත** (ප්‍රතිනියෝජනයට පෙර
  PR එක merge විය යුතුය). UI මෙහෙයුම: *Actions → “Windows RDP - Tailscale
  Mission Control (6h ephemeral)” → Run workflow → mode=rdp,
  runner_target=windows-latest*.

---

## 9. සාක්ෂි සහ සබැඳි

* PR: https://github.com/dictationb1/supreme-lamp/pull/79
* පරීක්ෂිත commit: `af483d2e7771df1055224edf7636518c2d1b61ac`
* පදනම: `451e8136c97f80563df5cf40fc9f6ed9f05eaa4d`
* මෙම වාර්තාව: `docs/reports/2026-10-25-mission-control-ui-repair/`
* පෙර වාර්තාව (ඉතිහාසය, වෙනස් නොකර): `docs/reports/2026-10-24-promotion/`

## 10. ඉතිරි වන දේ (සත්‍යවශයෙන්)

1. **Windows මත සජීවී collector ධාවනය** — lab/main runner එකක් අවශ්‍යයි (NOT_RUN).
2. **UI ↔ සජීවී backend පිළිගැනීම** — Search/Files/Settings/Health සඳහා
   සජීවී backend එකක් අවශ්‍යයි (NOT_RUN, මෙම PR හි වෙනස්කම් වලට ස්වාධීන).
3. **පරිශීලක VM මත RDP නැවත-තහවුරු කිරීම** — පරිශීලක කාලය අවශ්‍යයි.
4. `tests/workflow-validation.test.js` මෙම sandbox එකේදී `pyyaml` නොමැතිව
   අසාර්ථක විය; `pyyaml` ස්ථාපනයෙන් පසු සමත් විය (පරිසර දෝෂයක්, කේත දෝෂයක් නොවේ).

**කිසිදු 100% සාර්ථකත්වයක් පොරොන්දු නොවේ. කෘතිම “හරිත” තත්ත්ව නිපදවා නැත.**
