# R2 — Shipped design tokens (Mornye-inspired glass)

Every number below was **read out of the shipped source** by the commands named
in the last column, not recalled from the reference project or from an earlier
report. Provenance labels are used exactly as the brief requires:

| Label | Meaning |
| --- | --- |
| `SOURCE_INSPIRED` | The *behaviour* is adapted from the reference (SpotiFLAC-Mobile `MornyeGlass`, MIT, pinned `a434e66fa8f30fd8489ee16e3d5d37b492f88edc`). The **number is not** a conversion of a Flutter sigma. |
| `PROPOSED` | This repo's own hypothesis, chosen for CSS. |
| `BROWSER_VALIDATED` | Measured in a real browser. **No value in this table currently carries this label** — see §4 for why, stated plainly rather than implied. |

> **A Flutter sigma is not a CSS blur pixel.** Nothing here claims to be a
> measured Mornye equivalent. The Impeller refraction shader (`liquid_glass_easy`)
> was deliberately **not** ported: CSS has no equivalent, and faking it with
> stacked filters would cost more GPU passes than it buys.

---

## 1. Glass paint — `src/lib/glass/quality.ts`

The ONE paint calculation. `glassPaint({requested, variant, surface, clarity, env})`
is the only function in the repo that turns a preference into pixels; components
receive its output as CSS custom properties and never write `backdrop-filter`
themselves.

### 1.1 Inputs

| Constant | Shipped value | Provenance |
| --- | --- | --- |
| `CLARITY_STEPS` | `0, 0.25, 0.5, 0.75, 1` | SOURCE_INSPIRED (the reference quantizes clarity; a continuous slider would rebuild the filter every frame) |
| `DEFAULT_CLARITY` | `0.75` | SOURCE_INSPIRED (the reference default) |
| `BLUR_THRESHOLD` | `0.5` | SOURCE_INSPIRED (below this, blur is OFF even at non-zero clarity) |
| `DEFAULT_QUALITY` | `auto` → resolves to `frosted` on a capable browser | PROPOSED |
| `NESTED_FILL_FLOOR` | `0.86` | PROPOSED |

### 1.2 Blur radius (`QUALITY_BLUR_PX`, CSS px)

| Quality | Blur | Provenance |
| --- | --- | --- |
| `opaque` | `0px` (no `backdrop-filter` emitted at all) | PROPOSED |
| `frosted` | `8px` | PROPOSED |
| `clear` | `4px` | PROPOSED |

### 1.3 Fill alpha at clarity = 1 (`QUALITY_FILL_ALPHA`)

| Quality | tinted | clear | Provenance |
| --- | --- | --- | --- |
| `opaque` | 1.00 | 1.00 | PROPOSED |
| `frosted` | 0.72 | 0.55 | PROPOSED |
| `clear` | 0.50 | 0.38 | PROPOSED |

Interpolation: `fill = 1 - (1 - table) * clarity`. Tint is **paint, not a
saturation filter** — alpha on `background-color`, never `opacity` on the
element (an element with `opacity < 1` becomes a backdrop root and fades its own
text). That rule is SOURCE_INSPIRED; the alphas are PROPOSED.

### 1.4 Border alpha (`QUALITY_BORDER_ALPHA`)

| Quality | Border alpha | Provenance |
| --- | --- | --- |
| `opaque` | `0` → falls back to the solid `--color-border-default` token | PROPOSED |
| `frosted` | `0.22` × `(0.6 + 0.4·clarity)` | PROPOSED |
| `clear` | `0.28` × `(0.6 + 0.4·clarity)` | PROPOSED |

### 1.5 What actually ships at the default (clarity 0.75)

Computed by running `glassPaint` with the shipped constants
(`node` over the tables above, reproduced verbatim):

| quality | variant | surface | blur | fill α | border α | samples backdrop |
| --- | --- | --- | --- | --- | --- | --- |
| frosted | tinted | backdrop | **8px** | **0.7900** | **0.1980** | **yes** |
| frosted | tinted | nested | 0px | 0.8600 | 0.1980 | no |
| frosted | clear | backdrop | 8px | 0.6625 | 0.1980 | yes |
| frosted | clear | nested | 0px | 0.8600 | 0.1980 | no |
| clear | tinted | backdrop | 4px | 0.6250 | 0.2520 | yes |
| clear | tinted | nested | 0px | 0.8600 | 0.2520 | no |
| clear | clear | backdrop | 4px | 0.5350 | 0.2520 | yes |
| clear | clear | nested | 0px | 0.8600 | 0.2520 | no |
| opaque | any | any | 0px | 1.0000 | 0 (solid border token) | no |

**The compositor budget:** exactly ONE element owns `backdrop-filter` in the
normal shell — the sticky TopBar. Every card below it is `surface="nested"` and
paints paint-only. `src/tests/smoke/r2-overview-redesign.test.tsx` asserts the
Overview contains **0** `[data-glass-samples="1"]` elements and more than 4
nested surfaces, so the budget cannot regress silently.

### 1.6 Clear vs Tinted produce a real difference

At the default clarity the two variants differ by **0.1275 fill alpha** on
frosted/backdrop (0.7900 vs 0.6625) and **0.0900** on clear/backdrop
(0.6250 vs 0.5350). That is a visible difference, not a rounding artifact.

---

## 2. Surface tokens — `src/styles/tokens.css`

| Token | Light | Dark | Provenance |
| --- | --- | --- | --- |
| `--glass-tint-rgb` | `255 255 255` | `15 23 42` | PROPOSED (space-separated triple so components write `rgb(var(--glass-tint-rgb) / a)`) |
| `--glass-edge-rgb` | `15 23 42` | `148 163 184` | PROPOSED |
| `--glass-shadow` | `0 2px 8px rgba(0,0,0,0.08)` | `0 2px 8px rgba(0,0,0,0.14)` | PROPOSED |
| `--glass-overlay-radius` | `16px` | `16px` | PROPOSED |
| `--glass-saturate` | `1` | `1` | PROPOSED — deliberately 1. The reference tints with paint, not with a saturation filter, so no saturate is applied. |
| `--glass-veil-top` / `-bottom` | `rgba(248,250,252,.55)` / `.72` | `rgba(2,6,23,.62)` / `.84` | SOURCE_INSPIRED technique (blend into the fill rather than filtering backdrop luma); the values are PROPOSED |
| `--glass-backdrop-a..d` | 4 radial gradients, α 0.18/0.16/0.14/0.10 | α 0.26/0.24/0.18/0.14 | PROPOSED |

The decorative backdrop is **CSS-generated** (`radial-gradient` layers in
`.app-backdrop`) and fixed at `z-index: 0` under a `z-[1]` shell. It is **not** a
capture of the RDP desktop, and it is `display: none` under
`prefers-reduced-transparency` and `forced-colors`.

## 3. Radius, spacing, shadow

| Token | Value | Provenance |
| --- | --- | --- |
| `--radius-sm` / `-md` / `-lg` | `4px` / `6px` / `8px` | PROPOSED |
| `--glass-overlay-radius` | `16px` | PROPOSED |
| `--space-1 … --space-16` | 4px grid: 4/8/12/16/20/24/32/48/64 | PROPOSED |
| `--shadow-xs` / `-sm` / `-md` | `0 1px 2px /.05`, `0 1px 2px /.10 + 0 1px 3px /.08`, `0 2px 4px /.10 + 0 1px 2px /.06` | PROPOSED |

The reference's larger radii and `0 8px 32px` shadows were **not** carried over;
v2 already retired that F38/F39 material and #213 §6 keeps the tighter scale.

## 4. Colour, and the contrast repair

`scripts/check-contrast.mjs` recomputes these from `tokens.css` on every run.
It currently prints **18/18 pass**. Values it corrected:

| Token | Was | Now | Worst ratio before → after |
| --- | --- | --- | --- |
| `--color-text-tertiary` (light) | `#64748b` | `#566274` | **4.344:1** → 5.646:1 on `bg-surface-raised` |
| `--color-success` (light) | `#059669` | `#047857` | **3.440:1** → 5.006:1 |
| `--color-danger` (light) | `#dc2626` | `#c81e1e` | **4.408:1** → 5.237:1 |
| `--color-warning` (light) | `#d97706` | `#b45309` | **3.186:1** as text → 4.584:1 |
| `--color-warning-accent` (new) | — | `#d97706` light / `#fbbf24` dark | decoration only |

The reported 4.34:1 tertiary defect was real and is fixed. **Two further light-theme
failures were not in the reported list** — success at 3.440:1 and danger at
4.408:1 — and were found by making the check a script rather than an audit.

**Warning, classified.** `#d97706` satisfied the 3:1 non-text bar and failed the
4.5:1 body-text bar while being used for both. It is now split:
`--color-warning` is text-safe (and therefore also control-safe), and
`--color-warning-accent` is decoration only. The classification is structural:
`check-contrast.mjs` fails the build if `text-warning-accent` or
`color: var(--color-warning-accent)` appears anywhere in `src/`.

No threshold was lowered to make a known-failing ratio pass.

## 5. Fallbacks

Resolved by `resolveQuality()`, in precedence order:

1. `forced-colors: active` → opaque
2. `prefers-reduced-transparency: reduce` → opaque
3. measured frame-time failure (one-way latch, `perfWatchdog`) → opaque
4. `CSS.supports("backdrop-filter")` false → opaque
5. explicit operator choice (`opaque` / `frosted` / `clear`)
6. `auto` → frosted

The opaque presentation is not a blank rectangle: `.glass` falls back to
`--glass-alpha: 1` **with the solid `--color-border-default` border**, so cards
keep their edge, radius and shadow. Preference lives in `localStorage` key
**`ghrdp:glass`** and is never cleared to make a preview look correct.

## 6. What is NOT yet browser-validated, stated plainly

`BROWSER_VALIDATED` is applied to **nothing** in this table. The reason is
recorded rather than papered over:

- This sandbox cannot download a browser. `pnpm exec playwright install chromium`
  fails with `ECONNRESET` to `cdn.playwright.dev`, and `--with-deps` fails
  because the apt packages are unavailable in the image.
- Therefore the blur/alpha values are `PROPOSED`, verified only by (a) the pure
  `glassPaint` unit tests, (b) the built bundle containing the expected CSS, and
  (c) `tests/e2e/r2-visual.spec.ts` in the authorized CI lab.
- `tests/e2e/r2-visual.spec.ts` was checked with `playwright --list` (10 tests
  discovered). **`--list` is not browser execution** and is not counted as such.

When the CI lane runs, its screenshots and the `data-glass-quality-resolved`
assertions are what would move specific values to `BROWSER_VALIDATED`.
