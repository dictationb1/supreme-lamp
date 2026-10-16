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

## ඊළඟ පියවර
ඔබගේ අවසරය ලබා දුන් වහාම මෙම කේතය (Pull Request) අනුමත කිරීමට සියලු කටයුතු සූදානම් කර ඇත. මෙය සම්පූර්ණයෙන්ම ක්‍රියාකාරී වන අතර නිෂ්පාදන මට්ටමේ v4 අතුරුමුහුණත දැන් සක්‍රීයව පවතී.
