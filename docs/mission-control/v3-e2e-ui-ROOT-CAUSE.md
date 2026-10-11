# V3 / e2e-ui lane — ROOT CAUSE of the single failing spec

**Diagnosed:** 2026-10-11
**Affects:** PR #226 (`arena/403ecbde-supreme-lamp` @ `07e04a7`), lane `e2e-ui`, step 8
**Diagnosis class:** read-only. Nothing was changed on the PR branch to produce this.

> This document was produced from a session bound to a **different** branch
> (`arena/88d52e64-supreme-lamp`, tree `881f26b`), which contains **none** of the
> v3 work. It therefore cannot push the fix. It records the diagnosis and a
> concrete patch for the session/operator that owns `arena/403ecbde-supreme-lamp`.

---

## 1. Evidence (from PR #226's own CI run, at the run's SHA)

The log blob host is blocked from agent sandboxes, but the workflow's own
**check-run annotations** are readable via the REST API and carry the failure:

```
gh api repos/dekarita/supreme-lamp/check-runs/114420650385/annotations
```

Result (verbatim):

```
F79-E2E-FAIL1::  1) [chromium] › tests/e2e/r2-visual.spec.ts:67:9 ›
  R2 visual acceptance › 1. Overview at phone (390x844) ::
  Error: the header must be compact, not a hero ::
  Expected: < 80 | Received:   84
```

Run/job identity:

| Field | Value |
|---|---|
| run id | `38122739344` |
| job id | `114420650385` |
| head SHA | `07e04a7` |
| failing step | `8 — Run F78 + F79 E2E specs (real bundle + mock backend)` |
| job window | 2026-10-11T07:50:41Z → 07:57:02Z |
| other lanes | `gates` pass · `windows-native` pending · 4 labs pass |

**Exactly one spec failed.** `F79-E2E-FAIL1` is the only `F79-E2E-FAIL*`
annotation emitted; there is no FAIL2/FAIL3. This is a single deterministic
assertion failure, not a suite-wide or flake pattern — consistent with the
earlier finding that an empty commit re-triggered the lane and it failed again.

## 2. The assertion

`tests/e2e/r2-visual.spec.ts`, inside the `for (const [label, vp] of Object.entries(VIEWPORTS))`
loop that begins the test at **line 67**; the failing expectation is at **line 90**:

```ts
// (c) No unexplained empty hero area: the first content surface must
//     begin within the first viewport third, below the top bar.
const headerBox = await page.locator('[data-testid="overview-header"]').boundingBox();
expect(headerBox!.height, "the header must be compact, not a hero").toBeLessThan(80);
```

`VIEWPORTS` = phone 390×844, phoneLandscape 844×390, tablet 768×1024, desktop 1440×900.
The same `<80` ceiling applies to all four. **Only `phone` failed** —
phoneLandscape, tablet and desktop passed it. That is the decisive clue: the
header is compact at every width except 390px, so this is a **wrap** induced by
narrow width, not a uniformly taller v3 header.

The spec file itself is **byte-identical** on `881f26b` and `07e04a7`
(`git diff HEAD FETCH_HEAD -- tests/e2e/r2-visual.spec.ts` is empty). The v3 work
did not touch the gate; it changed the component the gate measures.

## 3. Root cause

V3-01 replaced the Overview's bespoke header row with the shared
`src/components/primitives/PageHeader.tsx`.

**Before (pre-v3, still present on `881f26b`)** — one flat wrapping row:

```tsx
<header data-testid="overview-header"
        className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
  <h2 className="text-base font-semibold leading-none text-primary">…</h2>
  <Chip id="overview-conn-state" …/>
  <Link … className="ml-auto inline-flex min-h-[36px] …"/>
</header>
```

**After (v3, on `07e04a7`)** — `PageHeader` is a two-row `flex-col`:

```tsx
<header className="flex flex-col gap-1 mb-4">        {/* gap-1 = 4px */}
  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
    <h2 className="text-base … leading-none"/>        {/* title 16px */}
    <div data-testid="…-status" className="flex flex-wrap items-center gap-2">
      <Chip/>                                         {/* connection state */}
    </div>
    <div data-testid="…-actions" className="ml-auto flex flex-wrap items-center gap-2">
      <Link className="inline-flex min-h-[36px] …">   {/* glass summary, 36px */}
    </div>
  </div>
  <p data-testid="…-subtitle" className="text-xs text-tertiary"/>  {/* purpose, 12px */}
</header>
```

At 390px the title row must fit `Overview` + the connection `Chip` + an
`ml-auto` bordered `Link` whose label is the interpolated
`overview.glassSettings.summary` = `"{{quality}} / {{variant}} / {{clarity}}"`
(e.g. `Frosted / Tinted / 74%`). It does not fit, so the outer `flex-wrap`
pushes the **actions slot onto its own row**, and the new **subtitle row** is
added below. Height decomposition:

| Component | px |
|---|---|
| title row, line 1 (`h2` 16px / `Chip`) | 20 |
| `gap-y-2` between wrapped lines | 8 |
| title row, line 2 (`Link` at `min-h-[36px]`) | 36 |
| `PageHeader` `gap-1` | 4 |
| subtitle `<p>` line box (`text-xs` → 16px) | 16 |
| **total** | **84** |

`mb-4` (16px) is a **margin**, so it is excluded from `boundingBox().height` —
it does not contribute to the 84. The decomposition reproduces the CI-measured
value **exactly**.

> Evidence class: the 84 is **CI-measured** at SHA `07e04a7`. The decomposition
> above is **inferred from source**, not measured in a browser — this sandbox has
> no `node_modules`, no Playwright browser binary, and no v3 tree. Treat the
> arithmetic as a high-confidence hypothesis to confirm by measurement, not as a
> measurement.

## 4. Is the gate wrong, or is the header wrong?

**The gate is right. Do not loosen it.**

`docs/mission-control/v3/DESIGN-SYSTEM.md` specifies the header contract as:

* `Page title (PageHeader)` — 16px, *"the page name is not a hero"*
* `Page purpose (PageHeader)` — 12px, tertiary
* *"page top padding 20 px (no decorative hero)"*
* control heights: *32px dense, 36px default, 44px minimum primary target*

A v3-conformant phone header is therefore **one control row + one purpose line**
= `36 + 4 + 16` = **56px**, comfortably inside `<80`. The 84 arises from a
*third* row created by an unintended wrap — which the design system does not
describe. So this is a **real phone layout regression introduced by v3**, caught
correctly by an R2-era invariant whose *intent* ("compact, not a hero") the v3
design system still asserts verbatim.

This is **not** the "old structural gate encodes obsolete markup" case. The
invariant is still semantically valid; only the component drifted from it.
Raising 80 → 85 here would be changing a threshold after measurement to hide a
regression, and is explicitly out of bounds.

## 5. Proposed fix (component-side, gate untouched)

Keep the actions slot on the title row at phone width by making the glass
summary compact below `sm`, without removing it from the DOM or from the
accessibility tree.

In `src/components/overview/OverviewHeader.tsx`, the summary `<span>`:

```tsx
<span
  data-testid="overview-glass-summary"
  id="overview-glass-summary"
  className="sr-only sm:not-sr-only sm:inline"
>
  {t("overview.glassSettings.summary", {
    quality: t("glass.quality." + resolved),
    variant: t("glass.variant." + variant),
    clarity: Math.round(clarity * 100) + "%",
  })}
</span>
```

The `Link` keeps its `title` attribute and gains an `aria-label` carrying the
same summary, so the information is not lost on phone — it is announced rather
than painted. Expected phone height: title row stays single-line at 36px →
`36 + 4 + 16` = **56px** < 80. Tablet/desktop are unaffected (`sm:` is ≥640px).

### Safety check already performed

Only two files in the whole `07e04a7` tree reference these ids:
`OverviewHeader.tsx` and `src/tests/smoke/r2-overview-redesign.test.tsx`. The
single test assertion is:

```ts
const summary = screen.getByTestId("overview-glass-summary");
expect(summary.textContent).toMatch(/opaque/i);
```

That is a **textContent** assertion under jsdom, which has no layout engine —
`sr-only` does not remove the node or its text, so it keeps passing. No e2e spec
asserts on `overview-glass-summary` or `overview-glass-settings-link`.

### Alternatives, and why they are worse

* **A. `line-clamp-1` on the subtitle.** Does not help: the subtitle is not what
  wraps. `pages.overview.purpose` = *"Connect, work and diagnose from one
  screen."* (43 chars at 12px) already fits one line at 358px of content width.
* **B. Shorten the `summary` i18n string globally.** Changes desktop/tablet too,
  where nothing is broken, and edits a string other surfaces may rely on.
* **C. `dense` on PageHeader.** Only swaps `mb-4` → `mb-3`, i.e. a margin that
  `boundingBox().height` never counted. Zero effect on the measurement.
* **D. Raise the ceiling to 85.** Forbidden: threshold change after measurement,
  hiding a regression.

## 6. Verification plan (must run on `arena/403ecbde-supreme-lamp`)

Do not push without all of these, at the fix commit's SHA:

1. `pnpm run e2e --reporter=list` with `CI=true` — full suite, expect
   **136 passed / 11 skipped / 0 failed** (was 135 passed; the recovered spec
   adds one). `r2-visual.spec.ts › 1. Overview at phone (390x844)` must pass on
   the **unchanged** `<80` assertion.
2. Record the measured phone header height. It must be ≈56px. If it is not, the
   decomposition in §3 is wrong somewhere — re-diagnose, do not adjust the gate.
3. `npx vitest run` — expect 103 files / 1351 tests, `r2-overview-redesign` green.
4. `node --test tests/*.test.js` — expect 835 tests, 0 fail.
5. `npx tsc -p tsconfig.build.json --noEmit` — clean.
6. `node scripts/check-glass-contrast.mjs` — PASS (the `sr-only` span is not
   painted, so it cannot change any composited contrast pair; confirm anyway).
7. `npm run build`.
8. Refresh `docs/mission-control/v3/screens/07-overview-mobile.png` and
   `measurements.json` via `node scripts/v3-screenshots.cjs`, since the phone
   Overview header changes.
9. Re-check the other 10 routes: `PageHeader` is shared, so confirm no other
   route regressed at 390px. `r2-visual.spec.ts` only measures Overview's
   header — the other routes are covered by `src/tests/smoke/v3-shell.test.tsx`,
   which is structural, not metric. Their phone header heights are
   **NOT_MEASURED** and should be measured before any claim is made about them.

## 7. Status (kept separate, per the standing contract)

| Status | Value |
|---|---|
| `PLAN_READY` | ✅ (PR branch) |
| `UI_IMPLEMENTED` | ⚠️ partial — V3-01…V3-06 on the PR branch |
| `UI_VISUALLY_REVIEWED` | ⏳ operator required; the agent cannot see images |
| `BROWSER_VERIFIED` | ⚠️ partial — Chromium viewport emulation only; `REAL_DEVICE` = **NOT_MEASURED** |
| `CI_VERIFIED` | ❌ **NOT met** — `e2e-ui` FAIL at `07e04a7`; `windows-native` pending |
| `DEPLOYED` / `LIVE_VERIFIED` | not started |

The fix in §5 is **PROPOSED / UNVERIFIED**. It has not been applied, built, or
run anywhere. No evidence in this document comes from a SHA other than `07e04a7`
(the CI facts) and `881f26b` (the pre-v3 baseline used for the diff).
