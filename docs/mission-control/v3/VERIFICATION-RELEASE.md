# Mission Control v3 — VERIFICATION & RELEASE

Companion to `MASTER-PLAN.md`. Evidence classes are kept strictly separate; nothing is
promoted from one to another.

## 1. Evidence classes

| Class | What counts | What does not |
|---|---|---|
| **COMPONENT** | jsdom behaviour assertions (`npx vitest run`), node static gates | anything about rendered pixels |
| **BROWSER_LAB** | real Chromium (headless, in-sandbox): computed styles, layout boxes, pixel sampling, performance traces | a mount-only render |
| **THROTTLED_BROWSER** | the same with `Emulation.setCPUThrottlingRate(4)` | a real low-end phone |
| **REAL_DEVICE** | a physical iPhone/Android/Windows install | Playwright WebKit (not an iPhone), CPU throttling (not a phone) |

**REAL_DEVICE is NOT_MEASURED** in this session: no physical device is attached to this
environment. It is never inferred from elapsed time, tool calls or emulation.

## 2. Acceptance gates (fixed before measurement)

| Gate | Command / artefact | Budget |
|---|---|---|
| Unit/behaviour | `npx vitest run` | 0 failures; no assertion weakened |
| Static node gates | `node --test tests/*.test.js` | 0 failures (skips reported as skips) |
| Regression ids | `npm run check:regression-ids` | 219 ids intact |
| FX ids | `npm run check:fx-ids` | PASS |
| Bottom-bar time ownership | `npm run check:bottom-bar` | OK |
| Token contrast | `node scripts/check-contrast.mjs` | 4.5:1 text / 3:1 control |
| **Composited glass contrast (new)** | `node scripts/check-glass-contrast.mjs` | 4.5:1 text / 3:1 control across theme × quality × variant × clarity × level |
| Banned colour literals | `node scripts/check-no-neon-green.mjs ui/dist/index.html` | 0 in the **built bundle** |
| Typecheck | `tsc -p tsconfig.build.json --noEmit` | clean |
| Bundle present | `test -f ui/dist/index.html` | > 51200 bytes |

Budgets are set **before** measuring. A regression is reported as a regression; thresholds are
never moved after the fact to obtain green.

## 3. Test method (no vacuous green)

Every acceptance test follows **seed → assert precondition → act through the real UI →
observe the contract → assert the outcome**:

* If a required row/control is absent, the test **fails**. It never falls back to probing a
  different backend endpoint.
* A row-count assertion requires a **non-empty** dataset (the previous "files row count < 200"
  passed with zero rows).
* Search is exercised for replacement, cancellation and stale-response handling.
* Connect and Web Desktop are exercised for launch and recovery, with popup
  opener/referrer protection and no duplicate launch.
* Diagnostics: every emitted issue action is asserted to exist and to be wired.
* Settings: persistence and quality fallback are asserted across a reload.
* Keyboard, touch and focus restoration are asserted, not assumed.

## 4. Visual capture

`scripts/v3-capture.mjs` (optional tooling — it needs `puppeteer-core` and
`@sparticuz/chromium`, installed with `--no-save`; they are deliberately **not** added to
`package.json`, because `build-ui.yml` runs `pnpm install --frozen-lockfile` and an
un-locked dependency would break the build).

The harness serves the **built** bundle and captures, at 390×844 / 768×1024 / 1440×900:

1. Overview, Search, Files, Sessions, Connections, Keys, Telemetry, Health, Collector, Settings
2. Phone navigation + the More drawer
3. Diagnostics/Health and the troubleshooting panel
4. Tinted vs Clear vs Opaque fallback on identical content

Alongside each PNG it writes measured numbers — not claims:

* count of elements with a live `backdrop-filter` (steady state must be **1**)
* composited pixel colour sampled inside a real content panel, for Tinted vs Clear
* the **measured** perceptual delta (ΔE in CIE76 over sRGB) between the two captures
* sampled composited contrast of real text nodes

Captures land in `screenshots/v3-*.png` with a `v3-manifest.json`.

**Honest limitation:** the agent does not see images. It can measure them; the operator must
open them. `UI_VISUALLY_REVIEWED` is therefore only claimable after operator review.

## 5. Build identity (source → served)

Verified chain, from `build-ui.yml` and the app source:

```
source revision (git rev-parse HEAD)
  → VITE_BUILD_SHA stamped at build time
  → ui/dist/index.html (single file)
  → ui-dist-<sha>.zip + ui-dist-<sha>.zip.sha256 published to the `ui-dist` release
  → main.yml downloads the asset and verifies the digest (fail-closed)
  → served bundle renders #uiShaBadge "ui: <sha7>" and #ghrdpBuild[data-build]
```

The pre-v3 WebDesktop warning compared the compiled SHA with `main`'s SHA and called an
inequality "an older UI". That is not sound: `main` carries status-only commits that do not
change the interface. The wording is replaced by **build provenance** — built SHA, served
stamp, whether they match, and the artifact name — shown in Settings → About, with the
backend `releaseId` available behind an explicit re-check (never on mount, so the Settings
tree stays fetch-free for the existing probe contract).

## 6. Activation and rollback

### Activation (what the user can do right now)

1. Merge the v3 PR into `main`.
2. `build-ui.yml` runs on the push, builds `ui-dist-<sha>.zip` + `.sha256`, publishes them to
   the `ui-dist` release.
3. Dispatch `main.yml`; it downloads and SHA-256-verifies that artifact and serves it from the
   runner.
4. Confirm identity in the running app: bottom bar `ui: <sha7>` equals the merged commit's
   first 7 characters, and Settings → About shows **served = built**.

### What a merge alone does NOT do

A successful PR/build does **not** update an already-running RDP session. The running session
keeps serving the bundle it was started with. If activating would interrupt an active session,
the exact release is prepared and a maintenance-window decision is requested — the session is
never restarted blindly.

### Rollback

| Level | Action | Effect |
|---|---|---|
| Presentation only | Settings → Visual quality → **Opaque** | Solid surfaces, no filters. Instant, per browser, reversible. |
| Per-view escape | append `?ui=v1` | Classic v1 UI for one release |
| Full artifact rollback | re-dispatch `main.yml` pinned to the previous `ui-dist-<sha>.zip` | Serves the previous verified bundle |

## 7. Privacy constraints during verification

* No secret value is written to a screenshot, a log, a telemetry record or a public artifact.
  Keys are captured masked.
* A closed `<details>` keeps its children in the DOM — hiding credential cards is a
  presentation decision, **not** a capture exclusion. Capture exclusions are respected
  independently (DVR redaction rules remain in force).
* The decorative backdrop stays a CSS gradient field: never a desktop screenshot, file
  thumbnail or DVR frame (WP-13b).

## 8. Status vocabulary (never collapsed into "done")

`PLAN_READY` · `UI_IMPLEMENTED` · `UI_VISUALLY_REVIEWED` · `BROWSER_VERIFIED` ·
`CI_VERIFIED` · `DEPLOYED` · `LIVE_VERIFIED`

Each is reported separately with its own evidence and its own SHA.
