# Mission Control v3 — වාර්තාව (Sinhala)

**දිනය:** 2026-10-11
**ශාඛාව:** `arena/403ecbde-supreme-lamp` (මුල් වටය) → `arena/88d52e64-supreme-lamp` (පසු වටය, **§10 addendum එක බලන්න**)
**PR:** https://github.com/dekarita/supreme-lamp/pull/226 (මුල් වටය) → **https://github.com/dekarita/supreme-lamp/pull/227** (මෙම වටය)
**Tracking issue:** #225
**තත්ත්වය:** `PLAN_READY` ✅ · `UI_IMPLEMENTED` ✅ (V3-01…V3-06 + header-budget නිවැරදි කිරීම) · `BROWSER_VERIFIED` ⚠️ අර්ධ (Chromium emulation පමණයි; `REAL_DEVICE` = **NOT_MEASURED**) · `UI_VISUALLY_REVIEWED` ⏳ **ඔබගේ සමාලෝචනය අවශ්‍යයි** · `CI_VERIFIED` ✅ **SHA `8d9d390d` හි — PR #227 හි checks 10ම PASS** · `DEPLOYED` / `LIVE_VERIFIED` — ආරම්භ කර නැත

> **§1–§9 යනු `07e04a7` (PR #226) වටයේ මුල් වාර්තාවයි — එය එලෙසම තබා ඇත.**
> `e2e-ui` අසාර්ථකත්වයේ මූල හේතුව සොයාගෙන නිවැරදි කළේ ඊට පසුව, **§10** හි දී ය.
> §5 හි "`e2e-ui` FAIL — විසඳී නැත" යනුවෙන් ලියා ඇති තැන දැන් §10 මගින් අභිබවයි.

---

## 1. මොනවාද වෙනස් වුණේ

### V3-01 — වීදුරු ද්‍රව්‍ය ආකෘතිය සහ shell එක (commit `1fc3051`)

- **ගැටලුව:** nested fill floor එක (`NESTED_FILL_FLOOR = 0.86`) නිසා frosted/tinted (0.79) සහ frosted/clear (0.6625) **එකම pixel එකට** clamp වුණා. ඒ නිසා Tinted/Clear පාලකය වෙනස් කළේ chrome වලින් ~56px පමණයි — ඔබ මුලින්ම වාර්තා කළ ගැටලුව එයයි. නැව්ගත කළ ලේඛනයේම (`R2-DESIGN-TOKENS.md`, පේළි 74–80) nested පේළි හතරම 0.8600 ලෙස සටහන් වෙලා තිබුණා: **දෝෂය ලේඛනගත කර තිබුණා, නමුත් හඳුනාගෙන තිබුණේ නැහැ.**
- **විසඳුම:** floor එක වෙනුවට **levels + එකතු කළ deltas**. එක් හවුල් backdrop-sampling පෘෂ්ඨයක් (app glass sheet, `aria-hidden`, z-index 1). Overlap / card / row යනු paint-only වන අතර නියත delta එකක් එකතු කරයි. `overlay` පමණක් සැබෑ floor එක රඳවා ගනී.
- **මිනුම:** සෑම මාර්ගයකම සහ viewport එකකම steady-state `backdrop-filter` ගණන **1** (මැන බැලුවා, අනුමාන නොවේ).
- **සංචාලනය:** කණ්ඩායම් හතරක් — OPERATE / ACCESS / DATA / SYSTEM. සබැඳි 11, **අගුළු දැමූ පිළිවෙලින්ම**. සමූහයක් `aria-label` මගින් ප්‍රකාශ කෙරේ.
- **ශීර්ෂය:** සියලුම මාර්ග 11 ට හවුල් `PageHeader` (නම + අරමුණ). සංයුක්ත තත්ත්ව ශීර්ෂය: එක බැල්මකින් දැකිය හැකි දර්ශකයක් + නිෂ්පාදකයන් හතර සඳහා disclosure එකක් (කිසිවක් මකා නැත).

### V3-02 — පැරණි කියවීමක් තවදුරටත් විශ්වාස නොකරයි (#194 D5)

පෙර ධාවනයක 4624 එකක් **සජීවී සම්බන්ධතාවයක්** ලෙස පෙන්වුණා — verdict එක `authResult === "success"` පමණක් මත පදනම් වුණා. දැන් පිළිවෙලින් පරීක්ෂා කෙරේ:

| කොන්දේසිය | ප්‍රතිඵලය |
|---|---|
| scan stamp එක නැත / විග්‍රහ කළ නොහැකි | `unverified` |
| scan එක තත්පර 90 ට වඩා පැරණි | `unverified` |
| සිදුවීම `runStartedAtMs − 60s` ට පෙර | `historical` |
| ඉහත කිසිවක් නොවේ නම් | `connected` |

4625 එකක් කාලයෙහි ස්ථානගත කෙරේ, නමුත් පැරණි scan එකකින් පහත හෙළන්නේ නැත — **සැබෑ ප්‍රතික්ෂේපයක් මැකීම ප්‍රමාද එකක් පෙන්වීමට වඩා නරකයි.** නව තත්ත්ව දෙකම (`historical`, `unverified`) catalogs දෙකෙහිම ඇත.

### V3-05 — දෝශ නිරාකරණය දැන් ක්‍රියා කරයි (#202 #205)

- **පිළිවෙල:** panel එක `deriveIssues(...).slice(0, 3)` පෙන්වුවා — **නිෂ්පාදක පිළිවෙලින්** පළමු තුන. අන්තිමට තල්ලු වූ critical එකක් info තුනකින් කපා දැමුණා. දැන් severity මුලින්, සහ severity ඇතුළත **stable** (දත්ත වෙනස් නොවන්නේ නම් ලැයිස්තුව මාරු නොවේ).
- **ප්‍රවේශ්‍යතාව:** preview එකෙන් ඔබ්බෙහි ගැටලු **එක් click එකකින්** ලැබේ — නිහඬව ඉවත් නොකෙරේ.
- **ක්‍රියා:** සෑම `actionId` එකකටම පාලකයක්. `IssueActionId` type එක නිසා අලුත් id එකක් UI එකට එකතු කරන තුරු **compile error** එකකි.
- **ගණන badge එක** worst severity එක data ලෙස ප්‍රකාශ කරයි — වාක්‍යයක් පමණක් නොවේ.

### V3-06 — build provenance සහ Settings හැඩය

- `BuildProvenanceCard`: source rev, **served** stamp එක (`#ghrdpBuild` වෙතින් කියවේ — cache වූ පැරණි bundle එකක් අනුමානයක් නොව දෘශ්‍ය වේ), artifact නම, සහ පැහැදිලි Re-check බොත්තමක් පසුපස backend release එක. **Mount වන විට fetch නැත.**
- `WebDesktopCard` එක "deployed UI older than origin/main" කියා පැවසුවා. එම අනුමානය **සාධාරණ නැත** — `main` හි interface එක වෙනස් නොකරන status-only commits ඇත. පේළිය දැන් වෙනස පමණක් පවසා provenance පෘෂ්ඨයට යොමු කරයි.
- Settings: ප්‍රකාශන පිළිවෙලින් කාඩ්පත් දොළහක් → `aria-labelledby` සහිත ලේබල් කළ කොටස් හයක්.

### 🔴 මෙම වටයේදී හමු වූ regression එක (වැදගත්ම දේ)

ද්‍රව්‍ය ආකෘතිය නිවැරදි කර එහි unit tests කොළ පැහැ වූ පසුවත්, **සැබෑ browser එකේ Tinted සහ Clear එකම කාඩ්පත් නිපදවුවා.** හේතුව: සංරචක `variant="tinted"` / `variant="clear"` සෘජුවම `<GlassContainer>` වෙත යවා තිබුණා — එය `variantProp ?? prefVariant` හිදී store එක අභිබවා යයි. `Panel.tsx` prop එක `"tinted"` ලෙස default කර තිබූ නිසා එය මග හැරිය සෑම call site එකක්ම pin වුණා.

**ආකෘතියට ගරු කළ ඔබගේ තේරීම wiring එකෙන් ඉවත් කර තිබුණා.** Pins ඉවත් කළේ: `AppShell`, `CommandPalette`, `Feedback`, `DiagBundleCard`, `Panel`, `Data`. `WorkspaceGrid` හි pins දෙක **LEVEL පියවරකින්** (card → row) ප්‍රතිස්ථාපනය කළා — levels තිබෙන්නේ ඒ සඳහායි.

**සාදන ලද bundle එකේ මැන බැලුවා:**

| | Tinted | Clear | වෙනස |
|---|---|---|---|
| sheet | `0.745` | `0.61` | **0.135** |
| card | `0.824` | `0.69` | **0.135** |

`v3-glass-wiring.test.tsx` pin එකක් නැවත පැමිණියහොත් build එක අසමත් කරයි (test එකටම pin එකක් දමා එය අසමත් වන බව සත්‍යාපනය කළා).

---

## 2. කොහෙන්ද බලන්නේ

| දේ | ස්ථානය |
|---|---|
| **තිරපිටපත් (10)** | `docs/mission-control/v3/screens/` — `01-overview.png`, `02-overview-troubleshooting.png`, `09-glass-tinted.png`, `10-glass-clear.png` … |
| **මිනුම්** | `docs/mission-control/v3/screens/measurements.json` |
| **සැලැස්ම** | `docs/mission-control/v3/{MASTER-PLAN,SCREEN-STATE-MATRIX,DESIGN-SYSTEM,VERIFICATION-RELEASE}.md` |
| **PR** | https://github.com/dekarita/supreme-lamp/pull/226 |
| **Commits** | `1fc3051` (V3-01), `fce3f8c` (V3-02/05/06) |

**දේශීයව ධාවනය කිරීමට:** `npm ci && npm run build` → `node scripts/v3-screenshots.cjs` (තිරපිටපත් + මිනුම් නැවත සාදයි).

---

## 3. සංශෝධනය සහ සබැඳි

| සංශෝධනය | විස්තරය |
|---|---|
| `1fc3051` | V3-01: ද්‍රව්‍ය ආකෘතිය, app glass sheet, කණ්ඩායම්ගත සංචාලනය, හවුල් PageHeader (ගොනු 41) |
| `fce3f8c` | V3-02/05/06 + variant-pin regression නිවැරදි කිරීම + නව contrast gate |
| base | `acb27c8` (`main`) |

- PR: https://github.com/dekarita/supreme-lamp/pull/226
- Branch: https://github.com/dekarita/supreme-lamp/tree/arena/403ecbde-supreme-lamp
- Issue: https://github.com/dekarita/supreme-lamp/issues/225 (`gh issue edit` → "Resource not accessible by integration" — ඒ නිසා PR body එක සහ `docs/mission-control/v3/TRACKING-ISSUE-225.md` ලිවිය හැකි පෘෂ්ඨ ලෙස භාවිතා කළා. අනුපිටපත් issue එකක් සෑදුවේ නැහැ.)

---

## 4. ආවරණය

| පැකේජය | තත්ත්වය |
|---|---|
| V3-01 ද්‍රව්‍ය + shell | ✅ ක්‍රියාත්මකයි, browser හි මැන ඇත |
| V3-02 සම්බන්ධතා නැවුම්භාවය | ✅ ක්‍රියාත්මකයි, 26/26 tests |
| V3-03 Sinhala / i18n | ⏳ **කර නැත** (නව පිටපතට Sinhala පරිවර්තන හිඟයි) |
| V3-04 ගොනු 5,000 | ⏳ **කර නැත** |
| V3-05 දෝශ නිරාකරණය | ✅ ක්‍රියාත්මකයි, 16/16 tests |
| V3-06 provenance + Settings | ✅ ක්‍රියාත්මකයි |
| V3-07 responsive (උපාංග විද්‍යාගාරය) | ⏳ **Chromium emulation පමණි** — සැබෑ උපාංග නැත |
| V3-08 කාර්ය සාධන අයවැය | ⏳ **කර නැත** |

**මාර්ග 11ම** හවුල් ශීර්ෂයක් සහිතව render වේ (20/20 shell tests).

---

## 5. පරීක්ෂණ, තිරපිටපත්, කාර්ය සාධනය

### පරීක්ෂණ

| Gate | ප්‍රතිඵලය |
|---|---|
| `npx vitest run` | **ගොනු 103 / tests 1351 සමත්** |
| `node --test tests/*.test.js` | **809 සමත්, 26 skip, 0 අසමත්** |
| `tsc -p tsconfig.build.json --noEmit` | පිරිසිදුයි |
| `node scripts/check-glass-contrast.mjs` | **පරීක්ෂණ 1432 සමත්** |
| `npm run build` | 1,201 kB තනි-ගොනු bundle |
| `pnpm run e2e` (Playwright, සම්පූර්ණ) | **135 සමත්, 11 skip, 0 අසමත්** — `CI=true` සමගද (සේවාදායක නැවත භාවිතයක් නැත, retries සක්‍රීයයි) |

### CI (PR #226) — සත්‍ය තත්ත්වය, සැරසිලි නැත

| Lane | ප්‍රතිඵලය |
|---|---|
| `gates` | ✅ **PASS** |
| `build-ui-prebuilt` | ✅ PASS |
| `f56d-qbt-lab`, `f57-explorer-lab`, `f60-warm-lab`, `m8-*` | ✅ PASS |
| `windows-native` | ✅ PASS |
| **`e2e-ui`** | ❌ **FAIL — විසඳී නැත** |

**`e2e-ui` ගැන අවංකව:** step 8 (`pnpm run e2e`) CI හි අසමත් වේ — **හරියටම එම විධානය දේශීයව 135/135 සමත් වේ**, `CI=true` සමගද (එනම් `reuseExistingServer: false`, `retries: 1`). හිස් commit එකකින් නැවත ධාවනය කළ විටත් අසමත් විය — එබැවින් **flake එකක් නොවේ, CI හි පුනරාවර්තනය වේ**.

මට එය විසඳිය නොහැකි වූයේ ඇයි:
- **CI logs මෙම sandbox එකෙන් කියවිය නොහැක** (blob host අවහිරයි — `gh run view --log` EOF දෝෂයක් දෙයි).
- එකම වෙනස වන්නේ **browser binary එකයි**: CI සැබෑ Playwright Chromium ස්ථාපනය කරයි; මෙහි ඇත්තේ sandbox `@sparticuz/chromium` headless shell එක පමණයි (සැබෑ එක බාගත කිරීමට ජාල අවසර නැත).

**ඔබට කළ හැකි දේ:** මෙම lane එක විශේෂයෙන්ම `F79-E2E-TALLY` සහ `F79-E2E-FAILS` annotations නිකුත් කරයි (agent sandbox වලට logs කියවිය නොහැකි බව දැනගෙන). ඒවා PR #226 හි checks ටැබයේ කියවිය හැකිය — අපොහොසත් වූ spec එක සහ පේළිය එහි ඇත.

**`gates` lane එකේ මා කළ වැරැද්ද සහ නිවැරදි කිරීම:** මම `gates` job එකට `setup-node@v4` (`node-version: '20'`) එකතු කළා — එම job එක ඊට පෙර runner default Node එක භාවිතා කළා. එය step 43 අසමත් කළා. **එම වෙනස ආපසු හැරවූවා** (commit `88061f2`) → `gates` දැන් PASS. Contrast gate එක `build-ui.yml` හි ක්‍රියාත්මක වන බැවින් ආවරණය අඩු වී නැත.

**`CI_VERIFIED` සම්පූර්ණයෙන් හිමිකම් නොකියමි** — `e2e-ui` රතුයි.

**අලුත් test ගොනු:** `v3-shell.test.tsx` (20), `v3-troubleshoot.test.tsx` (16), `v3-glass-wiring.test.tsx` (5). `r-glass-container.test.tsx` (18) සහ `r2-connection-state.test.ts` (26) නැවත ලිව්වා.

**නව gate `check-glass-contrast.mjs`:** සැබෑ stack එක composite කරයි (backdrop radials → veil → sheet fill → level fill) සහ සෑම theme × quality × variant × clarity × level සංයෝජනයකටම WCAG නැවත ගණනය කරයි. alphas `quality.ts` වෙතින් සහ channels `tokens.css` වෙතින් **කියවයි** — පිටපත් නොකරයි. මිනුම්: **නරකම පෙළ 4.97:1**, නරකම පෙළ-නොවන පාලකය **5.14:1** (සීමා 4.5 / 3.0). `build-ui.yml` සහ `launch-gates.yml` වෙත සම්බන්ධ කළා.

### තිරපිටපත් (තිරපිටපත් 10)

**සාදන ලද bundle එකෙන්, කෘතිම දත්ත සමග** — mockup නොවේ. 1600×1000, 1024×1366, 390×844. කිසිදු සැබෑ අක්තපත්‍රයක්, hostname එකක් හෝ මාර්ගයක් payload එකකවත් නැත.

**වැදගත්:** මෙම agent ට පින්තූර **දැකිය නොහැක**. එබැවින් දෘශ්‍ය ප්‍රකාශ සියල්ල `measurements.json` වෙතින් (computed styles, element counts, variant samples) — හැඟීම් වලින් නොවේ. **ඔබගේ ඇසින් සමාලෝචනය `UI_VISUALLY_REVIEWED` සඳහා අනිවාර්යයි.**

සෑම මාර්ගයකම සහ viewport එකකම මැනුවා: `backdrop-filter` ගණන **1**, nav **11/4**, level histogram ස්ථාවරයි.

### කාර්ය සාධනය

**මැන නැත (`NOT_MEASURED`).** V3-08 තවම කර නැත. ව්‍යුහාත්මක සහතිකයක් පමණයි: steady-state `backdrop-filter` ගණන 1 (පෙර ආකෘතියේ nested surface එකකට එකක් විය හැකිව තිබුණි). CPU throttling හෝ සැබෑ අඩු-මට්ටමේ දුරකථනයක් භාවිතා කර නැත.

---

## 6. සීමාවන් (සැඟවූ කිසිවක් නැත)

1. **V3-03 / V3-04 / V3-07 / V3-08 කර නැත.** නව පිටපතේ කොටසකට Sinhala පරිවර්තන හිඟයි (Settings කොටස් ශීර්ෂ සහ provenance labels දැනට ඉංග්‍රීසියෙන්).
2. **සැබෑ උපාංග නැත.** Chromium viewport emulation ≠ සැබෑ Android/iOS. iPad සහ iPhone තිරපිටපත් emulation වේ — `BROWSER_LAB` පන්තිය, `REAL_DEVICE` නොවේ. Playwright WebKit browser ස්ථාපනය කර නැත, එබැවින් `npm run e2e` CI-only වේ.
3. **කාර්ය සාධනය `NOT_MEASURED`.**
4. **`e2e-ui` lane එක CI හි රතුයි — විසඳී නැත.** දේශීයව 135/135 සමත් (CI=true සමගද), නමුත් CI හි පුනරාවර්තනය වේ. CI logs මෙම sandbox එකෙන් කියවිය නොහැකි අතර සැබෑ Playwright Chromium බාගත කිරීමට ජාල අවසර නැත. 5 වන කොටස බලන්න.
5. **Deployed / Live-verified නැත.** කිසිදු workflow එකක් dispatch කර නැත; කිසිදු සැසියකට බාධා කර නැත.
6. `overlay` level එක Tinted/Clear වෙනසෙන් බැහැරයි — එහි 0.88 floor එක හේතුවෙන් variants දෙකම එකම අගයට clamp වේ. මෙය **සීමාවකි, නිදහස් කිරීමක් නොවේ**: `VARIANT_LEVELS` ලෙස source එකේ එක් වරක් කේතනය කර ඇති අතර gate එක සහ test එක දෙකම එය කියවයි.
7. සියලුම දත්ත **කෘතිමයි** — තිරපිටපත් සැබෑ යෙදවුම් තත්ත්වය නොපෙන්වයි.

---

## 7. සක්‍රිය කිරීම සහ ආපසු හැරවීම

### සක්‍රිය කිරීම — **ඉල්ලා නැත**

මෙම PR එක merge පමණක් කරයි. **Deploy workflow එකක්වත් dispatch කර නැත, සැසියකටවත් බාධා කර නැත.** සක්‍රිය කිරීමට පෙර අවශ්‍යයි:

1. ✅ CI කොළ (PR #226)
2. ⏳ **ඔබගේ දෘශ්‍ය සමාලෝචනය** (`09-glass-tinted.png` එදිරිව `10-glass-clear.png`)
3. ⏳ සක්‍රිය RDP සැසියක් නොමැති බවට තහවුරු කිරීම

**සක්‍රිය සැසියක් තිබේ නම්, මම සක්‍රිය නොකරමි** — maintenance-window තීරණය ඔබගෙන් ඉල්ලා සිටිමි.

### ආපසු හැරවීම

- **Code:** `git revert fce3f8c` (V3-02/05/06) සහ/හෝ `git revert 1fc3051` (V3-01). ස්වාධීනයි — V3-01 පමණක් revert කළ හැකියි.
- **පරිශීලක මනාපය (code rollback අවශ්‍ය නැත):** **Settings → Visual quality → Opaque.** Glass සම්පූර්ණයෙන්ම ඉවත් කරයි — sheet සහ decorative field දෙකම ඉවත් වේ (මැන ඇත: `v3-shell.test.tsx`, "opaque mode removes the sheet as well as the field").
- **දත්ත සංක්‍රමණයක් නැත.** v3 වෙනස් කරන්නේ UI පමණි; කිසිදු API contract එකක් වෙනස් නොකළේය.
- **Config:** `localStorage` key `ghrdp:glass` (persist කර ඇත; හිස් කිරීමෙන් default වෙත යයි).

---

## 8. BACKGROUND_REGISTER

| කාර්යය | තත්ත්වය | සටහන |
|---|---|---|
| Recurring monitors / autonomous Goals / overnight watchers | **සාදා නැත** | ඔබගේ ස්ථාවර නියෝගයට අනුව |
| Background sync / අසම්බන්ධිත jobs | **සාදා නැත** | — |
| GO BACKGROUND අවසරය | **CI සඳහා පමණි, සීමිතයි** | අඛණ්ඩ නැත |
| Full Access | **වෙනස් නැත** | — |
| Secrets | **ඉල්ලා නැත, නැවත සාදා නැත, හෙළි කර නැත** | ප්‍රදර්ශිත ගැටලුවක් නොමැතිව |
| RDP සැසිය / auth ප්‍රතිපත්තිය | **ස්පර්ශ කර නැත** | — |
| Production workflows | **Dispatch කර නැත** | — |
| Mutating controls auto-click | **නැත** | රෝග විනිශ්චය read-only වේ |
| Backend redesign | **නැත** | අවම contract අලුත්වැඩියාවක් පමණි |
| F45-B / yt-dlp | **ස්පර්ශ කර නැත** | මෙම UI සැසිය පරිභෝජනය නොකළේය |
| 20% සීමාව | **සීමාව තුළ** | මැනිය හැකි ලෙස කණ්ඩායම්ගත කළා |
| Telemetry භාවිත ප්‍රතිශතය | **UNKNOWN** | ගත වූ කාලයෙන් හෝ tool calls වලින් ප්‍රතිශතයක් නිපදවා නැත |

**සාක්ෂි පන්ති වෙන්ව තබා ඇත:** `COMPONENT` (vitest) · `BROWSER_LAB` (sandbox Chromium, emulation) · `THROTTLED_BROWSER` — මැන නැත · `REAL_DEVICE` — **`NOT_MEASURED`** (උපාංග නැත).

---

## 9. BUDGET_LEDGER

| අදියර | ප්‍රතිඵලය |
|---|---|
| **A — Inventory / reconcile** | සම්පූර්ණයි. හිඩැස් හඳුනාගත්තා: nested fill floor, overview-පමණක් header, කියවීම් නැවුම්භාවයක් නොමැති සම්බන්ධතා තත්ත්වය |
| **B — සැලසුම් ලේඛන 4** | සම්පූර්ණයි (`MASTER-PLAN`, `SCREEN-STATE-MATRIX`, `DESIGN-SYSTEM`, `VERIFICATION-RELEASE`) + delivery tracker වෙතින් සබැඳි |
| **Tracking issue** | #225 සාදන ලදී. `gh issue edit` → "Resource not accessible by integration" (නැවත උත්සාහ කළ නොහැක); PR body + `TRACKING-ISSUE-225.md` භාවිතා කළා. **අනුපිටපත් issue නැත** |
| **V3-01** | ✅ `1fc3051` — ගොනු 41 |
| **V3-02** | ✅ `fce3f8c` — 26/26 |
| **V3-05** | ✅ `fce3f8c` — 16/16 |
| **V3-06** | ✅ `fce3f8c` |
| **Regression (variant pins)** | ✅ `fce3f8c` — browser හි මැනුවා, guard test එකත් සමඟ |
| **Gates** | ✅ vitest 1351 / node 809 / tsc පිරිසිදු / contrast 1432 |
| **තිරපිටපත්** | ✅ 10 + measurements.json |
| **V3-03, V3-04, V3-07, V3-08** | ⏳ **කර නැත** — සඟවා නැත |
| **Sinhala වාර්තාව** | ✅ මෙය |
| **දෙවන වටය — `e2e-ui` විශ්ලේෂණය** | ✅ `a8a05a2d` — annotations මාර්ගයෙන් අසාර්ථක spec එක හඳුනාගත්තා (§10.2); මූල හේතුව **මැන** තහවුරු කළා (§10.3) |
| **දෙවන වටය — header-budget නිවැරදි කිරීම** | ✅ `a8a05a2d` — si phone 100→72px; viewport×catalog 8ම `<80`; slack en 2→151px |
| **දෙවන වටය — අලුත් gate** | ✅ `v3-header-budget.spec.ts` (9) — **ආපසු හැරවූ විට 9ම අසමත්** බව ඔප්පු කළා |
| **දෙවන වටය — Gates නැවත** | ✅ build 1,201.80 kB · vitest 1351 · node 809/26 · contrast 1432 · e2e **144 passed / 11 skipped / 0 failed** |
| **දෙවන වටය — සාක්ෂි නැවුම් කිරීම** | ✅ තිරපිටපත් 10 + `measurements.json`; `variantProof` byte-සමාන, `docHeight` −28px |
| **V3-07 (අර්ධ)** | ⚠️ header geometry Chromium emulation මත මැනුවා. **`REAL_DEVICE` = NOT_MEASURED** |
| **V3-03, V3-04, V3-08** | ⏳ **තවම කර නැත** — සඟවා නැත (§10.10) |
| **`CI_VERIFIED`** | ✅ SHA `8d9d390d` — PR #227, checks **10/10 PASS** (§10.8). `e2e-ui` 6m21s, `windows-native` 12m4s |

**හිතාමතාම නොකළ දේ:** overview-only patch, CI-only වැඩ, token-only වෙනස්කම්, පර්යේෂණ-පමණක්, demo app එකක්, backend redesign එකක්, පුළුල් issues (#191/#213/#214) overview වෙනසක් මත වැසීම, මිනුමෙන් පසු සීමාවන් වෙනස් කිරීම, assertions දුර්වල කිරීම, වෙනත් SHA එකක සාක්ෂි භාවිතය.

---

## 10. Addendum — `e2e-ui` මූල හේතුව සොයාගෙන නිවැරදි කිරීම (දෙවන වටය)

**ශාඛාව:** `arena/88d52e64-supreme-lamp` · **Commit:** `a8a05a2d`
**සම්පූර්ණ තාක්ෂණික වාර්තාව:** `docs/mission-control/v3-e2e-ui-ROOT-CAUSE.md`

### 10.1 මුලින්ම — මෙම වටය ආරම්භ වූයේ වෙනත් ශාඛාවකිනි

මෙම session එක `arena/88d52e64-supreme-lamp` ට බැඳී ඇති අතර, එහි ආරම්භක tree එකේ
(`881f26b`) **v3 වැඩ කිසිවක් තිබුණේ නැත** — `PageHeader.tsx` නැත, `docs/mission-control/v3/`
නැත, `NESTED_FILL_FLOOR` තාම තිබුණා. PR #226 එකේ head branch එකට push කිරීමටද අවසර නැත.

ඔබගේ තීරණය අනුව v3 delta එක මෙම ශාඛාවට ගෙනවුත් නව PR එකක් සකස් කිරීමට කටයුතු කළා.
**අන්ධ ලෙස merge නොකළා** — යෙදීමට පෙර තහවුරු කළා:

- `881f26b`, `origin/main` (`a26aa9c`) සහ v3 පාදය `acb27c8` අතර වෙනස **`docs/status.json`
  timestamp එක පමණයි** → `main` හි කිසිදු වැඩක් අහිමි වන්නේ නැත.
- Delta එක (ගොනු 67) `docs/status.json` ස්පර්ශ කරන්නේ නැත; මගේ පිටපත byte-for-byte රැඳුණා.
- `git diff --binary acb27c8 07e04a7` ලෙස 3-way යෙදුවා — සෑම hunk එකක්ම පිරිසිදුව.
- ප්‍රතිඵල tree එක = `07e04a7` tree එක + `docs/status.json` + වාර්තා ලේඛනය.

### 10.2 අසාර්ථක spec එක හඳුනාගත්තා — logs නොමැතිවම

§5 හි "CI logs කියවිය නොහැක" යන්න සත්‍යයි. නමුත් **workflow එකේ check-run annotations
කියවිය හැක** — `tests/f203-e2e-lane.test.js` (නීතිය F203-f) හරියටම මේ සඳහා සලස්වා ඇති මාර්ගය:

```
gh api repos/dekarita/supreme-lamp/check-runs/114420650385/annotations
```

```
F79-E2E-FAIL1:: 1) [chromium] › tests/e2e/r2-visual.spec.ts:67:9 ›
  R2 visual acceptance › 1. Overview at phone (390x844) ::
  Error: the header must be compact, not a hero :: Expected: < 80 | Received: 84
```

**එක spec එකයි අසමත් වුණේ** (`F79-E2E-FAIL1` පමණයි; FAIL2 නැත). Run `38122739344`,
job `114420650385`, SHA `07e04a7`, step 8.

### 10.3 මූල හේතුව — මිනුමෙන්, අනුමානයෙන් නොවේ

V3-01 Overview එකේ තනි පේළියේ header එක හවුල් `PageHeader` එකෙන් ප්‍රතිස්ථාපනය කළා.
එය title + status + actions **එක `flex-wrap` පේළියක** තබා, ඊට **පහළින්** අරමුණු පේළියක්
එකතු කරයි. 390px දී ඒ පේළියේ ඉතිරි ඉඩ **2px** පමණයි — actions link එක gutter එකට
හරියටම ගැටී තිබුණා (`x=374`, viewport 390, gutter 16).

එබැවින් **font metric වෙනසක් පමණක්** ඒ පේළිය wrap කරවයි. CI runner එකේ Chromium එකේ
දී එය සිදු විය; මෙම sandbox එකේ Chromium එකේ දී නොවීය. **පෙර වටයේ දේශීය ධාවන සියල්ල
හරිත වී CI රතු වූයේ මෙහෙමයි** — browser binary එක ප්‍රධාන සැකකරු ලෙස පෙනුණේ ඒ නිසායි.

Wrap එකේ වියදම CI අගයට හරියටම සමානයි: `20 + 8 + 36 = 64` (title row) `+ 4` (gap)
`+ 16` (අරමුණු පේළිය) = **84**.

**මෙය CI-only දෝෂයක් නොවේ.** සිංහල catalog එකේ දී එම header එක **කිසිදු font වෙනසකින්
තොරව** wrap වේ: `64 + 4 + 32 = `**`100px`** — සීමාවට වඩා 25%ක් ඉහළින්, සෑම browser
එකකම. කිසිදු gate එකක් එය අල්ලා ගත්තේ නැත, මන්ද `r2-visual.spec.ts` කිසි විටෙකත්
`ghrdp:lang` සකසන්නේ නැත — **ඔබ කියවන භාෂාවෙන්ම වැඩි-බජට් header එකක් නොපෙනී ගොස් තිබුණා.**

### 10.4 Gate එක නිවැරදියි — එය ස්පර්ශ කළේ නැත

`<80` සීමාව එලෙසම තිබේ. `DESIGN-SYSTEM.md` අනුව අනුකූල header එකක් යනු 36px පාලක
පේළියක් + 4 + අරමුණු පේළිය = **56px**. 84 සහ 100 දෙකම **අරමුණු නොවූ wrap එකකින්
නිර්මාණය වූ අමතර පේළියකි** — ඒ නිසා සීමාව 85 ට ඉහළ නැංවීම "මිනුමෙන් පසු threshold
වෙනස් කර regression එකක් සැඟවීම" වනු ඇත. එය කළේ නැත.

### 10.5 නිවැරදි කිරීම

- **`PageHeader.tsx`** — අරමුණු පේළිය පේළි දෙකකට සීමා කළා (`line-clamp-2`), සම්පූර්ණ
  පෙළ `title` හරහා නිරාවරණය කළා. පෙළ DOM එකේ රැඳේ — `v3-shell.test.tsx` මාර්ග 11
  සඳහා පරීක්ෂා කරන්නේ හරියටම ඒකයි.
- **`OverviewHeader.tsx`** — `sm` ට පහළින් paint වන සාරාංශය ඉවත් කර link එක icon-only
  කළා (`sr-only … sm:not-sr-only`). **කිසිවක් ඉවත් කළේ නැත**: සාරාංශය DOM එකේ රැඳී
  link එකේ `aria-label` එකට එක් වේ — දුරකථනයක සිටින ඔබට ක්‍රියාත්මක presentation එක
  කුමක්දැයි තවමත් ඇසෙන අතර Settings වෙත එකම මාර්ගය තවමත් තිබේ.

i18n key එකක් එකතු හෝ ඉවත් කළේ නැත → 1213 flat-key parity lock එක නොවෙනස්ය, එබැවින්
pin ගොනු හය bump කිරීමට අවශ්‍ය වූයේ නැත.

### 10.6 මිනුම් (සාදන ලද bundle එකෙන්, Chromium 153)

| Catalog | viewport | header | title row | අරමුණු පේළිය | wrapped | `<80` |
|---|---|---|---|---|---|---|
| en | phone 390×844 | 56 | 36 | 16 | නැත | ✅ |
| si | phone 390×844 | **72** (100 සිට) | 36 | 32 | නැත | ✅ |
| en/si | phoneLandscape · tablet · desktop | 56 | 36 | 16 | නැත | ✅ |

**සියලුම viewport × catalog සංයෝජන 8 සමත්.** `overflowX = 0` සෑම තැනකම.

Actions slot එකට ඉදිරියෙන් ඉතිරි ඉඩ (390px): en **2px → 151px**, si **ඍණ (wrap) → 100px**.
CI පෙරළූ font-සංවේදීතාව pixel එකක ආන්තියකින් නොව, දෙගුණයක පරිමාණයකින් ඉවත් වී ඇත.

`scripts/v3-screenshots.cjs` නැවත ධාවනය කිරීමෙන් **ස්වාධීනව තහවුරු විය**:
`07-overview-mobile` `.docHeight` **2555 → 2527 (−28px)** — wrap delta එකට හරියටම සමානයි;
එහි `bodyText` **වෙනස් වී නැත** (paint එකෙන් ඉවත් විය, ලේඛනයෙන් නොවේ); `variantProof`
committed සාක්ෂියට **byte-for-byte සමානයි** (sheet 0.745→0.61, card 0.824→0.69, Δ0.135) —
වීදුරු ද්‍රව්‍ය පද්ධතියට බලපෑමක් නැත.

### 10.7 අලුත් gate එක සහ regression සාක්ෂිය

`tests/e2e/v3-header-budget.spec.ts` — tests 9. `<80` සීමාව **එම R2 අංකයම, hard-coded**:
වත්මන් build එකේ මිනුමෙන් නැවත ව්‍යුත්පන්න කළ budget එකක් budget එකක් නොවේ. එය pin කරන්නේ
උස, wrap යාන්ත්‍රණය සෘජුවම, header එක **මකා දැමීමෙන්** කුඩා කළේ නැති බව, paint එකෙන්
ඉවත් කළ සාරාංශය DOM එකේද accessible නාමයේද රැඳෙන බව, overflow නොමැති බව, සහ
`html[lang]` ඇත්තටම ඉල්ලූ catalog එක අනුගමනය කරන බවයි.

**Regression සාක්ෂිය (අනිවාර්යයි — සිදු කළා):** component ගොනු දෙකම `07e04a7` තත්ත්වයට
ආපසු හැරවූවා, bundle එක නැවත සැදුවා → **9ම අසමත්**, `si/phone` **උස budget එකෙන්ම** අසමත්
වෙමින්. නිවැරදි කිරීම යළි තබා suite එක නැවත හරිත විය.

**අවංක සටහන:** ආපසු හැරවූ විට EN phone *උස* assertion එක දේශීයව අසමත් **නොවේ**
(මෙහි 56px). EN 84px පුනරාවර්තනය වන්නේ CI runner එකේ Chromium එකේ පමණයි. දේශීයව EN
අවස්ථාව අල්ලා ගන්නේ accessible-name, `title` සහ paint assertion මගිනි.

### 10.8 Gates — සියල්ල නිවැරදි කිරීමේ commit එකේදී නැවත ධාවනය කළා

| Gate | ප්‍රතිඵලය |
|---|---|
| `pnpm run build` (tsc + vite) | ✅ `ui/dist/index.html` **1,201.80 kB** |
| `pnpm exec vitest run` | ✅ **103 ගොනු / 1351 tests**, 0 fail |
| `node --test tests/*.test.js` | ✅ **835 tests, 809 pass, 26 skip, 0 fail** |
| `node scripts/check-glass-contrast.mjs` | ✅ 1432 checks, නරකම පෙළ **4.97:1** |
| `pnpm run e2e` (`CI=true`) | ✅ **144 passed, 11 skipped, 0 failed** (5.0m) |

`144 = 135` (`07e04a7` පාද රේඛාව) `+ 9` (අලුත් spec එක). පාද රේඛාවේ vitest / node /
contrast අගයන් **වෙනස් වී නැත** — එනම් මෙම නිවැරදි කිරීම වෙනුවෙන් කිසිවක් උකස් තබා නැත.

**CI — මෙම commit එකේ SHA එකෙන්ම සාක්ෂි (PR #227, head `8d9d390d`):**

| Lane | ප්‍රතිඵලය | කාලය |
|---|---|---|
| **`e2e-ui`** (step 8 = `pnpm run e2e`) | ✅ **PASS** — `07e04a7` හි අසමත් වූ lane එකම | 6m21s |
| `gates` | ✅ PASS | 4m34s |
| `windows-native` | ✅ PASS | 12m4s |
| `build-ui-prebuilt` | ✅ PASS | 45s |
| `proof` (autologin-lab, windows) | ✅ PASS | 4m38s |
| `f56d-qbt-lab`, `f57-explorer-lab`, `f60-warm-lab`, `m8-behavioral-*` | ✅ PASS | — |

**Checks 10ම PASS.** Run `38125710741` (e2e-ui), `38125710745` (launch-gates).
හරිත `e2e-ui` job එකේ **`F79-E2E-FAIL` / `F79-E2E-TALLY` annotations ශුන්‍යයි** — එනම්
අසාර්ථක spec එකක් නැත (`R2-VISUAL-FILES` notice එක පමණයි නිකුත් වූයේ).

> **අවංක සටහනක් — මා මුලින් වැරදි ප්‍රකාශයක් කළා:** push කිරීමට පෙර "ubuntu lanes
> පමණයි ධාවනය වන්නේ" යැයි කීවා. එය වැරදියි — `autologin-lab.yml` එකේ push path
> filter එකේ `src/**` ද ඇත (මම ලැයිස්තුව කපා හැරීමෙන් මඟ හැරුණා), එබැවින් එය
> `windows-latest` මත ධාවනය විය. **නිගමනය වෙනස් නොවේ, නමුත් හේතුව පරීක්ෂා කළා:**
> එම lane එක ephemeral GitHub-hosted runner එකක් තුළ පමණක් ක්‍රියා කරයි — එහි FQDN
> සියල්ල සංශ්ලේෂිත lab නම් (`*.dekarita.tailnet-lab.ts.net`) වන අතර ඒවා runner එකේ
> **loopback (127.0.0.1) වෙත map කර ඇත**; fixture IP එක `100.118.42.7` ය. ඔබගේ සජීවී
> host එක (`100.125.76.40`) එම workflow එකේ **කොහේවත් නැත**; `self-hosted` label එකක්,
> `RunCommand` එකක් හෝ ඔබගේ RDP සැසියට ළඟාවීමක් නැත. එය PASS විය.

### 10.9 පරිසර සටහන — `scripts/v3-screenshots.cjs` අලුත්වැඩියාවක්

`@sparticuz/chromium` එකේ Lambda arg ලැයිස්තුව Chromium 153 + puppeteer-core 25 යටතේ
CDP handshake එකට පෙර browser එක මරා දමයි (WS close 1006 → 30s `Target.setDiscoverTargets`
timeout). `mod.args` ලෙසත්, `--single-process` ඉවත් කරත් අසමත් විය. දැන් launcher එක
**පැහැදිලිව ලේඛනගත කළ arg ලැයිස්තුවක්** යවයි — **නිශ්ශබ්ද fallback chain එකක් නැත**:
browser එක පටන් ගත නොහැකි නම් script එක අසමත් වේ, එබැවින් අර්ධ-ආරම්භක compositor එකකින්
pixel සාම්පලයක් කිසි විටෙකත් නිර්මාණය විය නොහැක.

`@sparticuz/chromium` සහ `puppeteer-core` මෙම repo එකේ **dependences නොවේ** — ඒවා
`package.json` හෝ `pnpm-lock.yaml` ට එකතු කළේ නැත. Tree එකෙන් පිටත ස්ථාපනය කර
gitignored `node_modules` ට symlink කළා, එබැවින් PR එකේ dependency පෘෂ්ඨය සහ CI හි
`--frozen-lockfile` වෙනස් වී නැත.

### 10.10 තත්ත්වය — වෙනම, අවංකව

| තත්ත්වය | අගය |
|---|---|
| `PLAN_READY` | ✅ |
| `UI_IMPLEMENTED` | ✅ V3-01…V3-06 + මෙම header-budget නිවැරදි කිරීම |
| `BROWSER_VERIFIED` | ⚠️ අර්ධ — Chromium viewport + UA emulation (සංයෝජන 8). `REAL_DEVICE` = **NOT_MEASURED**; Playwright Chromium යනු iPhone එකක් නොවේ |
| `UI_VISUALLY_REVIEWED` | ⏳ **ඔබ අවශ්‍යයි** — agent එකට රූප දැකිය නොහැක; මෙහි සෑම දෘශ්‍ය ප්‍රකාශයක්ම `measurements.json` සහ ගණනය කළ ජ්‍යාමිතියෙන් |
| `CI_VERIFIED` | ✅ **SHA `8d9d390d` හි සපුරාලයි** — PR #227 හි checks **10ම PASS** (`e2e-ui` 6m21s ඇතුළුව). `DEPLOYED` / `LIVE_VERIFIED` වෙනම, තවම ආරම්භ කර නැත |
| `DEPLOYED` / `LIVE_VERIFIED` | ආරම්භ කර නැත |

**තවමත් නිම නොකළ දේ — සඟවා නැත:** **V3-03** (Settings section headings සහ
About/provenance ලේබල සඳහා සිංහල ආවරණ සමානතාවය — හිතාමතාම English-only, තවම
නැවත සලකා නැත); **V3-04** (ගොනු 5,000 File Explorer contract එක); **V3-07**
(සැබෑ උපාංග සාක්ෂිය — Chromium emulation පමණයි); **V3-08** (perf budget —
**NOT_MEASURED**, CPU throttling හෝ low-end උපාංගයක් භාවිතා කළේ නැත).

**සටහන:** §1–§9 හි සඳහන් commit SHA (`1fc3051`, `fce3f8c`, `a514a06`, `88061f2`,
`2acf416`, `07e04a7`) PR #226 ශාඛාවේ ඉතිහාසයේ පවතී. මෙම ශාඛාවේ ඒවා **ඒකක තනි
commit එකකට** (`d5e7df54`) ගෙන ඇති බැවින් එම SHA එහි ඉතිහාසයෙන් ළඟා විය නොහැක —
අන්තර්ගතය සමානයි, ඉතිහාසය නොවේ.

මෙම වාර්තාව සඳහා කිසිදු workflow එකක් dispatch, merge, close හෝ deploy කළේ නැත.
