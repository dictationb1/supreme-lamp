# Provider fixtures

Two kinds live here and they are never mixed:

* `authored/` — hand-written payloads in the exact shape each provider returns.
  They pin the PARSERS. They are not evidence that the provider is reachable.
* `live/` — bodies captured from the real provider by
  `scripts/provider-live-probe.mjs` on a host with real internet (CI job
  `search-provider-probe`, artifact committed under
  `tests/providers/fixtures/live/` + `docs/reports/search-repair/evidence/`).
  The offline suite parses these too, so a parser regression against the REAL
  current payload is caught without network access at test time.

The suite labels every assertion with its kind in
`docs/reports/search-repair/COVERAGE.md`. A live body never stands in for a
production result in the UI: the app only ever renders what the adapter
fetched at search time.
