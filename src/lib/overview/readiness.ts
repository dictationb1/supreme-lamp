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
//                observed by the server-side collector. Only this state may
//                render as "connected".
//   failed       the collector observed a 4625 (rejected credential).
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
  nowMs: number;
}

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

  // 1. Actual logon evidence beats every request-side signal. A 4624 observed
  //    by the collector is the only thing that may be called "connected".
  if (ev.authResult === "success") {
    return {
      state: "connected",
      labelKey: "connState.connected",
      evidence: "server logon collector observed an interactive 4624" +
        (ev.authEventTs ? " at " + ev.authEventTs : "") +
        (ev.authScanTs ? " (scanned " + ev.authScanTs + ")" : ""),
      blockers: [],
      evidenced: true,
    };
  }
  if (ev.authResult === "failed") {
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
