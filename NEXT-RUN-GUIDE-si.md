# මීළඟ RDP Session එක ආරම්භ කිරීමේ මාර්ගෝපදේශය (Next-Run Guide)

## 1. අවශ්‍ය අලුත්ම කේත (Revisions)
දැනට PR #1 `closed` තත්ත්වයේ පවතින බැවින්, එහි වෙනස්කම් `main` ශාඛාවට එක් වී (merged) ඇත්දැයි පරීක්ෂා කර තහවුරු කරගන්න.
ඔබගේ Workflow එක ක්‍රියාත්මක කළ යුත්තේ `main` ශාඛාව පදනම් කරගෙනයි.

## 2. Operator විසින් සම්පූර්ණ කළ යුතු පෙර සූදානම් පියවර (Pre-requisites)
පහත රහස්‍ය දත්ත (secrets) Github ගබඩාවේ `Settings > Secrets and variables > Actions` හි සකසා තිබිය යුතුය. අදාල උපදෙස් `docs/mission-control/v4/SETUP-GUIDE-si.md` ලේඛනයේ ඇත.
* **`TS_AUTHKEY`** (අනිවාර්යයි)
* **`VNC_PASS`** (අනිවාර්යයි)
* **`RENTRY_EDIT_PASSWORD`** (Mirror mode භාවිතා කරන්නේ නම් අනිවාර්යයි)

## 3. RDP ආරම්භ නොකර සූදානම පරීක්ෂා කිරීම (Readiness-only Check)
ඔබගේ Workflow එකෙහි **"Preflight Configuration Check (Readiness Gate)"** පියවර මගින් `mode=readiness` තෝරාගත් විට:
* අවශ්‍ය Secrets (`TS_AUTHKEY`, `VNC_PASS`, `RENTRY_EDIT_PASSWORD`) නිවැරදිව සකසා ඇත්දැයි පරීක්ෂා කරයි.
* RDP Launch Dependencies (Prebuilt Binaries, UI Bundle) වල පවතින තත්ත්වය පරීක්ෂා කර පෙන්වයි.
* කිසිදු Asset එකක් Build කිරීම හෝ Publish කිරීම සිදු නොකරයි. නොමැති Assets `mode=rdp` ධාවනයේදී ස්වයංක්‍රීයව සකසන ලෙස සටහන් කරයි.

## 4. RDP Workflow එක ආරම්භ කිරීම (Single-Dispatch Automatic Orchestration)
එක් වරක් `mode=rdp` තෝරා Run workflow කිරීමෙන් සම්පූර්ණ RDP පරිසරය ආරම්භ කළ හැක:
1. Github හි `Actions` ටැබ් එකට යන්න.
2. `Windows RDP - Tailscale Mission Control (6h ephemeral)` Workflow එක තෝරන්න.
3. **mode:** `rdp` ලෙස තෝරන්න.
4. `Run workflow` බොත්තම ක්ලික් කරන්න.

* **ස්වයංක්‍රීය Dependency සූදානම් කිරීම:** F59 Prebuilt Binaries හෝ UI Bundle නොමැති නම්, Workflow එක මගින් Reusable Workflows මාර්ගයෙන් ඒවා ස්වයංක්‍රීයව Build කර, Verify කර, RDP Session එක සක්‍රීය කරයි. F59 හෝ build-ui manual dispatch කිරීම අවශ්‍ය නොවේ.

## 5. Workflow හි අදියර (Expected Startup Stages)
ඔබගේ RDP Session එක සූදානම් වන විට පහත ප්‍රධාන පියවරයන් සාර්ථකව අවසන් විය යුතුය:
1. **Preflight Check:** Secrets සහ Manifests වලංගු කිරීම.
2. **Ensure Dependencies (UI & F59):** නොමැති Dependencies ස්වයංක්‍රීයව Build/Verify කිරීම.
3. **Verify Dependencies & Authorize:** සියලුම Dependencies සූදානම් බව තහවුරු කිරීම.
4. **Tailscale up & Services:** Tailscale ජාලයට සම්බන්ධ වීම සහ RDP සේවාවන් ආරම්භ කිරීම.
5. **Service Readiness Check:** Dashboard සහ RDP සේවාවන් සක්‍රීය බව තහවුරු කිරීම.
6. **Keep-alive:** 5h30 කාලයක් පුරා සේවාදායකය සක්‍රීයව තබා ගැනීම.

## 6. Ready (සූදානම්) බව හඳුනාගැනීම
Workflow එක ධාවනය වන විට එහි තත්ත්වය `In progress` ලෙස දර්ශනය වේ. එනමුත් RDP Session එක සැබවින්ම භාවිතයට "සූදානම්" (Ready) වන්නේ:
* Workflow එකෙහි `Keep-alive 5h30` පියවර ආරම්භ වූ විට පමණි.
* මෙම පියවර ධාවනය වෙමින් පවතින තාක් කල්, ඔබගේ RDP සේවාව ක්‍රියාකාරී තත්ත්වයේ පවතී.
* Github Actions හි අදාල Run එක මත ක්ලික් කර `Summary` ටැබ් එකට ගොස්, එහි ඇති දත්ත හරහා Dashboard එකට සහ Web Desktop එකට පිවිසිය හැක.

## 7. දෝෂ සහ පිළියම් (Troubleshooting)
* **Preflight Check අසමත් වුවහොත්:** `Summary` පිටුවට ගොස් කුමන Secret එක අඩුදැයි පරීක්ෂා කර එය ඇතුලත් කරන්න.
* **Tailscale සම්බන්ධ නොවේ නම්:** `TS_AUTHKEY` කල් ඉකුත් වී හෝ වැරදි දැයි පරීක්ෂා කරන්න.
* **VNC Password ගැටළු:** `VNC_PASS` අගය අකුරු 8කට වඩා වැඩි ශක්තිමත් මුරපදයක් බව තහවුරු කරගන්න.

## 8. Session එක අවසන් කිරීම
RDP Session එක අවසන් කිරීමට අවශ්‍ය වූ විට:
* අදාල Github Action Run එක විවෘත කර, ඉහළ දකුණු කෙළවරේ ඇති `Cancel workflow` බොත්තම ක්ලික් කරන්න.
* මෙවිට `Cleanup` පියවර ක්‍රියාත්මක වී සියළුම තාවකාලික දත්ත මකා දැමීම සුරක්ෂිතව සිදු කරයි.

---
**වත්මන් තත්ත්වය (Current Status):** `BLOCKED_BY_CONFIGURATION` (ඔබ අත්‍යවශ්‍ය Secrets ලබා දෙන තුරු).
