// [SINGLE-DISPATCH / ATTEMPT-LIFECYCLE-2026-10-25] Cancellation, correlation and
// the honest stage vocabulary.
//
// The operator's screenshot showed "Password rejected by the host ... 38s BEFORE
// the last mstsc launch": a failed logon that PREDATED the launch, attributed to
// it by temporal proximity alone. These tests pin the correlation rules that make
// that sentence unreachable.
import { describe, expect, it } from "vitest";
import { lifecycleStage, recoveryDecision, RECOVERY_ATTEMPT_MAX_AGE_MS } from "@/lib/domain/native";

const NOW = Date.parse("2026-10-25T14:00:00Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function failedEvent(over: Record<string, unknown> = {}) {
  return {
    result: "failed",
    sub: "0xC000006A",
    status: "0xC000006D",
    eventTs: iso(-5_000), // 5s after the beacon by default
    scanTs: iso(0),
    correlation: "complete",
    userMatched: true,
    sourceMatch: "match",
    targetUser: "rdpuser",
    expectedUser: "rdpuser",
    recordId: "4625-1",
    session: null,
    ...over,
  };
}

function chain(beaconOffsetMs: number, trace = "trace-1") {
  return [{ details: "invoked", ts: iso(beaconOffsetMs - 3_000) }, { details: "mstsc-started", ts: iso(beaconOffsetMs), trace }];
}

describe("[CORRELATION] recovery is only offered for THIS attempt", () => {
  it("correlated wrong-password after the launch: offered, with the real event time", () => {
    const rec = recoveryDecision(failedEvent(), chain(-10_000), NOW);
    expect(rec.show).toBe(true);
    expect(rec.why).toBe("password-rejected-by-host");
    expect(rec.dtSec).toBe(5);
    expect(rec.eventTs).toBe(iso(-5_000));
    expect(rec.manualFallback).toBeUndefined();
  });

  it("a failure that PREDATES the launch is history, never this attempt (the '38s before' defect)", () => {
    const rec = recoveryDecision(failedEvent({ eventTs: iso(-48_000) }), chain(-10_000), NOW);
    expect(rec.show).toBe(false);
    expect(rec.why).toBe("failure-predates-the-launch");
    expect(rec.dtSec).toBe(-38);
  });

  it("no event timestamp: the collector's SCAN time is not a substitute", () => {
    const rec = recoveryDecision(failedEvent({ eventTs: "", scanTs: iso(0) }), chain(-10_000), NOW);
    expect(rec.show).toBe(false);
    expect(rec.why).toBe("no-event-time");
  });

  it("an unstated identity is not a match", () => {
    expect(recoveryDecision(failedEvent({ userMatched: undefined }), chain(-10_000), NOW).why).toBe("identity-unknown");
    expect(recoveryDecision(failedEvent({ userMatched: null }), chain(-10_000), NOW).why).toBe("identity-unknown");
  });

  it("another account or another source is refused explicitly", () => {
    expect(recoveryDecision(failedEvent({ userMatched: false }), chain(-10_000), NOW).why).toBe("other-account");
    expect(recoveryDecision(failedEvent({ sourceMatch: "mismatch" }), chain(-10_000), NOW).why).toBe("other-source");
  });

  it("missing correlation is not assumed complete", () => {
    expect(recoveryDecision(failedEvent({ correlation: "" }), chain(-10_000), NOW).why).toBe("correlation-not-reported");
    expect(recoveryDecision(failedEvent({ correlation: "unavailable" }), chain(-10_000), NOW).why).toBe("correlation-unavailable");
    expect(recoveryDecision(failedEvent({ correlation: "none" }), chain(-10_000), NOW).why).toBe("no-correlated-event");
  });

  it("a live inbound RDP session outlives a failed attempt (do not call it wrong password)", () => {
    const rec = recoveryDecision(failedEvent({ session: { active: true, name: "rdp-tcp#3", state: "Active" } }), chain(-10_000), NOW);
    expect(rec.show).toBe(false);
    expect(rec.why).toBe("session-already-active");
  });

  it("a console session does not mask a genuine rejection", () => {
    const rec = recoveryDecision(failedEvent({ session: { active: true, name: "console", state: "Active" } }), chain(-10_000), NOW);
    expect(rec.show).toBe(true);
  });

  it("a beacon from a DIFFERENT attempt is not this attempt's evidence", () => {
    const rec = recoveryDecision(failedEvent({ attemptTrace: "trace-1" }), chain(-10_000, "trace-other"), NOW);
    expect(rec.show).toBe(false);
    expect(rec.why).toBe("beacon-belongs-to-another-attempt");
  });

  it("an old launch cannot keep describing a new cancellation", () => {
    const rec = recoveryDecision(failedEvent({ eventTs: iso(-RECOVERY_ATTEMPT_MAX_AGE_MS - 5_000) }), chain(-RECOVERY_ATTEMPT_MAX_AGE_MS - 10_000), NOW);
    expect(rec.show).toBe(false);
    expect(rec.why).toBe("launch-too-old");
  });

  it("a non-wrong-password 4625 is not a wrong password", () => {
    for (const sub of ["0xC000006F", "0xC0000072", "0xC0000234", "0xC000015B"]) {
      const rec = recoveryDecision(failedEvent({ sub }), chain(-10_000), NOW);
      expect(rec.show).toBe(false);
      expect(rec.why).toBe("sub-not-wrong-password");
    }
  });

  it("no failure at all: nothing is offered and nothing is claimed", () => {
    const rec = recoveryDecision(null, chain(-10_000), NOW);
    expect(rec.show).toBe(false);
    expect(rec.why).toBe("no-failed-logon");
  });
});

describe("[ATTEMPT-LIFECYCLE] only observed stages, never inferred outcomes", () => {
  it("idle before any launch", () => {
    expect(lifecycleStage({}).stage).toBe("idle");
  });

  it("browser stages are named for what they are", () => {
    expect(lifecycleStage({ attemptStage: "preparing" }).stage).toBe("preparing");
    expect(lifecycleStage({ attemptStage: "ticket-issued" }).stage).toBe("preparing");
    expect(lifecycleStage({ attemptStage: "dispatched" }).stage).toBe("awaiting-handoff");
    expect(lifecycleStage({ attemptStage: "unconfirmed" }).stage).toBe("unconfirmed");
  });

  it("a handler beacon is not a connection", () => {
    const s = lifecycleStage({ attemptStage: "dispatched", handlerObserved: true });
    expect(s.stage).toBe("handler-observed");
    expect(s.source).toBe("launcher:beacon");
  });

  it("auth-confirmed and connected are distinct", () => {
    expect(lifecycleStage({ attemptStage: "handler-observed", handlerObserved: true, authConfirmed: true }).stage).toBe("auth-confirmed");
    expect(
      lifecycleStage({ attemptStage: "handler-observed", handlerObserved: true, authConfirmed: true, sessionActive: true }).stage,
    ).toBe("connected");
  });

  it("cancelled requires a positive operator observation", () => {
    expect(lifecycleStage({ attemptStage: "dispatched", cancelledByUser: true }).stage).toBe("cancelled");
    // A dispatched attempt with no beacon is NOT cancelled and NOT failed.
    expect(lifecycleStage({ attemptStage: "dispatched" }).stage).toBe("awaiting-handoff");
  });

  it("an active session with no correlated logon is not 'connected'", () => {
    expect(lifecycleStage({ attemptStage: "dispatched", sessionActive: true }).stage).toBe("awaiting-handoff");
  });
});
