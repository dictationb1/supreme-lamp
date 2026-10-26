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
