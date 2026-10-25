# Verification log — commands, results, identities

Environment: Linux sandbox, Node v22.22.3, pnpm 9.15.9, no PowerShell, no
Windows host, no Tailscale, no reachable application backend.

Tested source: `af483d2e7771df1055224edf7636518c2d1b61ac`
Baseline (main at session start): `451e8136c97f80563df5cf40fc9f6ed9f05eaa4d`
Branch: `arena/b462ed7a-supreme-lamp` · PR: #79

## Baseline, before any edit

| Check | Result |
|---|---|
| `git merge-base --is-ancestor d3f13d4 main` | true (PR #73 merge is in main) |
| `git rev-parse origin/main` | `451e8136c97f80563df5cf40fc9f6ed9f05eaa4d` |
| `gh run view 40139740003` | in_progress, headSha `2e16bffd`, started 2026-10-24T22:42:59Z |
| `pnpm vitest run` | **109 files / 1395 tests pass** (169 s) |
| `node --test tests/*.test.js` | 920 pass / 9 fail / 26 skipped → all 9 were i18n/storage/inventory locks **plus** two workflow-validator failures caused by the sandbox lacking Python `yaml` |

`gh run view 40139740003` is a **running workflow on an older revision**; it is
not evidence about any code in this PR (documented in the handoff).

## After the repair

| Command | Result |
|---|---|
| `pnpm exec tsc -p tsconfig.build.json --noEmit` | **clean** |
| `pnpm vitest run` | **111 files / 1453 tests pass** (+2 files, +58 tests) |
| `node --test tests/*.test.js` | **929 pass / 0 fail / 26 skipped** (955 total) |
| `pnpm run build` | ok — `ui/dist/index.html` **1,245,750 bytes**, single-file |
| `pnpm run check:regression-ids` | OK — 219 === 219 |
| `pnpm run check:fx-ids` | OK — 10 IDs + 1 class, 219 collision-free |
| `pnpm run check:contrast` | OK — all contrast checks passed |
| `pnpm run check:glass-contrast` | OK |
| `pnpm run check:bottom-bar` | OK — live-wired |
| `pnpm run check:no-neon-green` | OK — 1,245,749 bytes scanned |
| `python -c yaml.safe_load(launch-gates.yml / autologin-lab.yml)` | OK |
| PowerShell scanner brace/paren balance (quote-aware) | balanced (`(0,0)`, no negative dips) |

Workflow-validator note: `tests/workflow-validation.test.js` shells out to Python
`yaml`. With `pip install --break-system-packages pyyaml` both previously failing
cases pass (`# pass 6 / # fail 0`). This is an environment gap, not a repo defect,
and it is why the baseline showed 9 failures rather than 7.

## New test files

| File | Cases | What it pins |
|---|---|---|
| `src/tests/smoke/v4-conn-correlation.test.ts` | 43 | foreign/uncorrelated rejections, failure→success, failed-new-attempt vs live session, earlier-run events, console vs remote, freshness matrix, dead collector vs zero events, 12 Status/SubStatus cases, beacon ≠ connection, incident age/dedupe/resolution |
| `src/tests/smoke/v4-incident-ui.test.tsx` | 15 | the screenshot shape mounted through the shipped Overview: chip not "failed", foreign rejection as INFO history, no "rejected the stored credential", no "0s ago", ack ≠ resolve, no resurrection after reload, four WebSocket availability states |
| `tests/f204-logon-correlation.test.js` | 12 | the shipped PowerShell contract: extracted fields, source redaction, per-account reduction, machine-wide counts preserved, success-supersedes-failure, type-10 tracking, Status-aware classification, session block, PS 5.1 syntax, client/backend field drift |

## Adjusted pre-existing tests (all documented inline)

| File | Change | Why |
|---|---|---|
| `tests/f28-logon-recovery.test.js` | `IpAddress` removed from the blanket ban; replaced by redaction assertions | the ban blocked the correlation fix; the replacement asserts *no credential fields*, *public source classed*, *raw address only on the tailnet branch* |
| `tests/f-i18n-parity.test.js` + `f109` / `f110` / `f110b` / `merge-hygiene` | `EXPECTED_FLAT_KEYS` 1252 → **1267** (+15 V4 keys) | the count lock is a measurement; every new key exists in **both** catalogs |
| `tests/f111-ci-inventory.test.js`, `f110-live-patch.test.js`, `f110b-signing.test.js`, `src/lib/ci/storageInventory.json`, `stepLedger.json` | one new declared surface `ghrdp:incidentAcks` (`addedBy: F-V4`), counts 25→26 / live 21→22 | the inventory gate is derived; the new browser-local ack ledger must be declared, with a ledger entry so `addedBy` is a real feature id |
| `src/tests/smoke/v3-troubleshoot.test.tsx` | `FIVE` seed now carries attribution + freshness; `wsAvailability: "supported"` | see `coverage-audit.md` "Replacement invariant" |
| `src/tests/smoke/r2-overview-redesign.test.tsx` | `wsAvailability: "unsupported"` / `"supported"` seeds | same |

## What was NOT verified here (and is not claimed)

| Item | Status | Why |
|---|---|---|
| Real Windows `Get-WinEvent` execution of the new reduction | **NOT_RUN** | no PowerShell/Windows in this sandbox. Assertions were *added* to `.github/workflows/autologin-lab.yml` so the next lab run executes them. |
| `/health`, `/api/native-status` against a running instance | **NOT_RUN** | no backend reachable; the workflow run `40139740003` serves an older revision. |
| Browser E2E (`e2e-ui`) | **CI only** | dispatched by the PR; results are in the PR check list, not in this file. |
| Search / Files / Settings / Health live operations | **NOT_RUN** | independent of this PR's changes; requires a live backend. |
| Native RDP re-test on the user's VM | **NOT_RUN** | deliberately not attempted (would end the user's working session). No code path touched. |
| `main.yml` deployment (mode=rdp, runner_target=windows-latest) | **NOT_RUN** | must run on the **merged** revision, not on this branch. |

---

# Addendum — verification after the merge (lab feedback loop)

The merge itself is not evidence. This section records what the *merged* code did.

| Item | Value | Status |
|---|---|---|
| `autologin-lab` run `40144661716` (head `ae5ae2c1`) | job `proof`, step "V: F28 logon-result loop + one-click recovery + fallback gap" | **FAILED** |
| Failing assertion | `[V] stage=scan-corr-counts :: … got excluded=1 count4625=0` | real defect **D8** |
| `e2e-ui` / `launch-gates` / `F59 build-ui` (same push) | — | not read in this addendum |
| Fix commit | `ae9e64e93bc4f00fb856f7bb90be9e7ed568180c` | pushed to the session branch, PR `#80` |
| Local gates on the fix | `node --test tests/*.test.js` → **930 pass / 0 fail / 26 skipped** (was 929; +`V4-PS-13`) | PASS |
| Windows re-execution of `scan-corr-counts` | requires a lab run on `ae9e64e93bc4f00fb856f7bb90be9e7ed568180c` | **PENDING** (not claimed) |

D8 is described in `defects-and-reproductions.md` (Addendum). The two other red
cells in that run (`x` F30, `y` F31c, both `0x8009030D` runner key-ACL failures)
are reproduced identically in pre-merge run `40122884082` and are **not**
regressions of this repair.

Standing honesty note, unchanged: no deployed SHA exists. `main.yml` was never
dispatched, so nothing in this bundle describes a running instance.

---

# Merge 2 and the lab run on `main`

| Item | Value | Status |
|---|---|---|
| PR | [#80](https://github.com/dictationb1/supreme-lamp/pull/80) | **MERGED** 2026-10-25T00:30:41Z |
| Merge commit | `69de7846e182a061e86c079271f2670067b114af` | on `main` |
| PR checks on `08231502` | `gates` 5m57s, `windows-native` 11m24s, `e2e-ui` 8m38s, lab static 8m17s, summarize — all **pass** (two lab profiles `skipping`) | PASS |
| **`autologin-lab` run `40146979935`** (head `69de7846`, push-triggered on `main`) | job `proof` | **SUCCESS** |
| Lab matrix on `main` | `a b_c d_e f h i j k2 l m n o p r s t u v w x y z` — **all pass** | PASS |

This is the first run of this repair's §V assertions on `main` that ends green;
`v` (F28/V4 correlation) is among the passing cells, so the backend correlation
contract and the count-before-gate fix are verified in the language they ship in.

Two honest caveats, neither of which affects the verdict:

* The lab emits a tolerated `git push failed: remote: HTTP 401: Bad credentials`
  from its evidence-publish step on push-triggered runs. That step needs a token
  that a `push` event does not carry; the run still concludes `success`.
* **No deployment happened.** `gh workflow run main.yml --ref main -f mode=rdp
  -f runner_target=windows-latest` still returns
  `HTTP 403: Resource not accessible by integration` — reproduced twice, not
  retried further. The operator must dispatch it from the UI (see
  `replay-and-rollback.md`). Everything above describes CI, not a running
  instance.

Earlier same-push statuses for the first merge, now read (they were pending in
the previous addendum): `e2e-ui` `40144661687` **success**,
`F59 build-ui` `40144661692` **success**, `launch-gates` `40144661783` **success**.

