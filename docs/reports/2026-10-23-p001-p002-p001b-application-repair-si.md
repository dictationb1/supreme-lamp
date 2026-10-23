# P001 / P001B / P002 — application repair, verification and handoff (2026-10-23)

**කියවන්න:** මෙය `dictationb1/supreme-lamp` main ට එකතු කළ ප්‍රතිසංස්කරණවල
(application patches) සහ ඒවා මත කරන ලද verification වල සත්‍ය වාර්තාවයි.
Deployment සහ Mission Control / RDP / Web Desktop සම්පූර්ණ integration සඳහා
වෙන් වූ verdicts පහත §7 හි දක්වා ඇත; ඒවා එකිනෙකට මිශ්‍ර කර නොමැත.

| item | value |
|---|---|
| lab source (read-only) | `dictationb1/supreme-lamp-lab` @ `7e92a891dcb1adcab1dde812c1fa6e3a92ca5ce0` |
| bundle | `app-candidate/` (3 patches + 6 pinned node tests + replay script) |
| original bundle base | `978a8375ee77b392ce11694ccee7722fd6ca4f71` |
| application base this repair was written on | `28e2f278baaceb272d44d442be31dffe29addcb8` (main) |
| repair branch / PR | `arena/a56064f7-supreme-lamp` / #40 |
| shipped code touched | `payloads/ghrdp-server.ps1` only (no `src/`, no UI bundle, no workflow semantics) |

## 1. Bundle provenance — downloaded, checksummed, replayed

```
$ curl -fsSL -o lab.zip https://codeload.github.com/dictationb1/supreme-lamp-lab/zip/7e92a891...
$ python3 -c "import zipfile; zipfile.ZipFile('lab.zip').extractall(...)"   # 156 entries, no unsafe paths
$ cd app-candidate/patches && sha256sum -c SHA256SUMS
0001-P001-authorize-the-ticket-route-against-the-current-.patch: OK
0002-P002-api-version-reads-config.json-buildSha-the-iden.patch: OK
0003-P001B-purge-route-current-token.patch: OK
```

Hashes match both `SHA256SUMS` and `manifest.json`:

| # | file | SHA256 |
|---|---|---|
| 0001 | P001 | `550f44dfcf07ab1db247209018a9cf8ea46ff25044c6bde0222fc754b3ff7109` |
| 0002 | P002 | `a645b8287342a6bbdb2b475a53db559335052467def7b3fc9cb01171146b3cfb` |
| 0003 | P001B | `1e20650fd6a4830298c918e7ed4a311d9ec9f33d49b859f04ba87a36710e436e` |

Original-base replay (fresh standalone clone at the pinned base, lab script
unchanged):

```
$ git fetch --depth=1 origin 978a8375ee77b392ce11694ccee7722fd6ca4f71
$ app-candidate/replay/apply-and-verify.sh /tmp/appbase
REPLAY_OK base=978a8375ee77b392ce11694ccee7722fd6ca4f71 patches=3   (6/6 pinned tests)
```

### Bundle inconsistencies found and resolved

| inconsistency | resolution |
|---|---|
| handoff names patch 0002 with an outdated filename | `series.txt` + `SHA256SUMS` + `manifest.json` agree on `0002-P002-api-version-reads-config.json-buildSha-the-iden.patch`; that is the file that exists and matches |
| prose says "5 pinned tests", manifest says 6 | the shipped test file has **6** tests; the replay printed `6/6` |
| prose says "two patches", queue has three | three (P001, P002, P001B) |
| `docs/reports/2026-10-23-app-candidate-p001-p002-si.md` referenced by the prompt | **does not exist** at the pinned commit (only `2026-10-22-mission-control-integration-si.md` and `2026-10-23-native-rdp-signing-...`) |
| rollback README omits patch 0003 | recorded here: dependency-safe reversal is **0003 → 0002 → 0001** |
| replay falls back to `--ignore-whitespace`; `REPLAY_OK` ≠ strict apply | the replay above applied **strictly** (the fallback branch was never taken; `git status` showed only the expected two files) |
| replay requires a `.git` **directory** | used a real standalone clone, not a worktree |
| manifest prose about live runs (`in_progress` at 10:18) | treated as historical; no run, endpoint, credential or claim was reused |

## 2. Defects (reproduced by reading current main, then by execution)

**P001** — `POST /api/rdp-token` compared the bearer with `$script:Token`, the
credential read **once at boot**. `main.yml` kicks the `GHRDP-Server` scheduled
task in *F92 register user-session server* and writes `config.json`
(`buildSha`, `dashToken`) and `dash-token.txt` much later in *Stage files +
write config.json*. Consequences: the run's own credential got 401, and a
previous run's credential stayed mintable for the life of the process.

**P001B** — `GET /api/purge-stale-creds` repeated the identical single-snapshot
comparison, on a route that hands out a credential-deleting command.

**P002** — `GET /api/version` read `config.json.commit`, a key nothing writes.
The workflow writes `buildSha`. The task-owned server inherits no
`GHRDP_BUILD_SHA`/`GITHUB_SHA`, so the endpoint answered `sha="dev"` for a server
whose exact identity was on disk. The same chain was used by `/api/ping.commit`
and by the F92 `version:match` check — which compares against
`?frontendSha=<GITHUB_SHA>` and therefore reported a **false**
`backend dev != frontend <sha>` failure. `main.yml`'s *F92 smoke* step fails the
rdp job on any `fail` check, so this was deployment-blocking, not cosmetic.

## 3. What was implemented (adapted, not blind-applied)

All three hunks were ported by hand onto current main (the bundle's patches do
not apply to `28e2f27`: the surrounding regions moved).

### P001/P001B — one credentialed authority, revocation ledger

`Get-GhrdpStrictDashTokenCandidates` returns **exactly one** current credential:

1. `dash-token.txt` — **authoritative**. `main.yml` writes `config.json` first
   and `dash-token.txt` *last* from the same value; `Provision-GhrdpVps.ps1`
   writes and re-validates the same file.
2. `config.json.dashToken` — fallback **only** when the file cannot be read or
   does not parse, and **only** for the credential already established as
   current (or to establish one when nothing is established yet).
3. Nothing readable → the **last established** credential stays valid. The boot
   snapshot is not consulted again after a rotation.

Adopting a new credential **revokes** the previous one and the boot snapshot for
the life of the process. A revoked value cannot become valid again because a
file disappeared, emptied out or stopped parsing. No union of remembered
credentials, no invented grace window, no fail-open. Constant-time
`Test-TicketBearer` per candidate, telemetry per refusal, and the
`401 → 403 (tailnet source) → 409 (MagicDNS) → 200 {rid,ttl}` order are
preserved. The purge route shares the resolver and still **returns** a command
(it never executes anything).

**Corrections over the bundle** (found by review, then pinned):

| bundle behaviour | why it is unsafe | this implementation |
|---|---|---|
| returns `file-token ∪ config-token` | a stale `config.json.dashToken` re-authorizes a credential the token file already replaced | one authoritative value; a disagreeing config-only value is not authority |
| falls back to the boot snapshot when neither source is readable | a superseded credential becomes mintable again when the files vanish | last established credential only; superseded values are in a revocation ledger |
| no shape validation | whitespace/control bytes could be treated as a credential | `Test-GhrdpDashTokenShape` (printable ASCII, 8..256 chars) |

### P002 — deployed identity, validated precedence

`Get-GhrdpBuildIdentity` (shared by `/api/version`, `/api/ping` and the F92
`version:match` check):

1. `config.json.buildSha` — **deployed application identity** (written by the
   same staging step that staged these bytes) — wins over the execution
   environment, so a conflicting runner identity cannot make the server report
   another build;
2. `GHRDP_BUILD_SHA`, then `GITHUB_SHA` — execution identity;
3. `config.gitCommit` / `sourceSha` / `commit` — legacy aliases (nothing writes them);
4. `dev` — no valid identity anywhere; never invented.

Every step is validated as `^[0-9a-fA-F]{7,40}$`, lower-cased; `sha7` stays the
7-character prefix; `shaSource` is additive (`config.buildSha`, `env.X`,
`config.X`, `none`). No commit SHA is hard-coded.

## 4. Tests

| layer | file | result |
|---|---|---|
| contract pins (zero-dependency) | `tests/p001-p002-ticket-and-version-identity.test.js` | **10/10 pass** |
| **runtime** matrix (real PowerShell, shipped functions) | `tests/p001-p002-identity.ps1` | **52 checks pass** on `windows-latest` (launch-gates `windows-native`, step 9) |
| existing runtime suite that exercises the same routes | `tests/f27-windows.ps1` (autologin-lab `proof`) | pass — 401/403/200 ordering unchanged through the new gate |
| whole zero-dependency node suite | `node --test tests/*.test.js` | 943 tests, 915 pass, 2 env-only failures (see §5) |
| workflow validation (with PyYAML present) | `node --test tests/workflow-validation.test.js` | 5/6 — the remaining failure is the actionlint download (blocked host), not a repository defect |
| bundle replay on the pinned base | `app-candidate/replay/apply-and-verify.sh` | `REPLAY_OK`, 3 patches, 6/6 |

The runtime matrix executes the shipped functions (AST extraction, the
`tests/f27-windows.ps1` convention) against a temp `Root` and synthetic peers:

1. credential written **after** the process starts → 200 `{rid:32hex, ttl:60}`;
2. rotation under the **same** running process → new 200, superseded 401;
3. token file = new, `config.json` = old → new 200, old 401;
4. `config.json` = new, token file = old → the file value stays current,
   the config-only value is refused (documented authority, secure direction);
5. token file missing / empty / malformed → the established credential still
   works, nothing else becomes valid;
6. every source removed after a rotation → the superseded and boot-snapshot
   values stay 401 (no resurrection), anonymous stays 401 (no fail-open);
7. supported static/bootstrap case (process came up with the file) → the boot
   credential works until a rotation, then dies;
8. purge route: current 200 with `olderThanDays=7`, `target=TERMSRV/...`,
   `command` returned and **not** executed, superseded/anonymous/forged 401;
9. `/api/version` + `/api/ping`: deployed identity, `sha7`, `shaSource`,
   conflicting env cannot override the deployed identity, malformed value →
   `dev`, no identity → `dev`;
10. a **pre-patch baseline arm** for each core case (the old snapshot-only gate
    and the old env-only identity chain), so the matrix cannot pass against the
    unfixed code.

## 5. Honest test accounting

* `node --test tests/*.test.js` in this environment: **943 tests, 915 pass,
  2 fail, 26 skipped**. Both failures are environment-only:
  `WF-VALIDATOR-1`/`-3` need PyYAML (absent) and the actionlint release asset
  (host not reachable from this sandbox). With PyYAML installed,
  `WF-VALIDATOR-1` passes and only the actionlint-download negative control
  fails. Neither touches the repaired code.
* The 26 skips are the suite's own platform/optional gates, unchanged by this
  work (baseline had the same count).
* No test was disabled, weakened or deleted. `tests/f27-windows.ps1` gained the
  new function names in its **import list** (it extracts an explicit list from
  the server); every assertion in it is unchanged.

## 6. Accessibility / permission limits met

* The lab repository was used **read-only** (public HTTPS + codeload). Nothing
  was pushed, dispatched or modified there.
* Local sandbox has no PowerShell and cannot reach GitHub release assets, so the
  PowerShell *runtime* proof runs on the repository's own
  `launch-gates → windows-native` runner (real Windows, real `pwsh`), not here.
* No credential, private key or token value appears in any test, artifact or
  this document. Tokens in the runtime matrix are randomised per run and only
  length + `sha256[0:8]` are printed.

## 7. Verdicts (scope-accurate)

1. **APPLICATION_PATCHES** — see the handoff summary in the PR/commit evidence.
2. **APPLICATION_DEPLOYMENT** — separate; requires a fresh `main.yml`
   `mode=rdp` run of the merged commit.
3. **FULL_MISSION_CONTROL_INTEGRATION** — separate; requires a real tailnet peer,
   the interactive client VM, native RDP + signed `.rdp`, LogonType 10 evidence
   and fresh Web Desktop frames.

## 8. Rollback

* Original three-patch queue: reverse in dependency order **0003 → 0002 → 0001**
  (0003 reuses 0001's resolver; 0002 and 0001 touch adjacent regions).
* This repair: `git revert <commit>` in application order
  (commit 1 adds resolver + identity + routes, commit 2 adds the runtime
  baseline arm, commit 3 fixes the F27 import list, commit 4 adds evidence
  annotations). Reverting all four restores the pre-repair bytes; revert
  **newest first**. The shared resolver must not be removed while
  `/api/purge-stale-creds` still calls it — that is what commit order prevents.
* After any revert the dashboard process must be restarted: a running process
  does not reload its own file.
* No credential, certificate, signing identity or `config.json` is touched by a
  rollback.
