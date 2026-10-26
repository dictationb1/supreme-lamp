# Search repair — what was broken, what was built, and what is actually verified

Branch: `arena/cd153e89-supreme-lamp` · Base: `main` @ `5af694b6`
Last updated: 2026-10-26 (see `STATE.md` in this directory for the exact revision table).

This directory is the durable record of the Search + website-source repair. It is
written so that a reader who has never opened the repository can (1) understand
each defect, (2) see the evidence for the fix, and (3) re-run every check.

---

## 1. The one-paragraph summary

Search used to fan out **only** to five adapters compiled into
`payloads/ghrdp-server.ps1`, so a site the operator cared about (Open Culture,
Internet Archive, Openverse, an `awesome-*` list, `fmhy.net`, `rentry.org`) either
could not be searched at all or was searched through an interface that does not
exist. A pasted URL was handed to the server's query route, which rejects URLs by
design, so the operator saw a generic failure — often the words "authentication
required" for content that is entirely public. Sources could be added but never
edited, disabled, retested, exported or removed.

Now the app ships a **provider engine in the client bundle**
(`src/lib/providers/*`) that talks to each service through the interface that
service really exposes, reports **per-source** status (complete / empty / failed
with a typed reason / cancelled), keeps the results of the sources that worked
when another one fails, inspects a pasted URL into a preview and offers it as a
source only when that source can actually answer a later search, and manages the
whole source registry (add, bulk add, test, enable/disable, edit, retest, remove,
export, import) with the server as the durable store and `localStorage` as the
mirror that survives an ephemeral server run.

The one thing the server still needs is a **relay** for hosts that send no CORS
header (`/api/providers/relay`, added in this branch). Every provider the brief
names is reachable **directly** from a browser, so the relay is an optional
fallback, not a requirement — and it is the only part of this change that could
not be executed in the authoring environment (see §7).

---

## 2. Defects and their demonstrated causes

| # | Symptom the operator reported | Demonstrated cause | Fix |
|---|---|---|---|
| D1 | A pasted `https://github.com/mfkl/awesome-vlc#readme` never worked; the app asked for a password | the URL went to `POST /api/search`, which rejects `https?://` queries; the only URL path was the F58 "add site" probe, and the client mapped 401/403 to `addSite.authMissing` | a URL is now **classified** (`src/lib/providers/index.ts › classifyUrl`), **inspected** through the provider's own API and previewed. Public GitHub content is read anonymously (`api.github.com`, CORS `*`); no credential is requested anywhere in the URL path |
| D2 | `awesome.re` looked like a hostname mismatch | `awesome.re` redirects to `github.com/sindresorhus/awesome`; the host fence reported the canonical redirect as a mismatch | `awesome.re` is a **known alias** resolved in the classifier (`GITHUB_ALIASES`), and the inspection states "Resolved from awesome.re → github.com/sindresorhus/awesome" |
| D3 | A curated list was treated as a "GitHub Releases" source and reported as empty | the only GitHub adapter was `github-releases`; `GET /repos/sindresorhus/awesome/releases` legitimately returns `[]` | the GitHub provider reads the **repository, its README and its lists**; releases are one fact among many and the empty answer is shown as "none — this repository publishes no releases, which is normal for a curated list" |
| D4 | `ChessMax/awesome-programming-languages` needed a `sourceId` and "releases" | same as D3, plus the URL parser required a registry row | the parser accepts every GitHub URL shape; the live test `E` inspects this repository with no `sourceId` and no release requirement |
| D5 | Relative links in a README produced broken URLs | relative hrefs were emitted verbatim | the repo's **default branch** is read first and relative links are resolved against `https://github.com/<owner>/<repo>/blob/<branch>/<dir>/` (live test `K`) |
| D6 | Open Culture could not be searched | its `/?s=` search 302s to `/gcsearch`, a Google Custom Search page whose results exist only inside Google's script (measured: `docs/reports/search-repair/evidence/live-probe.json`) | the Open Culture provider reads the **RSS feed** and the **sitemap**, matches locally, and says so. A hit is the *editorial article*; the external resource it recommends is listed separately by the inspector |
| D7 | Internet Archive returned nothing useful | the shipped adapter was a "public" stub with no real query, filters or pagination | `archiveSearch` uses `advancedsearch.php` (real query language, real `numFound`, real `page`/`rows`, real sort), `archiveInspect` uses `/metadata/<id>` for the **authoritative file list** |
| D8 | Openverse never appeared | it was not in the adapter allowlist at all | `openverseSearch` uses the current `/v1/images/` and `/v1/audio/` endpoints; `license`, `license_type`, `creator`, `source`, `extension`, `category` change the request and are reported as applied |
| D9 | One failing source turned the whole screen into one error | all adapters were collapsed into a single request/response with one error string | `runProviderLane` runs sources **in parallel** and reports a separate outcome per source; a failure never removes another source's hits |
| D10 | Adding a site did not make it searchable; nothing could be edited | the F58 registry could only `POST` and `DELETE`; the Search page had no idea a source existed | `PATCH /api/f58/sources/<id>` (new), `notes`/`enabled` on `POST`, and `src/stores/sourcesStore.ts` which turns registry rows into search sources |
| D11 | Silent/decorative buttons | several controls had no handler, and some actions "succeeded" in the UI while the server rejected them | every control in the source manager acts on the store and surfaces the server's own error; `Add as source` is only offered when `InspectOutcome.addable` is true |
| D12 | Sinhala text missing for the new surfaces | the new UI had English-only strings | 104 keys added to **both** `src/i18n/en.json` and `src/i18n/si.json`; the parity test pins the key count |
| D13 | **After the merge**, `e2e-ui` went red on `main` at `243dced`: `tests/e2e/f79-google-simple.spec.ts` saw **12 result cards where its fixture backend serves 2**, never showed the empty state for `xyz`, and timed out | the app ships a **client provider lane** that queries the real providers from the browser. The F78/F79 lane runs the production bundle against a *fixture* backend that deliberately answers with two fixed rows, and the Playwright runner has working egress, so ten **live** GitHub rows were merged into the two fixture rows (`toHaveCount(2)` → 12) and `xyz` stopped being empty. Real result silently replacing a fixture — the mirror of the defect the brief forbids | `ghrdp:search.lane = "off"` is now a documented, read-once switch in `src/lib/search/providerLane.ts › resolveLaneEnabled()`, and `playwright.e2e-ui.config.ts` sets it for every spec through `tests/e2e/fixtures/lane-off.storage.json`. The lane stays ON for real sessions (default) and keeps its own deterministic + live suites. Pinned by three tests in `src/tests/providers/lane-and-stores.test.ts` |

---

## 3. What each provider can really do (measured, not assumed)

Evidence: `docs/reports/search-repair/evidence/live-probe.json` (real HTTP from a
GitHub runner, all 15 targets HTTP 200) and the adapter code comments.

| Provider | Interface used | Search | Filters that change the request | Pagination | Files / preview | Licence |
|---|---|---|---|---|---|---|
| GitHub | `api.github.com` (CORS `*`) | repository search + entries mined from curated lists | sort, list mining budget | partial (per_page) | file links from README | licence + stars + branch |
| Internet Archive | `archive.org/advancedsearch.php`, `/metadata/<id>` | full query language | `mediatype`, `collection`, `language`, `year`, `sort` | page/rows | real file list (name/size/format/md5), `services/img` preview | `licenseurl` when stated |
| Openverse | `api.openverse.org/v1/{images,audio}` | full text | `license`, `license_type`, `creator`, `source`, `extension`, `category`, media type | page/page_size | direct file URL + thumbnail | full licence + attribution |
| Open Culture | `/feed`, `/sitemap.xml` | feed + sitemap slug match (**partial** — there is no search API) | feed pages, sitemap scan | n/a | none (it links out) | article metadata only |
| FMHY | `/sitemap.xml` + each wiki page | local match over the taxonomy (**partial** — `/search` 404s) | pages read | n/a | n/a | n/a |
| rentry.org | `rentry.co/<slug>/raw` (Markdown) | local match over the page and its own sub-pages (**partial**) | depth, page cap | n/a | n/a | n/a |
| Any added website | feed → sitemap → on-site search form → page links | **partial**, reported per site | source | n/a | n/a | n/a |

A provider that cannot search says so in `capabilities.search === "unsupported"`
and the UI explains it; it is never added as a source that could never return a
row. `genericInspect` refuses to mark such a site `addable` and gives the reason.

---

## 4. Source management (the operator-facing part)

`Manage sources` on the Search page opens a dialog with three tabs:

* **Add website** — URL, optional display name, optional notes, live
  **type detection** (GitHub / Internet Archive / Openverse / Open Culture /
  FMHY / rentry / generic site), a **Test** button that runs the real inspection
  and prints what the site answered, and a capabilities table with the plain
  explanation of what will and will not work.
* **Manage** — one row per source: enable/disable, edit name/notes, retest,
  remove. Built-in providers are configurable the same way (they are rows in the
  same registry).
* **Transfer** — export the whole configuration as JSON, import it back, and a
  **bulk paste** area that adds many URLs at once with a per-line report.

Persistence boundary (deliberate, and pinned by tests):

1. the PowerShell registry (`/api/f58/sources`) is the durable store; a row added
   here appears in Search **without a redeploy**;
2. `localStorage["ghrdp:searchSources"]` mirrors the operator's overrides and
   custom rows so a restarted ephemeral server does not silently lose the setup;
3. export/import JSON is the file-level escape hatch, and its format is
   `{ format: "ghrdp.search-sources", version: 1, sources: [...] }`.

---

## 5. Evidence: what was executed, and where

| Check | Kind | Result |
|---|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | static | 0 errors |
| `npx vite build` | static | built (`ui/dist/index.html`) |
| `npm run test:providers` (21 tests) | **fixture** | pass |
| `npm run test:providers` lane/store suite (12 tests) | **fixture** | pass |
| `npm run test:providers:live` → GitHub suite (9 tests, real `api.github.com`) | **live** | pass — see `evidence/github-live.txt` |
| `search-store-live.test.ts` (2 tests: real GitHub results through the whole store; pasted URL inspection) | **live** | pass |
| `scripts/provider-live-probe.mjs` (15 real endpoints: Open Culture, archive.org, Openverse, api.github.com, fmhy.net, rentry.org) | **live** | all HTTP 200 — `evidence/live-probe.json` |
| `npm run test:smoke` (full jsdom suite) | static/fixture | see `STATE.md` for the recorded run |
| Browser click-through on a Windows VM with the real server | **not run here** — see §7 | BLOCKED in this environment |
| `launch-gates` (incl. the **Windows-native** job and its "Parse native PowerShell scripts" step, which parses `payloads/ghrdp-server.ps1` on a real Windows runner) | CI | **PASS** — run 40261801235, revision `9afc508` |
| `autologin-lab` (Windows native proof suite) | CI | **PASS** — run 40261801144, revision `9afc508` |
| `F59 build-ui` (prebuilt UI release asset) | CI | **PASS** — run 40261801148, revision `9afc508` |

Fixtures and live runs are never mixed: a payload under
`src/tests/providers/fixtures/authored/` pins the *parser*; a payload under
`fixtures/live/` was captured from the real service; a `*.live.test.ts` file is
the only place a test is allowed to depend on the network. The application never
renders a fixture — every row in the grid was produced by the request the user
just made.

---

## 6. Repro commands

```bash
# offline / deterministic
npx tsc -p tsconfig.build.json --noEmit
npm run test:providers                 # fixtures only
npx vite build

# real providers (needs internet; the wrapper adds the system CA bundle when the
# host sits behind a TLS-inspecting proxy - it never disables verification)
npm run test:providers:live

# real-provider reachability + payload capture (writes evidence + fixtures)
node scripts/provider-live-probe.mjs --out docs/reports/search-repair/evidence/live-probe.json
```

`PROVIDERS_LIVE=0` skips every live test, so an offline machine still runs the
deterministic suite.

---

## 7. What is NOT verified here, and the exact next actions

The authoring environment can reach **only** `github.com`, `api.github.com`,
`npm` and `pypi`. It has no browser, no PowerShell and no Windows VM. Therefore:

| Item | State | Why | Exact check to run |
|---|---|---|---|
| Open Culture / Internet Archive / Openverse / fmhy.net / rentry.org **live adapter runs** | NOT RUN here (payload reachability is proven by the probe; parsing is proven by fixtures) | egress blocked from the sandbox | on a machine with internet: `npm run test:providers:live` — the `*-live.test.ts` files cover each provider |
| Browser click-through of the new controls | NOT RUN here | no browser/Playwright download in the sandbox | on the VM: follow `LAB-VERIFICATION-PROMPT.md`, scenario list A–L |
| `payloads/ghrdp-server.ps1` changes (`/api/providers/relay`, `PATCH /api/f58/sources/<id>`, `notes`/`enabled` on `POST`) | **PARSED on a real Windows runner** (launch-gates step "Parse native PowerShell scripts", run 40261801235); the three ROUTES are not exercised | a syntax error is ruled out; server start-up and live request handling still need the VM | `LAB-VERIFICATION-PROMPT.md` §3 (the six route checks) |
| Windows runner suite (launch gates, RDP, launcher) | unchanged by this branch | — | the existing `autologin-lab` workflow already ran green on this branch's commit |

**First unresolved cause** of anything still failing on a real machine would be
found in this order: (1) the provider's own HTTP answer — the UI shows the code
(`NOT_FOUND`, `RATE_LIMITED`, `FORBIDDEN`, `AUTH_REQUIRED`, `CORS_BLOCKED`,
`RELAY_UNAVAILABLE`, `TIMEOUT`, `PARSE_ERROR`, `SIZE_LIMIT`) and the remedy
sentence for it; (2) the relay route, if the host sends no CORS header; (3) the
dashboard search route, which is independent and can fail without affecting the
provider results.

---

## 8. Deployment and rollback

* The client bundle is what ships in this change; `npm run build` produces
  `ui/dist/index.html` (single file), which is what the server serves.
* The PowerShell changes are additive and behind the existing dash-token gate.
  Removing the branch removes them; there is no migration and no data format
  change (`notes`/`enabled` are optional fields on the existing row shape, and a
  row without them behaves exactly as before).
* `localStorage["ghrdp:searchSources"]` is additive; clearing it restores the
  defaults without touching the server registry.

See `README-si.md` for the Sinhala summary of this document.

---

## 9. Lane kill switch (operator + CI)

The client-side provider lane (`src/lib/search/providerLane.ts`) is what makes
Search query Open Culture, the Internet Archive, Openverse and GitHub straight
from the browser. It is **on by default**; there is no UI toggle, because it is
the feature.

Two documented ways to switch it off, both read **once at page load** by
`resolveLaneEnabled()`:

```js
localStorage.setItem("ghrdp:search.lane", "off"); // documented value
window.__GHRDP_PROVIDER_LANE__ = false;           // page-level override (before boot)
```

Anything else — absent, `"on"`, an unrelated string, storage that throws in
private mode — leaves the lane **on**. The only in-repo user is the hermetic
Chromium lane (`playwright.e2e-ui.config.ts` +
`tests/e2e/fixtures/lane-off.storage.json`), which compares the production bundle
against a fixed fixture backend and must not have real provider rows mixed into
its expected counts. The switch is registered in `src/lib/ci/storageInventory.json`
as a `dead-read` surface, deliberately: the app never writes it.
