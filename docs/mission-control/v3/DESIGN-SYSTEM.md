# Mission Control v3 — DESIGN SYSTEM

Companion to `MASTER-PLAN.md`. Every published number is classified:

* **SOURCE_INSPIRED** — adapted from the Mornye reference (SpotiFLAC-Mobile, MIT). A Flutter
  sigma is **not** a CSS px and the Impeller refraction shader has no CSS equivalent, so no
  value is claimed as a conversion.
* **PROPOSED** — a hypothesis of this repository, chosen for a stated reason.
* **BROWSER_VALIDATED** — measured in real Chromium on the shipped build (see
  `VERIFICATION-RELEASE.md` §4).

## 1. Reference and adaptation boundary

Reference: `github.com/spotiflacapp/SpotiFLAC-Mobile`, Mornye glass
(`lib/widgets/mornye_chrome.dart`, `lib/theme/mornye_theme.dart`), MIT. Adapted, not copied:

| Reference fact (source-derived) | v3 adaptation |
|---|---|
| Three levels: flat / frosted / liquid | flat → **opaque**; frosted → **frosted**; liquid **rejected** (no CSS Impeller lens; stacking filters costs more GPU passes than it buys) |
| Nested glass never samples the backdrop again — "child controls paint on this surface" | `GlassBackdropScope`: any descendant of a sampling surface is forced paint-only |
| Clarity is one clamped, **quantized** 0..1 value | `CLARITY_STEPS = [0, .25, .5, .75, 1]`; a continuous slider would rebuild the filter every frame |
| Below a threshold the blur is off even when clarity is non-zero | `BLUR_THRESHOLD = 0.5` |
| Tint is paint, not a saturation filter | alpha on `background-color`; **never** `opacity` on a text container |
| Blend black into the fill instead of filtering backdrop luma | the `.app-backdrop::after` veil (a gradient, not a filter) |

## 2. The material architecture (this is the v3 fix)

### 2.1 The defect being corrected

Pre-v3, every nested surface was clamped to `NESTED_FILL_FLOOR = 0.86`. At the default
clarity (0.75) frosted-tinted computed **0.79** and frosted-clear **0.6625**; both were raised
to **0.86**, i.e. *identical*. Since the only `surface="backdrop"` element was the TopBar, the
Tinted/Clear control changed ~56 px of chrome and nothing else. This is documented as shipped
in `R2-DESIGN-TOKENS.md` rows 74–80.

### 2.2 The v3 model: levels + additive deltas

The variant and clarity difference is carried by the **shared sampling surface**, and every
nested level adds a **constant delta** on top of it. Because the delta is additive, the
difference survives into the content instead of being flattened by a floor.

| Level | Who uses it | Samples backdrop | Delta over sheet |
|---|---|---|---|
| `sheet` | the app glass sheet | **yes** | 0 |
| `overlap` | TopBar, Sidebar, BottomBar, MobileNav | no | +0.12 |
| `card` | `Panel`, `Card`, content surfaces | no | +0.08 |
| `row` | rows / strips inside a card | no | +0.14 |
| `overlay` | palette, drawers, modals, toasts | **yes** (transient) | +0.30, floor 0.88 |

Why a floor is legitimate for `overlay` but was not for content: page content genuinely
scrolls behind an overlay, so a low fill would bleed text through it. Nothing scrolls behind
the sheet — its backdrop is the fixed decorative field.

### 2.3 Layers

```
z 0   .app-backdrop          fixed decorative gradient field (aria-hidden, no capture)
z 1   .app-glass-sheet       fixed, pointer-events:none, aria-hidden — THE sampler
z 2   shell content          TopBar / Sidebar / Main / BottomBar / MobileNav (paint-only)
z 40+ overlays               own sampler, high fill floor
```

The sheet is `position: fixed`, so content painted above it is **not** part of its backdrop:
scrolling does not re-run the filter. That is a deliberate performance property, not a fake.

## 3. Published paint values

### 3.1 Fill alpha at clarity = 1 (sheet level) — PROPOSED, then BROWSER_VALIDATED

| Quality | Tinted | Clear | Variant separation |
|---|---|---|---|
| frosted | 0.66 | 0.48 | 0.18 |
| clear | 0.50 | 0.32 | 0.18 |
| opaque | 1.00 | 1.00 | 0 (by design) |

Interpolation: `fill(clarity) = 1 - (1 - table) * clarity`, so clarity 0 = fully opaque.
Resulting composited fills at the default clarity 0.75:

| Level | frosted/tinted | frosted/clear | clear/tinted | clear/clear |
|---|---|---|---|---|
| sheet | 0.745 | 0.610 | 0.625 | 0.490 |
| overlap | 0.865 | 0.730 | 0.745 | 0.610 |
| card | 0.825 | 0.690 | 0.705 | 0.570 |
| row | 0.885 | 0.750 | 0.765 | 0.630 |

Separation at clarity 0.75 = **0.135** (was 0.000 on nested surfaces). At clarity 1 = 0.18.

**Saturation, stated rather than hidden.** The level delta is additive, so at the two lowest
clarity steps the upper levels can exceed 1.0 and are clamped: at clarity 0.25, `row` is pinned
to a fully opaque 1.0 in both variants. That is the intended "nearly opaque" end of the scale
(`clarity 0` is opaque by definition), and `src/tests/smoke/r-glass-container.test.tsx` asserts
the saturation explicitly instead of letting a separation quietly read 0.

### 3.2 Veil (ambient colour lever) — PROPOSED

`.app-backdrop::after` opacity: **1.00** for Tinted, **0.62** for Clear. Clear therefore shows
markedly more of the ambient field through a still-readable fill. This is the second, stronger
perceptual lever and it does not lower text contrast, because the fill above it is unchanged.

### 3.3 Blur — PROPOSED

| Level | frosted | clear |
|---|---|---|
| sheet | 22 px | 14 px |
| overlap / card / row | 0 (paint-only, enforced in CSS) | 0 |
| overlay | 18 px | 12 px |

Below `BLUR_THRESHOLD = 0.5` clarity the blur is off while the fill stays tinted (reference
behaviour: "10% must not suddenly enable backdrop sampling").

### 3.4 Border, highlight, saturation, radius, shadow

| Property | frosted | clear | Classification |
|---|---|---|---|
| border alpha (clarity 1) | 0.26 | 0.34 | PROPOSED (clear has less fill, so it needs a stronger edge) |
| border ramp | × (0.6 + 0.4 × clarity) | same | PROPOSED |
| nested border scale | × 0.7 | × 0.7 | PROPOSED |
| top inner highlight alpha | 0.10 | 0.16 | SOURCE_INSPIRED (glass edge) |
| saturation | 1.06 | 1.22 | SOURCE_INSPIRED |
| radius | 4 / 8 / 10 px (sm/md/lg); sheet 0; overlay 16 px | same | PROPOSED |
| shadow — card | `0 2px 8px rgba(0,0,0,.14)` | same | existing token |
| shadow — sheet | `0 8px 30px rgba(0,0,0,.28)` | same | PROPOSED (depth cue where translucency alone is subtle) |

### 3.5 Opaque presentation (designed, not degraded)

`--glass-alpha: 1`; borders fall back to the contrast-tested solid `--color-border-default`;
no `backdrop-filter`; the decorative field is not rendered; `--glass-saturate: 1`.
Triggered by: forced-colors, `prefers-reduced-transparency`, the measured performance latch,
an unsupported browser, or the operator's explicit choice. Every trigger is named in
Settings → Visual quality, in words.

## 4. Colour

Dark foundation (`--color-bg-base #0f172a`) with restrained cyan/blue emphasis
(`--color-accent #0ea5e9`) and subtle ambient colour from the backdrop field
(sky/violet/teal/rose at 0.14–0.26). Not a neon dashboard: the only green is the sanctioned
emerald; `#22c55e`, `#39ff14`, `#00ff41`, `#00ff00` remain banned by
`scripts/check-no-neon-green.mjs`.

Light theme keeps `--color-accent #0369a1` and the repaired tertiary `#566274`
(≥ 5.6:1 on every surface). The warning token is explicitly classified:
`--color-warning` is text-safe; `--color-warning-accent` is decoration only and the gate fails
the build if it is ever used as a text colour.

## 5. Typography

| Role | Stack | Size |
|---|---|---|
| UI | Inter → system → **Noto Sans Sinhala** → Nirmala UI → Iskoola Pota | `--body-size` 14 / 15 / 16 px (comfort / large / a11y) |
| Numerics, timestamps, ids | JetBrains Mono → Roboto Mono → Consolas | 11–13 px |
| Page title (`PageHeader`) | UI, 600 | 16 px — the page name is not a hero |
| Page purpose (`PageHeader`) | UI, 400, tertiary | 12 px |
| Card title | UI, 600 | 14 px |
| Field label | UI, 500, uppercase, tertiary | 11 px |

Sinhala rendering is exercised on every i18n-parity run; EN/SI catalogs move in lockstep
(1160 flat keys at plan time, raised only in lockstep with the parity locks).

## 6. Spacing, density, motion

* 4 px grid; 8 px rhythm; page gutter 16 px (phone) / 24 px (tablet+); shell max-width 1600 px.
* Content padding: card `md` = 16 px, `sm` = 12 px; page top padding 20 px (no decorative hero).
* Control heights: 32 px dense, 36 px default, **44 px minimum primary target**, 52 px phone bar.
* Motion: 100 / 150 / 200 ms, `cubic-bezier(.4,0,.2,1)`, no spring overshoot.
  `--glass-blur` is **never** transitioned (animating a backdrop filter rebuilds the read).
  All motion collapses to 0 ms under `prefers-reduced-motion`.

## 7. Focus and interaction

* `:focus-visible` 2 px ring in `--color-focus-ring`, 2 px offset — global, never removed.
* Active nav: `bg-accent/15` + `text-accent` + a 2 px inset accent bar (not colour alone).
* Hover uses the raised-surface token; hover is never the only affordance.
* Every overlay: Escape closes, Tab is trapped, focus returns to the opener.
* Icon-only controls carry an `aria-label`; a `title` attribute is never the accessible name.
