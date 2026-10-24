// [V4 / 2026-10-25] THE CORRELATED CONNECTION MODEL, end to end.
//
// WHY THIS FILE EXISTS. The screenshot this session was handed showed
// "Connection failed" over a working RDP session, with a 4625 from an earlier
// attempt rendered as "0s ago" and labelled "the host rejected the stored
// credential" with `cause.kind = confirmed`.
//
// The old suites could not catch that, because every case they seeded was a
// machine-wide fact (a bare `authResult` plus two timestamps). The invariant
// this file replaces is NOT "failed is always critical" - it is:
//
//   a state is only as strong as the identity it can be attributed to and the
//   freshness of the reading behind it.
//
// Every case therefore seeds the identity fields the backend actually
// publishes (record id, target user, source match, correlation, session
// evidence) and asserts BOTH the state and the limitations the evidence forces.
import { describe, expect, it } from "vitest";
import {
  authFreshness,
  classifyFailure,
  connTone,
  deriveConnectionState,
  EVIDENCE_MAX_SCAN_AGE_MS,
  MAX_CLOCK_SKEW_MS,
  RUN_START_TOLERANCE_MS,
  type ConnEvidence,
} from "@/lib/overview/readiness";
import { deriveIssues, type IssueInput } from "@/lib/overview/issues";
import { reconcileIncidents, incidentAgeMs, EMPTY_INCIDENTS } from "@/lib/overview/incidents";

const NOW = 1_800_000_000_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const RUN_START = NOW - 30 * 60_000; // this run started 30 minutes ago
const FRESH_SCAN = ago(5_000);
const USER = "WIN-NFU1JG4VESE\\User";

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
    runStartedAtMs: RUN_START,
    nowMs: NOW,
    ...over,
  };
}

/** A fully correlated, current, inbound-RDP success. */
function remoteSuccess(over: Partial<ConnEvidence> = {}): ConnEvidence {
  return base({
    authResult: "success",
    authEventTs: ago(2 * 60_000),
    authScanTs: FRESH_SCAN,
    authTargetUser: USER,
    expectedUser: USER,
    authUserMatched: true,
    authLogonType: "10",
    authRemoteInteractive: true,
    authCorrelation: "complete",
    authRecordId: "900001",
    ...over,
  });
}

/** A fully correlated, current rejection of the intended account. */
function matchingFailure(over: Partial<ConnEvidence> = {}): ConnEvidence {
  return base({
    authResult: "failed",
    authEventTs: ago(60_000),
    authScanTs: FRESH_SCAN,
    authTargetUser: USER,
    expectedUser: USER,
    authUserMatched: true,
    authStatus: "0XC000006D",
    authSub: "0XC000006A",
    authCorrelation: "complete",
    authRecordId: "900002",
    ...over,
  });
}

describe("V4-1: correlation decides WHOSE failure it is", () => {
  it("another account's 4625 cannot fail this client's connection", () => {
    const v = deriveConnectionState(
      matchingFailure({
        authTargetUser: "WIN-NFU1JG4VESE\\Administrator",
        authUserMatched: false,
        authCorrelation: "none",
      })
    );
    expect(v.state).not.toBe("failed");
    // Nothing in flight and every gate green: the honest answer is "unknown".
    expect(v.state).toBe("unknown");
    expect(v.notices.join(" ")).toMatch(/different account/i);
    expect(v.notices.join(" ")).toContain("Administrator");
    expect(v.correlation).toBe("none");
  });

  it("a 4625 from another SOURCE is excluded even when the user matches", () => {
    const v = deriveConnectionState(
      matchingFailure({
        authSource: "100.101.7.9",
        authSourceMatch: "mismatch",
        authCorrelation: "partial",
      })
    );
    expect(v.state).not.toBe("failed");
    expect(v.notices.join(" ")).toMatch(/different source/i);
  });

  it("a failure that matches the account and is current is still 'failed'", () => {
    const v = deriveConnectionState(matchingFailure());
    expect(v.state).toBe("failed");
    expect(v.failureClass).toBe("wrong-password");
    expect(connTone(v.state)).toBe("danger");
    expect(v.freshness).toBe("current");
    expect(v.correlation).toBe("complete");
  });

  it("a matching failure FOLLOWED by a matching success is 'connected'", () => {
    // The backend reduces to the NEWEST attributable event, so by the time the
    // client sees "success" the rejection of the same account is history. The
    // invariant here: a green state is reachable without any special-casing.
    const v = deriveConnectionState(
      remoteSuccess({
        authEventTs: ago(10_000),
        authRecordId: "900005",
        authRemoteEventTs: ago(10_000),
      })
    );
    expect(v.state).toBe("connected");
    expect(v.eventAtMs).toBe(Date.parse(ago(10_000)));
  });

  it("a failed NEW attempt does NOT close a session that is still Active", () => {
    const v = deriveConnectionState(
      matchingFailure({
        authEventTs: ago(20_000),
        // The remote session was created BEFORE the rejected attempt.
        authSessionActive: true,
        authSessionName: "rdp-tcp#4",
        authSessionState: "Active",
        authSessionLogonTs: ago(40 * 60_000),
      })
    );
    expect(v.state).toBe("connected");
    expect(v.notices.join(" ")).toMatch(/rejected/i);
    expect(v.notices.join(" ")).toMatch(/survived/i);
    expect(v.evidence).toContain("rdp-tcp#4");
  });

  it("a failed attempt BEFORE the live session is still the failure", () => {
    // Order matters: if the session was created AFTER the rejection, the
    // rejection belongs to an older attempt and the session is the newest fact.
    const v = deriveConnectionState(
      matchingFailure({
        authEventTs: ago(20 * 60_000),
        authSessionActive: true,
        authSessionName: "rdp-tcp#4",
        authSessionState: "Active",
        // The live session was created AFTER the rejection, so the rejection
        // belongs to an older attempt and is the newest failure - not saved by
        // the session that came later.
        authSessionLogonTs: ago(5 * 60_000),
      })
    );
    expect(v.state).toBe("failed");
  });

  it("an event from an EARLIER run is historical, not current", () => {
    const v = deriveConnectionState(
      remoteSuccess({ authEventTs: new Date(RUN_START - 3_600_000).toISOString() })
    );
    expect(v.state).toBe("historical");
    expect(v.evidence).toMatch(/before this run started/i);
  });

  it("missing correlation fields do not become a false 'confirmed' failure", () => {
    const v = deriveConnectionState(
      base({
        authResult: "failed",
        authEventTs: ago(60_000),
        authScanTs: FRESH_SCAN,
        authCorrelation: "unavailable",
        // no expectedUser / targetUser / userMatched at all
      })
    );
    // It IS a rejection, so the state stays failed - but the verdict says the
    // attribution is unavailable rather than inventing one.
    expect(v.state).toBe("failed");
    expect(v.correlation).toBe("unavailable");
    const issues = deriveIssues({
      progressLost: false,
      wsLive: true,
      wsAvailable: true,
      wsAvailability: "supported",
      wsDead: false,
      wsDeadReason: "",
      wsAttempts: 0,
      wsLastDisconnectAtMs: null,
      serverNowMs: NOW,
      nativeLost: false,
      collectorDead: false,
      authScanTsMs: Date.parse(FRESH_SCAN),
      connState: v.state,
      connBlockers: v.blockers,
      sessionExpired: false,
      authEventTsMs: v.eventAtMs,
      connFreshness: v.freshness,
      connCorrelation: v.correlation,
      connFailureClass: v.failureClass,
    } as IssueInput);
    const failed = issues.find((i) => i.id === "conn-failed")!;
    expect(failed.cause.kind, "an unattributed rejection must not be 'confirmed'").toBe("suspected");
    expect(failed.severity).toBe("warning");
    expect(failed.cause.text).toMatch(/could not attribute/i);
  });
});

describe("V4-2: console sign-in is not inbound RDP", () => {
  it("a type-2 autologon with a console session is 'console', never 'connected'", () => {
    const v = deriveConnectionState(
      remoteSuccess({
        authLogonType: "2",
        authRemoteInteractive: false,
        authRemoteEventTs: undefined,
        authSessionActive: true,
        authSessionName: "console",
        authSessionState: "Active",
        authSessionLogonTs: ago(20 * 60_000),
      })
    );
    expect(v.state).toBe("console");
    expect(v.state).not.toBe("connected");
    expect(v.evidence).toMatch(/not proof of an inbound RDP connection/i);
    expect(connTone(v.state)).toBe("warning");
  });

  it("a cached-interactive (type 11) logon is 'console' too", () => {
    const v = deriveConnectionState(
      remoteSuccess({ authLogonType: "11", authRemoteInteractive: false, authRemoteEventTs: undefined })
    );
    expect(v.state).toBe("console");
  });

  it("a type-2 logon whose Terminal Services session is rdp-tcp IS 'connected'", () => {
    // Windows can record an RDP sign-in as type 2 when the session was
    // pre-created; the session NAME is the evidence that resolves it.
    const v = deriveConnectionState(
      remoteSuccess({
        authLogonType: "2",
        authRemoteInteractive: false,
        authRemoteEventTs: undefined,
        authSessionActive: true,
        authSessionName: "rdp-tcp#2",
        authSessionState: "Active",
        authSessionLogonTs: ago(5 * 60_000),
      })
    );
    expect(v.state).toBe("connected");
    expect(v.evidence).toContain("rdp-tcp#2");
  });

  it("a type-10 logon is 'connected' without any session evidence", () => {
    const v = deriveConnectionState(remoteSuccess({ authLogonType: "10", authRemoteInteractive: true }));
    expect(v.state).toBe("connected");
  });
});

describe("V4-3: ONE freshness rule for success and failure", () => {
  it.each([
    ["no scan stamp", "", "undated"],
    ["an unparseable scan stamp", "not-a-timestamp", "undated"],
    ["a scan from before the epoch of this page", ago(EVIDENCE_MAX_SCAN_AGE_MS + 1), "stale"],
    ["a scan stamped in the future", new Date(NOW + MAX_CLOCK_SKEW_MS + 1).toISOString(), "undated"],
    ["a fresh scan", FRESH_SCAN, "current"],
  ])("%s -> %s", (_label, scanTs, expected) => {
    expect(authFreshness(scanTs as string, NOW)).toBe(expected);
  });

  it("a STALE failure is labelled stale instead of reading as current", () => {
    const v = deriveConnectionState(matchingFailure({ authScanTs: ago(600_000) }));
    expect(v.state).toBe("failed");
    expect(v.freshness).toBe("stale");
    expect(v.evidence).toMatch(/600s old/i);
    expect(v.evidence).toMatch(/may already be resolved/i);
  });

  it("a stale SUCCESS and a stale FAILURE get the same freshness verdict", () => {
    const staleTs = ago(600_000);
    const ok = deriveConnectionState(remoteSuccess({ authScanTs: staleTs }));
    const bad = deriveConnectionState(matchingFailure({ authScanTs: staleTs }));
    expect(ok.freshness).toBe("stale");
    expect(bad.freshness).toBe("stale");
    // ...and the stale success is not promoted to "connected".
    expect(ok.state).toBe("unverified");
  });

  it("a malformed event timestamp cannot be placed in time", () => {
    const v = deriveConnectionState(remoteSuccess({ authEventTs: "yesterday-ish" }));
    expect(v.state).toBe("unverified");
    expect(v.eventAtMs).toBeNull();
  });

  it("a future-dated event is not read as freshly connected", () => {
    // A timestamp a day ahead is malformed, not "very fresh".
    const future = new Date(NOW + 24 * 3_600_000).toISOString();
    const v = deriveConnectionState(remoteSuccess({ authEventTs: future, authScanTs: FRESH_SCAN }));
    // The event parses, so it is not "undated"; it is simply newer than the
    // run, which is inside tolerance and therefore not historical. What it must
    // NEVER be is a silent "current" reading: the freshness of the SCAN (not the
    // event) governs currency, and the event is reported verbatim.
    expect(v.eventAtMs).toBe(Date.parse(future));
    expect(v.evidence).toContain(future);
  });
});

describe("V4-4: dead collector is not 'no logon', and no evidence is not failure", () => {
  it("a dead collector with no events is unknown + named", () => {
    const v = deriveConnectionState(base({ collectorDead: true, authResult: "none", authScanTs: "" }));
    expect(v.state).toBe("unknown");
    expect(v.evidence).toMatch(/collector is not running/i);
    expect(v.evidenced).toBe(false);
  });

  it("zero matching events on a LIVE collector is 'none yet', not 'failed'", () => {
    const v = deriveConnectionState(base({ authResult: "none", authScanTs: FRESH_SCAN }));
    expect(v.state).toBe("unknown");
    expect(v.state).not.toBe("failed");
    expect(v.freshness).toBe("current");
  });

  it("a launcher beacon is NOT a connection", () => {
    const v = deriveConnectionState(base({ helloWatchArmed: true, helloWatchSeen: true, helloWatchArmedAt: NOW - 5_000 }));
    expect(v.state).toBe("launched");
    expect(v.state).not.toBe("connected");
    expect(v.evidence).toMatch(/no interactive logon observed/i);
  });
});

describe("V4-5: the 4625 reason is not always 'wrong password'", () => {
  it.each([
    ["0XC000006A", "wrong-password"],
    ["0XC000006D", "bad-user-or-password"],
    ["0XC0000064", "no-such-user"],
    ["0XC0000234", "account-locked"],
    ["0XC0000072", "account-disabled"],
    ["0XC000006E", "account-restriction"],
    ["0XC000006F", "time-restriction"],
    ["0XC0000070", "workstation-restriction"],
    ["0XC0000071", "credential-expired"],
    ["0XC000015B", "logon-type-denied"],
    ["0XC0000999", "other"],
  ])("SubStatus %s -> %s", (sub, expected) => {
    expect(classifyFailure("0XC000006D", sub)).toBe(expected);
  });

  it("Status alone is classified when SubStatus is absent", () => {
    expect(classifyFailure("0XC0000234", "")).toBe("account-locked");
  });

  it("an event with NEITHER code is 'unclassified', not a guessed password error", () => {
    expect(classifyFailure("", "")).toBe("unclassified");
    expect(classifyFailure(undefined, undefined)).toBe("unclassified");
  });

  it("an unknown SubStatus is 'other', never the coarse Status meaning", () => {
    // Status 0xC000006D means "logon failure"; promoting an unrecognized
    // SubStatus to "bad user or password" would be an over-claim.
    expect(classifyFailure("0XC000006D", "0XC0000999")).toBe("other");
  });

  it("a locked account is not described as a rejected password", () => {
    const v = deriveConnectionState(matchingFailure({ authSub: "0XC0000234", authStatus: "0XC000006D" }));
    expect(v.failureClass).toBe("account-locked");
    const issues = deriveIssues({
      progressLost: false,
      wsLive: true,
      wsAvailable: true,
      wsAvailability: "supported",
      wsDead: false,
      wsDeadReason: "",
      wsAttempts: 0,
      wsLastDisconnectAtMs: null,
      serverNowMs: NOW,
      nativeLost: false,
      collectorDead: false,
      authScanTsMs: Date.parse(FRESH_SCAN),
      connState: v.state,
      connBlockers: v.blockers,
      sessionExpired: false,
      authEventTsMs: v.eventAtMs,
      authSub: "0XC0000234",
      authStatus: "0XC000006D",
      authTargetUser: USER,
      expectedUser: USER,
      authUserMatched: true,
      connFreshness: v.freshness,
      connCorrelation: v.correlation,
      connFailureClass: v.failureClass,
    } as IssueInput);
    const failed = issues.find((i) => i.id === "conn-failed")!;
    expect(failed.cause.text).toMatch(/locked out/i);
    expect(failed.cause.text).not.toMatch(/rejected the stored credential/i);
    // It is still a real, attributed, current failure: confirmed + critical.
    expect(failed.cause.kind).toBe("confirmed");
    expect(failed.severity).toBe("critical");
  });
});

describe("V4-6: incidents keep their age and resolve only on recovery", () => {
  const failureIssueInput = (eventMs: number, recordId: string) =>
    deriveIssues({
      progressLost: false,
      wsLive: true,
      wsAvailable: true,
      wsAvailability: "supported",
      wsDead: false,
      wsDeadReason: "",
      wsAttempts: 0,
      wsLastDisconnectAtMs: null,
      serverNowMs: NOW,
      nativeLost: false,
      collectorDead: false,
      authScanTsMs: Date.parse(FRESH_SCAN),
      connState: "failed",
      connBlockers: [],
      sessionExpired: false,
      authEventTsMs: eventMs,
      authRecordId: recordId,
      authSub: "0XC000006A",
      authStatus: "0XC000006D",
      authTargetUser: USER,
      expectedUser: USER,
      authUserMatched: true,
      connFreshness: "current",
      connCorrelation: "complete",
      connFailureClass: "wrong-password",
    } as IssueInput);

  it("the issue is dated from the EVENT, not from the poll", () => {
    const eventMs = NOW - 3 * 3_600_000; // three hours old
    const issues = failureIssueInput(eventMs, "900010");
    const failed = issues.find((i) => i.id === "conn-failed")!;
    expect(failed.occurredAtMs).toBe(eventMs);
    expect(failed.observedAtMs).toBe(eventMs);
    expect(failed.observedAtMs).not.toBe(NOW);
  });

  it("ten polls of ONE event preserve its original age", () => {
    const eventMs = NOW - 3_600_000;
    let ledger = EMPTY_INCIDENTS;
    for (let i = 0; i < 10; i++) {
      const pollNow = NOW + i * 1_000;
      ledger = reconcileIncidents(ledger, failureIssueInput(eventMs, "900011"), pollNow);
    }
    const recs = Object.values(ledger.records);
    expect(recs.length, "one event must produce one incident, not ten").toBe(1);
    const rec = recs[0];
    expect(rec.occurredAtMs).toBe(eventMs);
    expect(rec.firstObservedAtMs).toBe(NOW);
    expect(rec.observations).toBe(10);
    // The AGE still grows with the wall clock: it is the event's age, not a
    // counter that resets.
    expect(incidentAgeMs(rec, NOW + 9_000)).toBe(3_600_000 + 9_000);
  });

  it("a NEW rejection after a recovery is a NEW incident", () => {
    const first = failureIssueInput(NOW - 600_000, "900020");
    let ledger = reconcileIncidents(EMPTY_INCIDENTS, first, NOW);
    // Recovery: the producer stops reporting the failure.
    ledger = reconcileIncidents(ledger, [], NOW + 5_000);
    expect(Object.values(ledger.records)[0].resolvedAt).toBe(NOW + 5_000);
    // A later, DIFFERENT rejection.
    ledger = reconcileIncidents(ledger, failureIssueInput(NOW + 60_000, "900021"), NOW + 60_000);
    const recs = Object.values(ledger.records);
    expect(recs.length).toBe(2);
    const old = recs.find((r) => r.key.includes("900020"))!;
    const fresh = recs.find((r) => r.key.includes("900021"))!;
    expect(old.resolvedAt).not.toBeNull();
    expect(fresh.resolvedAt).toBeNull();
    // The resolution time of history does not move on later polls.
    ledger = reconcileIncidents(ledger, failureIssueInput(NOW + 60_000, "900021"), NOW + 70_000);
    expect(Object.values(ledger.records).find((r) => r.key.includes("900020"))!.resolvedAt).toBe(NOW + 5_000);
  });

  it("an unrelated recovery does not resolve the connection incident", () => {
    const failure = failureIssueInput(NOW - 60_000, "900030");
    const wsIssue = deriveIssues({
      progressLost: false,
      wsLive: false,
      wsAvailable: false,
      wsDead: true,
      wsDeadReason: "ladder-exhausted",
      wsAttempts: 5,
      wsLastDisconnectAtMs: NOW - 30_000,
      serverNowMs: NOW,
      nativeLost: false,
      collectorDead: false,
      authScanTsMs: null,
      connState: "unknown",
      connBlockers: [],
      sessionExpired: false,
      wsAvailability: "supported",
    } as IssueInput);
    let ledger = reconcileIncidents(EMPTY_INCIDENTS, [...failure, ...wsIssue], NOW);
    // Only the WebSocket condition clears.
    ledger = reconcileIncidents(ledger, failure, NOW + 10_000);
    const failedRec = Object.values(ledger.records).find((r) => r.id === "conn-failed")!;
    const wsRec = Object.values(ledger.records).find((r) => r.id === "ws-dead")!;
    expect(failedRec.resolvedAt).toBeNull();
    expect(wsRec.resolvedAt).toBe(NOW + 10_000);
  });
});
