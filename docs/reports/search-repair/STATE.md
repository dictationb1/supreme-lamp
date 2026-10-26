# Revision and run log

| Field | Value |
|---|---|
| Branch | `arena/cd153e89-supreme-lamp` |
| Base | `main` @ `5af694b6` |
| Engine commit | `8b9b346` (provider engine, live GitHub tests, probe) |
| This report | committed with the docs it describes; the exact SHA is in the pull request |
| Node used for the recorded runs | v20/v22 (sandbox), vitest 2.1.9 |
| Live GitHub run | 11/11 pass — `evidence/github-live.txt` |
| Offline suites | 21 provider fixtures + 36 lane/store/UI fixtures — pass |
| Reachability probe | 15/15 HTTP 200 — `evidence/live-probe.json` (run ID 40255818095) |
| Full jsdom suite | see the pull request's check list; the pre-existing 3 failures (documented below) were fixed in this branch |

## Known environment limits of the authoring session

* Outbound network: only `github.com` / `api.github.com` / npm / pypi. No browser,
  no Playwright browser download, no PowerShell, no Windows.
* `NODE_EXTRA_CA_CERTS` is required for Node to trust the sandbox's TLS proxy;
  `scripts/run-provider-live.mjs` sets it automatically when the bundle exists and
  never disables certificate verification.

## Fixed in this branch (pre-existing failures)

1. `src/tests/smoke/search-page.test.tsx` — "shows the error state with retry":
   the new provider lane must not turn a failed dispatch into "partial" before any
   provider row exists.
2. `tests/f79-default-5-adapters.test.ts` — the lane must not consume the first
   `fetch` call in a test that asserts the request body of the server lane.
3. `src/tests/smoke/repo-identity-links.test.ts` — `docUrl("searchRepair")`
   pointed at a report that did not exist yet; this directory is that report.

## Gates green in the authoring sandbox (re-measured after the ledger/inventory update)

```text
npx tsc -p tsconfig.build.json --noEmit   -> 0 errors
npx vite build                            -> ui/dist/index.html built
npx vitest run                            -> 119 files / 1539 tests pass
node --test tests/*.test.js               -> 931 pass / 0 fail
npm run test:providers                    -> 36 pass (11 live tests skipped)
npm run test:providers:live               -> 11 pass against real api.github.com
```

Two of the `node --test` failures were environment-only and are NOT code defects:
the workflow validator shells out to Python's `yaml`, which is not installed in the
sandbox (`pip install pyyaml --break-system-packages` makes all 931 pass). The
launch-gates workflow installs it itself.

Pinned counts that moved with this change, each re-MEASURED rather than incremented:
`src/lib/ci/storageInventory.json` 26 -> 28 declared surfaces (ghrdp:searchSources,
ghrdp:providerTokens, both `addedBy: "F-SEARCH-REPAIR"`), the i18n flat-key lock
1280 -> 1384, and a new `stepLedger.json` entry (step 16, PR #102) so the two new
storage surfaces are attributable to a ledger feature.

## CI at revision `9afc508` (PR #102)

| Workflow | Run | Conclusion |
|---|---|---|
| `launch-gates` (static + unit + **Windows-native**, incl. parsing `payloads/ghrdp-server.ps1` with the PowerShell parser) | 40261801235 | success |
| `autologin-lab` (Windows proof suite) | 40261801144 | success |
| `F59 build-ui` (prebuilt UI release asset) | 40261801148 | success |

An earlier revision (`9583c36`) failed `launch-gates` at "Node Unit Tests &
PowerShell Parser": the repo's own gates (i18n key lock, storage inventory, the
data-testid rule) had not yet been updated for the new surfaces. `9afc508` fixes
exactly that and the gate is green — which is why the pinned counts in §"Gates"
above are re-measured here rather than incremented.

## MERGED — verification of the merged revision

| Field | Value |
|---|---|
| Pull request | #102 — https://github.com/dictationb1/supreme-lamp/pull/102 |
| Merged at | 2026-10-26T03:20:02Z |
| Merge commit | `243dced82a2f72e28b0f43908121f2c9c417b8bb` |
| Branch head that was merged | `0d7b08d` (identical tree to `9afc508` except this directory) |
| Base at merge | `main` `dca68a5` |

Checked **at the merge commit** (fresh worktree of `243dced`, node_modules linked):

```text
node --test tests/*.test.js               -> 931 pass / 0 fail
npx tsc -p tsconfig.build.json --noEmit   -> 0 errors
npx vitest run --config vitest.providers.config.ts
                                          -> 36 pass, 11 live skipped
node scripts/run-provider-live.mjs (github-live + search-store-live)
                                          -> 11 pass against real api.github.com
```

CI at `243dced` (main): `F59 build-ui` success, `autologin-lab` success,
`launch-gates` and `e2e-ui` running when this line was written — see the
workflow list for their conclusions; the same jobs were green on `9afc508`
(launch-gates 40261801235, autologin-lab 40261801144, F59 40261801148) and
`9afc508` differs from the merged tree only by documentation.

### Fresh dispatch of the live probe

`gh workflow run search-provider-probe.yml` returns **HTTP 403** for this token
(recorded earlier in this session): the dispatcher is not permitted on this
repository. The workflow is push-triggered on
`.github/workflows/search-provider-probe.yml` and
`scripts/provider-live-probe.mjs`. Exact operator action:

```bash
# either touch the workflow to trigger it on a branch/PR
git commit --allow-empty -m "ci: re-run the live provider probe"   && gh api -X POST repos/dictationb1/supreme-lamp/actions/workflows/search-provider-probe.yml/dispatches        -f ref=<branch>        # needs a token with `actions:write`
# or run the same script by hand on any networked machine
node scripts/provider-live-probe.mjs --out docs/reports/search-repair/evidence/live-probe.json
```

The last committed probe evidence (`evidence/live-probe.json`, run 40255818095)
covers 15 real endpoints and is what §3 of the README cites.

## Post-merge defect found by CI, and its repair

`e2e-ui` on `main` at `243dced` was **red**: `tests/e2e/f79-google-simple.spec.ts`
failed five assertions. The annotations the workflow emits (the step log itself is
not retrievable from this sandbox — `results-receiver.actions.githubusercontent.com`
is outside the allowed egress) read:

```text
F79-E2E-FAIL1 :: zero results names xyz ... Test timeout of 60000ms exceeded.
                 Expected substring: "No results for 'xyz'. Try broader terms or"
F79-E2E-FAIL2 :: Classifier... :: expect(locator).toHaveCount(expected) failed
                 :: Expected: 2 | Received: 12
F79-E2E-FAIL3 :: result typography ... :: Expected: 2 | Received: 12
```

Cause (demonstrated, not guessed): the client provider lane is ON in the
production bundle, the F79 fixture backend answers "tls" with exactly two rows,
and the Playwright runner has egress — so ten live GitHub rows were merged in on
top of the two fixture rows, and "xyz" stopped being empty because GitHub really
does return repositories for it. The fixture lane is hermetic by design; the
production path is correct and stays on by default.

Repair: `resolveLaneEnabled()` in `src/lib/search/providerLane.ts` honours
`localStorage["ghrdp:search.lane"] === "off"` and a
`window.__GHRDP_PROVIDER_LANE__ = false` override, read once at load; the E2E
config switches it off for every spec via
`tests/e2e/fixtures/lane-off.storage.json`. Three new tests in
`src/tests/providers/lane-and-stores.test.ts` pin the resolver *and* assert the
config + state file still agree with it. Evidence for the repair itself: the
`e2e-ui` run on the repair revision (see the PR), because a browser lane cannot be
executed in this sandbox (no Chromium binary, no browser egress).
