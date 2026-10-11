# R2 — Mornye-inspired Mission Control UI: implementation plan

Status: **IN PROGRESS**. Written from an inspected working tree, not from a
prior report. Every "verified" claim below names the command that produced it.

---

## 0. Served / source identity (verified this session, not inherited)

| Question | Answer | How it was established |
| --- | --- | --- |
| A. Source revision | `e9c4233` = `origin/main` head, branch `arena/851f647e-supreme-lamp` | `git log --oneline -1`, `git log origin/main -1` |
| Is PR #223 (`c017d1a`) already here? | **YES — identical source.** `git diff --stat e9c4233 c017d1a -- src/` returns **empty** | `git diff --stat e9c4233 c017d1a36c7199c5b1d81a060efcb11aca45cf6c -- src/` |
| #221 / #222 / #223 state | all `MERGED` into `main` | `gh pr view 221/222/223 --json state,headRefOid` |
| B. Built UI identity | single-file `ui/dist/index.html`, sha stamped from `VITE_BUILD_SHA`; footer badge `#uiShaBadge` shows the 7-char stamp (`"dev"` when unstamped) | `vite.config.ts` `define` block; `AppShell.tsx` `UI_SHA7` |
| C/D. Artifact → served asset | **UNKNOWN from here.** This sandbox cannot reach the RDP runner or the deployment target. Labelled UNKNOWN, not guessed. |
| E. Route / UI mode | `HashRouter`, index route `/#/` → `Overview`. `?ui=v1` escapes to classic. | `src/App.tsx`, `AppShell.classicUiHref` |
| F. Persisted glass pref | zustand `persist` key **`ghrdp:glass`** = `{quality, clarity, variant}`, re-applied on rehydrate | `src/stores/prefsStore.ts:158-185` |
| G. Fallbacks | `CSS.supports("backdrop-filter")` gate, `prefers-reduced-transparency`, `prefers-reduced-motion`, `forced-colors`, and `html[data-glass-quality-resolved="opaque"]` | `src/lib/glass/quality.ts`, `src/styles/globals.css` |
| H. Service worker | **none exists** — `grep -rl serviceWorker src/` is empty; caching is browser-default only | grep |

### The actual cause of the operator's screenshot — five specific, verified defects

The glass *infrastructure* from #221 shipped. The **Overview page never adopted
it**. These are not inferences:

1. **`DiagBundleCard` bypasses `GlassContainer`.** `src/components/domain/DiagBundleCard.tsx:56`
   is `<div className="glass rounded-xl border border-default p-4 mb-4">`. A bare
   `.glass` class carries no `data-glass-samples` attribute, so *neither*
   `[data-glass-samples="1"]` nor `[data-glass-samples="0"]` matches → no
   `backdrop-filter`, and `--glass-alpha` falls back to `1` → **fully opaque**.
   This is the "dominant opaque diagnostic-export banner" in the screenshot.
2. **Overview order is still the pre-R-GLASS stack.** `src/pages/Overview.tsx`
   renders `PrimaryActions` → **`DiagBundleCard` (2nd, with a comment saying it
   is deliberately first)** → `KeysCard` (credentials) → `WebDesktopCard` →
   only then `ConnectionCard`. Credentials and the export banner therefore
   occupy the primary screen real estate, and the connection panel is pushed
   below them. This is the reported hierarchy defect, and it is structural.
3. **Assistant-specific wording in a product action.** `src/i18n/en.json:1254`
   `"⬇ Download Diagnostic Bundle (for Claude)"`; `:1257` "paste its contents
   to Claude for analysis"; `:1275` "one file to paste to Claude". Mirrored in
   `si.json:1220/1223` and `Collector.tsx:343`.
4. **Light-theme tertiary really is 4.34:1.** `#64748b` on
   `--color-bg-surface-raised (#f1f5f9)` computes **4.344:1**; on `#ffffff`
   4.759; on `#f8fafc` 4.548. Defect reproduced, cause located.
5. **Warning is used as body text but only passes as a control.** Light
   `#d97706` is **3.186:1** on `#ffffff` and **3.045:1** on `#f8fafc` — it
   clears the 3:1 non-text bar and fails the 4.5:1 body-text bar. `Chip`
   (`tone="warning"` → `text-warning`) and `PrimaryActions`
   (`#f94.autoLoginBlocked` → `text-warning`) both render it as text.

So the answer to §4 of the brief is **"new source with a page that never adopted
it"** — not a stale artifact, not a cache, and not an intentional opaque mode.

---

## 1. Plan (in build order)

### P1 — Redesign the Overview (the actual unmet requirement)

`src/pages/Overview.tsx` becomes a thin composition of five new, glass-native
surfaces. **Every existing feature stays mounted**; nothing is deleted, it is
re-homed behind progressive disclosure or onto its existing route.

```
Overview (new)
├─ 1. PageHeader          compact identity + honest readiness dots (no big toolbar)
├─ 2. ConnectPanel        PRIMARY: Windows auto-login · SECONDARY: Web Desktop
│                         states: requested|launched|connected|unavailable|unknown
│                         explains *why* a disabled action is disabled
├─ 3. WorkspaceGrid       Files · Search · Transfers · Sessions  (real routes/handlers)
├─ 4. TroubleshootSummary severity + freshness + "Diagnose" → embedded drawer
│                         Export demoted to a secondary text button
├─ 5. ActivityStrip       real recent activity + real metrics only
└─ <details> Advanced     Credentials/legacy/mirror detail (KeysCard, WebDesktopCard
                          deployment text, ConnectionCard deep rows, LogPanel,
                          Telescope, Launcher beacon, Install guide, Manual verify)
                          + a link to the existing /#/keys route
```

Rules applied:
- Every control calls an **existing** handler or navigates to an **existing**
  route. No `/downloads` route is invented (transfers link to `/files`, where
  `ExplorerProgressRail` already lives).
- No fabricated numbers. Unknown renders as an explicit, labelled unknown.
- Reserved whitespace is removed by deleting the `mb-6` header block that
  duplicated the TopBar's own identity row, not by a negative margin.

### P2 — Make the glass system reach the content

- `DiagBundleCard` → `GlassContainer` (nested surface), neutral label.
- New `Surface`/`SectionCard` usage so cards inside the Overview are paint-only
  nested surfaces (one backdrop sampler in the shell, unchanged budget).
- Ship the token table with `SOURCE_INSPIRED` / `PROPOSED` / `BROWSER_VALIDATED`
  labels (§6 of the brief).

### P3 — Contrast and accessibility

- `--color-text-tertiary` (light) `#64748b` → **`#566274`**: 6.19 / 5.91 / 5.65
  on white / base / raised. Minimum 5.65, above 4.5.
- Split warning into **`--color-warning`** (non-text controls, 3:1) and
  **`--color-warning-text`** (body text, ≥4.5:1). Light text `#8f490b`
  (6.72 / 6.42 / 6.13). Dark keeps `#f59e0b` (8.31 / 6.81 / 5.94 / 8.72 — all
  pass, including on `--color-bg-surface-raised`).
- A machine check (`scripts/check-contrast.mjs`) computes the ratios from
  `tokens.css` so the numbers cannot silently regress.

### P4 — Behavioural tests against the real components

Seeded fixtures, asserted preconditions, real handler invocation, and a
**fail-if-the-branch-was-not-exercised** assertion. No
"if rows exist test the button, else test an endpoint" shape.

### P5 — Visual review

Local browser execution is **blocked in this sandbox**:
`pnpm exec playwright install chromium` fails with `ECONNRESET` to
`cdn.playwright.dev`, and `--with-deps` fails because the apt packages are not
available. Therefore:
- the built bundle is served here as a **live preview** the operator opens in a
  real browser, and
- the **authorized CI lab** (`e2e-ui.yml`, which already uploads `screenshots/`
  with `if-no-files-found: error`) produces the reviewed images. A new
  `tests/e2e/r2-visual.spec.ts` writes the six required shots at phone / tablet
  / desktop widths.

---

## 2. Status labels used in the final report

`UI_IMPLEMENTED` · `UI_VISUALLY_REVIEWED` · `BROWSER_VERIFIED` · `CI_VERIFIED`
· `DEPLOYED` · `LIVE_VERIFIED` — never collapsed into "complete".
