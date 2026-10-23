# P001 / P001B / P002 — merge, main CI and verdict addendum (2026-10-23)

මෙය `docs/reports/2026-10-23-p001-p002-p001b-application-repair-si.md` ට එකතුවන
කෙටි වාර්තාවයි: merge, main CI, deployment උත්සාහය සහ scope-accurate verdicts.

## 1. Merge

| item | value |
|---|---|
| PR | #40 (`arena/a56064f7-supreme-lamp` → `main`) |
| merged at | 2026-10-23T11:27:00Z |
| merge commit | `e242da637d2e558ef450f3ebbc0f549e8a39a141` |
| branch head that was tested | `c393d180d098aacb275a10acd71c881a84c49140` |
| is the merge commit on main | yes (`git rev-parse origin/main` = `e242da63…`) |

The bytes on main are the bytes the Windows lane executed:

```
$ git show origin/main:payloads/ghrdp-server.ps1 | sha256sum
78326369fbfc6e316096ee54d5f6ebe9783a40a3adc4059420929dff56512702
$ git show origin/main:tests/p001-p002-identity.ps1 | sha256sum
640a3b427011f948b6c24f60f18022ed4d59698f7056ecdf92337fd10b6fcd93
```

## 2. Candidate CI (pre-merge, branch)

| run | workflow | job | result |
|---|---|---|---|
| 39944991860 | launch-gates | `gates` | success |
| 39944991860 | launch-gates | `windows-native` (`P001/P001B/P002 runtime matrix` step, `F27` step, PS parse) | success |
| 39944991843 | e2e-ui | — | success |
| 39943307085 | autologin-lab | `proof` (real `F27` PowerShell matrix) | success |

Intermediate commit `28c7c2c1` had a red `windows-native`: the F27 harness
extracts an **explicit** function list from the server, so the new resolver had
to be added to that list (`ade68b8`). Every F27 assertion is unchanged and the
lane is green again — recorded here rather than hidden.

## 3. Main CI after merge (`e242da6`)

| run | workflow | result |
|---|---|---|
| 39946151495 | launch-gates (`gates`, `windows-native`) | success |
| 39946151285 | e2e-ui | success |
| 39946151502 | autologin-lab (`proof`, real Windows F27) | success |

## 4. Deployment attempt — deterministic permission rejection

`main.yml` (`mode=rdp`, `runner_target=windows-latest`) on `main`:

```
$ gh workflow run main.yml --ref main -f mode=rdp -f runner_target=windows-latest
could not create workflow dispatch event: HTTP 403: Resource not accessible by integration
(https://api.github.com/repos/dictationb1/supreme-lamp/actions/workflows/385695353/dispatches)
```

Recorded once; not retried. The token used here can read the repository and
merge PRs but cannot create workflow dispatch events. **This is the only
operator action this work needs** — see §6.

Run `39936058717` (`15e15ab8`, created 2026-10-23T10:01Z) is an *older,
unpatched* dispatch by someone else's session: it is not this repair's run, no
claim is made about it, and nothing was reused from it. No run started by this
work is active.

## 5. Why a fresh `mode=rdp` run matters for P002

`main.yml` ends the rdp job with **F92 smoke**:
`node scripts/f92-smoke-probe.mjs` → `GET /api/f92-selftest?frontendSha=<GITHUB_SHA>`
and `node scripts/assert-selftest.js`. The probe treats **any nested `fail`
check, including `version:match`, as not-ready**. Before this repair,
`version:match` compared `?frontendSha` with the *workflow environment* only;
the dashboard is started by the `GHRDP-Server` **Scheduled Task**, which
inherits no `GITHUB_SHA`, so it answered `dev` and the check failed. With this
repair the same server resolves identity from `config.json.buildSha` (written by
the staging step) and the two agree. A green smoke step on a fresh merged run is
therefore direct production evidence for P002 — and it can only be observed after
the run's keep-alive phase, which is why it is not claimed here.

## 6. Verdicts (scope-accurate)

### APPLICATION_PATCHES — **VERIFIED**

* the bundle was downloaded from the pinned lab commit, all three patch hashes
  verified against `SHA256SUMS` **and** `manifest.json`;
* the bundle replays on its own base: `REPLAY_OK`, 3 patches, 6/6;
* the three defects exist on current main and are repaired there (adapted, not
  blind-applied);
* the repairs execute correctly on a real Windows PowerShell runtime
  (`launch-gates → windows-native`, step `P001/P001B/P002 runtime matrix`, 52
  checks) and on the pre-existing F27 runtime matrix;
* the zero-dependency suite is clean: 943 tests, 915 pass, 2 environment-only
  failures (PyYAML absent, actionlint asset unreachable from the sandbox),
  26 pre-existing skips; with PyYAML installed only the actionlint-download
  negative control fails;
* UI/`src/`, the UI bundle, TLS/NLA, the signing identity, MC-SIGNAL and the
  logon observer are untouched (pinned by test).

### APPLICATION_DEPLOYMENT — **BLOCKED** (one dispatch permission)

* merged and green on main CI (`e242da6`);
* the deployed bytes are byte-identical to the tested bytes;
* **not verified**: that a fresh `mode=rdp` run of `e242da6` starts the patched
  server, reports `/api/version.sha = e242da6`, mints a ticket for its own
  credential from a real tailnet peer and passes F92 smoke. The dispatch above
  was refused with HTTP 403 (`Resource not accessible by integration`).

Operator action (smallest possible): dispatch the existing workflow —

```
workflow: .github/workflows/main.yml
ref:      main
inputs:   mode=rdp, runner_target=windows-latest
```

That single dispatch covers §5 and the `/api/version` observation; anything more
(tailnet peer, client VM) is §7.

### FULL_MISSION_CONTROL_INTEGRATION — **NOT_VERIFIED / NOT_RUN**

Nothing in this work proves: discovery of a current application origin by the
lab, authenticated Mission Control in the interactive client VM, native RDP
through the intended launcher with fresh correlated LogonType 10 evidence,
signed final `.rdp`, or fresh Web Desktop frames. Those need a live tailnet
peer and the client VM; a sandbox browser or a server-local self-probe would not
be proof and is not reported as such.

## 7. Still owed after a permitted dispatch

1. `GET /api/version` on the running server: `sha == e242da6…`, `sha7 == e242da6`,
   `shaSource == config.buildSha`.
2. `GET /api/f92-selftest?frontendSha=<sha>` → `status: pass` with
   `version:match.status == pass` (the F92 smoke gate).
3. `POST /api/rdp-token` from a real tailnet peer with the run's own credential →
   `200 {rid,ttl}`; a previous run's credential → 401.
4. `GET /api/purge-stale-creds` with the current credential → 200 (command is
   returned, never executed); with a superseded credential → 401.
5. MC-SIGNAL check-run bound to that run/attempt/SHA with a fresh heartbeat.
6. Client VM: Mission Control UI, native RDP, LogonType 10, Web Desktop frames.

## 8. Rollback (post-merge, actual sequence)

`git revert` **newest first**, then restart the dashboard process:

```
git revert <docs addendum commit>        # this file
git revert c393d18                       # report
git revert ade68b8                       # F27 import list
git revert 28c7c2c                       # runtime baseline arm
git revert 2d68101                       # resolver + identity + routes
```

Reverting `2d68101` removes the shared resolver; nothing else may still call it
at that point (`ade68b8` only touches the test harness, so the order above is
dependency-safe). No credential, certificate, signing identity or `config.json`
is touched by a rollback.
