// [R-FILES / #217 / #225] The Explorer READ/OP split — a class-level gate.
//
// Why this file exists. The routed Files page must read the runner's normalized
// index, and the F45 S3 gate forbids the S3 OP client (idempotency header, the
// fx.err catalog) in the shipped bundle. The first implementation read the index
// through `components/explorer/api/*`, which dragged the whole op client into
// ui/dist/index.html and broke that gate in CI (check-run "gates" on 1513a9b:
// "S3 client code leaked into the shipped bundle (X-Idempotency-Key)").
//
// The repair is a split, not a relaxation:
//   * src/lib/explorer/transport.ts  - the OP transport (unchanged; still owns
//     /api/fx/op, the CSRF cookie, trash/restore/move and NOT the read).
//   * src/lib/explorer/read-index.ts - the READ transport (new): one GET, dash
//     token in the header, schema gate, typed ExplorerReadError.
//   * `.github/workflows/launch-gates.yml` keeps the two S3-op needles forbidden
//     AND pins the one read path positively, so neither direction can drift
//     unnoticed: a reopened import fails here, and a lost read fails the bundle
//     assertion in the workflow.
//
// Every assertion below fails loudly on a re-introduced import, and the two
// "negative control" assertions prove the check is not vacuous.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p) => readFileSync(p, "utf8");

/** Matches a real import of the S3 lane; prose mentions are not imports. */
const S3_IMPORT = /from\s+["'][^"']*components\/explorer\/api/;

const READ = read("src/lib/explorer/read-index.ts");
const OP = read("src/lib/explorer/transport.ts");
const HOOK = read("src/lib/explorer/useListing.ts");
const GATES = read(".github/workflows/launch-gates.yml");

test("V3-READ-SPLIT: the read path is its own module and never imports the S3 op client", () => {
  assert.ok(READ.includes('export const FX_LIST_PATH = "/api/fx/list"'), "the read owns exactly one GET path");
  assert.ok(READ.includes('from "./transport"'), "the read reuses the documented same-origin transport");
  // The probe matches an IMPORT, not a prose mention: the module's own header
  // names the S3 lane on purpose (it explains why the read is not there).
  assert.ok(!S3_IMPORT.test(READ), "the read must not import the S3 lane");
  assert.ok(S3_IMPORT.test('import { createFxApi } from "@/components/explorer/api/endpoints";'), "positive control: the import probe fires");
  assert.ok(!READ.includes("X-Idempotency-Key"), "the S3-only idempotency header must not appear");
  assert.ok(!/\?key=/.test(READ), "the dash token must never travel in a URL");
});

test("V3-READ-SPLIT: the listing hook reads through read-index and not through the op client", () => {
  assert.ok(HOOK.includes('from "./read-index"'), "useListing must consume the read module");
  assert.ok(!S3_IMPORT.test(HOOK), "no op-client import may remain in the hook");
  assert.ok(!HOOK.includes("createFxClient") && !HOOK.includes("createFxApi"), "the op client factories stay out");
  assert.ok(HOOK.includes("readIndex({ signal: controller.signal })"), "the read is issued with the request's own signal");
});

test("V3-READ-SPLIT: the F56-d fence on the OP transport still holds", () => {
  // This is the pre-existing F57 assertion, re-pinned here so the split cannot
  // be "simplified" later by moving the list path back into transport.ts.
  assert.ok(!OP.includes("api/fx/list"), "the op transport must stay free of the read path");
  assert.ok(!OP.includes("X-Idempotency-Key"));
  assert.ok(OP.includes("ghrdp_fx_csrf") && OP.includes('export const FX_OP_PATH = "/api/fx/op"'));
});

test("V3-READ-SPLIT: the bundle gate forbids the S3 op markers and pins the read path", () => {
  const gate = GATES.slice(GATES.indexOf("[F49] X-Dash-Token is a legitimate PRODUCTION header"));
  assert.ok(gate.length > 0, "the F45 S3 bundle step must still exist");
  const step = gate.slice(0, gate.indexOf("F45 S3 endpoint gates PASS"));
  for (const needle of ["'X-Idempotency-Key'", "'fx.err.hostBadGateway'"]) {
    assert.ok(step.includes(needle), `${needle} must still be a forbidden bundle needle`);
  }
  // The reviewed contract change: the read path is asserted POSITIVELY, so
  // deleting the read (and with it live rows) cannot pass as "clean bundle".
  assert.ok(step.includes("if ! grep -qF '/api/fx/list' ui/dist/index.html"), "the read path must be pinned positively");
  assert.ok(step.includes("REVIEWED CONTRACT CHANGE"), "the change must carry its justification in the workflow");
  // The old, now-false premise must be gone from the step's own text.
  assert.ok(!step.includes("the shipped bundle\n          # must not gain any"), "the obsolete premise must be rewritten");
});
