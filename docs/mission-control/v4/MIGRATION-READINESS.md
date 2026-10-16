# MIGRATION READINESS - Mission Control v4

මෙම ලේඛනය හරහා v4 සංක්‍රමණයේ (Migration) වත්මන් තත්ත්වය සහ RDP Workflow එක ක්‍රියාත්මක වීමට පෙර සම්පූර්ණ කළ යුතු පියවර විස්තර කෙරේ.

## 1. වත්මන් තත්ත්වය (Current Status)
* **අවසන් වරට ක්‍රියාත්මක වූ Workflow:** `Windows RDP - Tailscale Mission Control (6h ephemeral)` (Run ID: 38882965315).
* **ප්‍රතිඵලය:** `cancelled` (අවලංගු කර ඇත).
* **අසමත් වූ/අවලංගු වූ පියවර:** `F59 parallel pre-warm (Tailscale MSI + prebuilt binaries + PS parse)` පියවර අසමත් විය. පසුව සම්පූර්ණ Workflow එකම අවලංගු කර ඇත.

## 2. හඳුනාගත් ගැටළු (Identified Issues)
1. **අත්‍යවශ්‍ය Secrets නොමැති වීම:**
   * `TS_AUTHKEY` සහ `VNC_PASS` නොමැති නම් workflow එක ක්‍රියාත්මක වීම අසමත් වන ලෙස සකසා ඇත (Fail-closed by design).
   * `RENTRY_EDIT_PASSWORD` පරීක්ෂාව සමත් වුවද, අනෙකුත් අත්‍යවශ්‍ය secrets නොමැති වීමෙන් පසුවන පියවර වලදී ගැටළු මතු වේ.
2. **Pre-warm පියවරේ අසමත් වීම:** Tailscale සහ අදාල binaries භාගත කිරීමේදී ඇති වූ දෝෂයක් හෝ ජාල ගැටළුවක් නිසා `F59 parallel pre-warm` පියවර අසමත් වී ඇත.
3. **Smoke Test අසමත් වීම:** 6h Keep-alive පියවරට ප්‍රථමව ක්‍රියාත්මක වන `F92 smoke` පියවර අසමත් වී ඇත (පෙර පියවරයන් සාර්ථකව අවසන් නොවීම නිසා).

## 3. ඊළඟ පියවර (Next Steps for Operator)
1. **Secrets යාවත්කාලීන කිරීම:** `docs/mission-control/v4/SETUP-GUIDE-si.md` හි සඳහන් උපදෙස් අනුව `TS_AUTHKEY`, `VNC_PASS` සහ අවශ්‍ය නම් `RENTRY_EDIT_PASSWORD` Github Secrets ලෙස එක් කරන්න.
2. **PR #1 තත්ත්වය:** PR #1 (feat(v4): Complete Mission Control v4) දැනට `closed` තත්ත්වයේ පවතී. එහි අඩංගු වූ කේත වෙනස්කම් `main` ශාඛාවට එක් වී (Merged) ඇති බවට තහවුරු කරගන්න. (Head SHA: `d0a544d4...`).

## 4. RDP ක්‍රියාත්මක කරන නිවැරදි ක්‍රමය
මෙම ගැටළු නිරාකරණය කළ පසු, නැවත Workflow එක ක්‍රියාත්මක කිරීමට:
1. Github Actions -> `Windows RDP - Tailscale Mission Control (6h ephemeral)` වෙත යන්න.
2. `Run workflow` ක්ලික් කරන්න.
3. Branch එක ලෙස `main` තෝරාගෙන ආරම්භ කරන්න.
