# Coverage audit — requirements vs. evidence (2026-10-25 repair)

Every requirement the operator stated, and the artifact that answers it. If a row
says *partial*, the gap is named in `unresolved.md`; nothing is marked complete on
inspection alone.

| # | Requirement (operator's words, condensed) | Evidence | State |
| --- | --- | --- | --- |
| 1 | One deliberate dispatch per user intent | `dispatch-single-attempt.test.ts` (19), `launch-store-single-dispatch.test.tsx` (11) | complete (JS) |
| 2 | One attempt identity, one ticket, ≤1 protocol navigation | attempt counters asserted in both suites (`ticketRequests === 1`, `dispatches === 1`) | complete (JS) |
| 3 | No speculative second dispatch / duplicate listeners | `dispatch.ts` has no iframe/anchor path; `api.ts` exposes a single `dispatchProtocolOnce`; dead `ghrdp-handler-gesture.test.ts` removed | complete (JS) |
| 4 | Rapid-duplicate-submission protection | `already-preparing` / `awaiting-handoff` assertions, incl. two synchronous clicks | complete (JS) |
| 5 | `location` assignment is never treated as proof | `dispatched` ≠ `connected`; `unconfirmed` is the default terminal state without a beacon | complete (JS + UI) |
| 6 | Fallback only after demonstrable pre-dispatch failure or explicit retry with fresh ticket | `no-dispatch-path` / `ticket-refused` paths; retry mints a new ticket (asserted) | complete (JS) |
| 7 | Uncertain outcome must not silently relaunch | `unconfirmed` blocks automatic dispatch; only an explicit click retries | complete (JS) |
| 8 | Do not close owned helper window on a 4 s timer | the helper window is gone; nothing is closed on a timer | complete (JS) |
| 9 | Behavioural tests counting dispatches/tickets/effects, incl. popup blocked, no handler, cancel, retry, expiry, late callbacks | all enumerated in `defects-and-reproductions.md` D1 table | complete |
| 10 | Keep single-use tickets; no auth/TLS/NLA weakening; no auto-clicking dialogs | no change to token endpoints, TLS or NLA; launcher still rejects replay and calls no dialog automation | complete (source) |
| 11 | Native "unknown publisher" classified separately from browser consent / cmdkey prompt | `PrimaryActions.tsx` triage block (3 numbered prompts); `native.ts` keeps cert, NLA, credssp and publisher as separate facts | complete (UI), U2 for the measured cause |
| 12 | Trace `cmdkey` to its real caller with evidence | trace: duplicate dispatch → second redemption → 401 → `CmdkeyStep(forcePrompt:true)`; the duplicate dispatch is now removed at the source | complete (trace), U3 to re-measure on Windows |
| 13 | Explicit attempt lifecycle with correlation, scan time ≠ event time, no inference from focus loss | `lifecycleStage()` + `recoveryDecision()` in `native.ts`; `rdp-recovery-correlation.test.ts` (18) | complete (JS) |
| 14 | Preserve earlier failures in history; clear attempt-owned timers on retry/cancel | history retained per attempt; each attempt owns its timers (asserted via late-callback tests) | complete |
| 15 | Real-time = observation + source + freshness; 4625 ≠ wrong password; failed probe ≠ credential failure; render `ws`/`wsReason` truthfully | V4 suites plus `issues.ts` occurred/observed split | complete (JS) |
| 16 | Centralized repository identity; every link verified; no repo from a query param | `repoIdentity.ts` + `repo-identity-links.test.ts` (6, includes "every DOC_LINKS path exists on disk") | complete |
| 17 | `/api/lab/inspect`: mode-first, one auth, one budget, one pipeline, one error schema | `lab-inspect-endpoint.test.ts` (16) — HTTP for the client, structural contract for the route | partial: route runtime executes on Windows only (U5) |
| 18 | Preserve HTTPS/redirect/host/SSRF protections; awesome.re chain allowlisted, not global | per-source `AllowedHosts`, hop re-check, `offHost` detail in refusals | complete (source + client HTTP) |
| 19 | Result mode preserves URL/query/provenance; no-releases vs fetch-failure distinguished | `resultKind`, `finalHostname`, `redirectChain`; `data-empty-kind` no-links/no-matches | complete (JS + source) |
| 20 | No duplicate inspections on back/reload/retry; production build not demo results | one POST per target+query (asserted); `production-bundle-no-demo.test.ts` (4) proves the rebuilt artifact contains no fixture rows (`fx-snap-01` -> 0) | complete (JS + artifact) |
| 21 | Full feature/operation inventory with prerequisite/action/expected/actual/verdict/evidence | `feature-operations.md` | complete |
| 22 | Disposable fixtures; no user data deleted, no unrelated sessions killed, no secrets rotated | all fixtures in-process/in-memory; no real endpoint touched | complete |
| 23 | Focused PR, merge after checks, fresh deploy, deterministic 403 reported once | `promotion.json` (real SHAs only) | see `promotion.json` |
| 24 | No force-push to main, no weakening tests/security, preserve F201/R1/R2/R2b/V4 | history untouched; only one obsolete static test removed, replaced by behavioural suites; F201/V4 suites green | complete |
| 25 | Evidence bundle + Sinhala report + handoff JSON | this directory, `REPORT-si.md`, `../../mission-control-current-handoff.json` | complete |
| 26 | Never fabricate merge/deploy SHAs; hash real artifacts | `evidence/build-sha256.txt`, `SHA256SUMS` | complete |
| 27 | User VM unreachable → finish app + Windows-verifiable work, leave `USER_VM_ACCEPTANCE` pending | `REPORT-si.md` §7 | complete |
| 28 | Final Sinhala report with the seven required sections | `REPORT-si.md` | complete |

## Test inventory added by this change

| File | Tests | Kind |
| --- | --- | --- |
| `src/tests/smoke/dispatch-single-attempt.test.ts` | 19 | behavioural (dispatch/ticket counters) |
| `src/tests/smoke/launch-store-single-dispatch.test.tsx` | 11 | behavioural (store + UI wiring) |
| `src/tests/smoke/rdp-recovery-correlation.test.ts` | 18 | behavioural (correlation rules) |
| `src/tests/smoke/lab-inspect-endpoint.test.ts` | 16 | HTTP (node:http fixture) + route contract |
| `src/tests/smoke/lab-inspector-2026-10-25.test.tsx` | 8 | UI behaviour (one inspection, states) |
| `src/tests/smoke/repo-identity-links.test.ts` | 6 | identity + on-disk link targets |
| `src/tests/smoke/launcher-replay-contract.test.ts` | 4 | launcher source contract |
| `src/tests/smoke/production-bundle-no-demo.test.ts` | 4 | source + built-artifact proof |
| **total** | **86** | |

Removed: `src/tests/smoke/ghrdp-handler-gesture.test.ts` (4 tests) — it locked in
the duplicate-dispatch helper window (`#ghrdpHelperWin`, 4 s close timer) that this
change deletes.
