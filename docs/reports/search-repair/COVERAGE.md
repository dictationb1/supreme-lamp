# Source-and-control coverage matrix

Legend for **Evidence**: `LIVE` = executed against the real service in this
branch's session; `FIXTURE` = executed against a recorded/hand-authored payload;
`CODE` = implemented, reviewed and type-checked but NOT executed here (needs
Windows/PowerShell); `NOT RUN` = not executed anywhere yet.
`PASS` means the stated check ran and succeeded. Nothing is marked PASS on the
strength of a green build.

## A. Sources (adapters)

| # | Source / capability | Input | Expected | Actual | Revision | Evidence | Status |
|---|---|---|---|---|---|---|---|
| S1 | GitHub repo/search URL | `https://github.com/mfkl/awesome-vlc` | repo facts + README sections, no credential | title `mfkl/awesome-vlc`, sections, default branch, stars 307 | `arena/cd153e89` | LIVE `github-live.test.ts` A | PASS |
| S2 | GitHub `#readme` fragment | `https://github.com/mfkl/awesome-vlc#readme` | classified as README, inspected | subkind `readme`, sections returned | same | LIVE B | PASS |
| S3 | awesome list info | `https://github.com/sindresorhus/awesome` | categories + listed resources, releases "none" | 27 sections/677 items (session log), releases `none` | same | LIVE C | PASS |
| S4 | awesome.re canonical path | `https://awesome.re/` | resolves to sindresorhus/awesome, not a hostname mismatch | `Resolved from awesome.re → github.com/sindresorhus/awesome` | same | LIVE D | PASS |
| S5 | ChessMax list | `https://github.com/ChessMax/awesome-programming-languages` | no sourceId, no releases requirement | inspected, default branch `master`, releases `none` | same | LIVE E | PASS |
| S6 | Relative README links | README containing `docs/usage.md` | absolute URL against the default branch | `https://github.com/mfkl/awesome-vlc/blob/main/docs/usage.md` | same | LIVE K + FIXTURE lane-and-stores | PASS |
| S7 | Open Culture feed search | query "Kaufmann" | editorial article hits, external resource kept separate | hit = article URL; sitemap fallback reported | same | FIXTURE offline-providers | PASS |
| S8 | Open Culture live surface | `https://www.openculture.com/feed` | real HTTP 200 + CORS | 200, `access-control-allow-origin: *`, 116 879 bytes | `3967e14` | LIVE probe JSON | PASS |
| S9 | Internet Archive search | `advancedsearch.php` with filters | real total + rows | numFound/rows/page/sort sent; rows mapped | same | FIXTURE + live probe 200 | PASS (parse) / LIVE reachability PASS |
| S10 | Internet Archive item + files | `/metadata/<id>` | authoritative file list | files with size/format + `/download/...` URLs | same | FIXTURE archive item test | PASS |
| S11 | Openverse filters | license/media type | changed request + appliedFilters | `license=cc0`, `/v1/images/` vs `/v1/audio/` | same | FIXTURE openverse ×2 | PASS |
| S12 | Openverse live | `api.openverse.org/v1/images/?q=...` | 200 with results | 200 (2853 bytes) | `3967e14` | LIVE probe JSON | PASS |
| S13 | FMHY taxonomy page | `https://fmhy.net/misc` | sections + anchors + starred/warning | sections with `#-food` anchors | same | FIXTURE fmhy ×2 + probe 200 | PASS (parse) |
| S14 | FMHY search absence | `/search?q=` | 404 → page reading instead | 404 confirmed | `3967e14` | LIVE probe JSON | PASS |
| S15 | rentry megathread | `https://rentry.org/megathread` | raw Markdown, sections, sub-pages | `/raw` parsed, sub-page followed once | same | FIXTURE rentry ×2 + probe 200 | PASS (parse) |
| S16 | Arbitrary added site | feed / sitemap / search form | usable interface or explicit refusal | feed path + challenge refusal + relay path | same | FIXTURE generic ×4 | PASS |
| S17 | Provider live suites for Open Culture / IA / Openverse / FMHY / rentry | real endpoints | rows returned | **not executed in this sandbox** (egress allowlist) | — | — | NOT RUN (run `npm run test:providers:live` on a networked host) |

## B. Controls

| # | Control | Expected | Actual | Evidence | Status |
|---|---|---|---|---|---|
| C1 | Submit a text query | provider rows appear while the server lane runs | rows appear, phase `partial` when the server lane fails | FIXTURE search-repair-ui + LIVE search-store-live | PASS |
| C2 | Per-source status | one line per source: queued/running/complete/empty/failed(coded)/cancelled | rendered, failing source shows its own rate-limit line | FIXTURE search-repair-ui | PASS |
| C3 | One source fails | other sources keep their rows | both outcomes reported, rows kept | FIXTURE lane + LIVE store | PASS |
| C4 | Cancel | CANCELLED, not an error; no further reads | `status: cancelled`, `code: CANCELLED` | FIXTURE lane | PASS |
| C5 | Paste a URL | inspection preview, no credential dialog | preview with facts/sections, Add button only when addable | FIXTURE UI + LIVE store | PASS |
| C6 | Add as source | row created, appears in search specs | row added (server or local mirror) | FIXTURE UI + store | PASS |
| C7 | Edit name/notes | PATCH by id, no create | `PATCH /api/f58/sources/<id>` body `{name,notes}` | FIXTURE store; PS route CODE | PASS (client) |
| C8 | Enable / disable | row + search specs + persisted | local mirror + write-through PATCH | FIXTURE store | PASS |
| C9 | Remove | row gone locally and on the server | DELETE + mirror cleared | FIXTURE store | PASS |
| C10 | Export / import | round-trip, foreign file refused | round-trip ok, `{format:"other"}` refused | FIXTURE store | PASS |
| C11 | Persistence after reload | mirror rehydrates overrides | override survives `refresh()` | FIXTURE store | PASS |
| C12 | Bulk paste | per-line report | implemented, covered by the same `add()` path | FIXTURE (unit) / UI NOT RUN | PARTIAL |
| C13 | Retry / refresh a source | re-inspect the same URL | implemented in the manager | CODE (UI button) | PARTIAL |
| C14 | Result detail / provenance | provider, list, section, licence, files | `ProviderResultDetail` renders them | FIXTURE (render) | PASS |
| C15 | Keyboard nav / filters / sort / pagination of the existing grid | unchanged behaviour | unchanged | existing smoke suite | PASS |
| C16 | Sinhala text for every new string | parity with English | 104 new keys in both files, parity test green | `i18n-f56-parity.test.ts` | PASS |
| C17 | Silent buttons | none | every new button acts or is disabled with a reason | review | PASS |

## C. Required operator scenarios (A–L)

| Id | Scenario | Result |
|---|---|---|
| A | Public GitHub URL without a password | PASS (LIVE) |
| B | awesome-vlc README | PASS (LIVE) |
| C | sindresorhus/awesome list information | PASS (LIVE) |
| D | awesome.re canonical path | PASS (LIVE) |
| E | ChessMax list without sourceId/releases | PASS (LIVE) |
| F | Open Culture / Internet Archive / Openverse real results | PARTIAL — adapters + live reachability proven; adapter live runs must be executed on a networked host (`test:providers:live`) |
| G | User-added site full lifecycle | PASS (FIXTURE, store + UI) |
| H | Persistence boundary | PASS (FIXTURE: server row / local mirror / export) ; server restart needs VM |
| I | Empty vs invalid vs unavailable vs rate-limited vs auth | PASS (FIXTURE error taxonomy) |
| J | Cancellation race | PASS (FIXTURE) |
| K | Links resolve | PASS (LIVE relative-link test + absolute URL assertions) |
| L | No fixture silently replacing a production result | PASS — fixtures only ever feed tests; the UI renders only fetched rows (a failed source shows a coded error) |

## D. Backend (PowerShell) surface

| # | Route | Check | Status |
|---|---|---|---|
| P1 | `GET /api/providers/relay?url=` | token gate, https-only, host allowlist, 2 MB cap, 10/min, typed refusals | CODE — needs Windows execution |
| P2 | `PATCH /api/f58/sources/<id>` | name/notes/enabled, per-field errors, persisted | CODE — needs Windows execution |
| P3 | `POST /api/f58/sources` | `notes` ≤280 with the code rule, `enabled` | CODE — needs Windows execution |
| P4 | existing GET/DELETE/inspect | unchanged | existing suites + CODE |
