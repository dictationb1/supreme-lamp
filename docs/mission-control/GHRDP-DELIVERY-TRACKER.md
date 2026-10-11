# GHRDP DELIVERY TRACKER — continuation index (session 2026-10-10, branch `arena/e491ab8c-supreme-lamp`)

**Why this file exists.** The previous canonical tracker lived only on repair
branches (`814e2b2`, `26a9764`/`e3acf15`) inside sandboxes that are gone:
**MISSING_COMMIT_ACCESS** — their contents cannot be recovered or re-verified,
so nothing below re-states their line items as fact. This file is the new
single index going forward; every row carries an evidence tier and a
publication status, and unexecuted work is never labelled PASS.

**Evidence tiers**: CLAIM (asserted, not checked) · INSPECTION (read the code,
not run) · REPRO (reproduced locally) · STATIC (structural gate executed) ·
COMPONENT (vitest/node:test executed) · WINDOWS-NATIVE (pwsh lane on Windows) ·
BROWSER (Playwright executed) · CI (GitHub Actions run) · DEPLOYMENT (live).
**Publication**: LOCAL_ONLY · PR_OPEN · MERGED · DEPLOYED.

## 1. This session — checkpoint

| Fact | Value | Tier |
|---|---|---|
| origin/main | `179a25a8187f7a892da8d7b07833a4ae81e4e1c0` | INSPECTION (git) |
| Session branch | `arena/e491ab8c-supreme-lamp`, base merge `3cfb8c6` (PR #221 head `008b754` merged INTO this branch, keeps its Mornye-inspired glass UI) | INSPECTION |
| PR index | #221 OPEN (head `008b754`), #220 MERGED, #219 OPEN, #208 OPEN | INSPECTION (gh) |
| Missing work | `814e2b2`, `26a9764`/`e3acf15` — MISSING_COMMIT_ACCESS; reconstructed below, not claimed | — |

## 2. E2E lane #203 — first real failure found, defect fixed

| Item | Detail | Tier | Status |
|---|---|---|---|
| Root cause | specs f86/f78/f84/f81/f91 asserted a window-open/launch-url transport, but every result surface uses the F91 queue transport (`openMirrored` → POST `/api/launcher/queue`); plus SPA-fallback traps (relative in-page fetches resolve against vite preview's index.html, not the mock) | REPRO (static analysis + gates) | LOCAL_ONLY |
| Fix A+C | specs migrated to the queue-transport mirror contract: `isolateExternalNetwork`, `closeExtraPages`, MOCK-absolute fetches (f91 stream fetches take `mock` into `page.evaluate`); mock CORS `*` on live `/api/stream` branches | COMPONENT (F203-a..k gates) | LOCAL_ONLY |
| Defect B | `openMirrored` passed `noopener,noreferrer` to `window.open`; the HTML spec forces a **null return whenever noopener is set** (MDN Window.open; whatwg/html#1851), so EVERY mirror click faked `popupBlocked` even when the tab opened. Fixed: open plainly (implicit noopener on all modern engines), then `win.opener = null` (spec's cross-origin-safe sever) — return value is truthful again; superseded pins carry dated comments | COMPONENT | LOCAL_ONLY |
| Gate | `tests/f203-e2e-lane.test.js` 11 tests incl. F203-k (pinned mirror-click spec list + same-line click detector) | STATIC | LOCAL_ONLY |
| Browser proof | **NOT_RUN** here (no browser in sandbox). Verification owner = the `e2e-ui.yml` CI lane after authorized push | — | NOT_RUN |

## 3. F45 — real server responsiveness (readiness repair, this session)

The synchronous `Get-WinEvent` startup scans previously ran **before**
`$listener.Start()`, so a slow event-log walk delayed the bind, the
`server-ok.txt` marker, and every harness waiting on it.

| Item | Detail | Tier | Status |
|---|---|---|---|
| §1 reorder | `payloads/ghrdp-server.ps1`: listener.Start() + LISTENING marker now precede the F28/F30/F37 startup scans; scans keep their exact call literals (lockstep greps in f28/f30/f37/launch-gates/autologin/f60 untouched) | STATIC | LOCAL_ONLY |
| §2 `/health` | new route before `/diag`: `{ok, app='ghrdp', pid, listenerBound, bind, port, serverStartedUtc, scans:{logon,connLog,telescope:{scanTs,probeError}}}` — readiness (instance identity) is separated from scanner FRESHNESS; a slow first scan reads as `scanTs:null`, never `ok:false`; loopback-only like `/diag`, no credentials | STATIC | LOCAL_ONLY |
| §3 pacing | accept-loop yield now `GHRDP_SCAN_DELAY_MS` (clamped 5..1000ms, default 50). Pacing knob only — it cannot shorten a scan running on the accept thread | STATIC | LOCAL_ONLY |
| Harnesses | `tests/f45-fx-server.ps1`, `tests/f49-mirror-runtime.ps1`, `.github/workflows/autologin-lab.yml` now require **marker + HTTP 200 `/health` + pid match** (marker pid vs `/health` pid vs started-process pid) — a stale marker over a recycled port fails loudly | STATIC (runtime = WINDOWS-NATIVE lane) | LOCAL_ONLY |
| Structural lock | new `tests/f45-readiness.test.js` (9 rules F45-R1..R9) | STATIC | LOCAL_ONLY |
| Windows-native runtime proof | **NOT_RUN** here (no PowerShell in sandbox). Verification owner = `windows-native` + `autologin-lab` CI lanes | — | NOT_RUN |

### F45-B work package (DEFERRED by design — not dropped)

The reorder fixes *readiness* but not mid-scan latency: a scan running on the
accept thread still pauses request draining while it executes. Moving scans
"after the drain" is insufficient (the user's explicit requirement). The real
fix is an **isolated bounded scan worker** (runspace or detached process) with
atomic state files and a `GHRDP_SCAN_GATE_FILE` seam so the Windows-native lane
can block a scanner at a real boundary and assert `/health` + authenticated
reads within budget, then exercise release/fail/timeout. It was NOT built in
this PR because the scan functions have cascading in-file dependencies in the
9.4k-line server, there is no PowerShell in this sandbox to verify any
concurrency, and shipping untested concurrency into the production server is
worse than an honest deferral. Owner: next Windows-capable session.

## 4. Glass UI / contrast (#213/#214 lineage, preserved from #221)

| Item | Detail | Tier | Status |
|---|---|---|---|
| Accent contrast (LIGHT) | `#0ea5e9` measured **2.77:1** on the white surface — below AA. Repaired to `#0369a1` (5.93:1 on surface, 5.42:1 raised), hover `#075985` (7.56:1), on-fill fg `#ffffff` (5.93:1), focus ring `#0369a1`; all measured locally (WCAG relative-luminance math) | REPRO (computed) | LOCAL_ONLY |
| fx selection border (LIGHT) | non-text boundary 2.77:1 → `#0284c7` (4.10:1 ≥ 3:1); pin updated with dated comment | REPRO (computed) | LOCAL_ONLY |
| Dark theme | unchanged (`#0ea5e9` = 5.28:1 / 6.44:1 on the slate surfaces) | REPRO (computed) | LOCAL_ONLY |
| Candidates flagged, NOT changed | tertiary `#64748b` = 4.34:1 on the raised tint (4.76:1 on white); warning `#d97706` = 3.19:1 on white (icon/UI sizes pass at 3:1). Composite glass ratios are browser-lab questions, not token math | INSPECTION | OPEN |
| Gates | build OK (tsc+vite singlefile 1.15 MB), no-neon-green, regression-ids 219/219, bottom-bar, fx-ids, ps-balance — all green after the repair | COMPONENT/STATIC | LOCAL_ONLY |

## 5. Full regression state at commit time (this tree)

| Suite | Result | Tier |
|---|---|---|
| `node --test tests/*.test.js` | 832 tests, 806 pass, 0 fail, 26 skip | COMPONENT |
| `npx vitest run` | 98 files, 1265/1265 pass | COMPONENT |
| `scripts/ps-balance-audit.mjs` | 0 surfaces failed | STATIC |
| `playwright --list` (e2e-ui config) | 136 tests / 22 files collect clean | STATIC |
| Browser E2E execution | NOT_RUN (sandbox has no browser) → CI lane | — |
| Windows-native execution | NOT_RUN (sandbox has no pwsh) → CI lane | — |

## 6. Standing backlog (issue index, preserved verbatim)

#191 hub · #193/#209/PR#208 Collector/DVR privacy · #194 truthfulness ·
#199/#200 contracts · #203 e2e (fixed this session, awaiting CI proof) ·
#210 downloads · #211/#212 metrics · #213/#214 glass/responsive · #215/#218
research · #216/#217 search/scale · PRs #219/#220/#221.

## 7. Honesty rules this tracker enforces

1. No PASS for anything unexecuted — it is NOT_RUN or BLOCKED, with the owner
   lane named.
2. Historical figures (contrast, perf, counts from earlier sessions) are
   CLAIMS until reproduced; this session reproduced only what it lists as
   REPRO/COMPONENT above.
3. Budget telemetry: **UNKNOWN** in this sandbox (no metering API reachable);
   see `BUDGET_LEDGER.md` (prior session) for the rule of record.

---

# SESSION 2026-10-10 (b) — branch `arena/f289f02e-supreme-lamp`

Continuation of the #222 repair line. This section records only what this
session **executed**; nothing here restates a prior session's claim as fact.

## B1. Failure registry (built BEFORE any code was changed)

Three red check runs were live on PR #222 head `b213fd42`.

| ID | revision / event | run / job | failing step | first actionable error | reproduction | cause confidence |
|---|---|---|---|---|---|---|
| GATES-01 | `b213fd42` / `pull_request` | run 38057454377 / job 114228734592 | `gates` step **32** "F37 telescope single-source + self-explaining lab gates" | `F37: the telescope startup scan is missing` | **REPRODUCED locally**: extracted the step verbatim to a script and ran it at repo root → identical message, exit 1 | **HIGH** |
| GATES-02 | `b213fd42` / `push` | run 38057418836 / job 114228631728 | same step | same annotation (`.github:217`) | same script | **HIGH** (same cause, different checkout) |
| E2E-01 | `b213fd42` / `pull_request` | run 38057454362 / job 114228734568 | `e2e-ui` step **8** "Run F78 + F79 E2E specs" | `F79-E2E-TALLY:: … f84-ux.spec.ts ✘=4 …` | **NOT reproducible here** — no browser binary and `cdn.playwright.dev` is egress-blocked | **LOW** (see B3) |

The two `gates` runs are the **same defect in two checkouts**, not two defects.
Neither is the earlier `windows-native`/F45 failure — `windows-native`
**passed** on both runs (job 114228734732 and 114228631588).

## B2. GATES-01/02 — cause, repair, regression proof

**Cause (HIGH).** Commit `b213fd42` ("F45 readiness repair") deliberately moved
the three startup scans (F28 logon, F30 conn-log, F37 telescope) to run
**after** the listener bind, so readiness is not held hostage by a synchronous
`Get-WinEvent` walk. That reworded the F37 comment from
`STARTUP SCAN: the telescope stamps BEFORE the first client can poll` to
`STARTUP SCAN: the telescope stamps promptly after the listener starts`.
`tests/f37-telescope.test.js` was updated to the new sentence; the **workflow
gate** at `launch-gates.yml:1905` was not. It grepped the old prose and failed.
The scan itself was intact — this was a prose-pin break, not a runtime defect.
This is exactly the class the brief warned about: a green `node --test` does
not cover a workflow shell step.

**Repair (deliberately NOT a prose swap).** Both surfaces now pin the
*behaviour* the sentence stood for, structurally:
- (a) the startup-scan **call** exists;
- (b) it runs **after** the `LISTENING` marker (readiness observable first);
- (c) it runs **before** the accept loop drains (the first client the loop
  serves cannot poll a never-attempted sample).

Verified anchors in `payloads/ghrdp-server.ps1`: marker line **9258** <
telescope startup scan **9274** < accept loop **9462**.

This is strictly stronger than the sentence: a reworded comment can no longer
break the gate, and deleting or reordering the scan still does. No assertion,
retry or timeout was loosened.

**Regression proof executed locally:**
| Check | Result | Tier |
|---|---|---|
| F37 gate step, extracted verbatim from the edited workflow and run | `F37 gates PASS`, exit 0 (was exit 1) | STATIC |
| `node --test tests/f37-telescope.test.js` (runs *inside* that gate) | 36/36 pass | COMPONENT |
| `node --test` over all `tests/**/*.test.js` | 832 tests, 806 pass, **0 fail**, 26 skip | COMPONENT |
| `npx vitest run` | 98 files, 1265/1265 pass | COMPONENT |
| `pnpm run build` (tsc + vite singlefile) | OK, `ui/dist/index.html` 1,153 kB | STATIC |
| YAML parse of both edited workflows | OK | STATIC |

## B3. E2E-01 — what the evidence does and does not support

Comparing the tally annotation across runs (the only readable channel; the step
log host `results-receiver.actions.githubusercontent.com` and the artifact host
`pipelines.actions.githubusercontent.com` are both egress-blocked here):

| spec | PR #221 / main (before) | #222 head `b213fd42` |
|---|---|---|
| `f86-ten-sites-deep` | ✘=13 ✓=1 | **✓=12 — fixed** |
| `f78-add-sites` | ✘=4 ✓=18 | outside the 400-char annotation window |
| `f84-ux` | ✘=2 ✓=5 | **✘=4 — regressed** |

So the mirror-transport migration **did** fix the large `f86` failure and
**did** regress `f84-ux` by one test (retries:1 ⇒ ✘=4 = 2 tests × 2 attempts).

**What was ruled out by execution, not by reading:**
- The mock's `/api/launcher/queue` fence was started locally and probed:
  `navigate`+https → **200**, `navigate`+`javascript:` → **400**,
  `explorer`+https → **400**. Both fallback branches of tests 4 and 5 assert
  exactly those, so **the mock fence is not the cause**.
- `/api/fx/list` serves the real 5000-row fixture (`files=5000`, `schema=2`).
- `"Opened locally ✓"` is present in `src/i18n/en.json`
  (`mirror.openedLocal` / `openedBoth` / `rdpOffline`), so the test-5 toast
  text is not the cause.
- `card-direct-url` is a `<button>`, not an anchor, so the click cannot
  navigate the page away from under the assertions.

**What is NOT established:** the actual failing assertion. Without a browser or
the step log, any named cause here would be a guess, and a guess shipped as a
"fix" is how this lane stayed red for ~100 runs.

**Instrument repair (deliberately paired with B2, not a substitute for it).**
`e2e-ui.yml` now emits `F79-E2E-FAILn` — one bounded annotation per failing
test carrying `spec:line › title :: first error line`. The tally named the
*file*; this names the *assertion*. Verified against a realistic Playwright
list-reporter log. Pinned by a new assertion in `tests/f203-e2e-lane.test.js`
(F203-f, 11/11 pass) so it cannot silently disappear. Sanitized by
construction: Playwright's own header and first error line only — never a
request body, response body or signed URL.

This is evidence tooling. **It does not fix the application**, and E2E-01
remains **OPEN**.

## B4. Evidence-class tallies for this session

| Class | Result |
|---|---|
| SOURCE_INSPECTED | `launch-gates.yml`, `e2e-ui.yml`, `payloads/ghrdp-server.ps1` (telescope/health/accept-loop regions), `src/lib/launchUrl.ts`, `src/pages/search/ResultsGrid.tsx`, `tests/e2e/f84-ux.spec.ts`, `tests/f203-e2e-lane.test.js`, `tests/e2e/fixtures/mock-backend.mjs` |
| STATIC_CHECK | F37 gate PASS · YAML parse OK · build OK · ps-balance-audit 0 failures |
| COMPONENT_BEHAVIOUR | node:test 832/806/0/26 · vitest 1265/1265 · F203 lane pins 11/11 |
| WINDOWS_NATIVE | **NOT_RUN** — no `pwsh` in this sandbox → `windows-native` / `autologin-lab` CI lanes |
| BROWSER_LAB | **NOT_RUN** — no browser binary; `cdn.playwright.dev` egress-blocked → `e2e-ui` CI lane |
| CI_VERIFIED | pending — see the run table in the PR body |
| LIVE_VERIFIED | **NOT_RUN** — production activation needs separate authorization |

## B5. Delivery constraint recorded honestly

This session's environment is fixed to branch `arena/f289f02e-supreme-lamp` and
cannot push to PR #222's branch (`arena/e491ab8c-supreme-lamp`). #222's commits
were therefore carried forward by fast-forward (verified: `main` `179a25a` is an
ancestor of `b213fd42`) and the repairs are published from the session branch as
a clearly linked continuation. **Nothing from #222 was dropped.**
#221 and #222 must not be merged independently of this line.

---

## R2 — Mornye-inspired Mission Control UI (session 2026-10-11, branch `arena/851f647e-supreme-lamp`, PR #224)

**Checkpoint, refreshed rather than inherited.**

| Fact | Value | Tier |
|---|---|---|
| Base | `e9c4233` = `origin/main` head | INSPECTION (git) |
| #221 / #222 / #223 | all **MERGED** | INSPECTION (`gh pr view --json state,headRefOid`) |
| Is #223 source already in main? | **YES — identical.** `git diff --stat e9c4233 c017d1a -- src/` returns empty | REPRO (git) |
| Therefore the reported gap was | **a page that never adopted the glass system**, not a stale artifact, not a cache, not an intentional opaque mode | REPRO |
| PR | #224, head `47ae0768` | CI |

### Five defects located in source, each fixed

| # | Defect | Location found | Fix | Tier |
|---|---|---|---|---|
| 1 | `DiagBundleCard` rendered **fully opaque on every browser**: `<div className="glass …">` carries no `data-glass-samples`, so neither `globals.css` selector matched → no `backdrop-filter`, `--glass-alpha` fell back to `1` | `DiagBundleCard.tsx:56` | `GlassContainer surface="nested"` | REPRO → COMPONENT |
| 2 | Overview order was the pre-R-GLASS stack (title repeat → export banner → **credentials** → WebDesktop → only then connection) | `Overview.tsx` | 7-band composition; deep cards into a closed `<details>`; 219-id lock still passes | REPRO → COMPONENT |
| 3 | Assistant-specific wording on a product action ("for Claude", "paste to Claude") | `en.json:1254/1257/1276`, `si.json:1220/1223`, `Collector.tsx:343` | neutral "Export diagnostics" in both catalogs | REPRO |
| 4 | Light tertiary **4.344:1** on `bg-surface-raised` (passed on white at 4.759:1, so a surface-only audit missed it) | computed from `tokens.css` | `#566274` → 5.646:1 | REPRO → STATIC |
| 5 | Light warning `#d97706` = **3.186:1** as text at 63+ call sites | computed from `tokens.css` | classified: `--color-warning` text-safe `#b45309`; `--color-warning-accent` decoration-only, enforced by gate | REPRO → STATIC |

**Two further light-theme failures found that were NOT in the reported list** —
success `#059669` at **3.440:1** and danger `#dc2626` at **4.408:1** — surfaced by
turning the audit into `scripts/check-contrast.mjs` (18/18 pass). No threshold
was lowered.

### Status labels (kept separate, never collapsed)

| Label | State | Evidence |
|---|---|---|
| `UI_IMPLEMENTED` | **DONE** | PR #224 head `47ae0768` |
| `UI_VISUALLY_REVIEWED` | **NOT DONE by the agent** | 16 `r2-*.png` written by the CI lane, but the artifact lives on `blob.core.windows.net`, unreachable from this sandbox. **The operator must open the artifact** — a screenshot job without inspected images is not visual review. |
| `BROWSER_VERIFIED` | **PARTIAL — structural only** | `e2e-ui` PASS at `47ae0768`; 10 R2 tests ran in real Chromium: no horizontal overflow at 4 viewports, connect panel above the fold, header < 80px, credentials in a closed disclosure, 4 mobile links with real hrefs, focus restoration after Escape, `data-glass-quality-resolved` values, reduced-transparency → opaque, opaque persists across reload, Explorer DOM bounded. **Not** a visual judgement. |
| `CI_VERIFIED` | **PARTIAL** | `e2e-ui` PASS, `gates` PASS, `proof` PASS, `build-ui-prebuilt` PASS at `47ae0768`; `windows-native` still pending at time of writing |
| `DEPLOYED` | **NO** | not performed; needs separate authorization |
| `LIVE_VERIFIED` | **NO** | not performed |

### Retrievability repair

The step log and the artifact blob are both unreachable from an agent sandbox, so
`e2e-ui.yml` now emits the R2 capture proof as **check-run annotations** (the one
channel that is reachable) and **fails the lane when the R2 spec wrote nothing** —
so a green lane can no longer be misread as visual coverage. Verified live:
annotation `R2-VISUAL-FILES` lists the captured `r2-*.png` at job `114389952590`.

### Still open, unchanged by this PR

**F45-B** synchronous scanner starvation — untouched, still tracked. Green UI CI
does not close it. Acceptance remains: the real scanner boundary blocked while the
Windows server keeps answering health and authenticated read-only requests inside
budget, with bounded workers, consistent snapshots and cleanup.

---

## Mission Control v3 — all-screen UI upgrade (session 2026-10-11, branch `arena/403ecbde-supreme-lamp`)

**Canonical tracking: issue [#225](https://github.com/dekarita/supreme-lamp/issues/225).**

The v3 plan is a suite of four documents under `docs/mission-control/v3/` — this tracker indexes
them and does not compete with them:

| Document | Owns |
|---|---|
| [`v3/MASTER-PLAN.md`](v3/MASTER-PLAN.md) | sections A–M: refreshed source model, requirement mapping, IA, component reuse/replacement decisions, material/typography/spacing spec, data contracts, a11y, budgets, packages V3-01…V3-08, PR strategy, exclusions |
| [`v3/SCREEN-STATE-MATRIX.md`](v3/SCREEN-STATE-MATRIX.md) | 11 primary routes + 4 lab routes + catch-all + 17 shared overlays × 10 states |
| [`v3/DESIGN-SYSTEM.md`](v3/DESIGN-SYSTEM.md) | level model + published blur/alpha/border/saturation/radius values, each classified |
| [`v3/VERIFICATION-RELEASE.md`](v3/VERIFICATION-RELEASE.md) | evidence classes, gates, test method, visual capture, build identity, activation + rollback |
| [`v3/TRACKING-ISSUE-225.md`](v3/TRACKING-ISSUE-225.md) | the prepared #225 body, kept in-repo because the GitHub integration cannot edit issues from this session |

### Why v3 exists (defects located in source, not inherited statuses)

| ID | Defect |
|---|---|
| D1 | `NESTED_FILL_FLOOR = 0.86` collapses Tinted and Clear onto the same pixel on every nested surface (at the default clarity both compute below the floor). Only the TopBar sampled the backdrop, so the Tinted/Clear control changed ~56 px of chrome. Documented as shipped in `R2-DESIGN-TOKENS.md` rows 74–80 |
| D2 | One blurred bar is not a glass workspace — every content panel is a nested 0.86 plate |
| D3 | Dense TopBar: 4 status chips + Reconnect + clock + 4 controls on one row |
| D4 | 10 of 11 routes have no shared page identity (ad-hoc `<h2>` + `Card` stacks) |
| D5 | `deriveConnectionState()` calls a 4624 "connected" with no freshness and no current-run validation |

### Fix in one paragraph

One shared sampling surface — the **app glass sheet** (fixed, `aria-hidden`, z-index 1, between the
decorative field and the shell content) — carries the Tinted/Clear and clarity difference; the
sidebar/bars (`overlap`), cards (`card`) and rows (`row`) add constant additive deltas so the
difference survives into the content; overlays keep their own sampler and a high fill floor because
content scrolls behind them. Steady-state `backdrop-filter` count stays at **1**.

### Note on the previous session

An earlier v3 session worked on branch `arena/5fe3bfee-supreme-lamp`, which was never pushed and no
longer exists on the remote. Its code work is unrecoverable; its findings were re-verified against
source before reuse. This tracker records only what is reproducible from the current tree.

## Mission Control v3 — `e2e-ui` root cause and the header height budget (session 2026-10-11, branch `arena/88d52e64-supreme-lamp`)

**Continues [#225](https://github.com/dekarita/supreme-lamp/issues/225); succeeds PR [#226](https://github.com/dekarita/supreme-lamp/pull/226).**
Full write-up: [`v3-e2e-ui-ROOT-CAUSE.md`](v3-e2e-ui-ROOT-CAUSE.md). Sinhala addendum: [`v3/VAAHANA-225.md`](v3/VAAHANA-225.md) §10.

### Why this session is on a different branch

This session is bound to `arena/88d52e64-supreme-lamp`, whose starting tree (`881f26b`) contained none
of the v3 work, and it cannot push to PR #226's head branch. The operator chose to carry the v3 delta
onto this branch and open a successor PR. Verified before applying, not assumed: `881f26b`,
`origin/main` (`a26aa9c`) and the v3 base `acb27c8` differ **only** by the bot-maintained
`docs/status.json` timestamp, so no `main` work is lost; the 67-file delta does not touch that file;
applied as a 3-way `git diff --binary acb27c8 07e04a7`, every hunk clean; the resulting tree equals
`07e04a7` plus `docs/status.json` plus the write-up.

### The failure, named without the step log

`gh run view --log` is unusable from an agent sandbox, but the lane's own **check-run annotations**
are readable — the channel `tests/f203-e2e-lane.test.js` rule F203-f exists to guarantee:

```
gh api repos/dekarita/supreme-lamp/check-runs/114420650385/annotations
  → F79-E2E-FAIL1:: tests/e2e/r2-visual.spec.ts:67:9 › 1. Overview at phone (390x844)
    Error: the header must be compact, not a hero :: Expected: < 80 | Received: 84
```

Exactly one spec failed. Run `38122739344`, job `114420650385`, SHA `07e04a7`, step 8.

### Defect D6 — the page header had no height budget outside English

| | |
|---|---|
| Defect | V3-01's shared `PageHeader` puts title + live status + actions in **one `flex-wrap` row** with a purpose line beneath it. At 390 px that row had **2 px of slack** (the actions link ended at `x=374` against a 16 px gutter), so any font-metric difference wrapped it: `20 + 8 + 36 = 64` title row, `+4` gap, `+16` purpose = **84 px**. That is why every local run was green while the lane was red |
| Worse | In Sinhala the same header wraps with **no** font difference at all: `64 + 4 + 32` = **100 px**, 25% over budget on every browser. Nothing caught it because `r2-visual.spec.ts` never sets `ghrdp:lang` |
| Gate verdict | The R2 `<80` invariant is **correct and untouched**. `DESIGN-SYSTEM.md` specifies a conformant header as one 36 px control row `+4` + purpose = 56 px; both 84 and 100 come from an unintended extra row. Raising the ceiling to 85 would have been changing a threshold after measurement to hide a regression |
| Fix | `PageHeader`: purpose line bounded to two lines (`line-clamp-2`), full text still in the DOM and exposed via `title`. `OverviewHeader`: below `sm` the painted presentation summary is withdrawn and the link becomes icon-only (`sr-only … sm:not-sr-only`), the summary joining the link's `aria-label` so nothing is lost to a phone or screen-reader user. No i18n key added or removed — the 1213 flat-key parity lock is untouched |

### Measured, on the built bundle (Chromium 153)

| Catalog | viewport | header | actions wrapped | `<80` | slack before actions |
|---|---|---|---|---|---|
| en | phone 390×844 | 56 (was 56) | no | pass | **2 px → 151 px** |
| si | phone 390×844 | **72** (was 100) | no | pass | negative → **100 px** |
| en/si | phoneLandscape · tablet · desktop | 56 | no | pass | — |

All 8 viewport × catalog combinations under budget, `overflowX = 0` everywhere. Independently
corroborated by `scripts/v3-screenshots.cjs` on the rebuilt bundle: `07-overview-mobile`
`.docHeight` **2555 → 2527 (−28 px)**, exactly the wrap delta; its `bodyText` **unchanged**
(withdrawn from paint, not from the document); `variantProof` **byte-identical** to the committed
evidence (sheet 0.745→0.61, card 0.824→0.69, Δ0.135), so the glass material system is unaffected.

### New gate, with regression evidence

`tests/e2e/v3-header-budget.spec.ts`, 9 tests, the **same** hard-coded `<80` ceiling — a budget
re-derived from the current build is not a budget. Pins the height; the wrap mechanism directly; that
the header was not made small by **deletion**; that the withdrawn summary survives in the DOM and in
the accessible name; no overflow; and that `html[lang]` really follows the requested catalog.

Reverting both component files to their `07e04a7` state and rebuilding fails **all 9**, `si/phone`
failing on the height budget itself. Honest caveat: the EN phone *height* assertion does not fail
locally when reverted (56 px in this sandbox) — the EN 84 px reproduces only on the CI runner's
Chromium, and locally the EN case is caught by the accessible-name, `title` and paint assertions.

### Gates on the fix commit

| Gate | Result |
|---|---|
| `pnpm run build` (tsc + vite) | PASS — `ui/dist/index.html` 1,201.80 kB |
| `pnpm exec vitest run` | PASS — 103 files / 1351 tests, 0 fail |
| `node --test tests/*.test.js` | PASS — 835 tests, 809 pass, 26 skip, 0 fail |
| `node scripts/check-glass-contrast.mjs` | PASS — 1432 composited checks, worst text 4.97:1, worst control 5.14:1 |
| `pnpm run e2e` (`CI=true`) | PASS — **144 passed, 11 skipped, 0 failed** (5.0 m) |

`144 = 135` baseline at `07e04a7` `+ 9` new. The baseline vitest, node and contrast numbers are
unchanged, so nothing was traded away for this fix.

### Environment repair, and the dependency surface

`@sparticuz/chromium`'s Lambda arg list kills Chromium 153 under puppeteer-core 25 before the CDP
handshake (WS close 1006 → a 30 s `Target.setDiscoverTargets` timeout); both the raw `mod.args` and
`mod.args` minus `--single-process` fail. `scripts/v3-screenshots.cjs` now passes an explicit
documented arg list with **no silent fallback chain**, so a pixel sample can never come from a
half-initialised compositor. Neither `@sparticuz/chromium` nor `puppeteer-core` was added to
`package.json` or `pnpm-lock.yaml`; both were installed outside the tree and symlinked into the
gitignored `node_modules`, leaving the PR dependency surface and CI's `--frozen-lockfile` unchanged.

### Status labels (kept separate, never collapsed)

| Status | Value |
|---|---|
| `PLAN_READY` | met |
| `UI_IMPLEMENTED` | met — V3-01…V3-06 plus the header height budget |
| `BROWSER_VERIFIED` | **partial** — Chromium viewport + UA emulation across 8 combinations. `REAL_DEVICE` = **NOT_MEASURED**; Playwright Chromium is not an iPhone |
| `UI_VISUALLY_REVIEWED` | **operator required** — the agent cannot see images; every visual claim comes from `measurements.json` and computed geometry |
| `CI_VERIFIED` | **met at SHA `8d9d390d`** — PR #227, **10/10 checks PASS**: `e2e-ui` 6m21s (step 8, the exact step that failed at `07e04a7`, now `success`), `gates` 4m34s, `windows-native` 12m4s, `build-ui-prebuilt` 45s, `proof` 4m38s, 4 labs. The green `e2e-ui` job emitted **zero** `F79-E2E-FAIL` / `F79-E2E-TALLY` annotations. Correction to a pre-push claim of mine: `autologin-lab.yml`'s push path filter does include `src/**`, so that Windows lane ran too — verified harmless (ephemeral `windows-latest`, synthetic `*.tailnet-lab.ts.net` FQDNs mapped to loopback, fixture IP `100.118.42.7`; the live host `100.125.76.40` appears nowhere in it, no `self-hosted` label, no `RunCommand`). It passed |
| `DEPLOYED` / `LIVE_VERIFIED` | not started |

### Still open, unchanged by this session

**V3-03** Sinhala copy parity for the Settings section headings and About/provenance labels
(English-only by deliberate choice, not yet revisited) · **V3-04** the 5,000-file File Explorer
populated-dataset contract · **V3-07** real-device evidence · **V3-08** perf budget, **NOT_MEASURED**
— no CPU throttling and no low-end device was used. F45-B / yt-dlp were not touched and are not
claimed. No workflow was dispatched, merged, closed or deployed; no RDP session was restarted.

---

## Mission Control v3 — UI completion + verified lab (session 2026-10-11b, branch `arena/f8b0d1a4-supreme-lamp`)

**Purpose.** Close the gap between the merged v3 implementation and the operator-requested
Mornye-inspired experience by (a) reconciling the plan against the actual merged base, and
(b) repairing the screenshot/verification lab so the visual evidence is trustworthy, then
delivering the remaining screen/state coverage and acceptance. This session does **not**
restart from scratch: V3-01…V3-06 are already MERGED via #227; what is repaired is the
*evidence* and the *remaining screens/states*, plus the Sinhala Settings/About copy and the
perfWatchdog sampling.

### Reconciled facts (re-inspected this session, not copied)

| Fact | Value | Tier |
|---|---|---|
| `main` head | `839db28` (status.json-only chain above #227 merge `a3e170d`) | INSPECTION (git + gh api) |
| Shallow-clone repaired | `git fetch --unshallow` before any ancestry claim | REPRO |
| PR #227 | MERGED `a3e170d` (head `d16e9137`) — integrates V3-01…V3-06 + header-budget fix | INSPECTION (gh) |
| Live RDP | run `38130242742` `in_progress`, head `7cd8d01f` (= #227 merge + status.json). NOT replaced | INSPECTION (gh run view) |
| CI on #227 merge | build-ui `38128675911`, autologin-lab `38128675906`, e2e-ui `38128675990`, launch-gates `38128675895` — all success | INSPECTION (gh run list) |

### Scope this session closes (carried from the #227 "still open" list)

* Repair `scripts/v3-screenshots.cjs` evidence weaknesses (coverage, strict API, fixture
  honesty, Tinted/Clear ΔE proof, issue seeding, build identity, gallery). See
  `VERIFICATION-RELEASE.md` §4.1.
* Image inspection: this environment CAN read PNGs; captures are inspected, not just measured.
* Remaining screen/state coverage across the 11 routes + overlays, recorded per-cell in
  `SCREEN-STATE-MATRIX.md` §6 with separate disposition states.
* Sinhala parity for Settings section headings + About/provenance labels (V3-06 carry-over).
* `perfWatchdog` overlay/scroll-container sampling repair + bounded-sampling assertion.
* Browser acceptance spec `tests/e2e/v3-acceptance.spec.ts`.

### Status vocabulary (never collapsed into "done")

DESIGNED → IMPLEMENTED → BEHAVIOR_VERIFIED → VISUALLY_REVIEWED → DEPLOYMENT_VERIFIED.
`REAL_DEVICE` stays **NOT_MEASURED** (no physical device attached); Playwright/puppeteer
Chromium emulation is labelled as emulation, never promoted.
