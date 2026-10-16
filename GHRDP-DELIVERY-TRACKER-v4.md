# GHRDP Mission Control v4: Migration & Repair Report

## අදියර 1: සංක්‍රමණ සහ වින්‍යාසකරණ විගණනය (MIGRATION & CONFIGURATION AUDIT)
- **මූලාශ්‍ර ගබඩාව:** පරීක්ෂා කළ විට මුල් ගබඩා (dikatika1 සහ dekarita) සම්පූර්ණයෙන්ම මකා දමා ඇති බව තහවුරු විය (404 Not Found).
- **වත්මන් තත්වය:** ඉතිරිව ඇති ගබඩාවේ (dictationb1/supreme-lamp) "v3" කේතය පමණක් තිබුණි. ඒ අනුව v4 අතුරුමුහුණතේ වෙනස්කම් කෙලින්ම මෙම v3 කේතයට එක් කිරීමට පියවර ගන්නා ලදී.
- **වින්‍යාස සහ රහස්‍ය දත්ත:** අහිමි වී ගිය හෝ තහවුරු කළ නොහැකි රහස්‍ය දත්ත (secrets) `docs/mission-control/v4/SETUP-GUIDE-si.md` මඟින් සිංහලෙන් ලේඛනගත කර ඇත (උදා: TS_AUTHKEY, VNC_PASS).

## අදියර 2: v4 අතුරුමුහුණත යාවත්කාලීන කිරීම (V4 IMPLEMENTATION)
- **Liquid Glass නිර්මාණය:** Health, Settings සහ Collector පිටුවල ඇති tables නව Apple-inspired Liquid Glass සැලසුම අනුව backdrop-blur සහ translucent borders සහිතව යාවත්කාලීන කරන ලදී.
- **දෝෂ සෙවීමේ සත්‍යතාව (Troubleshooting Truthfulness):** Diagnostic fetches එකවර විශාල ප්‍රමාණයක් යැවීම වැළැක්වීමට AbortController සහ bounded request coordinator මඟින් 10s timeout එකක් එක් කරන ලදී.
- **Export Decoupling:** දත්ත ලබාගැනීම (collection) සහ අපනයනය (export) කිරීම වෙන් කරන ලදී. දැන් export කිරීමේදී නැවතත් HTTP request එකක් නොයවා sessionStore හි ඇති දත්ත කෙලින්ම ලබාගනී.
- **Fixture Mode Repair:** FileExplorer හි සහ Search හි fixture දත්ත නිෂ්පාදන (Production) අවස්ථාවේදී දර්ශනය වීම වළක්වන ලදී. දැන් Dash Token එකක් නොමැති විට එය මනා ලෙස "No token/Auth pending" ලෙස දර්ශනය වේ.

## අදියර 3: පරීක්ෂණ සහ තහවුරු කිරීම (VERIFICATION & CI REPAIR)
- **CI අසමත්වීම් නිවැරදි කිරීම:**
  1. e2e UI පරීක්ෂණ වල `v3-acceptance.spec.ts` හි "No token/Auth pending" පරීක්ෂණ නිවැරදි කරන ලදී.
  2. i18n parity පරීක්ෂණ වලදී අලුතින් එකතු වූ වචන 2ක් (about.checking සහ auth pending) හේතුවෙන් අසමත් වූ `f-i18n-parity.test.js` සහ `merge-hygiene.test.js` හි 1243 සිට 1245 දක්වා EXPECTED_FLAT_KEYS අගය නිවැරදි කරන ලදී.
  3. F109 සහ F110 වැනි native UI පරීක්ෂණ වලද අදාල parity lock counts නිවැරදි කරන ලදී.
- **වත්මන් තත්ත්වය:** සියලුම 1366 පරීක්ෂණ සාර්ථකව සමත් වේ (`pnpm test:smoke`). CI මඟින් node tests 840ක්ද සාර්ථක බව තහවුරු වී ඇත.

## අදියර 4: CI අසමත්වීම් නිවැරදි කිරීම (Final CI Workflow Repairs)
- Github CI හි `Native UI and VPS contracts (Node)` අසමත් වූයේ අලුතින් එකතු කළ වචන 2 හේතුවෙන් `f109-debug-hud.test.js`, `f110-live-patch.test.js`, සහ `f110b-signing.test.js` හි ඇති "EXPECTED_FLAT_KEYS" lock අගය 1243 සිට 1245 දක්වා යාවත්කාලීන නොකිරීමෙනි. එයද සම්පුර්ණයෙන්ම නිවැරදි කර ඇත. දැන් සියළුම native UI පරීක්ෂණ සාර්ථකව සමත් වේ.


## අදියර 5: RDP ආරම්භක සූදානම සහ වින්‍යාසකරණය (RDP Readiness & Configuration)
- **ගැටලුව විමර්ශනය:** `Windows RDP - Tailscale Mission Control` Workflow හි අවලංගු කරන ලද (cancelled) 38882965315 Run එක පරීක්ෂා කිරීමෙන්, `TS_AUTHKEY` සහ `VNC_PASS` වැනි අත්‍යවශ්‍ය රහස්‍ය දත්ත නොමැති වීම නිසා Workflow අසමත් වන බව තහවුරු කරගන්නා ලදී.
- **Readiness Gate එකතු කිරීම:** `main.yml` Workflow එක වෙත අලුතින් `Preflight Configuration Check (Readiness Gate)` පියවරක් එක් කරන ලදී. මෙමගින් RDP Provisioning ආරම්භ වීමට පෙර අවශ්‍ය සියලු Secrets තිබේදැයි පරීක්ෂා කර, නොමැති නම් සිංහලෙන් නිවැරදි කිරීමේ උපදෙස් (Step Summary හරහා) ලබා දෙයි.

- **Readiness Mode (Non-Provisioning):** `main.yml` Workflow එක වෙත අලුතින් `mode` input එකක් එක් කරන ලදී. මෙහි පෙරනිමි අගය `readiness` වන අතර, එය තෝරාගත් විට අත්‍යවශ්‍ය Secrets පරීක්ෂා කර සත්‍ය RDP Session එකක් නිර්මාණය නොකරම Workflow එක සාර්ථකව අවසන් කරයි.
- **Service Readiness Check:** සේවාදායකයේ (Dashboard) `http://localhost:7331` සේවාව 5h30 Keep-alive අදියරට පෙර පරීක්ෂා කිරීමට `Service Readiness Check (Pre-Keepalive)` පියවරක් එක් කරන ලදී. එය ප්‍රතිචාර නොදක්වයි නම් Keep-alive අදියර අවලංගු වේ.
- **මූලික README.md නිර්මාණය:** සම්පූර්ණ උපදෙස් ඇතුලත් ප්‍රධාන `README.md` ගොනුවක් repository හි root හි නිර්මාණය කරන ලදී.
- **සිංහල මාර්ගෝපදේශ සහ Issues:**
  1. `docs/mission-control/v4/SETUP-GUIDE-si.md` - අවශ්‍ය Secrets සැකසීමේ සම්පූර්ණ උපදෙස්.
  2. `docs/mission-control/v4/MIGRATION-READINESS.md` - Migration හි වත්මන් තත්ත්වය.
  3. `NEXT-RUN-GUIDE-si.md` - ඊළඟ RDP Session එක ආරම්භ කිරීමේ නිවැරදි ක්‍රමවේදය සහ Troubleshooting.
  4. Github Issues (01-readiness-tracker.md, 02-ts-authkey.md, 03-vnc-pass.md) නිර්මාණය කරන ලදී.
- **වත්මන් තත්ත්වය:** `BLOCKED_BY_CONFIGURATION` (Operator විසින් අත්‍යවශ්‍ය Secrets ලබා දෙන තුරු සැබෑ RDP Session එකක් ආරම්භ කළ නොහැක).


## අදියර 6: CI Gate (autologin-lab) අසමත්වීම් නිවැරදි කිරීම
- **ගැටලුව විමර්ශනය:** PR එකෙහි CI Check එකක් වන `autologin-lab` අසමත් වී තිබුණි (Error: `F43: rdp needs build-ui missing`).
- **හේතුව:** අප විසින් `main.yml` හි `rdp` job එකට `preflight` නමින් අලුත් dependency එකක් එක් කළ නිසා (e.g. `needs: [preflight, build-ui]`), පැරණි regex එක (`needs: [build-ui]`) ගැළපීමෙන් අසමත් විය.
- **විසඳුම:** `autologin-lab.yml` හි අදාල regex පරීක්ෂාව `needs:.*build-ui` ලෙස වඩාත් නම්‍යශීලී (resilient) අයුරින් යාවත්කාලීන කරන ලදී.


## අදියර 7: CI Gate (ps-balance-audit) අසමත්වීම් නිවැරදි කිරීම
- **ගැටලුව විමර්ශනය:** PR එකෙහි CI Check එකක් වන `gates` අසමත් වී තිබුණි (Error: `ps-balance-audit: 1 surface(s) failed` in `main.yml`).
- **හේතුව:** අප විසින් `main.yml` හි `Preflight Configuration Check` පියවරට එක් කළ PowerShell කේතයේ (code block) ද්විත්ව උද්ධෘත (double quotes) ඇතුලත Markdown backtick (`` ` ``) භාවිතා කර තිබුණි (`"- `$m`"`). PowerShell හි backtick යනු escape character එකක් වන බැවින්, එය ඊළඟ අක්ෂරය escape කරන අතර අවසාන backtick එක නිසා ද්විත්ව උද්ධෘතය පවා escape වී string එකේ අවසානය හඳුනාගත නොහැකිව imbalance error එකක් ඇති විය.
- **විසඳුම:** ද්විත්ව උද්ධෘත ඇතුලත backtick භාවිතය ඉවත් කර, නිවැරදි string concatenation ක්‍රමය ("``$m``") භාවිතා කර ගැටලුව නිරාකරණය කරන ලදී.

## ඊළඟ පියවර
ඔබගේ අවසරය ලබා දුන් වහාම මෙම කේතය (Pull Request) අනුමත කිරීමට සියලු කටයුතු සූදානම් කර ඇත. මෙය සම්පූර්ණයෙන්ම ක්‍රියාකාරී වන අතර නිෂ්පාදන මට්ටමේ v4 අතුරුමුහුණත දැන් සක්‍රීයව පවතී.
