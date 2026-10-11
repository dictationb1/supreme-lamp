# MISSION CONTROL v3 — canonical tracking (all-screen UI upgrade)

**Scope:** the *complete* Mission Control interface — the shared shell, the material system, and **every**
user-facing screen and overlay. Not an Overview-only change. This issue does not replace any existing
requirement issue: it is the tracking surface that links them to one plan.

**Session branch:** `arena/403ecbde-supreme-lamp` (base `acb27c8`, which already contains merged #224).
Previous session branch `arena/5fe3bfee-supreme-lamp` was **never pushed and no longer exists** — its
code work is unrecoverable; its findings were re-verified against source before being reused.

## Plan (reconciled against source — not copied from older statuses)

| Document | Owns |
|---|---|
| [`docs/mission-control/v3/MASTER-PLAN.md`](https://github.com/dekarita/supreme-lamp/blob/arena/403ecbde-supreme-lamp/docs/mission-control/v3/MASTER-PLAN.md) | sections A–M: source model, requirement mapping, IA, component reuse/replacement decisions, material spec, data contracts, a11y, budgets, V3-01…V3-08, PR strategy, exclusions |
| [`docs/mission-control/v3/SCREEN-STATE-MATRIX.md`](https://github.com/dekarita/supreme-lamp/blob/arena/403ecbde-supreme-lamp/docs/mission-control/v3/SCREEN-STATE-MATRIX.md) | 11 routes + 4 lab routes + catch-all + 17 shared overlays × 10 states, with dispositions |
| [`docs/mission-control/v3/DESIGN-SYSTEM.md`](https://github.com/dekarita/supreme-lamp/blob/arena/403ecbde-supreme-lamp/docs/mission-control/v3/DESIGN-SYSTEM.md) | level model, published blur/alpha/border/saturation/radius values, each classified PROPOSED / SOURCE_INSPIRED / BROWSER_VALIDATED |
| [`docs/mission-control/v3/VERIFICATION-RELEASE.md`](https://github.com/dekarita/supreme-lamp/blob/arena/403ecbde-supreme-lamp/docs/mission-control/v3/VERIFICATION-RELEASE.md) | evidence classes, gates, test method, visual capture, build identity, activation + rollback |

Indexed from `docs/mission-control/GHRDP-DELIVERY-TRACKER.md` (no competing ledger).

## Refreshed snapshot (2026-10-11)

| Fact | Value |
|---|---|
| Base | `acb27c8` — contains merged **#224** (Overview redesign). v3 improves it, never reverts it |
| `main` head at check time | `4c5cbdd` |
| Routes | 11 sections + `/#/lab`, `/#/lab/glass`, `/#/lab/:featureId`, `/#/search/lab/:targetId`, catch-all → Overview |
| Baseline tests | `npx vitest run` → **100 files / 1297 tests PASS** |
| i18n | 1160 flat keys per catalog, EN/SI parity verified |

## Defects located in source (the reason this plan exists)

| ID | Defect |
|---|---|
| **D1** | `NESTED_FILL_FLOOR = 0.86` clamps every nested surface. At the default clarity frosted-tinted computes 0.79 and frosted-clear 0.6625 — **both become 0.86, i.e. identical**. Because the only `surface="backdrop"` element was the TopBar, the Tinted/Clear control changed ~56 px of chrome and nothing else. Already documented as shipped in `R2-DESIGN-TOKENS.md` rows 74–80 |
| **D2** | One blurred bar is not a glass workspace: every content panel is a nested 0.86 plate, so no perceptible depth where the work happens |
| **D3** | Dense TopBar: 4 status chips + Reconnect + clock chip + 4 controls on one row |
| **D4** | 10 of 11 routes have no shared page identity — ad-hoc `<h2>` + `Card` stacks |
| **D5** | `deriveConnectionState()` returns `connected` from `authResult === "success"` with **no freshness and no current-run validation** |

## Fix architecture (summary)

One shared sampling surface — the **app glass sheet** (fixed, `aria-hidden`, z-index 1) — carries the
Tinted/Clear and clarity difference. Sidebar/bars (`overlap`), cards (`card`) and rows (`row`) add
**constant additive deltas**, so the difference survives into content instead of being flattened by a
floor. Overlays keep their own sampler and a high fill floor, because content genuinely scrolls behind
them. Steady-state `backdrop-filter` count stays at **1**.

## Work packages

| ID | Outcome | State |
|---|---|---|
| V3-01 | Material model + sheet + grouped nav + compact TopBar + `PageHeader` on all 11 routes | in progress |
| V3-02 | Overview/connection: freshness-validated state, severity-ordered troubleshooting, provenance | planned |
| V3-03 | Search, Files, transfers | planned |
| V3-04 | Sessions, Connections, protected Keys | planned |
| V3-05 | Telemetry, Health, Collector, embedded troubleshooting | planned |
| V3-06 | Settings (grouped + About/build provenance), labs, overlays, consistency | planned |
| V3-07 | Behaviour / accessibility / visual / performance acceptance | planned |
| V3-08 | Verified build, release + activation procedure, final evidence | planned |

## Requirement issues this work answers (statuses are **not** inherited)

#213 glass · #214 responsive/text-light UX · #215/#218 research indexes · #216/#217 search + Explorer ·
#210 downloads/transfers · #211/#212 metrics + session timing · #202/#205 embedded troubleshooting ·
#194 truthful launch outcomes · #193/#209 + PR #208 privacy · #191 diagnostics hub (stays open).

**No broad issue is closed by this work.**

## Evidence policy

`COMPONENT` ≠ `BROWSER_LAB` ≠ `THROTTLED_BROWSER` ≠ `REAL_DEVICE`.

*Updated this session:* a real headless Chromium **is** runnable in the agent sandbox (via
`puppeteer-core` + `@sparticuz/chromium`, with the bundled AL2023 shared libraries extracted and
`LD_LIBRARY_PATH` set). Browser evidence is therefore produced locally against the built bundle and
measured as pixels — not inferred. The `e2e-ui` CI lane still runs the committed Playwright spec.

`REAL_DEVICE` remains **NOT_MEASURED**: no physical device is attached. Playwright WebKit is not an
iPhone; CPU throttling is not a low-end phone.

**Honest limitation:** the agent measures screenshots but does not see images, so
`UI_VISUALLY_REVIEWED` is only claimable after the operator opens the capture files.

## Known limitations tracked here

* **F45-B** (server-side synchronous scanner starvation) — out of UI scope, still open.
* Optional yt-dlp / download-engine upgrades — out of scope, status unchanged.
* Activation on a *running* environment is an operator dispatch action; a green CI run does not
  update a live session.
