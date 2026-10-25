# Verification — what was executed, on which revision, and how to re-run it

## Exact identities

| Item | Value |
| --- | --- |
| Tested application revision (branch head at test time) | `ae360351eb3fea434f482af1b9e9db48025936a7` |
| Branch | `arena/046926e8-supreme-lamp` |
| `main` when the branch was cut | `e067bcef5ff97287bbc79345fa6a55cd8f3fcf31` |
| Node / npm / vitest | `v22.22.3` / `10.9.8` / `2.1.9` |
| Production bundle (`ui/dist/index.html`) sha256 | `9315cdc8fe7d4f3cf3fa5f81e84811ed98e01c1aec79f1c7f57cb7af56b123ff` |
| Bundle size | 1 312 534 bytes |
| Launcher (`payloads/ghrdp-rdp-launcher.cs`) | **not compiled here** — no csc/mono/dotnet on the test host |

The bundle hash is the artifact produced by `npm run build` at the revision above;
it changes with any source edit, so re-derive it rather than trusting this line.

## Commands (all executed, results below)

```bash
npm ci                                  # 309 packages
npx tsc -p tsconfig.build.json           # 0 errors
npm run build                            # vite single-file build -> ui/dist/index.html
npx vitest run                           # full suite
npm run check:regression-ids             # 219 ids in sync
npm run check:no-neon-green
npm run check:bottom-bar
npm run check:fx-ids
npm run check:contrast
npm run check:glass-contrast
```

## Results

| Check | Result |
| --- | --- |
| `tsc -p tsconfig.build.json` | PASS (0 errors) |
| `vite build` (single-file) | PASS, 1 811 modules, ~1.27 MB output |
| `vitest run` (full) | **118 files / 1535 tests PASS**, exit 0 (log: `evidence/vitest-final.log`) |
| `check:regression-ids` | PASS (219 = baseline 219) |
| `check:no-neon-green` | PASS |
| `check:bottom-bar` | PASS |
| `check:fx-ids` | PASS |
| `check:contrast` | PASS |
| `check:glass-contrast` | PASS (worst control 5.14:1) |

Baseline before this work (same command): 111 files / 1453 tests PASS. This change
adds 8 test files with 86 tests (dispatch 19, store 11, correlation 18, lab
endpoint 16, lab UI 8, links 6, launcher 4, production bundle 4) and removes one obsolete static test
file (`ghrdp-handler-gesture.test.ts`, 4 tests, which asserted the presence of the
duplicate dispatch it was supposed to prevent): 1453 + 86 - 4 = 1535.

## Executable regression entry points (per defect)

| Defect | Command |
| --- | --- |
| Single dispatch / tickets / navigation counts | `npx vitest run src/tests/smoke/dispatch-single-attempt.test.ts src/tests/smoke/launch-store-single-dispatch.test.tsx` |
| Cancellation + correlation + lifecycle | `npx vitest run src/tests/smoke/rdp-recovery-correlation.test.ts` |
| Launcher replay (no cmdkey/mstsc/prompt) | `npx vitest run src/tests/smoke/launcher-replay-contract.test.ts` |
| Search A (allowlist / redirect) + B (result mode) | `npx vitest run src/tests/smoke/lab-inspect-endpoint.test.ts` |
| Lab UI states (empty / no-match / error / provenance / one inspection) | `npx vitest run src/tests/smoke/lab-inspector-2026-10-25.test.tsx` |
| Links + repository identity | `npx vitest run src/tests/smoke/repo-identity-links.test.ts` |
| Incident timestamps (occurred vs observed) | `npx vitest run src/tests/smoke/v4-conn-correlation.test.ts src/tests/smoke/v4-incident-ui.test.tsx` |
| Whole product regression | `npx vitest run` |

## What these tests actually prove (and what they do not)

* **Dispatch**: real invocations of the shipped store functions with a mocked
  ticket endpoint and a stubbed `location.assign`; they count POSTs and
  navigations, so a re-introduced second dispatch fails the suite.
* **Lab endpoint (client side)**: real HTTP over `node:http` through the shipped
  `src/api/lab` client, both modes, plus error propagation.
* **Lab endpoint (server side)**: the PowerShell route is **not executed** on this
  host. `lab-inspect-endpoint.test.ts` asserts the structural contract (mode
  selection before validation, one budget charge, one pipeline, allowlist on every
  fetch, replay-safe save probe). This is a regression fence, not a runtime proof.
  Runtime proof belongs to `main.yml`'s Windows job and the operator's VM.
* **Launcher**: `ghrdp-rdp-launcher.cs` is not compiled here; its contract is
  asserted structurally. The Windows candidate build is the runtime proof.
* **No VM, no tailnet, no live RDP**: nothing in this report claims a real RDP
  session was opened from this environment.

## Evidence files

| File | What it is |
| --- | --- |
| `evidence/vitest-final.log` | Full suite output (118 files / 1535 tests) at the tested revision |
| `evidence/build-sha256.txt` | sha256 of the built single-file bundle |
| `evidence/environment.txt` | Revision, tool versions, diffstat |
| `evidence/route-anchors.txt` | Line anchors for every changed production file (for reviewers) |
