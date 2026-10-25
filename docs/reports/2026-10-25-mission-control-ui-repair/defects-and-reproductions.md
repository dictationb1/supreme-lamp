# Defects, before/after, and the exact source evidence

Baseline for every "before" claim: `451e8136c97f80563df5cf40fc9f6ed9f05eaa4d`
(PR #73 merged). "After": `af483d2e7771df1055224edf7636518c2d1b61ac`.

The screenshot (2026-10-25) showed, at the same moment:

```
header:  Live
Overview: Connection failed
          "launcher beacon received — mstsc should be opening fullscreen"
          4625 authentication event used as the failure evidence
          critical issue: "the host rejected the stored credential"  (0s ago)
          Web Desktop viewing mode: manual
          certificate / NLA / CredSSP indicators
```

…while the operator's native RDP session was **working**.

Six independent defects produced that screen. Each is listed with the line of
code that caused it, the reproduction, and the replacement invariant.

---

## D1 — the backend verdict was machine-wide, not client-specific

**Before** (`payloads/ghrdp-server.ps1`, `Get-RdpLogonAuthLast`):

```powershell
foreach ($it in @($Items)) { ... }          # walks EVERY event in the window
$failSub = ([string]$it.subStatus).ToUpperInvariant()
...
if ($null -ne $okWhen -and ($null -eq $failWhen -or $okWhen -ge $failWhen)) { success }
elseif ($null -ne $failWhen) { failed }      # ANY account's 4625 wins
```

`Get-RdpLogonEventFields` extracted `TargetUserName` and the reduction never
used it. `ExpectedUser` did not exist. So the newest 4624/4625 **on the machine**
became "this client's connection".

**Reproduction:** `v4-conn-correlation.test.ts` → *"another account's 4625
cannot fail this client's connection"* (state was `failed`, now `unknown` with a
notice), and *"a 4625 from another SOURCE is excluded even when the user
matches"*.

**After:** the reduction takes `-ExpectedUser` (read from `config.rdpUser` by the
tick), normalizes UPN and `DOMAIN\user` forms on both sides, and:
* excludes `userMatch -eq 'no'` / `srcMatch -eq 'mismatch'` events, counting them
  (`excludedUser`, `excludedSource`, `undecidable`);
* keeps `count4624`/`count4625` **machine-wide** as diagnostic history;
* publishes `correlation` = `complete` | `partial` | `none` | `unavailable`
  **with a note**, so an incomplete correlation is reported, not implied.

**Invariant:** *an event that cannot be attributed to the intended account may
never decide this client's state; the machine-wide history is still published.*

---

## D2 — the failure branch had no freshness check while success did

**Before** (`src/lib/overview/readiness.ts`):

```ts
if (ev.authResult === "failed") {
  // A 4625 is a real, observed rejection, so it is NOT downgraded by a stale scan
  ...
  return { state: "failed", ... };           // no scan-age check at all
}
```

**Reproduction:** V4-3 → *"a stale SUCCESS and a stale FAILURE get the same
freshness verdict"* (before: success became `unverified`, failure stayed a
"current" `failed`).

**After:** one exported rule, `authFreshness(scanTs, nowMs)` →
`current | stale | undated`, used by **both** branches; a future-dated scan
beyond `MAX_CLOCK_SKEW_MS` is `undated`, not "fresh". A stale rejection keeps
its state (`failed`) but is labelled (`"…600s old, so this rejection may already
be resolved"`) and the issue layer downgrades it to a warning.

**Invariant:** *success and failure are dated by the same rule; a stale reading
is never presented as current, and a genuine rejection is never erased.*

---

## D3 — incidents were stamped with the poll time

**Before** (`src/lib/overview/issues.ts`):

```ts
if (input.connState === "failed") {
  out.push({ id: "conn-failed", ..., observedAtMs: input.serverNowMs,
             cause: { kind: "confirmed", text: "the host rejected the stored credential" } });
}
```

`serverNowMs` is *now*, so every render re-dated an hours-old 4625 to "0s ago".

**Reproduction:** V4-UI-1 → *"an OLD event is never displayed as '0s ago'"*
(asserts `data-stale="1"`, age > 3h from `data-occurred-at`, and no `0s` token);
V4-6 → *"ten polls of ONE event preserve its original age"*.

**After:** `Issue` carries `occurredAtMs` (the event), plus
`firstObservedAtMs` / `lastObservedAtMs` / `resolvedAt`, and a stable
`incidentKey` (`conn-failed:rec-<EventRecordID>`, else `ts-<event ms>`). The new
`incidents.ts` reducer folds polls into records:
* same key → same record, `occurredAtMs` unchanged, `observations++`;
* producer stops reporting the key → `resolvedAt = now`, stamped once;
* resolved history is capped at 50 and never resurrected by a reload (only acks
  are persisted).

**Invariant:** *an incident's age comes from its event; a repeated observation
is not a new incident; resolution is the producer's absence, not a click.*

---

## D4 — "confirmed / the host rejected the stored credential" was not supported

**Before:** the failure issue always used `kind: "confirmed"` and one sentence,
regardless of `Status`/`SubStatus` and regardless of attribution. A locked,
disabled, expired or policy-denied account all became "wrong stored password".

**Reproduction:** V4-5 (12 Status/SubStatus cases) and *"a locked account is not
described as a rejected password"*.

**After:** `classifyFailure(status, sub)` returns 11 named reasons; a **present**
SubStatus that is unknown is `other` (never the coarse Status meaning); the
issue text is reason-specific; `kind: "confirmed"` requires **attribution**
(`userMatched === true`) **and** freshness — otherwise `suspected`, severity
`warning`, with the limitation spelled out.

**Invariant:** *the label may only be as strong as the evidence behind it.*

---

## D5 — `wsAvailable === false` meant "this build has no /ws endpoint"

**Before** (`issues.ts`):

```ts
} else if (!input.wsLive && !input.wsAvailable) {
  // cause: { kind: "confirmed", text: "this build exposes no /ws endpoint…" }
```

`useDashboardPolling` wrote `setWsAvailable(false)` both when `/health` said
`ws=false` **and** when the fetch itself failed.

**Reproduction:** V4-UI-3 → pending is `ws-unknown` (info), a worker-pool outage
is `ws-pool-unavailable` (warning, with the reconnect control), a refused probe
is `ws-unauthorized`, and only an explicit `ok && ws===false && no reason`
produces `ws-absent`.

**After:** `WsAvailability` has six members; `telemetryStore.setWsHealth`
derives it from `/health` (the server already published `wsReason` —
*"websocket worker pool unavailable"*), and a **transport failure keeps the last
known capability** instead of overwriting it.

**Invariant:** *no data, unreadable data and a negative observation are three
different facts.*

---

## D6 — LogonType 2/11 was accepted as inbound RDP

**Before:** with R1's accepted set (`2`, `10`, `11`), any interactive logon was
published as `result = success`, and the client mapped `success` → `connected`.
R1 was right that a type-2 autologon is a real desktop; it was wrong to call it
RDP.

**Reproduction:** V4-2 → type-2 with a `console` session is `console`; type-2
whose Terminal Services session is `rdp-tcp#N` **is** `connected`; type-10 is
`connected` on its own.

**After:** the server publishes `remoteInteractive` and a `remote{seen,eventTs,
recordId,count}` block (LogonType-10 only) next to a `session{active,name,state,
logonTs}` block collected with `quser`. The client's `remoteProof` requires a
type-10 logon or an `rdp-tcp#N` session.

**Invariant:** *a desktop is not necessarily a remote desktop; only RDP evidence
justifies "Connected".*

---

## D7 (regression guard) — a failed NEW attempt closed a live session

Not present in the screenshot report, but the same class of error: with the
newest event being a 4625, an existing session that is still `Active` was
reported as `failed`.

**After:** if Terminal Services lists an `rdp-tcp#N` session **created before**
the rejection, the verdict stays `connected` and the rejection is attached as a
notice. If the session was created **after** the rejection, the rejection stands
(`failed`). Reproductions: V4-1 (both directions).

---

## What was NOT changed

* No change to `Test-CredsAllowed`, ticket mint/redeem, `.rdp` signing, NLA /
  CredSSP probes, cert binding, Tailscale, the launcher C#, or the handler
  gesture path. `git diff 451e813..af483d2 --stat` touches the collector, the
  TS UI model, i18n, tests and two workflow files only.
* R1's accepted logon-type set (`2`, `10`, `11`) is unchanged — the collector
  still *counts* type-2/11 desktops; it just stops calling them remote proof.

---

# Addendum — D8: the Windows lab found a real defect in the V4 fix

This record is dated **after** the merge on purpose. The scenario the repair was
written for ("a 4625 for another account must not decide this client") had a
second half that the local tests could not see: the machine-wide counters.

## D8 — an excluded event vanished from `count4624` / `count4625`

**Found by:** `autologin-lab` run **`40144661716`** (head `ae5ae2c1`, the merge
commit of PR #79), job `proof`, step *"V: F28 logon-result loop + one-click
recovery + fallback gap"*.

**Observed (runner annotation, not a log scrape):**

```
[V] stage=scan-corr-counts :: the foreign event must be excluded AND still
counted machine-wide, got excluded=1 count4625=0
```

**Cause.** In `Get-RdpLogonAuthLast` the counters were incremented *inside* the
per-event branches, i.e. **below** the correlation gate. The gate `continue`s for
an event whose account or source does not match, so an excluded 4625 never
reached `$c4625++`. The published contract calls these fields *machine-wide
counts* — "this machine has seen N rejections" — while the code was producing
"this machine has seen N rejections **that belong to this client**". That is the
same class of error as D1 (a machine-wide fact presented as a client fact), one
layer down: the verdict was fixed, the surrounding history was not. A foreign
rejection would have read as *"nothing else is happening on this machine"*,
which is exactly the reassurance a user must not be given.

**Fix (commit `ae9e64e93bc4f00fb856f7bb90be9e7ed568180c`).** Counting is moved above the
gate and made explicit:

```powershell
if ([string]$it.id -eq '4624') { $c4624++ } elseif ([string]$it.id -eq '4625') { $c4625++ }
# --- correlation gate ---
```

The exclusion counters (`excludedUser`, `excludedSource`, `undecidable`) still
describe *why an event was set aside*, and the gate still decides what may drive
the verdict. Nothing else in the reduction changed.

Two details kept intact on purpose:

* `count4624` still counts **interactive-type 4624 only** (2/10/11). The lab
  asserts this: `scan-console` requires `count4624 = 0` for a type-3 logon. A
  service/network logon is not a desktop, and inflating the count with them would
  be a different lie.
* The machine-wide count is taken **after** the window and future-skew checks, so
  a pre-window or malformed event is still not counted.

**Locked by:** `tests/f204-logon-correlation.test.js` → `V4-PS-13`, which asserts
the *order* (count before gate) structurally, so a future edit cannot silently
move the increment back into the branch. This is the test that would have caught
D8 in the 23 minutes between the PR checks and the lab run.

**Verified on Windows:** the same step's sibling assertions
(`scan-counts`, `scan-console`, `scan-corr-foreign`) pass in the pre-merge runs;
the specific `scan-corr-counts` assertion is re-executed by the lab run on the
fix commit.

## The other two red cells in that run are not this project's regressions

`[G] lab matrix … v=fail x=fail y=fail` also appeared in run **`40122884082`**
(head `d3f13d48`, the PR #73 merge, i.e. **before** any of this repair):

```
[G] lab matrix (autologin-lab fallback) … u=pass v=fail x=fail y=fail z=pass w=pass
```

* `x` (F30 TLS/cipher purge) and `y` (F31c token diagnostic) fail with
  `[forensics] runner-schannel … A fatal error occurred when attempting to access
  the TLS server credential private key … 0x8009030D` — a **key-ACL limitation of
  the hosted runner**, identical in both runs, unchanged by this work.
* `v` failed in `40122884082` at `stage=server-wiring` (that revision predates the
  scan tick wiring), and in `40144661716` at `stage=scan-corr-counts` (D8 above).

Therefore D8 is the **only** failure attributable to this repair, and it is fixed
forward rather than hand-waved. Nothing here is claimed as "green": the lab run
that would prove the fix must execute on the new commit.

---

# Addendum 2 — D9: a stale lab assertion, not a stale product

**Found by:** `autologin-lab` run **`40145246991`** (head `ae9e64e93`, the D8 fix),
job `proof`, same §V step — which now fails **later** than before:

```
[V] stage=server-wiring :: ghrdp-server.ps1 lacks:
if (((Get-Date) - $lastLogonScan).TotalSeconds -ge $script:F28IntervalSec)
```

**This ordering is the useful part.** Reaching `server-wiring` means
`scan-corr-counts` — the assertion D8 fixed — **passed on Windows**, and the lab
moved on to its next check. D8 is therefore lab-verified, not merely
locally-tested.

## D9 — the assertion still quoted the pre-R1 wiring

`payloads/ghrdp-server.ps1` used to hold the logon tick inline:

```powershell
if (((Get-Date) - $lastLogonScan).TotalSeconds -ge $script:F28IntervalSec) {
```

The R1 collector-spreading refactor (`f56b4ffec`, merged with PR #73 — the work
this repair is required to preserve) replaced it with **one clock read per
accept-loop iteration** and a due-flag, so three collectors (logon, conn-log,
telescope) share an iteration instead of stacking their `Get-WinEvent` cost:

```powershell
$iterNow = Get-Date
$dueLogon = (($iterNow - $lastLogonScan).TotalSeconds -ge $script:F28IntervalSec)
if ($dueLogon) {
    $lastLogonScan = $iterNow
```

The product kept its 30 s tick; the lab kept asserting the old *text*. `v` has
been red since that commit for this reason, which is why the same
`server-wiring` failure appears in run `40122884082` (head `d3f13d48`).

**Fix.** The assertion is **narrowed, not deleted** — it now checks the current
wiring and, additionally, the two facts the token list alone could not
distinguish:

```powershell
if ($srv -notmatch 'if \(\$dueLogon\) \{\s*\r?\n\s*\$lastLogonScan = \$iterNow') { V-Fail ... }
if (-not $srv.Contains('$script:F28IntervalSec = 30')) { V-Fail ... }
```

Without these, both "due on every iteration" (cost) and "never due" (stale
verdict) would satisfy a plain substring list. `main.yml` still must not mention
the scan (`server-side-only` unchanged).

**Locked locally by:** `tests/f204-logon-correlation.test.js` → `V4-PS-14`,
which reads the lab's token list out of the workflow, anchors on the
`V-Fail 'server-wiring'` site, and requires **every** token to exist in the
shipped `.ps1`, plus the timer-advance and interval checks. The first draft of
this test used a lazy whole-file regex and immediately "found" a token from an
unrelated list (`id="clientDnsRow"`) — the anchor is part of the test's own
correctness, so it asserts that it captured exactly one list.

This class of defect (product correct, gate stale) is the one that makes a lab
look untrustworthy: it trains a reader to ignore red. Failing forward at 11
minutes per Windows run is too slow, so the check now also runs in 0.1 s.
