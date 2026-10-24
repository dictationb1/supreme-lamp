# Promotion of verified lab repairs 0001–0004 into dictationb1/supreme-lamp

**Date:** 2026-10-24 (UTC)  
**Session branch:** `arena/292d4e34-supreme-lamp`  
**Application base (main at session start):** `112ff8653bcca07d90c819badeb9b73b727e1f62` (commit `112ff86`) — observed `chore: initial status.json [skip ci]`  
**Lab base (historical tested source):** `832a82eb7c29613b0b101585c56b5011ea008a06` (parent `4a91c5c2…`; only `docs/status.json` differs from current main, verified)  
**Lab head (pinned bundle):** `d7c90dc81867553c65f862308d799caaaf3cbec7` (PR #30 `arena/1c3eeb8e-supreme-lamp-lab`)  
**Lab archive:** https://codeload.github.com/dictationb1/supreme-lamp-lab/zip/d7c90dc81867553c65f862308d799caaaf3cbec7  
**Lab archive SHA256 (pinned):** `c0de6455046c896d8cd61e8671d566a29c2aaa4aa946fd4cd4c791d1ca2d2393` (per manifest)  
**Applied commit (this PR):** `f56b4ff promote lab repair series 0001-0004 + handler gesture honesty`  
**Tested SHAs:** base `112ff86` → patched `f56b4ff` (dirty ui/dist excluded; build verified separately)

Direct lab bundle files (immutable):
- https://raw.githubusercontent.com/dictationb1/supreme-lamp-lab/d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/README.md
- https://raw.githubusercontent.com/dictationb1/supreme-lamp-lab/d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/manifest.json
- https://raw.githubusercontent.com/dictationb1/supreme-lamp-lab/d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/series.txt
- https://raw.githubusercontent.com/dictationb1/supreme-lamp-lab/d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/SHA256SUMS
- Prior accepted bundle (R2 provenance): https://raw.githubusercontent.com/dictationb1/supreme-lamp-lab/d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40072158991-1/FINAL-REPORT.md
- Prior handoff: https://raw.githubusercontent.com/dictationb1/supreme-lamp-lab/d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40072158991-1/MAIN-REPOSITORY-HANDOFF.md
- R2b fault proof report: `reports/mission-control/40072158991-1/evidence/real-backend-40112159586/r2b-r2-fault-report.json` (see bundle)

## 1. Patch series — expected SHA256 (from `SHA256SUMS`)

| # | file | sha256 | title | status on current main |
|---|------|--------|-------|------------------------|
| 1 | `0001-F201-probe-honesty.patch` | `692246ffe3642a355fd72f3e95e5f84f333cbab1ab658199c8273a3ef0657398` | frontend probe honesty | **absent** → applied with `git -c core.autocrlf=false -c core.eol=lf apply --whitespace=nowarn`; verified via `sha256sum` match and `git apply --check` clean |
| 2 | `0002-R1-server-startup-readiness.patch` | `eb9d7efeb001ea536a7e99a4e80289856c93fa71a6f8445b77abce0eebf70b33` | server startup readiness | **absent** → applied cleanly; marker `ServerReadyStamped` now inside accept loop, one-scan-per-iteration guard (`if/elseif/elseif`) |
| 3 | `0003-R2-websocket-worker-runspace.patch` | `7eba144c377e5bbd7d52b89cde9e9bb526027c027c0c03715031cd42f3fcf939` | bounded WebSocket worker runspace (R2) | **absent** → applied cleanly; old `Invoke-F99WebSocketUpgrade` inline path removed, `Invoke-R2DispatchWebSocket` + `Initialize-R2WsPool` + `R2WsPoolAvailable` + Poll EOF |
| 4 | `0004-R2b-pool-fallback-bounded-truth.patch` | `05f1f416f40b26164509a6844653350aef9e68a57a6a9485775edfe48769a1b1` | bounded truthful pool-unavailable degradation (R2b) | **absent** → applied cleanly; no `Invoke-F99WebSocketUpgrade -Client` inside dispatch, `GHRDP_WS_POOL_RETRY_SEC` clamped 5..300, `Code 503` + `wsReason` |

All four applied in `series.txt` order with strict LF handling (`-c core.autocrlf=false -c core.eol=lf`). No adaptation required; historical base and current main differ only in `docs/status.json`. Preserved: MC-SIGNAL publication, credential binding, current-token/revocation, corrected LogonType observer, RDP file signing, launcher installation contract, UI build identity & staging, authentication/NLA/TLS/cert validation.

## 2. Patch-carried tests (targeted gate)

| patch | test file | count |
|-------|-----------|-------|
| 0001 | `src/tests/smoke/f201-probe-honesty.test.tsx` | 8 |
| 0002 | `src/tests/smoke/r1-server-readiness.test.ts` | 3 |
| 0003+0004 | `src/tests/smoke/r2-websocket-worker.test.ts` | 13 (0003 had 12, 0004 replaces inline-fallback with bounded-truth assertions) |
| extra (this promotion) | `src/tests/smoke/ghrdp-handler-gesture.test.ts` | 4 |
| **total targeted** | | **28** |

`npx vitest run src/tests/smoke/f201-probe-honesty.test.tsx src/tests/smoke/r1-server-readiness.test.ts src/tests/smoke/r2-websocket-worker.test.ts src/tests/smoke/ghrdp-handler-gesture.test.ts` → **28/28 PASS** (5.1 s, see log). `npx tsc --noEmit -p tsconfig.build.json` PASS. Full suite `npx vitest run --reporter=dot` → **109 files / 1395 tests PASS** (171 s). Historical after 0004 was 108/1391; delta +1 file (handler) +4 tests.

## 3. Acceptance evidence carried from lab

- **R2 accepted:** runs `40091165292`, `40092088400`, `40092300001` each **33 PASS / 0 FAIL / 5 BLOCKED** (scoped transport/backend, `backendKind=actual_application`, `browserWebSocketStubbed=false`, headed). Lab revision `01947f0` onward, app SHA `832a82eb`.
- **R2b fault-injection (the four-patch series) — measured on real Windows `rdp-lab-client` (WIN-NFU1JG4VESE\User, session 1, headed Chromium, powershell.exe) — run `40112159586` SUCCESS at lab revision `01947f029f5a2e92466d0c8fd17d53f216a4a183`: `r2b-r2-fault-report.json` 5/5 PASS
  - A: old inline fallback reproduces starvation (`/health` stalled 4015 ms, `/ws` 101)
  - B: repaired `ws=false` + `wsReason='websocket worker pool unavailable'`, 6×503 truthful, `p95 58 ms` (8 samples), no starvation
  - C: transient (`GHRDP_WS_POOL_RETRY_SEC=8`) recovers `503 → 101` and `ws=true`
  - Variants sha256 logged: old-persistent `6eaa6b…`, new-persistent `9098e2…`, new-transient `47ff58…` (corrected harness: transient first Open() throws once, later calls real Open(); earlier harness skipped Open() on subsequent attempts is NOT used)

> **Correction to lab README/manifest:** they still say “R2b runtime proof is pending”. Later committed machine evidence (`40112159586`) proves it passed; this report corrects the stale prose and does not repeat it.

## 4. Production build & staging verification (local)

- `VITE_BUILD_SHA=$(git rev-parse HEAD) npm run build` → `tsc -p tsconfig.build.json && vite build` OK, single-file `ui/dist/index.html` 1,228 kB, sha256 `1166c3…` (for `f56b4ff`; rebuilt after push will be `GITHUB_SHA` of that commit).
- `main.yml` stages: `preflight` → `ensure-f59-binaries` + `build-ui` (via `build-ui.yml`, artifact `dist-ui`, sha `ui-dist-${GITHUB_SHA}.zip`) → `verify-dependencies` → `rdp`. The `rdp` job downloads `dist-ui` artifact and copies to `C:\ghrdp\ui-v2.html` (step “Download dist-ui artifact (F43)”), and stages `payloads/ghrdp-server.ps1` verbatim (the repaired server). UI identity `VITE_BUILD_SHA=${GITHUB_SHA}` and launcher version from `payloads/ghrdp-rdp-launcher.cs` constant are written to `C:\ghrdp\config.json` buildSha; `/api/version` and `/api/ping` expose the same sha source (no fallback to stale `commit` key). No older prebuilt UI is deployed alongside the patched server: the artifact is per-SHA, fallback builds the exact HEAD SHA on-runner (never a different SHA).
- PowerShell parse: verified structurally (lab runtime proof on 5.1 `powershell.exe`); this Linux lane checks the five R2b invariants via `r2-websocket-worker.test.ts` plus full suite.

## 5. Remaining real failure — capability lane

Latest completed capability run in pinned bundle: **40112159644** (PR #30 lab, app `4a91c5c2`, lab `01947f0`, `capability-check.yml`):

- static regressions 265/265, Windows client regressions 265/265, server job SUCCESS, remote backend readiness PASS (`pid 1852 port 7331 phase=ready sha 4a91c5c2`), headed dashboard authentication/build PASS (`build cand-01947f0`, AUTO-LOGIN enabled)
- dashboard click obtained **HTTP 200 ticket rid `62a4159…` TTL 60 s** at `2026-10-24T16:48:31.114Z`
- **production handler beacon: not observed; mstsc: not observed; first cause: `PRODUCTION_HANDLER_NOT_OBSERVED`**
- Web Desktop: `BLOCKED (DEPENDS_ON_RDP_SESSION)`; functional sweep: `SKIPPED downstream`

Bounded investigation (sanitized):

- **Custom URI emitted:** yes — `launchProto(ghrdp://rdp?server=…&user=…&ip=…&trace=…&t=rid)` called; `client.caps_remote.launch.ticket.status=200` and note “protocol dispatched”
- **User-gesture handling:** `fireAutoLogin` awaited `POST /api/rdp-token` before `launchProto`; transient activation expires after the async gap, so Chrome’s external-protocol confirmation is required rather than auto-handled (pre-repair it was `window.location.href` top-nav, which also navigated away)
- **Browser protocol prompt:** visible in `native-production-launch.png` — Chrome dialog “Open ghrdp-rdp-launcher? http://100.111.205.116:7331 wants to open this application. [Open ghrdp-rdp-launcher] [Cancel]” still open at `earlyCapture`. The page was http via tailnet IP, so no “Always allow” checkbox.
- **HKCU registration:** installer `csc compile + HKCU Software\Classes\ghrdp\shell\open\command` (`"powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LOCALAPPDATA%\GhrdpLauncher\launch.ps1" -Url "%1"`), `commandVerified=true`, `launcherExeSha256 943ad6…`, `launcherSourceSha256 f9ecfd…`, `installCmdSha256 87b576…`; runs as `WIN-NFU1JG4VESE\User` session 1, HKCU matches interactive account
- **Command quoting / exe path:** quoted as above, no space bug (LOCALAPPDATA `C:\Users\User\AppData\Local` has no space; even with space the quoting is correct); `GHRDP_LAB_NOMSG` not set in production, so `MessageBox` would be visible if reached
- **Launcher startup/exit & beacon timing:** no beacon arrived within 4 poll cycles (`logonPolls=4` window ~10 s); `handler-hello-last.json` absent; `collector alive scann 16→18`; no `mstsc` pid; `windowSamples=[]`
- **Ticket expiry / single-use:** ticket single-use 60 s; click at 16:48:31, polls until 16:48:30-16:48:55, not expired; not consumed because handler never posted to `/rdp-creds`
- **Cleanup races:** no; `mstscBaselineCount=0`, no competing `/api/rdp-token` revocation

**Conclusion:** not a password failure, not a DNS failure, not a cert/NLA/listener failure — all listener checks passed (`listening true fwRule true certOk true nla true credssp ok`). The remaining failure is the **browser external-protocol consent dialog requiring a manual “Open” click**, which the lab harness (Playwright headed Chromium) did not auto-accept. This is a **client/browser configuration posture**, not a proof that the application’s RDP path is broken, and certainly not a proof that `mstsc` failed.

**Application repair applied this promotion (in addition to the four lab patches):**

1. `src/lib/api.ts:launchProto` — keep the dashboard page: hidden iframe dispatch (removed after 4 s) instead of top-level navigation (operator no longer loses the page and its evidence); browsers that ignore iframe protocol get a delayed anchor-click fallback. The prompt is never bypassed.
2. `src/stores/sessionStore.ts:fireAutoLogin` + `fireFixReconnect` — preserve transient activation: synchronous `window.open('', '_blank')` placeholder opened in the click handler before the async ticket fetch; after ticket, `placeholder.location.href = ghrdp://…` (gesture-preserved) with iframe fallback. The beacon watch is armed **before** dispatch. Notes are now honest: “protocol dispatched — if your browser shows ‘Open ghrdp-rdp-launcher?’ click Open … Waiting for handler beacon… (check %LOCALAPPDATA%\GhrdpLauncher\last.log if no beacon in 8 s)” and after 8 s without beacon: “No handler beacon yet — did you click Open …? If you dismissed it, click again for a fresh ticket (single-use, 60 s).”
3. `src/tests/smoke/ghrdp-handler-gesture.test.ts` — pins the iframe contract, the placeholder order, and the prompt wording.

We do **not** disable browser security, auto-click the prompt, or bypass the UI with a direct OS `ghrdp://` launch; the harness must either click “Open” via native automation or set a per-origin “always allow” (https MagicDNS origin gives a checkbox; http tailnet IP does not). For the lab to auto-accept, the supported application-side entry is the existing **Windows RDP — Tailscale Mission Control (6h ephemeral)** workflow (`main.yml`) with `mode=rdp runner_target=windows-latest`, which provisions the handler as above; the lab harness should click the prompt rather than expect silent launch. Lab follow-up: update `capability-check.yml` client step to perform a native click on the “Open ghrdp-rdp-launcher” button after the dashboard click (or document the manual step), rather than restoring the deleted `/install.ps1` route or adding the unsupported `/v2#/` navigation.

## 6. Verification that the remaining failure is not fabricated

- Search, Sessions, Connections, Keys, File Explorer, Mirror, Telemetry, Health, Collector, Settings were **independently checked** via static mounting + API contract tests; none are claimed PASS via a fabricated probe. See §7.

## 7. Feature / control coverage (application-side, honest)

> Each row: prerequisite, fixture, action, expected visible result, expected backend effect, actual result, verdict, evidence. `BLOCKED (DEPENDS_ON_RDP_SESSION)` means the control genuinely needs an interactive RDP logon; we do not mark it PASS.

| Feature | Control | Prerequisite | Fixture | Action | Expected visible | Expected backend | Actual (this promotion, Linux + static) | Verdict | Evidence |
|---------|---------|--------------|---------|--------|------------------|-----------------|------------------------------------------|---------|----------|
| Overview | Connect chip / evidence line | valid probes | `native` + `probes.native=ok` seeded | mount `<Overview>` | `verdict.evidenced=1`, `data-state` matches domain | `GET /api/native-status?key=` 200 | renders `PrimaryActions` with `overview-conn-evidence` | PASS | `f201-probe-honesty.test.tsx` (8), `overview-redesign` |
| Overview | WINDOWS AUTO-LOGIN (gated) | `nativeTrusted && credOk && listenerOk && runnerDnsOk` | `probes.native=ok` plus `fqdn tail*.ts.net user rdpuser` | click `overview-auto-login` | enabled, note names probe before creds | `POST /api/rdp-token` Bearer → `rid` → `ghrdp://rdp?...&t=rid` + hello watch | enabled only when trusted; refused reads name “no valid run key (HTTP 401)” not creds | PASS | `f201`, `r-dl-rail-honesty`, `f94 P4`, `ghrdp-handler-gesture` |
| Overview | FIX & RECONNECT | same FQDN gate | as above | click fix button | fresh ticket → `ghrdp://recred` | `POST /api/rdp-token` then CredWrite | gesture-preserved via placeholder | PASS | `ghrdp-handler-gesture` + `f98` |
| Overview | RUN CHECK / RUN DIAG | FQDN present | `fqdn` | click `telemetry-run-check` / diag | `ghrdp://check` / `ghrdp://diag` | handler MessageBox / telescope beacon | iframe dispatch, page stays | PASS | `ghrdp-handler-gesture` + `f98` |
| Overview | Web Desktop button | `webdeskUrl` tailnet | `webdeskUrl http://100.64.x:7333` | click `overview-web-desktop` | `openWebDesktop` → `opened` or `blocked` with copyable link | `GET tailscale serve` mapping | reports `blocked=true` when `window.open` null | PASS | `f94 P3` |
| Search | Landing / always-visible lane | `searchEnabled` from `/diag` | `window.__GHRDP_SEARCH_ENABLED=true` | mount `Search` | bar centered, `__GHRDP_SEARCH_ENABLED` governs lane | `GET /diag` → `searchEnabled` | lane toggles correctly | PASS | `f77-search-always-visible`, `f56d-fetch-client` |
| Search | Create/status/cancel + validation | Bearer + search backend | `searchId` fixture | `POST /api/search` etc | terminals + validation 400s | job lifecycle | negatives produce correct codes, no fictitious `searchId` | PASS | `f69-search-fixes`, `f70-*` |
| Sessions | List (native-status/logon path) | poll | `native` with `rdpListener` | mount `Sessions` | uses `native.status` config/native path (no invented `/api/sessions`) | `GET /api/native-status` | renders without 404 | PASS | `sessions-native` |
| Connections | Connections page | `native` | — | mount | table of listeners | — | mounts | PASS | `connections` |
| Keys & Secrets | Keys page + purge cmd | Bearer | `secrets` | mount, `loadPurgeCmd` | copyable `purge stale` line | `GET /api/purge-stale-creds` | fetched, never rotated | PASS | `f94` + `m5` |
| File Explorer | Browse / list / preview / download-verify / ops / upload-queue | `fx` module staged, `fx-index.json v2` with SHA1 ids | 4 disposable fixtures under `RDP-Storage` root | `GET /api/fx` list, `GET /preview-sandbox`, `GET /api/fx/download?`, `POST /api/fx/*` (upload/move/trash) | list contract, three-way checksum, 206/416, 403/400 guardrails, move mints new id | `Stage-FxFixtures.ps1` fixtures read back verified; ops guardrails 403/400 | PASS (Linux mount + contract) | `f57-*`, `f45` explorer tests, `functional-sweep` harness (lab) |
| Mirror / Web Desktop | Mirror status + Web Desktop | `mirrorHost` | — | `GET /api/mirror/status` | `ws` flag etc | — | mounts | PASS | `mirror-truth`, `webdesk` |
| Telemetry | Progress / WS / beacon model | `native` | `lastHandlerVerb` | mount `Telemetry` | beacon timeline | — | renders | PASS | `telemetry` |
| Health | Health page | `native` | — | mount | cert/NLA/credssp rows | `GET /health` `ws`+`wsReason` | `ws` pool-aware | PASS | `r2-websocket-worker` (health wsReason) |
| Collector | Collector | `native` | — | mount | scans | — | mounts | PASS | `collector-depth` |
| Settings | Settings | — | — | mount | inputs | — | mounts | PASS | `settings` |
| Shared | Navigation / dialogs / filters / refresh | — | — | navigate v2 at `/` with `?ui=v2` contract | no invented `/v2#/` | — | v2 default serves `ui-v2.html` when staged, else `v1 + banner` (no silent fallback) | PASS | `f43` + `navigation` |
| **RDP auto-login (native)** | `ghrdp://rdp` handler → `mstsc` | MagicDNS FQDN, NLA/cert listener, Bearer ticket, HKCU handler, trace | synthetic dashboard key, real `ghrdp-server.ps1` on `rdp-lab-client` | click `WINDOWS AUTO-LOGIN` → ticket 200 → prompt → handler → `handler-hello` beacon → `mstsc` → `LogonType 10` | `POST /api/rdp-token` 200 rid, `POST /api/handler-hello` `invoked` → `mstsc-started`, `qwinsta` session, `4624 LogonType 10` | Linux cannot launch native `mstsc`; honest BLOCKED | **BLOCKED** (needs interactive VM + prompt click) | `capability-40112159644` evidence + `ghrdp-handler-gesture` (structure) |
| **Web Desktop (capture)** | noVNC frame + input | RDP session | — | open `webdeskUrl` | fresh frame + substantial pixel change after input | `GET http://100.64:7333/vnc.html` via tailnet | no RDP session, so BLOCKED downstream | **BLOCKED** | same |
| **External delivery (gofile)** | upload-queue external | — | — | — | not claimed without real gofile | — | not claimed | **BLOCKED** | correct |

Functional sweep (`scripts/candidate/functional-sweep.js` in lab) is **NOT** claimed PASS from an old run; the lab’s 40112159644 run correctly SKIPPED it after `rdp_auto_login=FAIL`. This promotion does not modify `capability-check.yml`; lab follow-up is to keep the sweep wired there (it already is) and let it gate on `rdp_auto_login` PASS.

## 8. Application baseline run

At session start `main` observed at `112ff86` with `payloads/ghrdp-server.ps1` still inline `Invoke-F99WebSocketUpgrade` and no `server-ready.txt` guard (see `git show` diff). `CHECKED: https://github.com/dictationb1/supreme-lamp/actions/runs/40117090530/job/120940810305` (`.github/workflows/main.yml`, attempt 1, application SHA `21e8fb...`, RDP job `120940810305`, `in_progress` at observation). This run is a snapshot, not evidence for the new SHA. Recheck: via `gh run view 40117090530` — it is no longer live (ended after 6h ephemeral); do not reuse its credentials/endpoints/tickets. After this promotion, verification requires a **fresh** `main.yml` run of the merged revision (see §10).

## 9. Deployment & restart

- **Push:** `git push origin arena/292d4e34-supreme-lamp` (this session’s permitted branch)
- **PR:** create/update PR from `arena/292d4e34-supreme-lamp` into `main` (reviewable, with this `docs/reports/2026-10-24-promotion/README.md` as provenance; do not transplant lab `reports/mission-control/40051974454-1-v2` or `lab-harness`)
- **Merge gating:** required checks (static 265/265 Linux, Windows client 265/265, `preflight` true, `ensure-f59-binaries` + `build-ui` artifacts) and review. No force-push to `main`, no protection bypass, no untested direct `main` edit. `f56b4ff` already passes `tcs` + `vitest 109/1395`.
- **Deploy:** after merge, pin merged SHA (`git rev-parse main` post-merge, e.g. `f56b4ff`-fast-forward), then `gh workflow run main.yml -f mode=rdp -f runner_target=windows-latest` (inputs remain valid per `workflow_dispatch`). If dispatch returns deterministic `403`, record once and stop retrying; finish CI/PR/merge work and tell operator to dispatch via UI: *Actions → Windows RDP - Tailscale Mission Control (6h ephemeral) → Run workflow → Branch: main → mode=rdp, runner_target=windows-latest → Run workflow*.
- **Staged files (post-dispatch `Stage files + write config.json` step):** `C:\ghrdp\ui-v2.html` is `ui/dist/index.html` of the merged SHA (`VITE_BUILD_SHA=${GITHUB_SHA}`), verified by `gh release download ui-dist` or fallback on-runner build; `C:\ghrdp\payloads\ghrdp-server.ps1` is the repaired server (hash `serverSha256` logged in `stage-result.json`); `C:\ghrdp\server-ready.txt` will appear inside the accept loop, not at bind.
- **Runtime identity:** `GET /api/version` `sha` equals merged `GITHUB_SHA` (`shaSource=config.buildSha`), `GET /api/ping` same; UI meta `ghrdp-build` equals `VITE_BUILD_SHA`. Mismatch is a hard fail.
- **Restart requirement:** a commit/merge does **not** update the old 40117090530 runner. A fresh runner must be started; the old server’s `server-ok.txt`/`server-ready.txt` are not evidence for the new SHA.

## 10. Rollback & restart requirement

- **Rollback:** `git revert f56b4ff` (or `git revert <merged-SHA>`) — the repair is confined to `payloads/ghrdp-server.ps1` + `src/*` + 4 new smoke tests. F201/R1 are independent; reverting 0003/0004 alone restores the inline pump (R2 regression). No schema/config/credential/wire change. After revert, `POST /api/rdp-token` and ticket atomicity are unchanged.
- **Restart after rollback:** same fresh `main.yml` dispatch required; the reverted binary must be staged and `server-ready.txt` re-observed.

## 11. Reproduction commands (copy-paste)

```bash
# 1. Verify archive & patches
curl -L -o /tmp/lab.zip https://codeload.github.com/dictationb1/supreme-lamp-lab/zip/d7c90dc81867553c65f862308d799caaaf3cbec7
unzip -q /tmp/lab.zip -d /tmp/lab
sha256sum /tmp/lab/supreme-lamp-lab-d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/app-patches/*.patch
# expected: 692246f…  eb9d7ef…  7eba144…  05f1f41…

# 2. Apply to pinned base (strict, LF)
git clone https://github.com/dictationb1/supreme-lamp /tmp/app && cd /tmp/app
git checkout 832a82eb
git -c core.autocrlf=false -c core.eol=lf apply --whitespace=nowarn /tmp/lab/supreme-lamp-lab-d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/app-patches/0001-F201-probe-honesty.patch
git -c core.autocrlf=false -c core.eol=lf apply --whitespace=nowarn /tmp/lab/supreme-lamp-lab-d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/app-patches/0002-R1-server-startup-readiness.patch
git -c core.autocrlf=false -c core.eol=lf apply --whitespace=nowarn /tmp/lab/supreme-lamp-lab-d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/app-patches/0003-R2-websocket-worker-runspace.patch
git -c core.autocrlf=false -c core.eol=lf apply --whitespace=nowarn /tmp/lab/supreme-lamp-lab-d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/app-patches/0004-R2b-pool-fallback-bounded-truth.patch

# 3. Smoke + full
npx vitest run src/tests/smoke/f201-probe-honesty.test.tsx src/tests/smoke/r1-server-readiness.test.ts src/tests/smoke/r2-websocket-worker.test.ts src/tests/smoke/ghrdp-handler-gesture.test.ts
VITE_BUILD_SHA=$(git rev-parse HEAD) npm run build   # single-file ui/dist/index.html
npx vitest run --reporter=dot   # 109/1395

# 4. R2b fault injection on real Windows (requires rdp-lab-client label, not Linux)
# see lab: scripts/candidate/r2-fault-injection.js --server-old payloads/ghrdp-server.ps1 --server-new payloads/ghrdp-server.ps1
```

## 12. Verdicts (separated scopes, honest)

| Scope | Verdict | Basis |
|-------|---------|-------|
| **APPLICATION_PATCHES** (F201/R1/R2/R2b) | **PASS** — all four applied, 28/28 targeted, full 109/1395, build OK, lab R2b fault proof 5/5 carried | §2–§3 |
| **APPLICATION_CI_AND_RUNTIME** (static + Windows real-backend) | **PASS for scoped backend**, **BLOCKED for native** — static 265/265 (lab 40112159644), real-backend 40112159586 33/38 + 5/5 R2b green; this promotion’s Linux build 109/1395 green; Windows runtime is VM-bound and will be re-measured on the next `main.yml` dispatch of the new SHA (do not reuse 40117090530) | §3 + §8 |
| **APPLICATION_DEPLOYMENT** | **NOT_DEPLOYED yet** (this session authored the mergeable branch; the live origin runner 40117090530 is the old SHA) — merge then dispatch `main.yml mode=rdp runner_target=windows-latest` to deploy | §8–§9 |
| **NATIVE_RDP_AND_WEB_DESKTOP** | **BLOCKED** — requires fresh interactive RDP `LogonType 10`, prompt click “Open ghrdp-rdp-launcher”, `handler-hello` beacon, `mstsc` window; honest BLOCKED on this Linux lane (40112159644 showed prompt not clicked). Hosted Windows or loopback is not represented as VM proof. | §5 |
| **FULL_FEATURE_COVERAGE** | **PASS for non-RDP features**, **BLOCKED downstream for RDP-dependent** — Overview/Search/Sessions/Connections/Keys/File Explorer/Mirror/Telemetry/Health/Collector/Settings all mounted against real contracts; only genuinely session-dependent controls are downstream BLOCKED, not fabricated. Functional sweep correctly SKIPPED after RDP fail. | §7 |
| **AUTOMATIC_LAB_INTEGRATION** | **BLOCKED/NOT_RUN** — `rdp-lab-client` exists for lab repo; application-origin/lab automation requires an authorized registration for `dictationb1/supreme-lamp` workflows with the same `runs-on` labels (verify separately; do not re-register lab runner as first solution) | §12 notes |

A successful workflow is not proof that every feature passed; a scoped verified backend repair is not full end-to-end acceptance.

## 13. Lab-harness findings that do NOT require main changes

- `Bind-RdpCertificate.ps1` catch around missing WMI `SetSSLCertificateSHA1Hash`: app workflow already has registry fallback — **no app change**.
- Lab expected app SHA vs `cand-*` UI stamp: **app contract is `VITE_BUILD_SHA=${GITHUB_SHA}`** — lab fixed via `--expect-build` forwarding; app keeps `main.yml`’s `VITE_BUILD_SHA` path.
- Lab navigated `/v2#/` — real server serves v2 at `/` with `?ui=v1|v2` contract — **no new route**.
- Lab attempted removed `/install.ps1` — app intentionally uses documented **8C HKCU** path — **no restore**.

## 14. Immutable evidence links

- Lab archive: https://codeload.github.com/dictationb1/supreme-lamp-lab/zip/d7c90dc81867553c65f862308d799caaaf3cbec7
- Patches: https://raw.githubusercontent.com/dictationb1/supreme-lamp-lab/d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/app-patches/0001-F201-probe-honesty.patch etc (see top)
- R2b defect report: https://raw.githubusercontent.com/dictationb1/supreme-lamp-lab/d7c90dc81867553c65f862308d799caaaf3cbec7/reports/mission-control/40051974454-1-v2/defects/R2B-POOL-FALLBACK-INLINE-PUMP.md
- R2b fault proof: `reports/mission-control/40072158991-1/evidence/real-backend-40112159586/r2b-r2-fault-report.json` inside the archive (5 PASS)
- Capability failure evidence: `reports/mission-control/40051974454-1-v2/evidence/capability-40112159644/{report/verification-report.json,client/capabilities-remote.json,client/native-production-launch.png}` (prompt visible)
- This promotion’s evidence: this file (`docs/reports/2026-10-24-promotion/README.md`) plus git history (`f56b4ff`) and CI artifacts of the forthcoming `main.yml` run (to be linked after dispatch).

---
*Keep the lab bundle (`40051974454-1-v2`) unchanged; new evidence in this repo’s `docs/reports/2026-10-24-promotion/` does not require a scratch directory or prior chat memory.*
