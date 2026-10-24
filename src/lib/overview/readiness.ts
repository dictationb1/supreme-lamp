// [R2 / #194 §5] The connection lifecycle as ONE honest state machine.
//
// WHY THIS FILE EXISTS. The operator's report names the exact failure class:
// "A green WebSocket indicator does not prove RDP is connected. A queued launch
// does not prove a remote application opened." Every previous surface rendered
// each producer's own flag and let the reader combine them by eye, so a green
// pill next to a dead launcher read as "connected".
//
// This module derives ONE state from the raw store/server fields and names the
// evidence it used, so the UI can never show "connected" without an actual
// correlated logon event behind it.
//
// THE STATES (and why each one is separate):
//   unknown      no launch was ever requested from this browser AND no logon
//                evidence exists. Not an error - nothing has happened yet.
//   unavailable  a launch cannot be requested: the credential, DNS or
//                RDP-listener gate is failing. `blockers` names which.
//   requested    a ticket was issued and the protocol was dispatched, inside
//                the hello-beacon watch window, with no beacon back yet.
//   launched     the launcher beacon came back (`helloWatchSeen`) - the local
//                launcher ran. This is NOT a connection.
//   connected    a real interactive logon (4624) was observed by the
//                server-side collector, the collector's scan is FRESH, the
//                logon falls inside the current run window, AND the logon
//                proves a remote desktop (LogonType 10, or an interactive
//                logon whose Terminal Services session is an rdp-tcp session).
//                Only this state may render as "connected".
//   console      an interactive 4624 (LogonType 2/11) was observed, but no
//                inbound RDP evidence exists and the session name does not
//                prove a remote desktop. [V4] A console/autologon sign-in is a
//                real desktop - it is just NOT proof of inbound RDP, which is
//                what this project is about. The old code called it
//                "connected" whenever the logon was type 2/11.
//   historical   a 4624/4625 WAS observed, but it predates this run's start and
//                no newer attempt exists. A previous session's logon is not
//                this session's connection.
//   unverified   a 4624 was reported, but the reading cannot be placed in time
//                or cannot be attributed to the intended account.
//   failed       the collector observed a 4625 that can be attributed to this
//                client (matching user, and matching source where the server
//                reports one), inside the current run, with no live session
//                that survived it.
//
// [V3-02 / D5] WHY `historical` AND `unverified` EXIST. The pre-v3 code
// returned "connected" from `authResult === "success"` and nothing else.
//
// [V4 / 2026-10-25] WHY CORRELATION AND FRESHNESS ARE NOW FIRST-CLASS.
// The screenshot this session was handed showed "Connection failed" over a
// WORKING RDP session, with a 4625 belonging to an earlier attempt presented as
// "0s ago". Four independent defects produced that:
//   1. the backend reduced the Security-log window to a bare success/failed
//      without constraining the verdict to the intended user or source, so any
//      account's rejection could decide this client's state;
//   2. the failure branch had NO freshness check while the success branch had
//      one, so a stale failure stayed "current" forever;
//   3. the issues layer stamped `observedAtMs: serverNowMs`, so every poll
//      reset the age of an old incident to zero;
//   4. an interactive type-2/11 logon was accepted as inbound RDP.
// This module now computes ONE `freshness` for both branches, carries the
// correlation verdict from the backend, and never promotes an uncorrelated
// event into THIS client's state.
//
// The function is PURE: no store access, no clock reads beyond the `nowMs`
// argument. That is what makes the states testable without a browser.

export type ConnState =
  | "unknown"
  | "unavailable"
  | "requested"
  | "launched"
  | "connected"
  | "console"
  | "historical"
  | "unverified"
  | "failed";

/** How a reading relates to the collector's own tick. ONE vocabulary, applied
 *  identically to success and failure - the asymmetry was defect #2 above. */
export type Freshness = "current" | "stale" | "undated";

/** How well the observed event can be tied to THIS client's intended account
 *  and source. Never invented: the backend reports what it could match. */
export type CorrelationState = "complete" | "partial" | "none" | "unavailable";

/** The 4625 failure reason, in words, derived from Status/SubStatus. */
export type FailureClass =
  | "wrong-password"
  | "bad-user-or-password"
  | "no-such-user"
  | "account-locked"
  | "account-disabled"
  | "account-restriction"
  | "credential-expired"
  | "time-restriction"
  | "workstation-restriction"
  | "logon-type-denied"
  | "other"
  | "unclassified"
  | "";

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

  // --- [V4] correlation inputs, all optional so older servers keep working ---
  /** The account this browser intends to connect as (config.rdpUser). */
  expectedUser?: string;
  /** TargetUserName of the observed event (the account that was touched). */
  authTargetUser?: string;
  /**
   * `true`  the event's account matches `expectedUser`
   * `false` it belongs to a DIFFERENT account - never this client's state
   * `null`/undefined the backend could not decide (no expected user, no field)
   */
  authUserMatched?: boolean | null;
  /** Normalized source address of the observed event, when the server reports
   *  one inside the tailnet (the F28 contract deliberately does not store
   *  arbitrary internet addresses). */
  authSource?: string;
  /** "match" | "mismatch" | "unknown" | "not-reported" */
  authSourceMatch?: "match" | "mismatch" | "unknown" | "not-reported";
  /** 4625 Status/SubStatus verbatim (e.g. "0XC000006A"), never a secret. */
  authStatus?: string;
  authSub?: string;
  authSubMeaning?: string;
  /** Windows event record id - stable identity for the incident. */
  authRecordId?: string;
  /** "2" | "10" | "11" | "" - which logon the verdict came from. */
  authLogonType?: string;
  /** Backend-computed: does this logon prove an inbound remote desktop? */
  authRemoteInteractive?: boolean;
  /** Terminal Services evidence (`query user`): session state + name. */
  authSessionActive?: boolean | null;
  authSessionName?: string;
  authSessionState?: string;
  /** When the listed Terminal Services session was created. */
  authSessionLogonTs?: string;
  /** Backend's own correlation verdict. */
  authCorrelation?: CorrelationState;
  /** Newest LogonType-10 4624 seen in the window: the RDP proof. */
  authRemoteEventTs?: string;
  /** How many events the backend excluded because they were not this user. */
  authExcludedUserCount?: number;
  authExcludedSourceCount?: number;
  /** The launch attempt this browser most recently issued (rid + local clock). */
  attemptRid?: string;
  attemptAtMs?: number | null;
  /** Run identity published by the server, for the header/evidence line. */
  runId?: string;
}

/** How old a collector scan may be before its reading is called unverified.
 *  The collector ticks every 30s server-side; 90s is three missed ticks. */
export const EVIDENCE_MAX_SCAN_AGE_MS = 90_000;
/** Slack allowed when comparing a logon event against the run start: the
 *  runner's clock and the browser's are not the same clock. */
export const RUN_START_TOLERANCE_MS = 60_000;
/** The launcher beacon window (src/stores/sessionStore.ts arms a 20 s watch). */
export const HELLO_WATCH_WINDOW_MS = 20_000;
/** A timestamp further than this in the FUTURE is impossible, not merely early:
 *  clock skew between the runner and the browser is bounded, so an event dated
 *  a day ahead is malformed and must not be read as "fresh". */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

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
  /** [V4] How current the evidence behind this verdict is. Computed ONE way for
   *  both the success and failure branches. */
  freshness: Freshness;
  /** [V4] How well the evidence is attributed to this client. */
  correlation: CorrelationState;
  /** [V4] The 4625 reason in words ("" when the evidence is not a rejection). */
  failureClass: FailureClass;
  /** [V4] Epoch ms of the observed event, when one can be parsed. This is the
   *  incident's occurredAt - NOT the render time. */
  eventAtMs: number | null;
  /** [V4] Evidence that was seen but deliberately does NOT decide this client's
   *  state (another account's rejection, an attempt from another source...).
   *  Rendered as a secondary line so nothing is hidden. */
  notices: string[];
}

/** Parse a timestamp defensively. Returns NaN for empty/malformed input. */
function parseTs(ts: string | null | undefined): number {
  if (!ts) return NaN;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * [V4] ONE freshness rule for every auth reading.
 *
 * `undated` - no scan stamp, an unparseable one, or a scan the browser clock
 *             cannot be reconciled with.
 * `stale`   - the last scan is older than three collector ticks.
 * `current` - everything else.
 */
export function authFreshness(scanTs: string, nowMs: number): Freshness {
  const scanMs = parseTs(scanTs);
  if (!scanTs || !Number.isFinite(scanMs)) return "undated";
  const ageMs = nowMs - scanMs;
  // A scan stamped far in the future cannot be placed in time either.
  if (ageMs < -MAX_CLOCK_SKEW_MS) return "undated";
  if (ageMs > EVIDENCE_MAX_SCAN_AGE_MS) return "stale";
  return "current";
}

/** Map a Status/SubStatus pair onto the reason in words. SubStatus is the
 *  specific one; Status alone (e.g. 0XC000006D) is the coarse fallback. */
export function classifyFailure(status?: string, sub?: string): FailureClass {
  const s = String(sub || "").trim().toUpperCase();
  const st = String(status || "").trim().toUpperCase();
  const table: Record<string, FailureClass> = {
    "0XC000006A": "wrong-password",
    "0XC000006D": "bad-user-or-password",
    "0XC0000064": "no-such-user",
    "0XC000015B": "logon-type-denied",
    "0XC0000234": "account-locked",
    "0XC0000072": "account-disabled",
    "0XC000006E": "account-restriction",
    "0XC000006F": "time-restriction",
    "0XC0000070": "workstation-restriction",
    "0XC0000071": "credential-expired",
  };
  // A PRESENT SubStatus is the specific answer: if it is not one we know, the
  // honest verdict is "other". Falling back to the coarse Status here would
  // relabel an unrecognized specific cause as "bad user or password" - the
  // exact over-claim this repair removes. Status is only consulted when the
  // event carries no SubStatus at all.
  if (s) return table[s] || "other";
  if (st) return table[st] || "other";
  return "unclassified";
}

/** Does this logon type prove an inbound remote desktop on its own? */
function logonTypeIsRemote(logonType?: string): boolean {
  return String(logonType || "").trim() === "10";
}

/** A Terminal Services session name that can only exist for an inbound RDP
 *  connection (`rdp-tcp#3`). `console` is the physical/VM console. */
function sessionNameIsRemote(name?: string): boolean {
  return /^rdp-tcp#?\d*/i.test(String(name || "").trim());
}

export function deriveConnectionState(ev: ConnEvidence): ConnVerdict {
  const blockers: string[] = [];
  if (!ev.credOk) blockers.push("credentials");
  if (!ev.runnerDnsOk) blockers.push("dns");
  if (!ev.listenerOk) blockers.push("listener");

  const notices: string[] = [];
  const correlation: CorrelationState = ev.authCorrelation ?? "unavailable";
  const freshness = authFreshness(ev.authScanTs, ev.nowMs);
  const eventMs = parseTs(ev.authEventTs);
  const remoteMs = parseTs(ev.authRemoteEventTs);
  const sessionLogonMs = parseTs(ev.authSessionLogonTs);
  const sessionRemoteActive =
    ev.authSessionActive === true && sessionNameIsRemote(ev.authSessionName);
  const failureClass = classifyFailure(ev.authStatus, ev.authSub);

  /** Evidence is attributed to a DIFFERENT account/source. */
  const foreignUser = ev.authUserMatched === false;
  const foreignSource = ev.authSourceMatch === "mismatch";

  if (foreignUser || foreignSource) {
    notices.push(
      (foreignUser
        ? "a security event for a different account (" +
          (ev.authTargetUser || "unnamed") +
          ", intended " + (ev.expectedUser || "unknown") + ")"
        : "a security event from a different source (" + (ev.authSource || "unnamed") + ")") +
        " was observed and is NOT used to decide this client's connection"
    );
  }

  const verdict = (
    state: ConnState,
    labelKey: string,
    evidence: string,
    evidenced: boolean,
    extra: Partial<ConnVerdict> = {}
  ): ConnVerdict => ({
    state,
    labelKey,
    evidence,
    blockers,
    evidenced,
    freshness,
    correlation,
    failureClass: "",
    eventAtMs: Number.isFinite(eventMs) ? eventMs : null,
    notices,
    ...extra,
  });

  // ---- 1. Success branch -------------------------------------------------
  if (ev.authResult === "success") {
    const when =
      (ev.authEventTs ? " at " + ev.authEventTs : "") +
      (ev.authScanTs ? " (scanned " + ev.authScanTs + ")" : "");

    // 1a. No scan stamp, or one we cannot parse: the reading cannot be dated.
    if (freshness === "undated") {
      return verdict(
        "unverified",
        "connState.unverified",
        "the logon collector reported an interactive 4624" + when +
          ", but it stamped no scan time this reading can be dated against",
        false
      );
    }
    // 1b. A scan older than three collector ticks is not a current reading.
    if (freshness === "stale") {
      const scanMs = parseTs(ev.authScanTs);
      return verdict(
        "unverified",
        "connState.unverified",
        "the last collector scan is " + Math.round((ev.nowMs - scanMs) / 1000) + "s old (limit " +
          EVIDENCE_MAX_SCAN_AGE_MS / 1000 + "s)" + when +
          " - the logon is not confirmed as current",
        false
      );
    }
    // 1c. A logon that predates this run belongs to the PREVIOUS session -
    //     unless this browser has issued an attempt since, which the backend
    //     would already have reflected in the newest event.
    const runStart = ev.runStartedAtMs;
    if (Number.isFinite(eventMs) && typeof runStart === "number" && runStart > 0 && eventMs < runStart - RUN_START_TOLERANCE_MS) {
      return verdict(
        "historical",
        "connState.historical",
        "an interactive 4624 was observed at " + ev.authEventTs +
          ", BEFORE this run started at " + new Date(runStart).toISOString() +
          " - it is the previous session's logon, not a current connection",
        true
      );
    }
    // 1d. [V4] The logon must belong to the account this browser intends to
    //     use. Another account's logon is not this client's connection.
    if (foreignUser) {
      return verdict(
        "unverified",
        "connState.unverified",
        "an interactive 4624 was observed for a DIFFERENT account (" +
          (ev.authTargetUser || "unnamed") + ") than the one this browser intends (" +
          (ev.expectedUser || "unknown") + ")" + when + "; it does not prove this client's connection",
        false
      );
    }
    // 1e. [V4] A 4624 with no event timestamp cannot be compared with the run.
    if (!Number.isFinite(eventMs)) {
      return verdict(
        "unverified",
        "connState.unverified",
        "the logon collector reported an interactive 4624" + when +
          ", but the event carries no timestamp this run can be compared against",
        false
      );
    }

    // 1f. [V4] Console/interactive (2/11) is NOT inbound RDP.
    const remoteProof =
      ev.authRemoteInteractive === true ||
      logonTypeIsRemote(ev.authLogonType) ||
      (Number.isFinite(remoteMs) && remoteMs >= eventMs - RUN_START_TOLERANCE_MS);
    const logonKnown = ev.authRemoteInteractive !== undefined || !!String(ev.authLogonType || "").trim();
    if (logonKnown && !remoteProof) {
      if (sessionRemoteActive) {
        return verdict(
          "connected",
          "connState.connected",
          "server logon collector observed an interactive 4624" + when +
            ", and Terminal Services lists session " + (ev.authSessionName || "?") +
            " in state " + (ev.authSessionState || "Active") + " - a live remote desktop",
          true
        );
      }
      return verdict(
        "console",
        "connState.console",
        "server logon collector observed LogonType " + (ev.authLogonType || "?") +
          " (" + (ev.authSubMeaning || "interactive") + ")" + when +
          " - a local/console sign-in is not proof of an inbound RDP connection",
        true
      );
    }
    return verdict(
      "connected",
      "connState.connected",
      "server logon collector observed an interactive 4624" + when +
        (logonKnown ? "" : " (the server did not report which LogonType it came from)"),
      true
    );
  }

  // ---- 2. Failure branch -------------------------------------------------
  if (ev.authResult === "failed") {
    const when = ev.authEventTs ? " at " + ev.authEventTs : "";
    const reason = failureClass && failureClass !== "unclassified" ? " (" + failureClass + ")" : "";

    // 2a. [V4] Somebody else's rejection cannot fail this client.
    if (foreignUser || foreignSource) {
      notices.push("the most recent 4625 does not belong to this client, so it is reported as history");
      // fall through to the request-side signals below
    } else {
      // 2b. A rejection from before this run (with no newer attempt) is history.
      const runStart = ev.runStartedAtMs;
      if (
        typeof runStart === "number" && runStart > 0 &&
        Number.isFinite(eventMs) && eventMs < runStart - RUN_START_TOLERANCE_MS
      ) {
        return verdict(
          "historical",
          "connState.historical",
          "a rejected credential (4625" + reason + ") was observed" + when +
            ", BEFORE this run started at " + new Date(runStart).toISOString(),
          true
        );
      }

      // 2c. [V4] A failed NEW attempt can coexist with an ALREADY ACTIVE
      //     session. If Terminal Services still lists an rdp-tcp session that
      //     was created BEFORE the rejection, that session survived the
      //     attempt and the connection is up; the rejection is recorded as a
      //     notice instead of overwriting a live session with "failed".
      if (
        sessionRemoteActive &&
        Number.isFinite(sessionLogonMs) &&
        (!Number.isFinite(eventMs) || sessionLogonMs <= eventMs)
      ) {
        notices.push(
          "a newer launch attempt was rejected (4625" + reason + when +
            "), but session " + (ev.authSessionName || "?") + " created at " +
            (ev.authSessionLogonTs || "?") + " is still Active - the existing remote session survived it"
        );
        return verdict(
          "connected",
          "connState.connected",
          "Terminal Services lists remote session " + (ev.authSessionName || "?") +
            " as " + (ev.authSessionState || "Active") + " (created " + (ev.authSessionLogonTs || "?") +
            "); a later attempt was rejected and did not end it",
          true
        );
      }

      const evid = "server logon collector observed a rejected credential (4625" + reason + ")" + when;
      // 2d. [V4] ONE freshness rule. A stale scan means we do not know whether
      //     the rejection still describes reality; it stays a failure (erasing
      //     a real signal would be worse) but it is labelled stale, and the
      //     issues layer downgrades it and dates it from the EVENT.
      const staleNote =
        freshness === "stale"
          ? " - the collector's reading is " + Math.round((ev.nowMs - parseTs(ev.authScanTs)) / 1000) +
            "s old, so this rejection may already be resolved"
          : freshness === "undated"
            ? " - the collector stamped no usable scan time, so this rejection is not confirmed current"
            : "";
      return verdict("failed", "connState.failed", evid + staleNote, true, {
        failureClass,
      });
    }
  }

  // ---- 3. Request-side signals, in the order they actually happen --------
  const attemptNote =
    ev.attemptRid
      ? " [attempt " + ev.attemptRid + (typeof ev.attemptAtMs === "number" && ev.attemptAtMs > 0
          ? " issued " + Math.max(0, Math.round((ev.nowMs - ev.attemptAtMs) / 1000)) + "s ago"
          : "") + "]"
      : "";
  if (ev.helloWatchSeen) {
    return verdict(
      "launched",
      "connState.launched",
      "launcher beacon received - the local launcher ran; no interactive logon observed yet" + attemptNote,
      true
    );
  }
  const armedFresh =
    ev.helloWatchArmed &&
    ev.helloWatchArmedAt > 0 &&
    ev.nowMs - ev.helloWatchArmedAt <= HELLO_WATCH_WINDOW_MS;
  if (armedFresh) {
    return verdict(
      "requested",
      "connState.requested",
      "protocol dispatched, waiting on the launcher beacon (" +
        Math.max(0, Math.round((HELLO_WATCH_WINDOW_MS - (ev.nowMs - ev.helloWatchArmedAt)) / 1000)) +
        "s window)" + attemptNote,
      false
    );
  }

  // 4. Nothing in flight. A failing gate is a fact worth naming; otherwise the
  //    honest answer is "unknown", and an unknown is not an error.
  if (blockers.length > 0) {
    return verdict(
      "unavailable",
      "connState.unavailable",
      "launch gate failing: " + blockers.join(", "),
      true
    );
  }
  return verdict(
    "unknown",
    "connState.unknown",
    ev.collectorDead
      ? "no launch requested from this browser, and the logon collector is not running - no evidence either way"
      : "no launch requested from this browser and no interactive logon observed",
    false
  );
}

/** Tone for the shared Chip/StatusDot primitives. */
export function connTone(state: ConnState): "success" | "warning" | "danger" | "neutral" {
  switch (state) {
    case "connected":
      return "success";
    // [V3-02] A logon we can see but cannot confirm as CURRENT - or one that
    // belongs to a previous run - is a warning, never a green pill.
    // [V4] A console sign-in is a warning for the same reason: it is real, it
    // is just not evidence of the thing this dashboard reports on.
    case "console":
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

/** [V4] One-line, operator-facing attribution summary. The UI renders this next
 *  to the verdict so "connected" always names WHICH evidence and WHICH account
 *  produced it, and so an incomplete correlation is visible rather than implied. */
export function correlationSummary(ev: ConnEvidence): string {
  const parts: string[] = [];
  const c = ev.authCorrelation ?? "unavailable";
  if (c === "complete") parts.push("correlated to the intended account" + (ev.expectedUser ? " (" + ev.expectedUser + ")" : ""));
  else if (c === "partial") parts.push("correlated by account only - the server reported no comparable source address");
  else if (c === "none") parts.push("NOT correlated - the observed event matches neither the intended account nor this client");
  else parts.push("correlation unavailable - the server did not report enough identity to attribute the event");
  if (ev.authRecordId) parts.push("record " + ev.authRecordId);
  if (ev.authSessionName) parts.push("session " + ev.authSessionName + " " + (ev.authSessionState || ""));
  return parts.join(" · ");
}
