# V3 / e2e-ui lane — ROOT CAUSE and FIX for the single failing spec

**Diagnosed and fixed:** 2026-10-11
**Lane:** `e2e-ui`, step 8, on PR #226 (`arena/403ecbde-supreme-lamp` @ `07e04a7`)
**Fix carried on:** `arena/88d52e64-supreme-lamp` (see §0 for why)

---

## 0. Why this document exists on a different branch

This session is bound to `arena/88d52e64-supreme-lamp`, whose starting tree
(`881f26b`) contained **none** of the v3 work. It cannot push to PR #226's head
branch. The operator chose to bring the v3 delta onto this branch and open a
successor PR rather than leave the fix unlanded.

Integration was verified before applying, not assumed:

* `881f26b` (this branch), `origin/main` (`a26aa9c`) and the v3 base `acb27c8`
  differ **only** by the bot-maintained `docs/status.json` timestamp — so no
  `main` work is lost or reverted by taking the v3 delta.
* The delta (67 files) does not touch `docs/status.json`; this branch's copy was
  preserved byte-for-byte.
* Applied as `git diff --binary acb27c8 07e04a7` (3-way); every hunk clean. The
  resulting tree equals `07e04a7`'s tree plus `docs/status.json` plus this file.

## 1. Evidence (from PR #226's own CI run, at the run's SHA)

The log blob host is blocked from agent sandboxes, but the workflow's own
**check-run annotations** are readable and carry the failure. This is the channel
`tests/f203-e2e-lane.test.js` (rule F203-f) exists to guarantee:

```
gh api repos/dekarita/supreme-lamp/check-runs/114420650385/annotations
```

Verbatim:

```
F79-E2E-FAIL1::  1) [chromium] › tests/e2e/r2-visual.spec.ts:67:9 ›
  R2 visual acceptance › 1. Overview at phone (390x844) ::
  Error: the header must be compact, not a hero ::
  Expected: < 80 | Received:   84
```

| Field | Value |
|---|---|
| run id | `38122739344` |
| job id | `114420650385` |
| head SHA | `07e04a7` |
| failing step | `8 — Run F78 + F79 E2E specs (real bundle + mock backend)` |
| job window | 2026-10-11T07:50:41Z → 07:57:02Z |
| other lanes at that SHA | `gates` pass · `windows-native` pending · 4 labs pass |

**Exactly one spec failed.** `F79-E2E-FAIL1` is the only `F79-E2E-FAIL*`
annotation emitted. Deterministic, not a flake — consistent with the earlier
finding that an empty commit re-triggered the lane on an identical tree and it
failed again.

## 2. The assertion

`tests/e2e/r2-visual.spec.ts` line 90, inside the viewport loop whose test
declaration is line 67:

```ts
const headerBox = await page.locator('[data-testid="overview-header"]').boundingBox();
expect(headerBox!.height, "the header must be compact, not a hero").toBeLessThan(80);
```

`VIEWPORTS` = phone 390×844, phoneLandscape 844×390, tablet 768×1024, desktop
1440×900. The same `<80` ceiling applies to all four. **Only `phone` failed.**

The spec file is **byte-identical** on `881f26b` and `07e04a7` — v3 did not touch
the gate; it changed the component the gate measures.

## 3. Root cause — measured, not inferred

V3-01 replaced the Overview's flat header row with the shared
`src/components/primitives/PageHeader.tsx`, which puts title + live status +
actions in **one `flex-wrap` row** and adds a purpose line **beneath** it.

Measured on the built bundle in this sandbox, Chromium 153, phone 390×844:

| Catalog | header | title row | subtitle | actions wrapped | `<80` |
|---|---|---|---|---|---|
| EN (before fix) | **56** | 36 | 16 | no | pass |
| SI (before fix) | **100** | 64 | 32 | **yes** | **fail** |

Row geometry before the fix, EN phone:

| Element | width |
|---|---|
| title row content box | 358 |
| title (`Overview`) | 71 |
| connection chip | 92 |
| actions link (`Frosted / Tinted / 75%`, `min-h-[36px]`) | 169 |
| **slack before the actions slot** | **2 px** |

The actions element ended at `x=374` in a 390px viewport with a 16px gutter —
**flush against the gutter, with 2px to spare.** Any font-metric difference
between environments flips that row into a wrap. On the CI runner's Chromium it
did; in this sandbox's Chromium it did not. That is why the previous session
could run the full suite green locally and still see red on CI, and why the
browser binary looked like the only suspect.

The wrap cost is exactly the CI delta:

| | px |
|---|---|
| title row, line 1 (title + chip) | 20 |
| `gap-y-2` between the wrapped lines | 8 |
| title row, line 2 (the 36px link) | 36 |
| **title row wrapped** | **64** |
| `PageHeader` `gap-1` | 4 |
| subtitle, one line | 16 |
| **total = CI's reported value** | **84** |

Confirmed by direct measurement in Sinhala, where the title row wraps **without
any font difference at all**: 64 + 4 + 32 (subtitle wraps to two lines) = **100**.

`mb-4` is a margin, so `boundingBox().height` never counted it.

## 4. Is the gate wrong, or the header?

**The gate is right, and it was not touched.** Its ceiling stays `<80` everywhere.

`docs/mission-control/v3/DESIGN-SYSTEM.md` specifies title 16px (*"the page name
is not a hero"*), purpose 12px, *"page top padding 20 px (no decorative hero)"*,
controls 32/36/44px. A conformant header is one 36px control row + 4px + purpose
= 56px. The 84 (EN, CI) and 100 (SI, everywhere) both come from an **extra row
created by an unintended wrap**, which the design system does not describe.

So this is **not** the "obsolete structural gate" case. The invariant is still
valid; the component drifted from it. Raising 80 → 85 would have been changing a
threshold after measurement to hide a regression.

Two real defects were exposed, not one:

1. **CI red** — the EN phone header had 2px of slack, so it was one font metric
   away from wrapping. Fragile by construction, environment-dependent in effect.
2. **A Sinhala phone layout bug that no gate could see** — 100px, over budget,
   on every browser, because `r2-visual.spec.ts` never sets `ghrdp:lang`. The
   product's own primary language shipped a header 25% over its budget and
   nothing caught it.

## 5. The fix

**`src/components/primitives/PageHeader.tsx`** — the purpose line is bounded to
two lines (`line-clamp-2`) and exposes its full text through `title` when it is a
plain string. The full string stays in the DOM, which is what
`src/tests/smoke/v3-shell.test.tsx` asserts on (`textContent.trim().length > 10`)
for all eleven routes.

**`src/components/overview/OverviewHeader.tsx`** — below `sm` the painted
presentation summary is withdrawn and the link becomes icon-only
(`sr-only … sm:not-sr-only`). Nothing is removed: the summary text stays in the
DOM and becomes part of the link's `aria-label`, so a phone user still hears
which presentation is active and keeps the same one-tap route to Settings. The
summary string is computed once and used for both the painted label and the
accessible name, so the two cannot disagree.

No i18n key was added or removed — the fix reuses
`overview.glassSettings.{title,summary}` and `pages.overview.purpose`. The 1213
flat-key parity lock is untouched, so the six pin files did not need bumping.

## 6. Measured result (built bundle, Chromium 153, this sandbox)

| Catalog | viewport | header | title row | subtitle | wrapped | overflowX | `<80` |
|---|---|---|---|---|---|---|---|
| en | phone 390×844 | 56 | 36 | 16 | no | 0 | **PASS** |
| en | phoneLandscape 844×390 | 56 | 36 | 16 | no | 0 | **PASS** |
| en | tablet 768×1024 | 56 | 36 | 16 | no | 0 | **PASS** |
| en | desktop 1440×900 | 56 | 36 | 16 | no | 0 | **PASS** |
| si | phone 390×844 | **72** | 36 | 32 | no | 0 | **PASS** |
| si | phoneLandscape 844×390 | 56 | 36 | 16 | no | 0 | **PASS** |
| si | tablet 768×1024 | 56 | 36 | 16 | no | 0 | **PASS** |
| si | desktop 1440×900 | 56 | 36 | 16 | no | 0 | **PASS** |

Slack before the actions slot at phone 390px:

| Catalog | before | after |
|---|---|---|
| en | 2 px | **151 px** |
| si | negative (wrapped) | **100 px** |

The font-metric sensitivity that flipped CI is gone by two orders of magnitude,
not by a margin of one pixel.

Independently corroborated by `scripts/v3-screenshots.cjs`, which re-ran against
the rebuilt bundle: `07-overview-mobile` `.docHeight` **2555 → 2527 (−28px)**,
exactly the wrap delta, while its `bodyText` is **unchanged** (the summary is
withdrawn from paint, not from the document) and `variantProof` is
**byte-identical** to the committed evidence (sheet 0.745→0.61, card 0.824→0.69,
Δ0.135) — so the glass material system is unaffected by this change.

## 7. New gate: `tests/e2e/v3-header-budget.spec.ts`

Nine tests. The `<80` ceiling is the **same** R2 number, hard-coded, not
re-derived from a measurement of the current build — a budget set to whatever the
code happens to do is not a budget. It pins, per catalog × per viewport:

1. header height `< 80`;
2. the actions slot shares the title row (the wrap mechanism itself, asserted
   directly rather than only through its effect on height);
3. the header was not made small by **deletion** — title, connection chip and
   actions all present, connection state labelled, purpose line non-empty, and a
   clamped purpose line still exposes its full text via `title`;
4. the summary withdrawn from paint at phone width is still in the DOM and still
   carried in the link's accessible name;
5. no horizontal overflow;
6. `html[lang]` actually follows the requested catalog — otherwise this is an
   English test wearing a Sinhala label, which is how the 100px header shipped.

A tenth assertion pins the responsive contract itself: withdrawn from paint at
phone (≤2px), painted at desktop (>50px), so the fix cannot be silently replaced
by something that hides the summary at every width.

### Regression evidence (required, and performed)

Both fixed component files were reverted to their `07e04a7` state, the bundle was
rebuilt, and the new spec re-run. **All 9 tests fail**, with these first errors:

| Test | Assertion that fired |
|---|---|
| si / phone | `si/phone header height` — `toBeLessThan(80)` ← **the budget itself** |
| en / phone | `a clamped purpose line must still expose its full text` |
| en / phoneLandscape, en / tablet, en / desktop, si / phoneLandscape, si / tablet, si / desktop | `the link accessible name must carry the presentation summary` |
| paint contract | `phone: summary is withdrawn from paint` |

The fix was then restored and the suite re-run green. The Sinhala phone case
fails on the height budget **deterministically in this sandbox**, which is what
makes it a usable local reproduction of the same wrap CI hit in English.

Honest caveat: the EN phone *height* assertion does **not** fail locally when the
fix is reverted, because this sandbox's Chromium gives the old layout 56px. The
EN 84px only reproduces on the CI runner's Chromium. Locally the EN case is
caught by the accessible-name, `title` and paint assertions instead.

## 8. Gates, all re-run on the fix commit

| Gate | Result |
|---|---|
| `pnpm run build` (tsc + vite) | PASS — `ui/dist/index.html` 1,201.80 kB |
| `pnpm exec vitest run` | PASS — **103 files / 1351 tests**, 0 fail |
| `node --test tests/*.test.js` | PASS — **835 tests, 809 pass, 26 skip, 0 fail** |
| `node scripts/check-glass-contrast.mjs` | PASS — 1432 composited checks, worst text 4.97:1, worst control 5.14:1 |
| `pnpm run e2e` with `CI=true` | PASS — **144 passed, 11 skipped, 0 failed** (5.0m) |

`144 = 135` (the recorded baseline at `07e04a7`) `+ 9` (the new spec). The
baseline vitest / node / contrast numbers are unchanged, i.e. nothing was traded
away for this fix.

## 9. Environment note — a repair to `scripts/v3-screenshots.cjs`

The screenshot script launches Chromium through `@sparticuz/chromium`'s Lambda
arg list. Under Chromium 153 + puppeteer-core 25 in this sandbox the browser dies
before the CDP handshake (WebSocket close 1006, surfacing as a 30s
`Target.setDiscoverTargets` timeout). `mod.args` as shipped fails, and so does
`mod.args` minus `--single-process`.

The launcher now passes an explicit, documented arg list — the flags Playwright
uses to drive the same binary successfully here. There is **no silent fallback
chain**: if the browser cannot start the script fails, so a pixel sample can never
be fabricated from a half-initialised compositor. The `--disable-gpu` in that list
is the reason `variantProof` was re-checked against the committed values rather
than trusted; it reproduces them exactly (§6).

`@sparticuz/chromium` and `puppeteer-core` are **not** dependencies of this repo
and were not added to `package.json` or `pnpm-lock.yaml`. They were installed
outside the tree and symlinked into the gitignored `node_modules`, so the PR's
dependency surface is unchanged and `pnpm install --frozen-lockfile` in CI is
unaffected.

## 10. Status (kept separate, per the standing contract)

| Status | Value |
|---|---|
| `PLAN_READY` | ✅ |
| `UI_IMPLEMENTED` | ✅ V3-01…V3-06 plus this header-budget fix |
| `BROWSER_VERIFIED` | ⚠️ partial — Chromium viewport + UA emulation on 8 viewport×catalog combinations. `REAL_DEVICE` = **NOT_MEASURED**; Playwright Chromium is not an iPhone |
| `UI_VISUALLY_REVIEWED` | ⏳ **operator required** — the agent cannot see images; every visual claim here comes from `measurements.json` and computed geometry |
| `CI_VERIFIED` | ❌ **NOT met** — the five local gates are green, but no CI lane has run on the fix commit yet. `07e04a7`'s `e2e-ui` was FAIL and `windows-native` was pending |
| `DEPLOYED` / `LIVE_VERIFIED` | not started |

Still unfinished, named rather than omitted: **V3-03** Sinhala copy parity for
the Settings section headings and About/provenance labels (English-only by
deliberate choice, not yet revisited); **V3-04** the 5,000-file explorer
contract; **V3-07** real-device evidence; **V3-08** perf budget — both
**NOT_MEASURED**, no CPU throttling and no low-end device was used.

Nothing was dispatched, merged, closed or deployed to produce this document.
