# Mission Control v3 — SCREEN STATE MATRIX

Companion to `MASTER-PLAN.md`. Inventory derived from `src/App.tsx` (2026-10-11), not from
historical counts.

Legend: **Y** = state applies and is designed · **n/a** = does not apply (reason given) ·
**N** = not yet handled (only allowed with a listed owner and target package).

## 1. Primary routes (11)

| Route | Component | Loading | Populated | Empty | Stale | Offline/denied | Partial failure | Busy/cancelling | Success | Retry | Keyboard/touch | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | `pages/Overview.tsx` | Y | Y | Y (troubleshoot "all clear") | Y (issue freshness) | Y (dash-token/version gate) | Y (per-producer chips) | Y (connect/web-desktop in flight) | Y | Y (ws Reconnect) | Y | V3-01/02 — `PageHeader`, keep #224 bands |
| `/sessions` | `pages/Sessions.tsx` | Y | Y | Y (no events → explicit empty) | Y (clock sync note) | Y | Y | n/a (read-only) | n/a | n/a | Y | V3-04 — `PageHeader`, stat row, empty state |
| `/connections` | `pages/Connections.tsx` | Y | Y | Y (fqdn pending) | Y | Y | Y | Y (copy/download in flight) | Y | Y | Y | V3-04 — `PageHeader`, distinct request/launch/login/connection |
| `/keys` | `pages/Keys.tsx` | Y | Y | Y (no audit rows) | Y | Y (protected) | n/a | Y (reveal/copy) | Y | n/a | Y | V3-04 — deliberate protected access |
| `/files` | `pages/FileExplorer.tsx` | Y | Y (incl. 5000-row) | Y | Y | Y (read-only roots) | Y (op queue) | Y (upload/move, cancel) | Y | Y (queue retry) | Y (keymap) | V3-03 — virtualized, bounded DOM |
| `/mirror` | `pages/Mirror.tsx` | Y | Y | Y (no uploads) | Y | Y | Y | Y | Y | Y | Y | V3-04 — `PageHeader` |
| `/search` | `pages/Search.tsx` | Y | Y | Y (zero-result explanation) | Y (stale generation) | Y (source auth) | Y (correlated source failures) | Y (cancel) | Y | Y | Y | V3-03 — phase chips, no landing hero |
| `/telemetry` | `pages/Telemetry.tsx` | Y | Y | Y | Y (freshness) | Y | Y | n/a | n/a | Y | Y | V3-05 — `PageHeader` + tabs |
| `/health` | `pages/Health.tsx` | Y (probing) | Y | Y (no checks) | Y | Y (unreachable) | Y (per-row fail) | n/a | Y | Y (15 s poll) | Y | V3-05 — probing/unreachable branches |
| `/collector` | `pages/Collector.tsx` | Y | Y | Y | Y | Y | Y | Y (run) | Y | Y | Y | V3-05 — provenance + freshness |
| `/settings` | `pages/Settings.tsx` | n/a (static + stores) | Y | Y (no sources/trash) | n/a | Y (storage denied) | n/a | Y (probe/trash purge) | Y | n/a | Y | V3-06 — 6 grouped sections + About |

## 2. Lab / support routes (4) + catch-all

| Route | Component | Notes | Disposition |
|---|---|---|---|
| `/search/lab/:targetId` | `pages/search/Lab.tsx` | part of the `search` feature fence | V3-06 — inherits page chrome, no new surface |
| `/lab` | `components/lab/LabRoute.tsx` | registry index, own `FeatureBoundary` | V3-06 |
| `/lab/glass` | `components/lab/GlassLab.tsx` | the material harness; must show the **same** sheet/overlap/card/row stack the app ships | V3-06 — updated to the v3 level model |
| `/lab/:featureId` | `components/lab/LabRoute.tsx` | one section in isolation | V3-06 |
| `*` | Overview | catch-all, fenced as `overview` | unchanged |

## 3. Shared surfaces and overlays (17)

| Surface | Owner file | States | Disposition |
|---|---|---|---|
| App glass sheet (**new**) | `AppShell.tsx` | present / absent (opaque) | V3-01 — the single steady-state sampler |
| TopBar | `AppShell.tsx` | default / dead-socket / reconnect offered / mobile | V3-01 — de-densified, chips to a collapsible strip |
| Sidebar (drawer < lg) | `AppShell.tsx` | expanded / collapsed / open / closed / focus-trapped | V3-01 — 4 labelled groups, order + ids locked |
| MobileNav | `AppShell.tsx` | 5 slots incl. More | V3-01 — retained, restyled |
| More drawer | = Sidebar drawer | open / closed / Escape / restore | V3-01 |
| Command palette | `CommandPalette.tsx` | closed / open / filtered / no-match | V3-06 — `overlay` level |
| Diag side drawer | `DiagSideDrawer.tsx` | closed / running / result / error | V3-05 — read-only |
| Diagnostics drawer | `DiagnosticsDrawer.tsx` | collapsed / expanded / verdict rows | V3-05 |
| DVR FAB + SessionListModal | `DvrFab.tsx` | idle / recording / consent / redaction / cancel | unchanged; privacy contract re-asserted in V3-07 |
| Debug HUD | `DebugHUD.tsx` | off / open (Shift+F12) | unchanged |
| Toasts | `Feedback.tsx` | info / success / warning / error | V3-06 — `overlay` level |
| Preview / ManualVerify dialogs | `PreviewDialog.tsx`, `ManualVerifyDrawer.tsx` | open / loading / error | V3-06 |
| Launch choice modal | `F90LaunchChoiceModal.tsx` | open / choice / blocked | V3-06 |
| Version gate | `F92VersionGate.tsx` | pass / mismatch modal | V3-06 — provenance wording corrected |
| Dash-token gate | `DashTokenGate.tsx` | authorised / 403 modal | unchanged |
| Logon gate banner | `LogonGateBanner.tsx` | shown / self-hiding | unchanged |
| Error boundaries | `FeatureBoundary`, `ChromeBoundary` | healthy / nulled section | unchanged (11 + 8 pinned counts) |

## 4. State definitions (so "Y" means the same thing everywhere)

| State | Meaning in v3 |
|---|---|
| loading | a real request is in flight; a labelled skeleton or "probing" row is shown, never blank |
| populated | real data rendered from the store/API contract |
| empty | the contract answered with zero rows **and** the UI says why (never a bare blank panel) |
| stale | the newest evidence is older than the producer's own tick; labelled with its age |
| offline/denied | poll failed, 403, or a protected root; the reason is named and the safe action offered |
| partial failure | some producers answered, some did not; per-source status is shown, not averaged |
| busy/cancelling | a mutating op is in flight and can be cancelled; the control is disabled with its state announced |
| success | the action completed on the real transport — never simulated |
| retry | an explicit, single, idempotent corrective control exists |
| keyboard/touch | reachable and operable without hover; 44×44 targets; visible focus |

## 5. Material-state coverage (cross-cutting)

Every screen above is additionally covered across: theme (dark/light) × quality
(opaque/frosted/clear) × variant (tinted/clear) × clarity (0/0.25/0.5/0.75/1) ×
viewport (390×844, 768×1024, 1024×768, 1440×900). The composited-contrast gate
(`scripts/check-glass-contrast.mjs`) enumerates that matrix numerically; the browser
capture samples it as pixels.

## 6. Disposition states (2026-10-11b reconciliation)

The `Y` cells above mean **designed and handled**; they are not a claim that the state is
implemented, browser-verified and visually reviewed all at once. The honest per-route
status uses separate states:

* **DESIGNED** — specified in this matrix / master plan.
* **IMPLEMENTED** — code merged on `main` (V3-01…V3-06 via PR #227).
* **BEHAVIOR_VERIFIED** — component/e2e assertions exercise the state and pass in CI.
* **VISUALLY_REVIEWED** — a captured PNG of the state exists and was actually looked at
  (image inspection, not geometry alone).
* **DEPLOYMENT_VERIFIED** — the served bundle renders it (run identity recorded).

| Route | DESIGNED | IMPLEMENTED | BEHAVIOR_VERIFIED | VISUALLY_REVIEWED | DEPLOYMENT_VERIFIED |
|---|---|---|---|---|---|
| `/` Overview | ✓ | ✓ | ✓ (r2-overview, v3-troubleshoot, e2e r2-visual) | partial — desktop/tablet/mobile captured pre-session; refreshed + inspected this session | live RDP run 38130242742 serves the v3 build |
| `/sessions` | ✓ | ✓ | ✓ (component) | **captured + inspected this session** (was: captured only) | same run |
| `/connections` | ✓ | ✓ | ✓ (component) | **captured + inspected this session** | same run |
| `/keys` | ✓ | ✓ | ✓ (component) | **captured + inspected this session** | same run |
| `/files` | ✓ | ✓ | ✓ (explorer suites; 5,000-row contract strengthened this session) | **captured + inspected this session** (fixture-labelled capture repaired) | same run |
| `/mirror` | ✓ | ✓ | ✓ (f91 lane) | **captured + inspected this session** | same run |
| `/search` | ✓ | ✓ | ✓ (f78/f84/f85/f86/f88 lanes) | **captured + inspected this session** | same run |
| `/telemetry` | ✓ | ✓ | ✓ (component) | **captured + inspected this session** | same run |
| `/health` | ✓ | ✓ | ✓ (component) | **captured + inspected this session** | same run |
| `/collector` | ✓ | ✓ | ✓ (f101 lane) | **captured + inspected this session** | same run |
| `/settings` | ✓ | ✓ | ✓ (settings persistence suite) | partial pre-session; refreshed + inspected this session | same run |

Cells referencing this session are the **target disposition** of the 2026-10-11b session; the
final commit of the session reconciles each cell with links to the actual captures and the
inspection notes in `docs/mission-control/v3/screens/` (`index.html` gallery +
`measurements.json`). Where a state remains unverifiable in this environment it says so:
**REAL_DEVICE rendering is NOT_MEASURED** everywhere in this matrix.
