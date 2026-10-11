# BUDGET_LEDGER — researched-upgrade implementation session

**Date**: 2026-10-10 · **Branch**: `arena/a50d3050-supreme-lamp` · **PR**: #220
**Rule of record**: cap 20%; **stop before 18%** when real telemetry is available, otherwise report `UNKNOWN`.

## Axes that CAN be measured here — and their real numbers

| Axis | Meter | Reading | Verdict |
|---|---|---|---|
| GitHub Actions minutes, this branch | `gh run list --branch … --json startedAt,updatedAt,name` | **≈ 47 min** across 5 workflows × 2 heads (e2e-ui 18.6 + 18.6, launch-gates 10.1 + 10.0, autologin-lab 5.7, windows-native 10.0, build-ui 0.7, plus labs) | measured; the two `e2e-ui` runs are 74% of it, and both are the #203 investigation itself |
| Agent context window, this session | harness counter | **744,605 / 1,000,000 = 74.5%** as of the last reading, before the #203 second pass | measured; this is why #214/#213 were not started |
| Dependency delta | `git diff package.json` | **0** — byte-identical to `main` (8 runtime / 21 dev) | measured |
| Repository byte delta | `git diff --stat 017f719c..HEAD` | ~1.2 kB of build output growth; no new file type | measured |

## Axes that CANNOT be measured here — reported as UNKNOWN, not estimated

| Axis | Why it is unknown |
|---|---|
| Monetary spend / API-dollar cost | no billing or usage API is reachable from this sandbox; **UNKNOWN** |
| Per-model token accounting | not exposed; **UNKNOWN** |
| Total Actions minutes for the whole repository (other branches, `main`, scheduled runs) | out of scope and not attributable to this session; **UNKNOWN** |
| Wall-clock share of the *repo-wide* 20% budget | the cap has no published denominator; **UNKNOWN** |

**Bottom line**: against the only denominators I can actually read, this session is at
**74.5% of the session context budget** and **≈47 measured CI minutes**. Against the
20% programme cap the answer is **`UNKNOWN`** — I will not invent a denominator to
produce a number that looks compliant.

## What the budget went to

| Work | Share (qualitative) |
|---|---|
| #211/#212 metrics — 5 source modules, 35 tests, plus 4 defects found and closed | large |
| #216 search-failure explanation — pure module, component, wiring, 17 tests | medium |
| #217 Explorer windowing — rewrite, 13 tests, one subtle `PureComponent` trap | large |
| #210 stage 1 — rail honesty, 13 tests, and the blocked-dependency write-up | medium |
| #203 e2e lane — two instrumentation passes, 7 static pins, two CI runs read | medium-large |
| Ledger addendum + AGENT_STATE + this file | small |

## Deliberate stops (to stay inside the budget)

- **#214 (cross-device UX) and #213 (glass) were not started.** Both are recorded as
  `OPEN` with activation criteria rather than quietly dropped.
- **#210 stage 2 was not faked.** It is `BLOCKED_WITH_EXACT_DEPENDENCY` on a server-side
  status read that does not exist yet; shipping a client-side simulation of it would
  have been cheaper than writing the blocker down, and wrong.
- **No further #203 fix was attempted** after the tally identified the failure set:
  fixing a slow e2e step needs the step log or a browser, and neither is obtainable
  here. Reporting the finding beats guessing at a fix that cannot be verified.

---

# BUDGET_LEDGER — v3 `e2e-ui` root-cause and header-budget session

**Date**: 2026-10-11 · **Branch**: `arena/88d52e64-supreme-lamp` · **Fix commit**: `a8a05a2d`
**Rule of record**: cap 20%; **stop before 18%** when measurable, otherwise report `UNKNOWN`.

## Axes that CAN be measured here — and their real numbers

| Axis | Meter | Reading | Verdict |
|---|---|---|---|
| Dependency delta | `git diff --stat d5e7df54 a8a05a2d -- package.json pnpm-lock.yaml package-lock.json` | **0** — all three byte-identical | measured. `@sparticuz/chromium` and `puppeteer-core` were installed **outside** the tree and symlinked into gitignored `node_modules`, so CI's `--frozen-lockfile` is unaffected |
| Source delta | `git diff --stat d5e7df54 a8a05a2d -- src/ scripts/ tests/` | **4 files, +246 / −11** — 2 components (57 lines), 1 new spec (178 lines), 1 launcher repair (22 lines) | measured. No component deleted, no gate weakened |
| Bundle delta | `pnpm run build` output | **1,201.33 kB → 1,201.80 kB (+0.47 kB)** | measured. The added bytes are the `line-clamp-2` / `sr-only` rules and the `aria-label`, not new dependencies |
| i18n key delta | flat-key parity lock | **0** — 1213 keys per catalog, unchanged | measured. The six pin files did not need bumping |
| Test-count delta | `pnpm run e2e` (`CI=true`) | **135 → 144 passed**, 11 skipped, **0 failed** (5.0 m) | measured. `+9` is exactly the new spec; nothing moved from pass to skip |
| Baseline gate drift | vitest / node / contrast | **103 files / 1351**, **835 (809 pass, 26 skip, 0 fail)**, **1432 checks** — all identical to the recorded baseline at `07e04a7` | measured. Nothing was traded away for this fix |
| Layout budget | built bundle, Chromium 153, 4 viewports × 2 catalogs | **8/8 under the unchanged `<80` ceiling**; si phone **100 → 72 px**; slack en **2 → 151 px** | measured |
| GitHub Actions minutes, this branch | `gh run list --branch arena/88d52e64-supreme-lamp` | **≈ 36 min** across 5 completed runs — `launch-gates` 12m07s (PR) + 11m55s (push), `e2e-ui` 6m25s, `autologin-lab` 4m41s, `build-ui` 0m50s | measured. `launch-gates` ran twice because the workflow triggers on both `push` and `pull_request`; that is the repo's own config, not a re-dispatch. No workflow was dispatched by hand |
| CI outcome on the fix SHA | `gh pr checks 227` at head `8d9d390d` | **10 / 10 PASS** — `e2e-ui` 6m21s, `gates` 4m34s, `windows-native` 12m4s, `build-ui-prebuilt` 45s, `proof` 4m38s, 4 labs | measured. The green `e2e-ui` job emitted **zero** `F79-E2E-FAIL` / `F79-E2E-TALLY` annotations, so no spec failed |

## Axes that CANNOT be measured here — reported as UNKNOWN, not estimated

| Axis | Why it is unknown |
|---|---|
| Agent context-window share for this session | no harness counter is exposed to the agent in this session; **UNKNOWN** — no denominator will be invented to produce a compliant-looking figure |
| Monetary spend / API-dollar cost | no billing or usage API is reachable from this sandbox; **UNKNOWN** |
| Per-model token accounting | not exposed; **UNKNOWN** |
| `REAL_DEVICE` layout | no physical Android/iOS device is reachable; **NOT_MEASURED**. Chromium viewport emulation is not a phone |
| V3-08 perf budget | no CPU throttling and no low-end device was used; **NOT_MEASURED** |
| ~~Whether the CI runner's Chromium now passes~~ | **RESOLVED — no longer unknown.** The lane ran on the fix SHA `8d9d390d` and passed: `e2e-ui` step 8 `success`, 10/10 checks green, zero failure annotations. Moved to the measured table above |

## What the budget went to

| Work | Share (qualitative) |
|---|---|
| Reconciling a handoff whose branch, tree and v3 content did not match this session, then verifying a safe integration path | medium |
| Finding the failing spec through check-run annotations after the log host proved unreachable | small, and the highest-value step — it unblocked everything after it |
| Reproducing a failure that only appeared on CI: measuring the layout, discovering the Sinhala case, and identifying the 2 px slack as the mechanism | large |
| The fix, the new 9-test gate, and the revert-and-fail regression proof | medium |
| Re-running all five gates and refreshing the 10 screenshots + `measurements.json` | medium |
| Repairing the screenshot launcher (Chromium 153 + puppeteer-core 25) | small, but it needed three attempts and was bounded rather than open-ended |
| This ledger, the tracker section and the Sinhala addendum | small |

## Deliberate stops (to stay inside the budget)

- **The `<80` ceiling was not raised.** It would have been the cheapest possible green lane. The
  measurement said the header should be 56 px, so 84 px was a defect and the gate was right.
- **The screenshot launcher was given a bounded number of attempts**, then an explicit arg list with
  **no silent fallback chain** — a browser that will not start must fail the script, never produce a
  pixel sample from a half-initialised compositor.
- **`variantProof` was re-checked against the committed values rather than trusted**, because the
  launcher change altered the GL flags. It reproduces them byte-for-byte (0.745→0.61 sheet,
  0.824→0.69 card, Δ0.135), which is what makes the refreshed evidence usable.
- **V3-03, V3-04, V3-07 (real device) and V3-08 were not started**, and are recorded as unfinished
  rather than omitted. F45-B / yt-dlp were not touched and are not claimed as fixed.
- **No workflow was dispatched, no PR merged or closed, no RDP session restarted**, and no credential
  or auth policy was altered. Activation remains an operator decision that has **not** been requested.
