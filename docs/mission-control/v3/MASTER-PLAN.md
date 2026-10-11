# Mission Control v3 — MASTER PLAN

**Status: PLAN_READY → IMPLEMENTING**
Session branch: `arena/403ecbde-supreme-lamp` · Base: `acb27c8` (contains merged #224)
Canonical tracking: issue **#225** · Predecessor requirement issues: #191, #193, #194, #202, #205, #209, #210, #211, #212, #213, #214, #216, #217, #218

Companion documents (this is the index; do not create competing ledgers):

| Document | Contents |
|---|---|
| `MASTER-PLAN.md` (this file) | Sections A–M, work packages V3-01…V3-08, acceptance |
| `SCREEN-STATE-MATRIX.md` | Every route/overlay × every state, with disposition |
| `DESIGN-SYSTEM.md` | Tokens, material model, published paint values, typography, motion |
| `VERIFICATION-RELEASE.md` | Evidence classes, test plan, build/activation/rollback |

Human-readable progress: **Sinhala**. Code, identifiers, commands: **English**.

---

## A. Current source / build / served-UI model (INSPECTED, not assumed)

| Fact | Value | How verified |
|---|---|---|
| Framework | React 18 + Vite 5 + Tailwind 3 + react-i18next + zustand + react-window | `package.json` INSPECTION |
| Router | `HashRouter` — the dashboard is served from one URL, so deep links need no server rewrite | `src/App.tsx` INSPECTION |
| Routes | **11 primary** (`/`, `/sessions`, `/connections`, `/keys`, `/files`, `/mirror`, `/search`, `/telemetry`, `/health`, `/collector`, `/settings`) + `/search/lab/:targetId`, `/lab`, `/lab/glass`, `/lab/:featureId`, catch-all → Overview | `src/App.tsx` INSPECTION |
| Boundaries | 11 section routes fenced by `FeatureBoundary`; 8 chrome mounts fenced by `ChromeBoundary`; `App.tsx` pins exactly 13 `fence()` calls | `src/App.tsx`, `tests/f105-*.test.js`, `tests/m2-chrome-unfencing.test.js` |
| Chrome | `AppShell` = TopBar + Sidebar + Main + BottomBar + MobileNav + CommandPalette | `src/components/layout/AppShell.tsx` |
| Glass | **One** `GlassContainer` owns `backdrop-filter`: the sticky TopBar (`surface="backdrop"`). Sidebar / BottomBar / MobileNav / every `Panel` / every `Card` are `surface="nested"` | INSPECTION (grep) |
| Decorative field | `.app-backdrop`, `position: fixed`, `z-index: 0`, pure CSS gradients, `aria-hidden`, no `<img>`/canvas/network (privacy) | `src/components/layout/AppBackdrop.tsx`, `src/styles/globals.css` |
| Quality resolution | `src/lib/glass/quality.ts` → `resolveQuality()` precedence: forced-colors → reduced-transparency → perf latch → unsupported → explicit opaque → explicit frosted/clear → auto=frosted | INSPECTION |
| Build | `.github/workflows/build-ui.yml`: `pnpm install --frozen-lockfile && pnpm run build`, stamps `VITE_BUILD_SHA=$(git rev-parse HEAD)`, gates `check-regression-ids`, `check-fx-ids`, `check-no-neon-green ui/dist/index.html`, `check-bottom-bar-time`, publishes `ui-dist-<sha>.zip` + `.sha256` to the `ui-dist` release | INSPECTION |
| Served identity | `#uiShaBadge` renders `ui: <sha7>` from `VITE_BUILD_SHA || "dev"`; `#ghrdpBuild[data-build]` stamped at App root; `main.yml` downloads the verified artifact | INSPECTION |
| i18n | 1160 flat keys per catalog, EN/SI parity enforced by `tests/f-i18n-parity.test.js` and four locks | `node` count, 2026-10-11 |
| Baseline tests | `npx vitest run` → **100 files / 1297 tests PASS**; `node --test tests/*.test.js` → to be re-measured | REPRO (this session) |

**Shallow clone:** depth 1 at `acb27c8`. Older SHAs are not resolvable locally; PR/issue facts come from `gh`, not from local ancestry.

---

## B. User requirements mapped to previous issues

| Operator requirement | Issues | Where v3 addresses it |
|---|---|---|
| Dark frosted glass, restrained colour, clear hierarchy | #213, #218 | `DESIGN-SYSTEM.md` §2–§3; V3-01 |
| **Working** Tinted/Clear + Glass Clarity | #213, #214 | V3-01 material model (defect D1 below) |
| Compact, human-friendly navigation | #214 | V3-01 (grouped nav, compact TopBar) |
| Icon-first controls, accessible names, short labels | #214 | V3-01, V3-06 |
| Responsive Windows / Android / iPhone / iPad / desktop | #214 | V3-01, V3-06 |
| Useful connection / files / search / transfer workflows | #194, #210, #216, #217 | V3-02, V3-03 |
| Embedded troubleshooting at the point of failure | #202, #205 | V3-05 |
| Real, accurately labelled status and performance info | #194, #211, #212 | V3-02, V3-05 |
| Graceful low-capability presentation | #213 | V3-01 (opaque path) |
| **Consistent design across EVERY screen** | #191, #214 | V3-01…V3-06, `SCREEN-STATE-MATRIX.md` |
| Truthful build identity and activation | #194, #209 | V3-06 (BuildProvenanceCard), `VERIFICATION-RELEASE.md` |
| Privacy: no secrets in telemetry/screenshots/logs | #193, #209 | V3-04 (Keys), `VERIFICATION-RELEASE.md` §7 |

### The five defects this plan exists to correct (all located in source this session)

| ID | Defect (source-verified) | Evidence |
|---|---|---|
| **D1** | `NESTED_FILL_FLOOR = 0.86` clamps **every** nested surface. At clarity 0.75 frosted-tinted computes 0.79 and frosted-clear 0.6625; both are raised to **0.86 → identical**. Because the only `surface="backdrop"` element is the TopBar, the Tinted/Clear control changes ~56px of chrome and nothing else. | `quality.ts:234,248`; also **already documented** as shipped in `R2-DESIGN-TOKENS.md` rows 74–80 (all four nested rows = 0.8600) |
| **D2** | One blurred bar is not a glass workspace: every content panel is a nested 0.86 plate, so there is no perceptible depth on the surface where the work happens. | `Panel.tsx`, `Data.tsx` (`surface="nested"`) |
| **D3** | Dense header: TopBar carries 4 status chips + Reconnect + clock chip + 4 controls on one row. | `AppShell.tsx:137–247` |
| **D4** | Pages other than Overview have no shared page identity: ad-hoc `<h2 className="text-xl">` + `Card` stacks, with no consistent header, status slot or action slot. | `Sessions/Connections/Keys/Telemetry/Mirror/Settings/Health` |
| **D5** | `deriveConnectionState()` returns `connected` purely from `authResult === "success"` with **no freshness and no current-run validation** — a 4624 from a previous session still reads as connected. | `src/lib/overview/readiness.ts` (step 1) |

**Not** claimed as defects: the Overview composition from #224 is retained and improved, not replaced.

---

## C. Screen and overlay inventory (derived from `App.tsx`, not from historical counts)

**11 primary routes** · **4 lab/support routes** (`/search/lab/:targetId`, `/lab`, `/lab/glass`, `/lab/:featureId`) · **1 catch-all** (`*` → Overview) · **8 chrome mounts** · **17 shared overlays/surfaces** (see `SCREEN-STATE-MATRIX.md`).

Shared surfaces owned by V3-01/V3-06:
TopBar · Sidebar (drawer below `lg`) · MobileNav · More drawer · Command palette · Diag side drawer · Diagnostics drawer · DVR FAB + SessionListModal · Debug HUD · Toasts · Dialogs/Preview/ManualVerify · Tooltips/titles · Loading & error boundaries (`FeatureBoundary`, `ChromeBoundary`) · Version gate · Dash-token gate · Logon gate banner · App glass sheet (**new**).

---

## D. Navigation and information architecture

Desktop (`lg+`): persistent sidebar, collapsible to a 64px rail with names still in the accessible tree. The 11 destinations are grouped into **4 labelled sections** so a 11-item flat list becomes scannable — the locked order and the locked ids are **preserved exactly**:

| Group | Destinations |
|---|---|
| Operate | Overview, Search |
| Access | Sessions, Connections, Keys |
| Data | Files, Mirror |
| System | Telemetry, Health, Collector, Settings |

Tablet (`md`): same sidebar. Phone (`<lg`): 5-slot bottom bar (Overview, Search, Files, Mirror, More) + the full 11-destination drawer with Escape, focus trap, focus restoration and a visible close button (already implemented; retained and restyled).

No new route is invented. The Labs entry stays outside `<nav>` (the `nav a` count is a locked contract).

---

## E. Component reuse / replacement decisions

| Component | Decision | Rationale |
|---|---|---|
| `GlassContainer` | **Kept and extended** (`level` API). `surface` prop retained for compatibility. | It is the only writer of `backdrop-filter`; that invariant is what makes layer count auditable. |
| `quality.ts` | **Rewritten material model** (levels, additive deltas, no flat floor) | Fixes D1/D2 |
| `AppBackdrop` | **Kept** (single decorative field, privacy-safe) | — |
| `AppShell` | **Rewritten presentation**: app glass sheet + grouped nav + compact TopBar | Fixes D2/D3 |
| `Panel` / `Card` / `StatCard` | **Kept**, given `level="card"` | — |
| `PageHeader` | **New shared primitive** | Fixes D4; one page-identity contract on all 11 routes |
| `BuildProvenanceCard` | **New** (Settings → About) | Truthful build/served identity |
| `OverviewHeader` | **Replaced by** `PageHeader` + Overview-specific status chips | #224's work is preserved; its identity row becomes the shared primitive |
| `TroubleshootSummary` | **Kept + corrected** (severity ordering, full reachability, action coverage) | #202/#205 |
| `readiness.ts` | **Extended** with freshness + run-window validation | Fixes D5 |
| `VisualQualityCard` | **Kept**, moved into the grouped Settings surface | #213 §8 |
| Dependency stack | **Unchanged** — no major migration | Explicit operator constraint |

---

## F. Material, typography, spacing, interaction

See `DESIGN-SYSTEM.md` for the full published table (blur, alpha, border, saturation, radius, shadow, each classified as PROPOSED / SOURCE_INSPIRED / BROWSER_VALIDATED).

Summary of the material architecture:

1. **One shared sampling surface per region.** The **app glass sheet** — a `position: fixed`, `pointer-events: none`, `aria-hidden` element at z-index 1, between the backdrop (z 0) and the shell content (z 2). It is the only steady-state `backdrop-filter` in the app.
2. **Everything else paints on it.** Sidebar/bars (`overlap`), content panels (`card`), rows (`row`) are paint-only with **additive** level deltas, so the Tinted/Clear and clarity differences survive into the content instead of being flattened by a floor.
3. **Overlays** (palette, drawers, modals) keep their own sampler and a high fill floor, because page content genuinely scrolls behind them.
4. **No opacity on text containers** (an `opacity < 1` element becomes a backdrop root and fades its own text). Alpha lives on `background-color`.
5. **No blur on rows or cards**; no animated blur; no blanket `will-change` / `translateZ`.
6. **Opaque path is a designed presentation**, not a broken glass: solid token borders, no field, no filters.

Typography: Inter (Latin) + Noto Sans Sinhala (SI) with `Nirmala UI` / `Iskoola Pota` fallbacks; JetBrains Mono for all numeric/timestamp fields; `--body-size` scale steps comfort/large/a11y retained.
Spacing: 4px grid, 8px rhythm. Radii 4 / 8 / 10. Motion 100 / 150 / 200 ms, all collapsing to 0 under `prefers-reduced-motion`.

---

## G. Data contracts and truthful state semantics

* No backend contract is changed by this plan except where a UI-visible lie cannot be fixed in the UI alone (none identified so far; if one appears it is recorded in §M, not silently patched).
* Connection state remains derived purely from store fields (`readiness.ts`), now with: evidence freshness (`EVIDENCE_MAX_SCAN_AGE_MS`), run-window validation (`RUN_START_TOLERANCE_MS`), unparseable timestamps → `unverified`, and **only a collector-observed 4624 inside the current run counts as `connected`**.
* Troubleshooting issues are derived from live store state (`lib/overview/issues.ts`), each carrying producer, timestamp, `confirmed`/`suspected`, severity and next safe action. v3 adds deterministic severity ordering and guarantees every emitted `actionId` is rendered.
* Files/transfers keep the real transport (`POST /api/fx/op`) with optimistic local application; unknown values render as `--`, never as a fabricated completion.

---

## H. Accessibility and EN/SI requirements

* WCAG 1.4.3 4.5:1 for normal text, 1.4.11 3:1 for non-text controls — **enforced on composited glass stacks**, not only on token names (new gate `scripts/check-glass-contrast.mjs`).
* 44×44 minimum primary touch targets (`tap-44`), 52px on the phone bar.
* Accessible names on every icon control; no hover-only `title` as the only name.
* Visible focus (2px ring, 2px offset), Escape + focus trap + focus restoration on every overlay.
* Safe-area insets, keyboard avoidance, orientation, forced-colors, reduced-motion, reduced-transparency.
* EN/SI catalog parity is a hard lock (1160 → grows only in lockstep); Sinhala strings are marked for operator native review, as before.

---

## I. Browser / device / performance acceptance

| Class | Budget | Method |
|---|---|---|
| COMPONENT | jsdom behaviour, no thresholds | `npx vitest run` |
| BROWSER_LAB | real Chromium, unthrottled: route change p95 ≤ 20 ms, long tasks 0, no horizontal overflow at 4 viewports, steady-state samplers = 1 | puppeteer harness (sandbox) + `tests/e2e/v3-visual.spec.ts` (CI Chromium) |
| THROTTLED_BROWSER | 4× CPU throttle: p95 ≤ 25 ms, long tasks ≤ 4, quality latch behaviour verified | `Emulation.setCPUThrottlingRate` |
| REAL_DEVICE | **NOT_MEASURED** — no physical iPhone/Android in this environment. Never converted from emulation. | — |

Budgets are fixed **before** measurement; a regression is reported as a regression, not absorbed by moving the number.

---

## J. Ordered work packages

| ID | Outcome | Depends on |
|---|---|---|
| **V3-01** | Shared design system, material model, responsive shell, `PageHeader` on all 11 routes, grouped nav, compact TopBar | — |
| **V3-02** | Overview / connection experience reconciled with #224; truthful connection freshness | V3-01 |
| **V3-03** | Search, Files, transfer surfaces: page identity, result density, large-list behaviour, unknown-value honesty | V3-01 |
| **V3-04** | Sessions, Connections, protected Keys UX | V3-01 |
| **V3-05** | Telemetry / Health / Collector + embedded troubleshooting (severity ordering, action coverage) | V3-02 |
| **V3-06** | Settings (grouped + About/build provenance), labs, overlays, cross-screen consistency, i18n lockstep | V3-01…V3-05 |
| **V3-07** | Full acceptance: behaviour, accessibility, real-browser visual capture, performance | all |
| **V3-08** | Verified build, release/activation procedure, final evidence | V3-07 |

### Per-package detail

Each package below records: **ID | user-visible outcome | files | deps | implementation | states | acceptance | tests | screenshots | issue/PR | release/rollback impact**.

---

### V3-01 — shared design system, material, responsive shell

* **Outcome:** one coherent material across the whole app; Tinted/Clear and Clarity visibly change the workspace; compact chrome; every page opens with the same identity header.
* **Files:** `src/lib/glass/quality.ts`, `src/components/primitives/GlassContainer.tsx`, `src/styles/tokens.css`, `src/styles/globals.css`, `tailwind.config.ts`, `src/components/layout/AppShell.tsx`, `src/components/layout/AppBackdrop.tsx`, `src/components/primitives/PageHeader.tsx` (new), `src/components/overview/Panel.tsx`, `src/components/primitives/Data.tsx`, `src/components/primitives/Feedback.tsx`, `src/components/domain/DiagBundleCard.tsx`.
* **Deps:** none.
* **Implementation:** level model (`sheet|overlap|card|row|overlay`), additive level deltas, removal of the flat nested floor, app glass sheet in `AppShell`, grouped nav, TopBar de-densification (status chips move to a compact collapsible strip), `PageHeader` on all 11 routes.
* **States:** opaque / frosted / clear × tinted / clear × 5 clarity steps × 2 themes × 4 viewports.
* **Acceptance:** steady-state `backdrop-filter` elements = **1**; nested fill differs between tinted and clear by ≥ 0.13 alpha at clarity 0.75 and ≥ 0.18 at clarity 1; composited text contrast ≥ 4.5:1 in every combination; zero horizontal overflow at 390/768/1024/1440; every route renders exactly one `PageHeader`.
* **Tests:** `src/tests/smoke/v3-material.test.tsx`, `src/tests/smoke/v3-shell.test.tsx`, extended `r-glass-container.test.tsx`, `scripts/check-glass-contrast.mjs`.
* **Screenshots:** `v3-01-*.png` (tinted vs clear vs opaque, 2 viewports).
* **Release/rollback:** presentation-only; rollback = Settings → Opaque, or previous `ui-dist-<sha>.zip`.

---

### V3-02 — Overview / connection experience

* **Outcome:** compact identity/status header, primary connection action immediately visible, truthful Web Desktop readiness, real shortcuts, actionable troubleshooting, diagnostic export secondary, credentials disclosed.
* **Files:** `src/pages/Overview.tsx`, `src/components/overview/*`, `src/lib/overview/readiness.ts`, `src/hooks/useConnectionVerdict.ts`, `src/components/domain/PrimaryActions.tsx`, `src/components/domain/WebDesktopCard.tsx`.
* **Deps:** V3-01.
* **Implementation:** keep #224's 7-band composition; replace `OverviewHeader` with `PageHeader`; add freshness/run validation to `deriveConnectionState`; de-claim the WebDesktop "older UI" warning in favour of build provenance.
* **States:** unknown / unavailable / requested / launched / connected / failed × fresh / stale / unverified.
* **Acceptance:** historical login never renders as `connected`; a 4624 older than the freshness window renders `unverified`; WebSocket health alone never renders `connected`.
* **Tests:** extended `r2-connection-state.test.ts`, `src/tests/smoke/v3-connection.test.tsx`.
* **Screenshots:** `v3-02-overview-{connected,unverified,opaque}.png`.

---

### V3-03 — Search, Files, transfers

* **Outcome:** compact entry, clear source/filter controls, useful density, correlated source failures, zero-result explanations, honest pending/cancel/stale, bounded large lists.
* **Files:** `src/pages/Search.tsx`, `src/pages/search/*`, `src/pages/FileExplorer.tsx`, `src/pages/file-explorer/*`.
* **Deps:** V3-01.
* **Implementation:** `PageHeader` with phase + shown/total chips; read-only chip on protected paths; delete the landing hero; keep `react-window` virtualization and the v1 `itemData` contract.
* **States:** idle / queued / running / partial / complete / empty / failed / cancelled; files: populated / empty / read-only / 5000-row / busy / cancelling.
* **Acceptance:** 5000-file dataset renders a **non-empty** populated grid with bounded DOM rows; scroll, keyboard selection, resize, update and anchoring all pass; absent rows **fail** the test (no silent re-target to another endpoint).
* **Tests:** `src/tests/smoke/v3-files-5000.test.tsx`, existing explorer suites.
* **Screenshots:** `v3-03-{search,files}.png`.

---

### V3-04 — Sessions, Connections, protected Keys

* **Outcome:** clear session identity/availability; request vs launch vs historical login vs current connection are distinct; deliberate protected access for secrets.
* **Files:** `src/pages/Sessions.tsx`, `src/pages/Connections.tsx`, `src/pages/Keys.tsx`, `src/components/domain/KeysCard.tsx`.
* **Deps:** V3-01.
* **Implementation:** `PageHeader` on all three; Keys masking/reveal/copy with no secret in telemetry/screenshots/logs (capture exclusions respected even while a `<details>` ancestor is closed).
* **States:** populated / empty / loading / denied / partial / stale.
* **Acceptance:** no duplicate launch path; `.rdp` carries no credentials; reveal requires an explicit action and is audited.
* **Screenshots:** `v3-04-{sessions,connections,keys-masked}.png`.

---

### V3-05 — Telemetry, Health, Collector, embedded troubleshooting

* **Outcome:** accurate provenance and freshness, understandable summaries with technical drill-down, compact diagnostic workflows, actionable recovery, read-only by default.
* **Files:** `src/pages/Telemetry.tsx`, `src/pages/Health.tsx`, `src/pages/Collector.tsx`, `src/components/overview/TroubleshootSummary.tsx`, `src/lib/overview/issues.ts`.
* **Deps:** V3-02.
* **Implementation:** deterministic severity ordering (`orderIssues()`), preview-3 + show-all, every emitted `actionId` rendered or explicitly marked unavailable, route-aware diagnosis, static fallback when diagnostics fail.
* **States:** probing / unreachable / pass / warn / fail / stale.
* **Acceptance:** critical issues are never hidden by array order; all remaining issues reachable; no automatic mutation, restart or launch to make status look green.
* **Tests:** `src/tests/smoke/v3-troubleshoot.test.tsx`.
* **Screenshots:** `v3-05-{telemetry,health,troubleshoot}.png`.

---

### V3-06 — Settings, labs, overlays, cross-screen consistency

* **Outcome:** theme, clarity, quality, accessibility and language in one coherent surface; explicit opaque preference preserved; fallback reasons understandable; build provenance visible; overlays consistent.
* **Files:** `src/pages/Settings.tsx`, `src/components/domain/VisualQualityCard.tsx`, `src/components/domain/BuildProvenanceCard.tsx` (new), `src/components/layout/CommandPalette.tsx`, `src/components/primitives/Feedback.tsx`, `src/i18n/{en,si}.json`.
* **Deps:** V3-01…V3-05.
* **Implementation:** 6 labelled Settings sections; About/build provenance card (built vs served stamp, `ui-dist-<sha>.zip`, backend `releaseId` behind an explicit re-check — never on mount); overlay levels and borders unified.
* **States:** default / opaque-forced / perf-latched / reduced-transparency / forced-colors.
* **Acceptance:** Settings mount performs **no** network call (existing `f70-source-probe` contract); every fallback state names its reason; EN/SI parity lockstep.
* **Tests:** `src/tests/smoke/v3-settings.test.tsx`, `tests/f-i18n-parity.test.js` lock raised in lockstep.

---

### V3-07 — full acceptance

Behaviour (vitest + node gates), accessibility (composited contrast, targets, focus, keyboard), real-browser visual capture (measured pixel deltas for tinted vs clear), performance (unthrottled + 4× CPU), and honest `NOT_MEASURED` for real devices. See `VERIFICATION-RELEASE.md`.

### V3-08 — verified build, release and rollback

`npm run build` → dist-level gates → push → follow CI to terminal results → publish the exact activation and rollback procedure. See `VERIFICATION-RELEASE.md` §5–§6.

---

## K. PR integration strategy

* #224 is **MERGED** into `acb27c8`; it is not an evolving branch. Its Overview work is **retained and improved**, never reverted and never duplicated.
* This plan is executed on the session branch `arena/403ecbde-supreme-lamp` as **cohesive per-package commits** in one stacked PR — not one replacement PR per retry.
* Historical planning branches (#207, #192, #190) are read for requirements only; their implementation statuses are **not** copied forward.

## L. Artifact, activation and rollback plan

See `VERIFICATION-RELEASE.md` §5 (build identity) and §6 (activation/rollback). Summary: merge → `build-ui.yml` builds and publishes `ui-dist-<sha>.zip` + `.sha256` → dispatch `main.yml` (which verifies the digest and serves the bundle) → verify `ui: <sha7>` in the bottom bar and `#ghrdpBuild`. Rollback: Settings → Opaque (presentation only), or re-dispatch the previous `ui-dist-<sha>.zip`, or `?ui=v1`.

## M. Exclusions, blockers, deferred dependencies

| Item | Status | Boundary |
|---|---|---|
| F45-B synchronous scanner starvation | **Open, out of scope** | Backend scanner; untouched by UI work. Not marked fixed. |
| yt-dlp / download-engine upgrades | **Deferred** | Unrelated infrastructure; must not consume this session. |
| Backend contract changes | **None required so far** | Any that appear are recorded here, not silently patched. |
| Real-device (iPhone/Android) measurement | **NOT_MEASURED** | No physical device in this environment; emulation is labelled as emulation. |
| Visual judgement of captured screenshots | **Operator-performed** | The agent measures pixels; it does not see images. |
| React/Tailwind major migration | **Excluded** | Explicit operator constraint. |
