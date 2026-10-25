# Defects, before/after, and the exact code that changed

Branch: `arena/046926e8-supreme-lamp`; base revision
`ae360351eb3fea434f482af1b9e9db48025936a7` (cut from `main` at
`e067bcef5ff97287bbc79345fa6a55cd8f3fcf31`). Every "before" statement below was
read out of the base revision; every "after" is what this branch ships.

---

## D1 — Multiple dispatches from one user action (PRIORITY)

**Before (confirmed in `src/stores/sessionStore.ts`, `src/lib/api.ts`).**

```ts
// fireAutoLogin
protoWin = window.open('', '_blank');            // blank helper window
const ticket = await postRdpToken();
protoWin.location.href = ghrdpUrl;               // navigation #1
setTimeout(() => protoWin.close(), 4000);        // closes an owned window on a timer
if (!winNavOk) launchProto(ghrdpUrl);
else try { launchProto(ghrdpUrl); } catch {}     // navigation #2 — even after #1 "succeeded"

// launchProto
iframe.src = url; document.body.appendChild(iframe);      // navigation #2 itself
setTimeout(() => { a.href = url; a.click(); }, 150);      // navigation #3
```

One click could reach the external-protocol handler three times. The comment
claiming the extra dispatch was "harmless because the ticket is single-use" is not
an acceptance argument: the second navigation carries an already-redeemed ticket,
and the launcher's redemption-error branch is what opens the interactive cmdkey
prompt (see D3).

**After.**

* `src/lib/domain/dispatch.ts` — `LaunchDispatcher`: one attempt identity, one
  ticket request (counted), one navigation (counted), duplicate suppression while
  `preparing`/`ticket-issued`/`awaiting handoff`, cancel, retry-from-terminal-only,
  expiry, and late-callback rejection by attempt id + trace + timestamp.
* `src/lib/api.ts:160` — `launchProto()` is now `dispatchProtocolOnce()`: ONE
  top-level `location.assign` from the click handler. No iframe, no synthetic
  anchor click, no delayed second dispatch. A pre-dispatch failure returns
  `"failed"` and stops; retry is an explicit user action with a fresh ticket.
* `src/stores/sessionStore.ts:362` — `fireAutoLogin` / `fireFixReconnect` /
  `fireRunCheck` / `fireRunDiag` / `fireAutoLoginNative` all go through the
  dispatcher. No helper window is opened (so nothing is closed on a 4 s timer and
  no permission prompt is ever killed), and `warmLaunchTicket()` mints the ticket
  *before* the click so the click itself performs the single navigation with
  transient activation intact.

**Behavioural tests** (count dispatches, tickets and side effects):
`src/tests/smoke/dispatch-single-attempt.test.ts` (19),
`src/tests/smoke/launch-store-single-dispatch.test.tsx` (11).

| Case | Test |
| --- | --- |
| normal click | `dispatch-single-attempt` › "a normal click requests exactly one ticket…" |
| double click | › "a double click while the ticket is in flight mints ONE ticket" |
| two clicks in one task | › "two synchronous clicks in the same task still produce one dispatch" |
| slow ticket response | same as double click (the ticket promise is parked) |
| popup blocked | › "no window/popup is opened by the dispatcher" (nothing to block) |
| no handler installed | › "silence is UNCONFIRMED, not failed" |
| cancel | › "cancel while the ticket is in flight drops the late ticket" |
| retry | › "expiry is its own state and a retry then mints a FRESH ticket" |
| expiry | › "an attempt that never dispatched expires with the ticket TTL" |
| late callback from older attempt | › "a beacon older than the dispatch … is ignored", › "a handler beacon from BEFORE the dispatch cannot promote a cancelled attempt" |

---

## D2 — Cancellation was attributed by proximity ("38s before the last mstsc launch")

**Before** (`src/lib/domain/native.ts`, `recoveryDecision`): a 4625 with
sub-status `0xC000006A` anywhere in the last 120 s before the newest
`mstsc-started` beacon was presented as this attempt's wrong password, and
`Date.parse(authLast.eventTs || authLast.scanTs)` substituted the collector's
**scan** time for a missing **event** time.

**After** (`native.ts:316`): the offer requires all of — real event time, account
match reported as `true` (unknown is not a match), no source mismatch, correlation
`complete`/`partial`, the event inside THIS attempt's beacon window (with a 10 s
skew allowance), a launch no older than 15 minutes, and no live `rdp-tcp` session
that outlived the failure. Every refusal names the missing correlation, and the UI
renders `Recovery is withheld (<why> …)` instead of a wrong-password claim.

`lifecycleStage()` (`native.ts:427`) adds the honest vocabulary: `preparing`,
`awaiting-handoff`, `handler-observed`, `auth-confirmed`, `connected`, `cancelled`,
`failed`, `expired`, `unconfirmed` — with a `source` string naming who observed it.
Cancellation is only reachable from a positive operator action.

Tests: `src/tests/smoke/rdp-recovery-correlation.test.ts` (20).

---

## D3 — The native warning and the password prompt (two separate failures)

**Trace to the actual caller (not a guess):**

1. `payloads/ghrdp-rdp-launcher.cs` `RedeemAndStoreStep` sends the ticket to
   `POST /api/rdp-creds`, which is single-use. A replay gets HTTP 401 and returns
   `"ticket-invalid-or-expired"`.
2. The `rdp` verb treated *any* redemption failure as `FallbackBeacon(...)` →
   `CmdkeyStep(forcePrompt: true)` → `cmdkey.exe` with `UseShellExecute = true`,
   i.e. **a visible interactive credential window**. That is the cmdkey password
   prompt in the screenshot, and the mechanism is duplicate dispatch (D1):
   invocation #2 redeems a consumed ticket.
3. The "Unknown publisher" dialog is Windows judging the **signature of the
   generated `.rdp` file on the client**, not the server's TLS certificate. The
   launcher signs the final file only when
   `%ProgramData%\ghrdp\rdp-signing.json` names a signing identity
   (`TrySignRdp`, `MstscStep`); absent that file the shipped behaviour is
   unsigned, hence "unknown publisher". This is a *client* trust configuration,
   deliberately not bypassed.

**After** (`ghrdp-rdp-launcher.cs:1034` `ReplayStep`):

* a 401/403/409 redemption is classified as a REPLAY (`IsTicketReplay`), decided
  **before** the fallback path in both the `rdp` and `recred` verbs;
* a replay opens no cmdkey window, starts no mstsc, writes no credential and does
  not retry the consumed ticket (single-use protection untouched);
* if this client already launched the same target in the last 10 minutes
  (`MarkLaunched`/`LaunchedRecently`), the duplicate delivery exits 0 — the
  intent was already satisfied;
* otherwise it beacons `ticket-replayed` and shows a message box that says the
  link was already used and to click the dashboard button again for a **fresh**
  ticket — never "type your password".

The UI now separates the three prompts explicitly
(`PrimaryActions.tsx`, `data-testid="overview-prompt-triage"`): browser consent,
the `.rdp` publisher warning, and the manual cmdkey prompt — and no code path in
this change auto-clicks, auto-trusts or disables any of them.

Tests: `src/tests/smoke/launcher-replay-contract.test.ts` (4) — structural,
because this host has no C# compiler (see `unresolved.md`).

---

## D4 — Search defect A: `awesome.re` answered HOSTNAME_MISMATCH

**Before.** The save-time probe records `canonicalHostname` only when the redirect
target is the same site (www-tolerant). `awesome.re` redirects to `github.com`, so
nothing was recorded, and `Invoke-F78SecureFetch` refuses the hop
(`Test-F78SameHost('awesome.re','github.com')` false) → `HOSTNAME_MISMATCH` → 403
`lab.hostnameMismatch`.

**After.**

* the probe records the observed cross-site target as `redirectHostname` on the
  source row (`ghrdp-server.ps1:6001`), a fact per source — never added to the
  global host allowlist;
* `Invoke-F78SecureFetch` gained `-AllowedHosts` (`:5205`): the exact-host fence is
  still checked first, then the per-source literal set, and **every redirect hop is
  re-checked** against the same set. No wildcard, no suffix match, no global
  widening. Hops and the final host are returned as provenance.
* the inspect route builds that set from: the source's own hostname, its
  `canonicalHostname`, its `redirectHostname`, the literal hosts of its **bundled
  hint** (`readmeUrl`/`redirectTo`/`searchEndpoint`, shipped data, not operator
  input), and hosts a previous successful cross-domain fetch already proved;
* link extraction fences on the host that actually **served** the page
  (`$f78SpFence`/`$f78CpFence`/`$f78FenceHost`), so `github.com` links are no longer
  filtered out because the typed hostname was `awesome.re`;
* the payload reports `finalHostname` and `redirectChain`, and the Lab renders
  "Served from github.com (redirected from awesome.re)".

Blocked destinations still fail loudly: an off-site hop returns
`HOSTNAME_MISMATCH` with `details.offHost`/`details.url`, and the client maps it to
`lab.hostnameMismatchRedirect` (not a generic message).

Tests: `src/tests/smoke/lab-inspect-endpoint.test.ts` (16) — real HTTP against a
contract server + structural assertions on the PowerShell route, including
"refuses an off-host hop and reports the host it refused".

---

## D5 — Search defect B: result deep-inspection was unreachable

**Before.** `POST /api/lab/inspect` validated `sourceId` first:

```powershell
if (-not $f78SourceId) { 400 VALIDATION_ERROR; return }   # ← every {sourceUrl, query} POST
```

so the result-view branch 140 lines later never executed. The handler also carried
two complete pipelines and charged the 10-fetches/minute budget twice per request.

**After** (`ghrdp-server.ps1:7091`): mode selection first, then validation of that
mode, then ONE budget charge keyed by the inspected identity, then ONE pipeline and
ONE response schema.

1. `sourceId` → stored-source mode (404 unknown, 403 labMode-off, 403 host fence);
2. `sourceUrl` → result mode (`https` only, no userinfo, ≤2048, own host only);
3. neither → 400 (the only 400 for mode selection);
4. budget: `$f78RateKey` = the `sourceId` or `url:<host>`, charged once;
5. one pipeline; the payload adds `resultKind`
   (`repository` | `releases` | `repository-file` | `repository-owner` | `page`,
   derived from the provider's URL shape — no assumption that a repository has
   Releases).

Client (`src/api/lab/index.ts:297` `parseInspect`): one parser for both modes,
keeping the server's code, messageKey, retry hint and sanitized `details`; unknown
HTTP statuses map to `lab.serverError`/`lab.httpError` instead of "something went
wrong". `LabInspector` renders the code + refused host, a Retry button, and
distinct empty states `no-links` vs `no-matches` (`data-empty-kind`), and collapses
duplicate inspections of the same target+query.

Tests: `lab-inspect-endpoint.test.ts` (16) and
`src/tests/smoke/lab-inspector-2026-10-25.test.tsx` (8).

---

## D6 — Repository and help links pointed at the old owner

**Before.** Six product surfaces hard-coded `github.com/dekarita/supreme-lamp`:
`Search.tsx` (documentation), `native.ts` (`SECRETS_URL`, `ACTIONS_URL`),
`DashTokenGate.tsx`, `F92VersionGate.tsx`, `WebDesktopCard.tsx` (commit-drift
probe) and `Collector.tsx` (related issue).

**After.** `src/lib/repoIdentity.ts:38` is the single identity
(`dictationb1/supreme-lamp`, from build configuration, never from a URL query
parameter, validated, with a compiled-in default). All six call sites resolve
through it. Every documentation path the app links to is asserted to exist in the
checkout by `src/tests/smoke/repo-identity-links.test.ts` (5), which also fails if
any product source re-introduces a hard-coded repository URL or the stale owner in
code.

---

## D7 — Incident timestamps, observed vs occurred

**Before.** `src/lib/overview/issues.ts` pre-filled `firstObservedAtMs` with the
event time, conflating "when it happened" with "when this browser first saw it"
(the V4 reducer owns the latter).

**After** (`issues.ts:202`): `occurredAtMs` (event), `firstObservedAtMs: null`
(reducer fills), `lastObservedAtMs` (this poll), `resolvedAt` (when the producer
stopped reporting) — four distinct facts, with stable `incidentKey` identity.

Covered by the existing V4 suites plus the full-suite run.

---

## D8 — The production bundle carried the demo rows (found while proving "no demo results")

**Before.** `Search.tsx` imported `isDevMode` from `src/pages/search/devFixture.ts`,
which also does `import fixture from "./fixture.json"`. Because of that single
import edge, the shipped single-file build inlined all 13 synthetic rows:

```
$ grep -c fx-snap-01 ui/dist/index.html      ->  1
$ grep -c "Pride and Prejudice" ...          ->  1
```

They were gated by `isDevMode()` at runtime, so an operator never saw them — but
the requirement was to *prove* the production build cannot substitute demo results,
and a runtime gate is not that proof when the data is in the artifact.

**After.**

* `src/lib/devMode.ts` (new) owns `isDevMode()` — no data import.
* `src/lib/domain/devSearchFixture.ts` (new) owns `DEV_FIXTURE_TICK_MS` and
  `shouldStreamDevFixture()` — no data import.
* `src/pages/search/devFixture.ts` is now data-only and is reached exclusively via
  `await import("./search/devFixture")` inside `if (!import.meta.env.DEV) return;`
  — Vite replaces that flag with `false` in a production build and Rollup drops the
  branch with its chunk.
* `FileExplorer.tsx` reads the predicate from `@/lib/devMode`.

Measured on the rebuilt artifact (`npm run build`):

```
fx-snap-01           -> 0 occurrences
Pride and Prejudice  -> 0 occurrences
lab-inspect          -> still present (the real production path)
```

`src/tests/smoke/production-bundle-no-demo.test.ts` (4) asserts: no production
module statically imports the fixture module; `Search.tsx` reaches the rows only
through the DEV-guarded dynamic import; and the built `ui/dist/index.html` contains
no fixture sentinel while still containing the production Lab path.
