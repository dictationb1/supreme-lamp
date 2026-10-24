# Mission Control UI අළුත්වැඩියාව — 2026-10-25

**ශාඛාව:** `arena/b462ed7a-supreme-lamp`
**පදනම:** `451e8136c97f80563df5cf40fc9f6ed9f05eaa4d` (main, PR #73 ඒකාබද්ධ වූ `d3f13d4` ඇතුළත්)
**කේත commit (මෙම වාර්තාව ලියන විට):** `af483d2e7771df1055224edf7636518c2d1b61ac`
**PR:** https://github.com/dictationb1/supreme-lamp/pull/79

මෙම කාර්යයේ අරමුණ තනි එකකි: **පෙන්වන තත්ත්වය සත්‍ය වීම.** තිර රුවෙහි
“Live” ශීර්ෂය, “Connection failed”, “launcher beacon received”, 4625 සිදුවීමක්
සහ “the host rejected the stored credential” (0s කලින් ලෙස) එකවර පෙනුණි.
ඒ සියල්ල සැබෑ නිෂ්පාදකයන්ගෙන් ආ නමුත්, වැරදි විෂය පථයකින්, වැරදි ඔරලෝසුවකින්
සහ වැරදි විශ්වාසයකින් එකට එකතු කර තිබුණි. දැන් ඒවා වෙන් වෙන්ව, සාක්ෂියේ
වයස සහ සම්බන්ධතාව (correlation) සමඟ පෙන්වයි.

## ගොනු දර්ශකය

| ගොනුව | අන්තර්ගතය |
|---|---|
| `FINAL-REPORT-si.md` | සම්පූර්ණ සිංහල අවසන් වාර්තාව (අවශ්‍ය පරිදි වෙන් කර ඇත) |
| `defects-and-reproductions.md` | දෝෂ 6ක්, පෙර/පසු ප්‍රතිනිර්මාණය සහ මූලාශ්‍ර සාක්ෂිය |
| `state-data-source-map.md` | OS සිදුවීම → backend → API → store → badge/issue → action දක්වා සිතියම |
| `coverage-audit.md` / `coverage-audit.csv` | 2026-10-24 `feature-coverage.csv` හි PASS පේළි 17ක නැවත-ශ්‍රේණිගත කිරීම (මුල් ඉතිහාසය ඉවත් නොකර) |
| `acceptance-matrix.csv` | මෙම වාර්තාවේ සැබෑ පිළිගැනීම් න්‍යායපත්‍රය (PASS/FAIL/BLOCKED/NOT_RUN) |
| `verification-log.md` | ධාවනය කළ නිශ්චිත විධාන, ප්‍රතිඵල සහ අනන්‍යතා (SHA, ගොනු hash) |
| `replay-and-rollback.md` | නැවත ධාවනය කරන ආකාරය සහ ආපසු හැරවීම |
| `manifest.json` | යන්ත්‍ර-කියවිය හැකි සාරාංශය + checksums |
| `SHA256SUMS` | මෙම නාමාවලියේ ගොනු සියල්ලේ SHA256 |

## කෙටි සාරාංශය

* **සම්බන්ධතා තත්ත්වය** දැන් සත්‍ය වේ: වෙනත් ගිණුමක/මූලාශ්‍රයක 4625 එකක්
  මෙම සේවාලාභියාගේ සම්බන්ධතාව අසාර්ථක කළ නොහැක; console (LogonType 2/11)
  පිවිසුමක් RDP සාක්ෂිය ලෙස නොපෙන්වයි; මැරුණු collector එකක් “පිවිසුමක් නැත”
  ලෙස නොපෙන්වයි.
* **සිදුවීම් වල වයස** සිදුවීමේ වේලාවෙන් ගණනය වේ — නැවත-පෝලිම් කිරීමෙන්
  “0s ago” ලෙස නැවත නොපිහිටයි. එකම සිදුවීම එකම incident එකක් ලෙස පවතී.
* **WebSocket** තත්ත්ව 6ක්: `pending` / `supported` / `unsupported` /
  `pool-unavailable` / `unauthorized` / `unknown`. `ws=false` යනු “මෙම build එකේ
  /ws නැත” යැයි තවදුරටත් අර්ථ නොදැක්වේ.
* **RDP** සම්බන්ධතා මාර්ගය (listener, NLA, cert, ticket, launcher) ස්පර්ශ කර
  නැත. පරිශීලකයා වාර්තා කරන සාර්ථක සම්බන්ධතාව ආරක්ෂා වේ.
