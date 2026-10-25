# 2026-10-25 — Launch, cancellation, Search and link repair (evidence bundle)

Branch: `arena/046926e8-supreme-lamp` · base `ae36035` (cut from `main` `e067bce`)

| File | Purpose |
| --- | --- |
| `REPORT-si.md` | **Final report (Sinhala)** — the seven required sections: APPLICATION_REPAIRS, SINGLE_DISPATCH_AND_CANCELLATION, STATUS_ACCURACY, SEARCH_AND_LINKS, FULL_FEATURE_OPERATIONS, APPLICATION_DEPLOYMENT, USER_VM_ACCEPTANCE |
| `defects-and-reproductions.md` | Each defect: exact before/after code, why it was wrong, how it is now covered (D1–D8) |
| `verification.md` | Executed commands, measured results, tested revision + build hash, regression entry points, what the tests do **not** prove |
| `coverage-audit.md` | Requirement-by-requirement traceability (operator's list → artifact), test inventory |
| `feature-operations.md` | Every page/operation: prerequisite, fixture, action, expected UI, expected backend effect, actual, verdict |
| `unresolved.md` | Everything NOT done, why, and the exact step that closes it (U1–U9) |
| `promotion.json` | PR / merge / deploy state with real identifiers only (never invented) |
| `evidence/` | Machine evidence: full test log, bundle sha256, environment, source anchors |
| `SHA256SUMS` | Hashes of these documents themselves |

## Immutable links

These files are addressed by commit, not by branch, so they stay valid after
`main` moves. The revision below is the real squash-merge commit of PR #88:

```
https://github.com/dictationb1/supreme-lamp/blob/5f175a6db83cdd57132f8ee36cc220e21b506f6c/docs/reports/2026-10-25-ui-launch-search-repair/REPORT-si.md
https://github.com/dictationb1/supreme-lamp/raw/5f175a6db83cdd57132f8ee36cc220e21b506f6c/docs/reports/2026-10-25-ui-launch-search-repair/REPORT-si.md
```

Nothing in this bundle is a mock-up: every table row either names a command that
was executed (with its output kept under `evidence/`) or says **NOT RUN**.
