# Feature / operation coverage

Honest verdict vocabulary (no operation is called "verified" without evidence):

* **JS-PASS** — exercised by an executable JS test in this repository at the tested
  revision, asserting a visible result and/or a backend effect.
* **HTTP-PASS** — executed over real HTTP against a fixture server (client side).
* **STRUCT-PASS** — the contract is asserted on the Windows/PowerShell/C# source
  because the artifact cannot be executed on the Linux test host.
* **NOT RUN** — no evidence collected here; a Windows candidate / operator VM run
  is required.
* **BLOCKED** — genuinely depends on the unavailable VM/tailnet/native runtime.

Everything below was inventoried from the shipped UI at
`ae360351eb3fea434f482af1b9e9db48025936a7`. "Relevant work" names what this change
did, if anything.

## Overview / Mission Control

| Operation | Prerequisite / fixture | UI action | Expected visible result | Expected backend effect | Actual | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| WINDOWS AUTO-LOGIN | dashboard token, FQDN+user, listener green | click `#btnWinAuto` | one protocol dispatch; stage line `awaiting handoff`; honest note | exactly one `POST /api/rdp-token`; launcher redeems once | 1 ticket + 1 navigation; second click suppressed | JS-PASS (2 suites) |
| Warm ticket (activation) | same | hover/focus then click | click dispatches without a network round-trip | ticket minted before the click, consumed once | 1 POST total across warm+click | JS-PASS |
| Cancel attempt | attempt in `preparing`/`awaiting handoff` | click Cancel | `launch: cancelled`, late beacon ignored | late ticket dropped, no dispatch | 0 dispatches | JS-PASS |
| Retry with fresh ticket | attempt `failed`/`expired`/`unconfirmed`/`cancelled` | click Retry | new attempt id, new note | new `POST /api/rdp-token` | 2 POSTs, 1 navigation | JS-PASS |
| FIX & RECONNECT | correlated wrong-password only | click `#btnFixReconnect` | recovery row explains correlation; single recred dispatch | 1 ticket POST | 1 ticket + 1 `ghrdp://recred` nav | JS-PASS |
| Recovery withholding | any 4625 | page render | `Recovery is withheld (<why>)` | none | wrong-account / unknown identity / pre-launch event all withheld | JS-PASS |
| WEB DESKTOP | `webdeskUrl` valid | click | popup or copyable URL | `/api/launch-url` when mirrored | unchanged by this work | JS-PASS (existing F94/F95 suites) |
| Prompt triage (NEW) | any | expand launch detail | three separate prompts named: browser consent, `.rdp` publisher, manual cmdkey | none (never auto-dismissed) | rendered | JS-PASS (ids/overview suites) |
| RUN CHECK / RUN DIAG | FQDN | click | one navigation, duplicate suppressed | none | 1 nav per intent | JS-PASS |
| Connection verdict / freshness | native-status | page render | state + evidence + freshness + staleness | `/api/native-status` | V4 state machine intact; timestamps separated | JS-PASS (v4 suites) |

## Search / Lab

| Operation | Fixture | UI action | Expected | Backend | Actual | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Submit query | adapters | type + enter | results/progress | adapter calls | unchanged | JS-PASS (existing) |
| Stored-site deep inspect | stored source | open Lab | link list, match count, source line | `POST /api/lab/inspect {sourceId}` | sourceId-only payload, token in header | HTTP-PASS |
| **Result deep inspect** | result id | open result inspector | same list, from the result's own URL | `POST /api/lab/inspect {sourceUrl}` | now reachable server-side; UI renders rows/kind/provenance | HTTP-PASS + JS-PASS |
| Source add/remove | token | Add site / trash | row appears/removed | `/api/f58/sources` | unchanged; probe now also records `redirectHostname` | STRUCT-PASS |
| awesome.re query | stored `awesome.re` | inspect with query | cross-host README/redirect read succeeds | allowlisted per-source hop | refusal path removed; blocked hops still refused | STRUCT-PASS + HTTP-PASS (error path) |
| Empty vs failed inspection | fixture | open inspector | `no-links`/`no-matches`/error are distinct screens | — | `data-empty-kind` + error code | JS-PASS |
| Rate limit | 429 | refetch | countdown, no hammering | one budget charge per inspection | single limiter in route; client honours hint | STRUCT-PASS + HTTP-PASS |
| Retry/back-navigation | — | Refetch / back | one inspection per target+query | one POST | duplicate suppressed | JS-PASS |

## Sessions / Connections / Keys & Secrets / Telemetry / Health / Mirror / Transfers / File Explorer / Collector / Settings

| Area | Representative operations | Status in this change | Verdict |
| --- | --- | --- | --- |
| Sessions | list, select, DVR/replay surfaces | untouched; existing suites green | JS-PASS (existing) |
| Connections | connection cards, probe honesty | untouched; F201/`v4` suites green | JS-PASS (existing) |
| Keys & Secrets | masked display, copy, purge command | untouched (no secret handling changed) | JS-PASS (existing) |
| Telemetry | ws state, `wsReason`, degraded reasons | unchanged; `wsReason` still rendered | JS-PASS (existing) |
| Health | `/health` probe, version gate | link now from `repoIdentity` | JS-PASS (existing) + link PASS |
| Mirror | mirror cards, mode assertions | untouched | JS-PASS (existing) |
| Transfers / File Explorer | navigate/preview/download/queue | untouched | JS-PASS (existing) |
| Collector | start/refresh/stop/export gates | untouched; issue link now identity-derived | JS-PASS (existing) |
| Settings | persistence after reload | untouched | JS-PASS (existing: `theme-persist`, `scale-persist`) |
| Launch/quit lifecycle on Windows | real PowerShell launcher, real `mstsc`, real prompts | requires the user VM | **NOT RUN / BLOCKED** |

## Notes on honesty

* No decorative controls, fake progress or false success toasts were added; the new
  Cancel/Retry/Stage elements only report dispatcher-observed states.
* No credential, ticket or password value is rendered, logged to the page, or put in
  a URL by this change; the ticket stays in the protocol URL exactly as before
  (single-use, 60 s) and `dispatchProtocolOnce` never echoes it.
* State-changing tests use fixtures only (mocked ticket endpoint, fixture HTTP
  server, in-memory sources). No real session, credential or secret was touched.
