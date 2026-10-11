// [R2 §8 / #194] The connection state machine, exercised on EVERY branch.
//
// WHY THIS SUITE IS SHAPED LIKE THIS. The operator's report names the failure
// mode precisely: "some green E2E tests exercised fallback branches rather than
// the intended seeded UI/popup journey." A test that renders a component with no
// data and asserts "it did not crash" passes through the same code path whether
// or not the feature works. Every case below therefore:
//   1. seeds the exact inputs the state under test needs,
//   2. asserts the state that was expected - and ONLY that state,
//   3. asserts the evidence string names the producer it came from, so a
//      verdict that happens to be right for the wrong reason still fails.
//
// deriveConnectionState is pure, so there is no timer, no fetch and no jsdom
// fallback anywhere in this file. That is deliberate: the branch under test is
// the product's own logic, not a test double's.
import { describe, expect, it } from "vitest";
import {
  deriveConnectionState,
  connTone,
  EVIDENCE_MAX_SCAN_AGE_MS,
  HELLO_WATCH_WINDOW_MS,
  RUN_START_TOLERANCE_MS,
  type ConnEvidence,
} from "@/lib/overview/readiness";

const NOW = 1_800_000_000_000;
/**
 * [V3-02 / D5] Timestamps are now derived from NOW instead of being literal
 * 2026 strings that sat three months before it. The old seeds encoded an
 * incoherent scenario - "the collector scanned this three months ago" - and
 * presented it as a current connection; the freshness gate exists precisely so
 * that can no longer pass. Seeds are built, not typed, so they stay coherent.
 */
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const FRESH_SCAN = ago(5_000);
const FRESH_EVENT = ago(30_000);

/** All gates green, no launch requested, no logon evidence -> "unknown". */
function base(over: Partial<ConnEvidence> = {}): ConnEvidence {
  return {
    credOk: true,
    runnerDnsOk: true,
    listenerOk: true,
    helloWatchArmed: false,
    helloWatchSeen: false,
    helloWatchArmedAt: 0,
    authResult: null,
    authEventTs: "",
    authScanTs: "",
    collectorDead: false,
    nowMs: NOW,
    ...over,
  };
}

describe("R2 connState: five distinct states, one per branch", () => {
  it("connected - ONLY from an observed interactive 4624", () => {
    const v = deriveConnectionState(
      base({ authResult: "success", authEventTs: FRESH_EVENT, authScanTs: FRESH_SCAN })
    );
    expect(v.state).toBe("connected");
    // The evidence must name the producer, not just restate the state.
    expect(v.evidence).toContain("logon collector");
    expect(v.evidence).toContain("4624");
    expect(v.evidence).toContain(FRESH_EVENT);
    expect(v.evidenced).toBe(true);
    expect(connTone(v.state)).toBe("success");
  });

  it("a green WebSocket and a queued launch do NOT produce 'connected'", () => {
    // This is the exact regression #194 describes. A launch in flight with no
    // logon evidence must be "requested", never "connected".
    const v = deriveConnectionState(base({ helloWatchArmed: true, helloWatchArmedAt: NOW - 3_000 }));
    expect(v.state).not.toBe("connected");
    expect(v.state).toBe("requested");
    expect(v.evidenced).toBe(false); // a pending request is not evidence
    expect(connTone(v.state)).toBe("warning");
  });

  it("launched - the beacon proves the launcher ran, and says it is NOT a connection", () => {
    const v = deriveConnectionState(base({ helloWatchArmed: true, helloWatchSeen: true, helloWatchArmedAt: NOW - 5_000 }));
    expect(v.state).toBe("launched");
    expect(v.evidence.toLowerCase()).toContain("no interactive logon observed");
    expect(v.evidenced).toBe(true);
  });

  it("failed - a 4625 outranks a pending launch", () => {
    const v = deriveConnectionState(
      base({ helloWatchArmed: true, helloWatchArmedAt: NOW - 2_000, authResult: "failed", authEventTs: FRESH_EVENT })
    );
    expect(v.state).toBe("failed");
    expect(v.evidence).toContain("4625");
    expect(connTone(v.state)).toBe("danger");
  });

  it("unavailable - names EVERY failing gate, not just the first", () => {
    const v = deriveConnectionState(base({ credOk: false, listenerOk: false }));
    expect(v.state).toBe("unavailable");
    expect(v.blockers).toEqual(["credentials", "listener"]);
    expect(v.evidence).toContain("credentials");
    expect(v.evidence).toContain("listener");
    expect(v.evidence).not.toContain("dns"); // the passing gate is not blamed
  });

  it("unknown - no launch and no evidence is NOT an error", () => {
    const v = deriveConnectionState(base());
    expect(v.state).toBe("unknown");
    expect(v.evidenced).toBe(false);
    expect(connTone(v.state)).toBe("neutral");
  });

  it("unknown names a dead collector, so missing evidence is not read as a healthy machine", () => {
    const v = deriveConnectionState(base({ collectorDead: true }));
    expect(v.state).toBe("unknown");
    expect(v.evidence).toContain("collector is not running");
  });

  it("an armed launch older than the beacon window falls back out of 'requested'", () => {
    const stale = deriveConnectionState(base({ helloWatchArmed: true, helloWatchArmedAt: NOW - HELLO_WATCH_WINDOW_MS - 1 }));
    expect(stale.state).toBe("unknown");
    const fresh = deriveConnectionState(base({ helloWatchArmed: true, helloWatchArmedAt: NOW - HELLO_WATCH_WINDOW_MS }));
    expect(fresh.state).toBe("requested");
  });

  it("the requested window counts down from the real remaining time", () => {
    const v = deriveConnectionState(base({ helloWatchArmed: true, helloWatchArmedAt: NOW - 12_000 }));
    expect(v.state).toBe("requested");
    expect(v.evidence).toContain("8s"); // 20s window - 12s elapsed
  });
});

describe("R2 connTone: no state renders as a neutral pill when it is not neutral", () => {
  it.each([
    ["connected", "success"],
    ["requested", "warning"],
    ["launched", "warning"],
    ["failed", "danger"],
    ["unavailable", "danger"],
    ["unknown", "neutral"],
    // [V3-02] A logon we can see but cannot confirm as current is a WARNING,
    // never a green pill - this row is the whole point of D5.
    ["historical", "warning"],
    ["unverified", "warning"],
  ] as const)("%s -> %s", (state, tone) => {
    expect(connTone(state)).toBe(tone);
  });
});

describe("V3-02 / D5: a 4624 is only 'connected' when it can be placed in time", () => {
  it("a scan older than the collector's own tick is 'unverified', not 'connected'", () => {
    const v = deriveConnectionState(
      base({
        authResult: "success",
        authEventTs: ago(EVIDENCE_MAX_SCAN_AGE_MS * 10),
        authScanTs: ago(EVIDENCE_MAX_SCAN_AGE_MS + 1_000),
      })
    );
    expect(v.state).toBe("unverified");
    expect(v.state).not.toBe("connected");
    expect(v.evidenced).toBe(false);
    expect(v.evidence).toContain("old");
    expect(connTone(v.state)).toBe("warning");
  });

  it("a scan exactly at the freshness limit is still current", () => {
    const v = deriveConnectionState(
      base({
        authResult: "success",
        authEventTs: ago(EVIDENCE_MAX_SCAN_AGE_MS - 1_000),
        authScanTs: ago(EVIDENCE_MAX_SCAN_AGE_MS),
      })
    );
    expect(v.state).toBe("connected");
  });

  it("a logon from BEFORE this run started is 'historical', not 'connected'", () => {
    const runStartedAtMs = NOW - 600_000; // this run began 10 minutes ago
    const v = deriveConnectionState(
      base({
        authResult: "success",
        authEventTs: new Date(runStartedAtMs - 3_600_000).toISOString(), // an hour before it
        authScanTs: FRESH_SCAN,
        runStartedAtMs,
      })
    );
    expect(v.state).toBe("historical");
    expect(v.state).not.toBe("connected");
    expect(v.evidence.toLowerCase()).toContain("before this run started");
    expect(connTone(v.state)).toBe("warning");
  });

  it("a logon inside the run-start tolerance is NOT called historical", () => {
    const runStartedAtMs = NOW - 600_000;
    const v = deriveConnectionState(
      base({
        authResult: "success",
        authEventTs: new Date(runStartedAtMs - RUN_START_TOLERANCE_MS / 2).toISOString(),
        authScanTs: FRESH_SCAN,
        runStartedAtMs,
      })
    );
    expect(v.state).toBe("connected");
  });

  it("a 4624 with no scan stamp is 'unverified' - it cannot be dated", () => {
    const v = deriveConnectionState(base({ authResult: "success", authEventTs: FRESH_EVENT, authScanTs: "" }));
    expect(v.state).toBe("unverified");
    expect(v.evidence).toContain("no scan time");
  });

  it("an unparseable scan stamp is 'unverified', not silently treated as fresh", () => {
    const v = deriveConnectionState(
      base({ authResult: "success", authEventTs: FRESH_EVENT, authScanTs: "not-a-timestamp" })
    );
    expect(v.state).toBe("unverified");
  });

  it("a 4624 with no event timestamp is 'unverified' - it cannot be compared to the run", () => {
    const v = deriveConnectionState(base({ authResult: "success", authEventTs: "", authScanTs: FRESH_SCAN }));
    expect(v.state).toBe("unverified");
    expect(v.evidence).toContain("no timestamp");
  });

  it("a 4625 from a previous run is 'historical' - a rejection is still placed in time", () => {
    const runStartedAtMs = NOW - 600_000;
    const v = deriveConnectionState(
      base({
        authResult: "failed",
        authEventTs: new Date(runStartedAtMs - 3_600_000).toISOString(),
        runStartedAtMs,
      })
    );
    expect(v.state).toBe("historical");
  });

  it("a 4625 in the CURRENT run stays 'failed' - a stale scan must not erase a rejection", () => {
    const v = deriveConnectionState(
      base({ authResult: "failed", authEventTs: FRESH_EVENT, authScanTs: ago(600_000) })
    );
    expect(v.state).toBe("failed");
    expect(connTone(v.state)).toBe("danger");
  });
});
