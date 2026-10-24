# Coverage audit — what the 2026-10-24 "PASS" rows actually established

**The prior report is preserved, not rewritten.** Its file
`docs/reports/2026-10-24-promotion/feature-coverage.csv` and its
`FINAL-REPORT-si.md` are untouched. This audit re-reads each row and records
what its cited evidence can and cannot support.

## Headline

| Original claim | Audit result |
|---|---|
| 17 PASS rows of 19 | **0** survive as full-operation PASS |
| — | 16 are `EVIDENCE_INSUFFICIENT` (unit / mount / contract only) |
| — | 1 is `PARTIAL` (the File Explorer functional sweep) |
| 2 BLOCKED rows | labels are **correct**; still blocked |

The prior report did not claim "FULL_FEATURE_COVERAGE PASS" in those words, but
its summary treated the 17 PASS rows as feature coverage. Under the rule the
brief states — *a mounted component, nonempty page, HTTP 200 acknowledgement or
mocked test cannot establish that the real operation completed* — 17 rows
overstate. The corrected record is `coverage-audit.csv` (columns:
`audit_id, source_report, feature, control, original_verdict,
evidence_actually_establishes, corrected_scope_class, corrected_verdict,
reason`).

## Why each class fails as a coverage claim

* **MOUNT_ONLY** — `Sessions`, `Connections`, `Mirror`, `Telemetry`,
  `Collector`, `Settings`, `KeysAndSecrets` were justified by the words
  *"mounts"* or *"renders"* in their own `actual` column. A mount exercises the
  import graph and the first render, not the feature.
* **UNIT_ONLY** — the Overview and Shared rows were jsdom clicks against the
  shipped handler. That is genuinely valuable (it proves the control is not
  decorative), and it is why they are re-graded `EVIDENCE_INSUFFICIENT` for
  *coverage* rather than *invalid*. No `POST /api/rdp-token`, no `CredWrite`, no
  popup and no MessageBox was observed.
* **CONTRACT_ONLY** — the Search row asserts a route and status codes. The job
  lifecycle (create → status → results → cancel) was never driven, and the row's
  `expected_backend` was never observed.
* **PARTIAL_REAL** — the File Explorer row cites a functional sweep against
  staged fixtures. It is the only row whose evidence is close to an operation.
  It still does not tie checksum-verified downloads, progress, cancellation and
  retry each to an observed run, so it is `PARTIAL`, not `PASS`.

## What this PR changes about the claim

* `acceptance-matrix.csv` in this directory uses only
  `PASS` / `FAIL` / `BLOCKED` / `NOT_RUN`, and every PASS is a *behavioural*
  assertion against the shipped code (unit, component or pure model), with the
  test named. Anything that needs a live backend or a Windows host is
  `NOT_RUN` or `CONTRACT_ONLY` — never PASS.
* The new tests are deliberately shaped so a "fallback branch" cannot pass:
  each seeds the exact identity fields the state under test requires and asserts
  the *limitation* the evidence forces (e.g. `correlation: "unavailable"` →
  `cause.kind === "suspected"`).

## Replacement invariant for the two rewritten assertions

| Test | Old assertion | Why it was false | New invariant |
|---|---|---|---|
| `v3-troubleshoot` seed `FIVE` | `connState: "failed"` alone yields a **critical** issue | severity depended on the state string, not on whether the 4625 belonged to this client — the screenshot's exact defect | the seed now carries an attributed, current rejection (critical is legitimate) **and** a separate test (V4-1) asserts an unattributed rejection is `warning` + `suspected` |
| `r2-overview-redesign` "missing /ws endpoint" | `wsAvailable === false` renders `ws-absent` ("this build exposes no /ws endpoint") | `false` was also what a failed or unanswered probe produced | the seed sets `wsAvailability: "unsupported"` (an explicit `ok && ws === false && no reason` answer) **and** V4-UI-3 asserts pending / unauthorized / pool-unavailable each render their own state |
