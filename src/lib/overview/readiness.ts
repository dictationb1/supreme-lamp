// [R2 / #194 §5] The connection lifecycle as ONE honest state machine.
//
// WHY THIS FILE EXISTS. The operator's report names the exact failure class:
// "A green WebSocket indicator does not prove RDP is connected. A queued launch
// does not prove a remote application opened." Every previous surface rendered
// each producer's own flag and let the reader combine them by eye, so a green
// pill next to a dead launcher read as "connected".
//
// This module derives ONE of five states from the raw store/server fields and
// names the evidence it used, so the UI can never show "connected" without an
// actual logon event behind it:
//
//   unknown      no launch was ever requested from this browser AND no logon
//                evidence exists. Not an error - nothing has happened yet.
//   unavailable  a launch cannot be requested: the credential, DNS or
//                RDP-listener gate is failing. `blockers` names which.
//   requested    a ticket was issued and the protocol was dispatched, inside
//                the hello-beacon watch window, with no beacon back yet.
//   launched     the launcher beacon came back (`helloWatchSeen`) - the local
//                launcher ran. This is NOT a connection.
//   connected    a real interactive logon (4624, LogonType 2/10/11) was
//                observed by the server-side collector, the collector's scan
//                is FRESH, and the logon falls inside the current run window.
//                Only this state may render as "connected".
//   historical   a 4624 WAS observed, but it predates this run's start. A
//                previous session's logon is not this session's connection.
//   unverified   a 4624 was reported, but the reading cannot be placed in
//                time: no scan timestamp, an unparseable one, or a scan older
//                than the collector's own tick allows.
//   failed       the collector observed a 4625 (rejected credential).
//
// [V3-02 / D5] WHY `historical` AND `unverified` EXIST. The pre-v3 code
// returned "connected" from `authResult === "success"` and nothing else. A
// 4624 from a session three hours ago - or from a runner that has since been
// re-provisioned - therefore rendered as a live connection, which is the exact
// class of report #194 was filed about. Evidence is now time-bounded, and an
// unbounded reading is labelled as one instead of being promoted.
//
// The function is PURE: no store access, no clock reads beyond the `nowMs`
// argument. That is what makes the five states testable without a browser and
// without a fixture that happens to land in a fallback branch.

export type ConnState =
  | "unknown"
  | "unavailable"
  | "requested"
  | "launched"
  | "connected"
  | "historical"
  | "unverified"
  | "failed";

export interface ConnEvidence {
  /** Credential + listener gates, as the auto-login button already computes them. */
  credOk: boolean;
  runnerDnsOk: boolean;
  listenerOk: boolean;
  /** Set when fireAutoLogin dispatched the protocol. */
  helloWatchArmed: boolean;
  helloWatchSeen: boolean;
  helloWatchArmedAt: number;
  /** The last 4624/4625 the server-side logon collector reported, if any. */
  authResult: "success" | "failed" | "none" | "" | null;
  authEventTs: string;
  authScanTs: string;
  /** True when the collector is not running - "no evidence" is not "no logon". */
  collectorDead: boolean;
  /**
   * When the runner run being displayed started (epoch ms), when the server
   * published one. Used to place a logon INSIDE the current run instead of
   * promoting a previous session's logon.
   */
  runStartedAtMs?: number | null;
  nowMs: number;
}

/** How old a collector scan may be before its reading is called unverified.
 *  The collector ticks every 30s server-side; 90s is three missed ticks. */
export const EVIDENCE_MAX_SCAN_AGE_MS = 90_000;
/** Slack allowed when comparing a logon event against the run start: the
 *  runner's clock and the browser's are not the same clock. */
export const RUN_START_TOLERANCE_MS = 60_000;

/** The launcher beacon window (src/stores/sessionStore.ts arms a 20 s watch). */
export const HELLO_WATCH_WINDOW_MS = 20_000;

export interface ConnVerdict {
  state: ConnState;
  /** Human-readable i18n key suffix, e.g. "connState.launched". */
  labelKey: string;
  /** Which producer this verdict came from - surfaced verbatim in the UI. */
  evidence: string;
  /** Named gates, only populated for "unavailable". */
  blockers: string[];
  /** True when the state rests on evidence, not on the absence of it. */
  evidenced: boolean;
}

export function deriveConnectionState(ev: ConnEvidence): ConnVerdict {
  const blockers: string[] = [];
  if (!ev.credOk) blockers.push("credentials");
  if (!ev.runnerDnsOk) blockers.push("dns");
  if (!ev.listenerOk) blockers.push("listener");

  // 1. Actual logon evidence beats every request-side signal - but only a
  //    reading that can be PLACED IN TIME may be called "connected".
  //    [V3-02 / D5] The pre-v3 code stopped at `authResult === "success"`.
  if (ev.authResult === "success") {
    const scanMs = ev.authScanTs ? Date.parse(ev.authScanTs) : NaN;
    const eventMs = ev.authEventTs ? Date.parse(ev.authEventTs) : NaN;
    const when =
      (ev.authEventTs ? " at " + ev.authEventTs : "") +
      (ev.authScanTs ? " (scanned " + ev.authScanTs + ")" : "");

    // 1a. No scan stamp, or one we cannot parse: the reading cannot be dated.
    if (!ev.authScanTs || !Number.isFinite(scanMs)) {
      return {
        state: "unverified",
        labelKey: "connState.unverified",
        evidence:
          "the logon collector reported an interactive 4624" + when +
          ", but it stamped no scan time this reading can be dated against",
        blockers: [],
        evidenced: false,
      };
    }
    // 1b. A scan older than three collector ticks is not a current reading.
    const ageMs = ev.nowMs - scanMs;
    if (ageMs > EVIDENCE_MAX_SCAN_AGE_MS) {
      return {
        state: "unverified",
        labelKey: "connState.unverified",
        evidence:
          "the last collector scan is " + Math.round(ageMs / 1000) + "s old (limit " +
          EVIDENCE_MAX_SCAN_AGE_MS / 1000 + "s)" + when +
          " - the logon is not confirmed as current",
        blockers: [],
        evidenced: false,
      };
    }
    // 1c. A logon that predates this run belongs to the PREVIOUS session.
    if (!ev.authEventTs || !Number.isFinite(eventMs)) {
      return {
        state: "unverified",
        labelKey: "connState.unverified",
        evidence:
          "the logon collector reported an interactive 4624" + when +
          ", but the event carries no timestamp this run can be compared against",
        blockers: [],
        evidenced: false,
      };
    }
    if (
      typeof ev.runStartedAtMs === "number" &&
      Number.isFinite(ev.runStartedAtMs) &&
      ev.runStartedAtMs > 0 &&
      eventMs < ev.runStartedAtMs - RUN_START_TOLERANCE_MS
    ) {
      return {
        state: "historical",
        labelKey: "connState.historical",
        evidence:
          "an interactive 4624 was observed at " + ev.authEventTs +
          ", BEFORE this run started at " + new Date(ev.runStartedAtMs).toISOString() +
          " - it is the previous session's logon, not a current connection",
        blockers: [],
        evidenced: true,
      };
    }
    return {
      state: "connected",
      labelKey: "connState.connected",
      evidence: "server logon collector observed an interactive 4624" + when,
      blockers: [],
      evidenced: true,
    };
  }
  if (ev.authResult === "failed") {
    // A 4625 is a real, observed rejection, so it is NOT downgraded by a stale
    // scan - erasing a genuine failure signal would be worse than a late one.
    // It IS still placed in time: a rejection from before this run is history.
    const eventMs = ev.authEventTs ? Date.parse(ev.authEventTs) : NaN;
    if (
      typeof ev.runStartedAtMs === "number" &&
      Number.isFinite(ev.runStartedAtMs) &&
      ev.runStartedAtMs > 0 &&
      Number.isFinite(eventMs) &&
      eventMs < ev.runStartedAtMs - RUN_START_TOLERANCE_MS
    ) {
      return {
        state: "historical",
        labelKey: "connState.historical",
        evidence:
          "a rejected credential (4625) was observed at " + ev.authEventTs +
          ", BEFORE this run started at " + new Date(ev.runStartedAtMs).toISOString(),
        blockers,
        evidenced: true,
      };
    }
    return {
      state: "failed",
      labelKey: "connState.failed",
      evidence: "server logon collector observed a rejected credential (4625)" +
        (ev.authEventTs ? " at " + ev.authEventTs : ""),
      blockers,
      evidenced: true,
    };
  }

  // 2. Request-side signals, in the order they actually happen.
  if (ev.helloWatchSeen) {
    return {
      state: "launched",
      labelKey: "connState.launched",
      // Deliberately NOT "connected": the beacon proves the launcher ran.
      evidence: "launcher beacon received - the local launcher ran; no interactive logon observed yet",
      blockers,
      evidenced: true,
    };
  }
  const armedFresh =
    ev.helloWatchArmed &&
    ev.helloWatchArmedAt > 0 &&
    ev.nowMs - ev.helloWatchArmedAt <= HELLO_WATCH_WINDOW_MS;
  if (armedFresh) {
    return {
      state: "requested",
      labelKey: "connState.requested",
      evidence: "protocol dispatched, waiting on the launcher beacon (" +
        Math.max(0, Math.round((HELLO_WATCH_WINDOW_MS - (ev.nowMs - ev.helloWatchArmedAt)) / 1000)) +
        "s window)",
      blockers,
      evidenced: false,
    };
  }

  // 3. Nothing in flight. A failing gate is a fact worth naming; otherwise the
  //    honest answer is "unknown", and an unknown is not an error.
  if (blockers.length > 0) {
    return {
      state: "unavailable",
      labelKey: "connState.unavailable",
      evidence: "launch gate failing: " + blockers.join(", "),
      blockers,
      evidenced: true,
    };
  }
  return {
    state: "unknown",
    labelKey: "connState.unknown",
    evidence: ev.collectorDead
      ? "no launch requested from this browser, and the logon collector is not running - no evidence either way"
      : "no launch requested from this browser and no interactive logon observed",
    blockers: [],
    evidenced: false,
  };
}

/** Tone for the shared Chip/StatusDot primitives. */
export function connTone(state: ConnState): "success" | "warning" | "danger" | "neutral" {
  switch (state) {
    case "connected":
      return "success";
    // [V3-02] A logon we can see but cannot confirm as CURRENT - or one that
    // belongs to a previous run - is a warning, never a green pill.
    case "historical":
    case "unverified":
    case "launched":
    case "requested":
      return "warning";
    case "failed":
    case "unavailable":
      return "danger";
    default:
      return "neutral";
  }
}
