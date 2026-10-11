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
  HELLO_WATCH_WINDOW_MS,
  type ConnEvidence,
} from "@/lib/overview/readiness";

const NOW = 1_800_000_000_000;

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
      base({ authResult: "success", authEventTs: "2026-10-11T03:52:10Z", authScanTs: "2026-10-11T03:55:00Z" })
    );
    expect(v.state).toBe("connected");
    // The evidence must name the producer, not just restate the state.
    expect(v.evidence).toContain("logon collector");
    expect(v.evidence).toContain("4624");
    expect(v.evidence).toContain("2026-10-11T03:52:10Z");
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
      base({ helloWatchArmed: true, helloWatchArmedAt: NOW - 2_000, authResult: "failed", authEventTs: "2026-10-11T03:53:00Z" })
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
  ] as const)("%s -> %s", (state, tone) => {
    expect(connTone(state)).toBe(tone);
  });
});
