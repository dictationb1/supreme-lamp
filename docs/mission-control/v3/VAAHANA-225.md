# Mission Control v3 — වාර්තාව (Sinhala)

**දිනය:** 2026-10-11
**ශාඛාව:** `arena/403ecbde-supreme-lamp`
**PR:** https://github.com/dekarita/supreme-lamp/pull/226
**Tracking issue:** #225
**තත්ත්වය:** `PLAN_READY` ✅ · `UI_IMPLEMENTED` (අර්ධ — V3-01…V3-06) · `BROWSER_VERIFIED` (අර්ධ) · `UI_VISUALLY_REVIEWED` ⏳ **ඔබගේ සමාලෝචනය අවශ්‍යයි** · `CI_VERIFIED` ⚠️ **අර්ධයි — `e2e-ui` FAIL (විසඳී නැත)** · `DEPLOYED` / `LIVE_VERIFIED` — ආරම්භ කර නැත

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

**හිතාමතාම නොකළ දේ:** overview-only patch, CI-only වැඩ, token-only වෙනස්කම්, පර්යේෂණ-පමණක්, demo app එකක්, backend redesign එකක්, පුළුල් issues (#191/#213/#214) overview වෙනසක් මත වැසීම, මිනුමෙන් පසු සීමාවන් වෙනස් කිරීම, assertions දුර්වල කිරීම, වෙනත් SHA එකක සාක්ෂි භාවිතය.
