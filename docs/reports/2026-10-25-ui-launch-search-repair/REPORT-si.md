# Mission Control: යාවත්කාලීන කිරීම — දියත් කිරීම, අවලංගු කිරීම, සබැඳි සහ සෙවුම් අලුත්වැඩියාව

**දිනය:** 2026-10-25
**පරීක්ෂා කළ යෙදුම් සංස්කරණය (revision):** `ae360351eb3fea434f482af1b9e9db48025936a7`
**ශාඛාව:** `arena/046926e8-supreme-lamp` (පදනම: `main` @ `e067bcef5ff97287bbc79345fa6a55cd8f3fcf31`)
**ගොඩනැගූ single-file bundle sha256:** `9315cdc8fe7d4f3cf3fa5f81e84811ed98e01c1aec79f1c7f57cb7af56b123ff`

මෙම වාර්තාව විස්තර කරන්නේ **සත්‍ය වශයෙන් කොහේද වැරැද්ද තිබුණේ** සහ **මේ ශාඛාවේ කුමක් වෙනස් වුණාද** යන්නයි.
ඉතිරි කොටස් (VM එකේ සත්‍ය RDP ධාවනය, PowerShell/C# compile) මෙහි **NOT RUN** ලෙස පැහැදිලිව සටහන් කර ඇත;
ඒවා අනුමාන කර "සමත්" ලෙස නොකියයි.

---

## 1. APPLICATION_REPAIRS (යෙදුම් අලුත්වැඩියා)

| අංකය | අලුත්වැඩියාව | ස්ථානය | තත්ත්වය |
| --- | --- | --- | --- |
| A1 | එක් පරිශීලක ක්‍රියාවකට එක් dispatch පමණක් (ticket 1, navigation 1) | `src/lib/domain/dispatch.ts` (නව), `src/lib/api.ts:160`, `src/stores/sessionStore.ts:362` | **JS-PASS** |
| A2 | අවලංගු කිරීම / නැවත උත්සාහය සැබෑ attempt එකකට බැඳීම | `dispatch.ts`, `native.ts:316/427`, `PrimaryActions.tsx` | **JS-PASS** |
| A3 | Replay කළ ticket එකක් නිසා cmdkey මුරපද ඉල්ලීමක් නොවීම | `payloads/ghrdp-rdp-launcher.cs:990/1034` | **STRUCT-PASS** (compile/runtime NOT RUN) |
| A4 | `awesome.re` HOSTNAME_MISMATCH නිවැරදි කිරීම (source-scoped allowlist) | `payloads/ghrdp-server.ps1:5205/6001` | **STRUCT-PASS** + client HTTP-PASS |
| A5 | result-URL deep inspection මාර්ගය විවෘත කිරීම (mode-first) | `payloads/ghrdp-server.ps1:7091`, `src/api/lab/index.ts:297` | **STRUCT-PASS** + **HTTP-PASS** |
| A6 | සියලුම repository/help සබැඳි එකම identity එකකට | `src/lib/repoIdentity.ts`, ස්ථාන 6ක් | **JS-PASS** |
| A7 | Incident වේලාවන් වෙන් කිරීම (occurred / observed / resolved) | `src/lib/overview/issues.ts:202` | **JS-PASS** |
| A8 | තුන් ආකාරයේ prompt වෙන් කර පෙන්වීම (UI) | `PrimaryActions.tsx` (`overview-prompt-triage`) | **JS-PASS** |

සම්පූර්ණ suite: **118 test files / 1535 tests — සියල්ල සමත් (exit 0)**.
පෙර තත්ත්වය: 111 files / 1453 tests සමත්. `tsc` දෝෂ 0, single-file build සමත්,
`check:regression-ids` (219), `check:no-neon-green`, `check:bottom-bar`, `check:fx-ids`,
`check:contrast`, `check:glass-contrast` සියල්ල සමත්.

---

## 2. SINGLE_DISPATCH_AND_CANCELLATION

**වැරැද්ද (මූලාශ්‍රයෙන් තහවුරු කළ):** `fireAutoLogin` එක් ක්ලික් එකකට
(1) හිස් popup එකක් විවෘත කර ticket එක ලබාගෙන එය `ghrdp://` වෙත යැව්වා, **සහ**
(2) එය "සාර්ථක" වුණාට පසුවත් `launchProto()` කැඳවා hidden iframe එකකින් **දෙවන** navigation එකක් කළා, **සහ**
(3) තත්පර 0.15කින් synthetic anchor click එකකින් **තුන්වන** dispatch එකක් කළා.
තවද popup එක තත්පර 4කින් වසා දැමුවා — browser consent prompt එක තවම විවෘතව තිබිය හැකි අවස්ථාවේ.

**දැන්:** attempt එකකට —
* එක් attempt identity එකක් (`att-…`), එක් `POST /api/rdp-token`, එක් custom-protocol navigation;
* `preparing`/`ticket-issued`/`awaiting handoff` අවස්ථාවල දෙවන ක්ලික් **ප්‍රතික්ෂේප** (නව ticket නිකුත් නොවේ);
* ස්වයංක්‍රීය "දෙවන උත්සාහය" කිසිවිටෙකත් නැත; fallback කරන්නේ dispatch-පෙර සත්‍ය අසාර්ථකත්වයකදී පමණි;
* helper window එකක් විවෘත නොකෙරේ (එබැවින් timer එකකින් වැසීමක් නැත);
* retry = නව attempt + **නව** ticket (පැරණි attempt එක terminal තත්ත්වයක තිබේ නම් පමණි);
* පැරණි attempt එකකින් පසුව එන beacon/callback එකක් attempt id + trace + වේලාවෙන් ප්‍රතික්ෂේප වේ.

**අවලංගු කිරීම (cancellation):** `cancelled` තත්ත්වයට පැමිණිය හැක්කේ පරිශීලකයා පැහැදිලිව Cancel
එබූ විටයි. Popup වැසීම, focus එක නැතිවීම හෝ beacon නොලැබීම **අවලංගු කිරීමක් ලෙස නොසැලකේ** —
එය `awaiting handoff` → `unconfirmed` ලෙස විවෘතව පවතී.

**පරීක්ෂණ:** `dispatch-single-attempt.test.ts` (19) සහ
`launch-store-single-dispatch.test.tsx` (11). සාමාන්‍ය ක්ලික්, ද්විත්ව ක්ලික්, මන්දගාමී ticket,
popup blocked, handler නැති අවස්ථාව, cancel, retry, expiry සහ පැරණි attempt එකකින් එන late callback
සියල්ල ගණන් කර පරීක්ෂා කෙරේ.

**"38s before the last mstsc launch":** `recoveryDecision` දැන් `eventTs` නොමැති විට scan time
ආදේශ නොකරයි; ගිණුම/මූලාශ්‍ර/run/attempt සහ සම්බන්ධතා (correlation) අවශ්‍ය වේ. ලොග් වීමට පෙර සිදු වූ
අසාර්ථකත්වයක් දැන් `failure-predates-the-launch` ලෙස වාර්තා වේ (එයම "ඔබේ මුරපදය වැරදියි" යැයි නොකියයි).

---

## 3. STATUS_ACCURACY (තත්ත්ව නිරවද්‍යතාව)

* `firstObservedAtMs` දැන් "මෙම browser එක මුලින්ම දුටු වේලාව" පමණි (reducer මගින් පිරවේ);
  `occurredAtMs` = සිදුවීමේ වේලාව; `lastObservedAtMs` = මෙම poll එක; `resolvedAt` = නිරාකරණය වූ වේලාව.
  නැවත නැවත poll කිරීමකින් පැරණි දෝෂයක් "0s ago" ලෙස අලුත් නොවේ.
* `ws=false` එක තනි රෝග නිර්ණයක් ලෙස නොපෙන්වයි — `wsReason` (pending / unsupported / unauthorized /
  pool-unavailable) වෙන් වෙන්ව දර්ශනය වේ (V4 කේතය එලෙසම රැක ඇත).
* 4625 එකක් සෑම විටම "වැරදි මුරපදය" නොවේ: `FailureClass` + Status/SubStatus + attribution අවශ්‍ය වේ.
* සත්‍ය RDP සැසියක් සමඟ අසාර්ථක නව attempt එකක් සමඟ පැවතිය හැක — bot `lifecycleStage` සහ
  `session-already-active` නීතිය මගින් එය වෙන් කරයි.

---

## 4. SEARCH_AND_LINKS (සෙවුම සහ සබැඳි)

**A. `awesome.re` → HOSTNAME_MISMATCH.** save-probe එක cross-site redirect එකක් (github.com)
"එකම අඩවිය" ලෙස නොසලකයි (එය නිවැරදියි), නමුත් එය **සටහන් නොකළ** නිසා පසුව සිදුවන ඕනෑම inspect එකක්
redirect hop එකේදී ප්‍රතික්ෂේප විය. දැන් probe එක `redirectHostname` ලෙස එය **එක් මූලාශ්‍රයකට පමණක්**
සටහන් කරයි; `Invoke-F78SecureFetch -AllowedHosts` මගින් hop-by-hop නැවත පරීක්ෂා කරයි. wildcard නැත,
suffix match නැත, global allowlist වෙනස් නොවේ. සබැඳි උපුටා ගැනීම සේවය කළ host එකට fence කෙරේ.

**B. Result deep inspection.** `POST /api/lab/inspect` මුලින්ම `sourceId` පරීක්ෂා කළ නිසා
`{sourceUrl, query}` සෑම ඉල්ලීමක්ම 400 ලෙස ප්‍රතික්ෂේප විය — result මාර්ගය කිසිදා ධාවනය නොවීය.
දැන්: mode තේරීම → එම mode එකේ සම්පූර්ණ වලංගුකරණය → **එක්** rate-budget → **එක්** pipeline →
**එක්** ප්‍රතිචාර schema. දෝෂ කේත (`HOSTNAME_MISMATCH` + `details.offHost`, `REDIRECT_REFUSED`,
`RATE_LIMITED` + retry, `lab.serverError`) UI එකේ පෙන්වයි; "යම් දෝෂයක් සිදු විය" යන්නට වැටෙන්නේ
නොදන්නා කේතයක් පමණි. "සබැඳි නැත" සහ "ගැළපුම් නැත" යන තත්ත්ව දෙක වෙන් වේ, fetch අසාර්ථකත්වයෙන් වෙන් වේ.

**සබැඳි.** `github.com/dekarita/supreme-lamp` ලෙස hard-coded තිබූ ස්ථාන 6ක්
(`Search.tsx`, `native.ts` `SECRETS_URL`/`ACTIONS_URL`, `DashTokenGate`, `F92VersionGate`,
`WebDesktopCard`, `Collector`) දැන් `src/lib/repoIdentity.ts` හරහා `dictationb1/supreme-lamp` වෙත යයි.
build configuration එකෙන් පමණක් පැමිණේ (URL query parameter එකකින් **නොවේ**). යොමු වන සියලු
documentation ගොනු checkout එකේ ඇත්දැයි test එකකින් තහවුරු කෙරේ.

---

## 5. FULL_FEATURE_OPERATIONS

`feature-operations.md` හි සම්පූර්ණ ලැයිස්තුව ඇත. සාරාංශය:

* **JS-PASS:** Overview (auto-login, fix-reconnect, web desktop, run check/diag, verdict, prompt triage),
  Search/Lab (submit, deep inspect, empty/error states, refetch), Sessions, Connections, Keys,
  Telemetry, Health, Mirror, Transfers, File Explorer, Collector, Settings — මේවායේ පවතින
  ස්වයංක්‍රීය පරීක්ෂණ සියල්ල සමත් (117 files / 1531 tests).
* **HTTP-PASS:** `/api/lab/inspect` client එක සත්‍ය HTTP හරහා (mode දෙකම, දෝෂ propagation).
* **STRUCT-PASS:** PowerShell route එකේ සහ C# launcher එකේ ගිවිසුම් (මෙම host එකේ ඒවා ධාවනය කළ නොහැක).
* **NOT RUN / BLOCKED:** සත්‍ය `mstsc`, cmdkey/Windows credential prompt, `.rdp` publisher warning,
  නියම PowerShell 5.1 server, tailnet RDP සැසිය — Windows candidate/VM එකක් අවශ්‍යයි.

---

## 6. APPLICATION_DEPLOYMENT

* PR සහ merge තත්ත්වය මෙම ෆයිල් එකේ **පහළින්** `promotion.json` එකේ සහ
  `docs/reports/mission-control-current-handoff.json` හි සටහන් වේ (merge SHA එකක් නිර්මාණය නොකර, සත්‍ය
  අගය පමණක්).
* main.yml නැවත dispatch කිරීම `mode=rdp`, `runner_target=windows-latest` සමඟ උත්සාහ කෙරේ;
  platform එකෙන් deterministic 403 එකක් ලැබුණහොත් එය එක් වරක් වාර්තා කර, නැවත නොකෙරේ.
* **කිසිදු deployment සාර්ථක බවක් මෙහි පූර්වයෙන් ප්‍රකාශ නොකෙරේ.**

---

## 7. USER_VM_ACCEPTANCE (පරිශීලක VM පිළිගැනීම) — **PENDING**

මෙම පරිසරයට පරිශීලකයාගේ VM (`rdp-lab-client`, `WIN-NFU1JG4VESE\User`) වෙත ප්‍රවේශයක් නැත,
එය lab repository එකට ලියාපදිංචි බව මිස මෙම යෙදුමට නොවේ. එබැවින් පහත දේ **නොකළා**:

1. සත්‍ය RDP සැසියක් විවෘත කිරීම (පරණ සම්බන්ධතාවය රැක ගනිමින්).
2. "Unknown publisher" warning එකේ **සත්‍ය** හේතුව එම PC එකේ `.rdp` අත්සන සහ
   `%ProgramData%\ghrdp\rdp-signing.json` සමඟ ගැළපීම.
3. cmdkey prompt එක replay එකකදී **නොපැමිණෙන** බව තහවුරු කිරීම.
4. සත්‍ය `awesome.re` සහ `github.com/ChessMax/awesome-programming-languages` inspect එකක්.

**පහත නිශ්චිත ක්‍රියා පිළිවෙල** (`unresolved.md` හි විස්තරය):

```
1) main.yml (mode=rdp, runner_target=windows-latest) → dashboard URL + ?key=
2) Overview → WINDOWS AUTO-LOGIN එක් වරක් click → "Open ghrdp-rdp-launcher?" → Open
3) පෙන්විය යුතු: launch: awaiting handoff (tickets=1 dispatches=1) → launcher beacon → connected
4) එම බොත්තම නැවත වරක් ඔබන්න → "an attempt is already awaiting handoff" (දෙවන ticket නැත)
5) Cancel → retry → නව ticket එකක්, එක් dispatch
6) Search → awesome.re → "Programming Languages" → සබැඳි ලැයිස්තුවක් (HOSTNAME_MISMATCH නැත)
7) Search result ChessMax/awesome-programming-languages → deep inspect → rows හෝ "no matches" (generic error නැත)
8) Help/actions/secrets සබැඳි → dictationb1/supreme-lamp වෙත (404 නැත)
```

මේ සියල්ල ඉටු වුවහොත් පමණක් USER_VM_ACCEPTANCE සමත් ලෙස සලකන්න. එසේ නොවුණහොත්
අදාළ පියවරේ ලොග්/beacon එක සමඟ මෙම ෆයිල් එකට එක් කරන්න — අනුමාන නොකරන්න.
