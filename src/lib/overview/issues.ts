// [R2 / #199 #200 §7] Troubleshooting issues derived from LIVE store state.
//
// Every issue carries the six fields the operator's brief asks for, and — the
// part that was missing before — separates WHAT WAS OBSERVED from WHAT IS
// SUSPECTED. `cause.kind` is "confirmed" only when a producer reported the
// failure itself; anything inferred from an absence is "suspected" and says so.
//
// [V4 / 2026-10-25] THREE DEFECTS FIXED HERE.
//   1. TIMESTAMP. The connection-failure issue was built with
//      `observedAtMs: input.serverNowMs` instead of the failure EVENT's time,
//      so every poll re-stamped the incident and the UI showed a five-hour-old
//      4625 as "0s ago". Issues now carry the producer's own event time
//      (`occurredAtMs`), and an absent event time is reported as absent rather
//      than replaced with "now".
//   2. CAUSE. The failure issue said the host "rejected the stored credential"
//      with `kind: "confirmed"` regardless of Status/SubStatus and regardless of
//      whether the event could even be attributed to this client. A locked,
//      disabled, expired or logon-type-denied account is not a wrong password;
//      an uncorrelated event is not this client's failure. Both are now said in
//      words, and `confirmed` requires BOTH attribution and freshness.
//   3. WEBSOCKET. `wsAvailable === false` was read as "this build exposes no
//      /ws endpoint". No answer yet, an unauthorized probe, a worker pool that
//      cannot start and a genuinely unsupported capability are four different
//      facts; they are four different issues now.
//
// Freshness is explicit: each issue names the producer that observed it and,
// where the producer timestamps its reading, how old that reading is. An issue
// whose evidence is stale is labelled stale rather than rendered as current.

export type Severity = "critical" | "warning" | "info";
export type CauseKind = "confirmed" | "suspected";

/** [V4] Why the server does not currently serve /ws. Distinct states, because
 *  "not attempted yet" is not "this build has no such endpoint" and neither is
 *  "the worker pool could not start". */
export type WsAvailability =
  | "pending"
  | "supported"
  | "unsupported"
  | "pool-unavailable"
  | "unauthorized"
  | "unknown";

export interface Issue {
  id: string;
  /**
   * [V4] Stable identity of the underlying EVENT, not of the production line.
   * Two polls that observe the same 4625 produce the same key; a new rejection
   * produces a new one. The incident reducer uses it to deduplicate.
   */
  incidentKey: string;
  severity: Severity;
  /** Which subsystem the reader should look at. i18n key suffix. */
  areaKey: string;
  /** What the operator sees going wrong. i18n key suffix. */
  symptomKey: string;
  /** Interpolation values for the symptom string. */
  symptomVars?: Record<string, string | number>;
  /** The producer that reported it, named in the UI verbatim. */
  source: string;
  /**
   * [V4] When the OBSERVED EVENT happened (epoch ms), never when the page
   * rendered. Null means the producer supplied no usable time — which is a
   * different fact from "just now" and is rendered as such.
   */
  occurredAtMs: number | null;
  /** First time this browser saw the incident (filled by the incident reducer). */
  firstObservedAtMs: number | null;
  /** Last time this browser re-saw the same incident (filled by the reducer). */
  lastObservedAtMs: number | null;
  /** When the producer stopped reporting it. Null while it is still live. */
  resolvedAt: number | null;
  /** Kept for the renderer: the primary evidence time the freshness label uses.
   *  Always equal to `occurredAtMs` for live-derived issues. */
  observedAtMs: number | null;
  cause: { kind: CauseKind; text: string };
  /** The next safe corrective action. i18n key suffix + optional action id. */
  nextActionKey: string;
  actionId?: "ws-reconnect" | "diagnose" | "keys" | "health" | "preflight-retry";
}

/** How old a reading may be before the UI calls it stale instead of current. */
export const STALE_AFTER_MS = 60_000;

export interface IssueInput {
  /** Browser -> server reachability. */
  progressLost: boolean;
  /** WebSocket bridge. */
  wsLive: boolean;
  wsAvailable: boolean;
  wsDead: boolean;
  wsDeadReason: string;
  wsAttempts: number;
  wsLastDisconnectAtMs: number | null;
  /** Runner readiness / server clock. */
  serverNowMs: number;
  nativeLost: boolean;
  /** [V4] epoch-ms of the last SUCCESSFUL /api/native-status answer. Lets the
   *  panel say how old the "last known" connection reading is when the probe is
   *  currently failing, instead of presenting it as live. */
  nativeLastOkAtMs?: number | null;
  collectorDead: boolean;
  authScanTsMs: number | null;
  /** RDP launch request + real connection evidence. */
  connState: string;
  connBlockers: string[];

  // --- [V4] optional correlation evidence, passed straight through from the
  // verdict so the issue layer can date and attribute the incident ----------
  /** When the observed 4625/4624 EVENT happened (epoch ms). */
  authEventTsMs?: number | null;
  authStatus?: string;
  authSub?: string;
  authSubMeaning?: string;
  authRecordId?: string;
  authTargetUser?: string;
  expectedUser?: string;
  authUserMatched?: boolean | null;
  authSourceMatch?: "match" | "mismatch" | "unknown" | "not-reported";
  /** How current the collector's reading is (from deriveConnectionState). */
  connFreshness?: "current" | "stale" | "undated";
  /** How well the event is attributed to this client. */
  connCorrelation?: "complete" | "partial" | "none" | "unavailable";
  /** The classified 4625 reason (see readiness.classifyFailure). */
  connFailureClass?: string;
  /** [V4] Explicit WebSocket availability, superseding the wsAvailable boolean. */
  wsAvailability?: WsAvailability;
  /** Session window. */
  sessionExpired: boolean;
}

/** [V4] Human wording for a 4625 Status/SubStatus. Never "wrong password" for a
 *  locked, disabled, expired or policy-denied account. */
export const FAILURE_CLASS_TEXT: Record<string, string> = {
  "wrong-password": "the host rejected the password presented for this account",
  "bad-user-or-password": "the host rejected the username or password presented for this account",
  "no-such-user": "the host reports no such account name - this is not a password problem",
  "account-locked": "the account is locked out (0xC0000234) - the stored password may well be correct",
  "account-disabled": "the account is disabled on the host (0xC0000072)",
  "account-restriction": "an account restriction (logon hours, workstation or policy) blocked the logon",
  "credential-expired": "the account's credential has expired on the host (0xC0000071)",
  "time-restriction": "logon-hours policy blocked the logon (0xC000006F)",
  "workstation-restriction": "a workstation restriction blocked the logon (0xC0000070)",
  "logon-type-denied": "the host denies this logon type by policy (0xC000015B) - the password is not the cause",
  other: "the host rejected the logon for a reason the collector could not classify",
  unclassified: "the host rejected the logon and reported no Status/SubStatus the collector could classify",
  "": "the host rejected the logon and reported no Status/SubStatus the collector could classify",
};

/** Build the connection-failure issue with the EVENT's own identity and time. */
function connFailedIssue(input: IssueInput): Issue {
  const occurredAtMs =
    typeof input.authEventTsMs === "number" && Number.isFinite(input.authEventTsMs)
      ? input.authEventTsMs
      : null;
  const failureClass = String(input.connFailureClass || "").trim();
  const reasonText = FAILURE_CLASS_TEXT[failureClass] || FAILURE_CLASS_TEXT[""];
  const sub = String(input.authSub || "").trim().toUpperCase();
  const fresh = input.connFreshness === "current";
  // Attribution: an event whose account is a different account is not this
  // client's failure, and `undefined` means the server did not say.
  const attributed = input.authUserMatched === true;
  const foreign = input.authUserMatched === false || input.authSourceMatch === "mismatch";
  // `confirmed` needs BOTH attribution and a current reading. Anything else is
  // what we can honestly call suspected.
  const kind: CauseKind = attributed && fresh && !foreign ? "confirmed" : "suspected";

  const who = input.authTargetUser || input.expectedUser || "";
  const bits: string[] = [reasonText];
  if (sub) bits.push("(4625 SubStatus " + sub + ")");
  if (who) bits.push("for account " + who);
  if (kind === "suspected") {
    if (foreign) bits.push("- the event does NOT match this client's intended account/source, so it is not proof of this client's failure");
    else if (!attributed) bits.push("- the collector could not attribute the event to this client, so this is a suspicion, not a finding");
    else if (input.connFreshness === "stale") bits.push("- the collector's reading is stale, so this may already be resolved");
    else if (input.connFreshness === "undated") bits.push("- the collector stamped no usable scan time, so this is not confirmed current");
  }

  return {
    id: "conn-failed",
    incidentKey:
      "conn-failed:" +
      (input.authRecordId ? "rec-" + input.authRecordId : occurredAtMs != null ? "ts-" + occurredAtMs : "unattributed"),
    // A rejection that cannot be dated or attributed is a warning, not a
    // headline-critical finding: the screenshot's "critical issue: the host
    // rejected the stored credential" over a WORKING session is exactly what
    // this downgrade prevents.
    severity: kind === "confirmed" ? "critical" : "warning",
    areaKey: "issues.area.connection",
    symptomKey: "issues.symptom.connFailed",
    symptomVars: {
      reason: reasonText,
      ...(sub ? { sub } : {}),
      ...(who ? { user: who } : {}),
    },
    source: "server logon collector (4625)" + (input.authRecordId ? " · record " + input.authRecordId : ""),
    occurredAtMs,
    firstObservedAtMs: occurredAtMs,
    lastObservedAtMs: input.serverNowMs,
    resolvedAt: null,
    observedAtMs: occurredAtMs,
    cause: { kind, text: bits.join(" ") },
    nextActionKey: kind === "confirmed" ? "issues.action.connFailed" : "issues.action.connFailedUnsure",
    actionId: "diagnose",
  };
}

export function deriveIssues(input: IssueInput): Issue[] {
  const out: Issue[] = [];

  // 1. Browser -> server reachability. Confirmed: the poll itself failed. The
  //    observation time is the caller's server clock because the poll failure
  //    IS the observation - there is no earlier event to date it by.
  if (input.progressLost) {
    out.push({
      id: "reachability",
      incidentKey: "reachability",
      severity: "critical",
      areaKey: "issues.area.reachability",
      symptomKey: "issues.symptom.reachability",
      source: "telemetry poll (/api/progress)",
      occurredAtMs: input.serverNowMs,
      firstObservedAtMs: input.serverNowMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: input.serverNowMs,
      cause: { kind: "confirmed", text: "the browser's own poll stopped returning data" },
      nextActionKey: "issues.action.reachability",
      actionId: "diagnose",
    });
  }

  // 2. WebSocket bridge. [V4] SIX states, not two booleans.
  // A caller that has not yet been taught the explicit availability can only
  // honestly report "not known yet". "wsAvailable === false" used to mean
  // "this build has no /ws" - the false claim this repair removes.
  const wsAvail: WsAvailability =
    input.wsAvailability ?? (input.wsAvailable ? "supported" : input.wsDead ? "unknown" : "pending");
  if (input.wsDead) {
    out.push({
      id: "ws-dead",
      incidentKey: "ws-dead",
      severity: "critical",
      areaKey: "issues.area.websocket",
      symptomKey: "issues.symptom.wsDead",
      symptomVars: { attempts: input.wsAttempts, reason: input.wsDeadReason || "ladder-exhausted" },
      source: "WebSocket client reconnect ladder",
      occurredAtMs: input.wsLastDisconnectAtMs,
      firstObservedAtMs: input.wsLastDisconnectAtMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: input.wsLastDisconnectAtMs,
      cause: { kind: "confirmed", text: "the 1s/3s/10s/30s reconnect ladder was exhausted" },
      nextActionKey: "issues.action.wsReconnect",
      actionId: "ws-reconnect",
    });
  } else if (input.wsLive) {
    // A live socket is not an issue. Nothing to report.
  } else if (wsAvail === "pool-unavailable") {
    out.push({
      id: "ws-pool-unavailable",
      incidentKey: "ws-pool-unavailable",
      severity: "warning",
      areaKey: "issues.area.websocket",
      symptomKey: "issues.symptom.wsPoolUnavailable",
      source: "/health wsReason",
      occurredAtMs: null,
      firstObservedAtMs: input.serverNowMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: null,
      cause: { kind: "confirmed", text: "the server answered /health with ws=false and the reason \"websocket worker pool unavailable\": the endpoint EXISTS but cannot be served right now" },
      nextActionKey: "issues.action.wsPoolUnavailable",
      actionId: "ws-reconnect",
    });
  } else if (wsAvail === "unauthorized") {
    out.push({
      id: "ws-unauthorized",
      incidentKey: "ws-unauthorized",
      severity: "warning",
      areaKey: "issues.area.websocket",
      symptomKey: "issues.symptom.wsUnauthorized",
      source: "/health probe",
      occurredAtMs: null,
      firstObservedAtMs: input.serverNowMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: null,
      cause: { kind: "suspected", text: "the /health probe was refused (401/403), so whether this build serves /ws is unknown" },
      nextActionKey: "issues.action.wsUnauthorized",
      actionId: "diagnose",
    });
  } else if (wsAvail === "pending" || wsAvail === "unknown") {
    out.push({
      id: "ws-unknown",
      incidentKey: "ws-unknown",
      severity: "info",
      areaKey: "issues.area.websocket",
      symptomKey: "issues.symptom.wsUnknown",
      source: "/health probe",
      occurredAtMs: null,
      firstObservedAtMs: input.serverNowMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: null,
      cause: { kind: "suspected", text: "no /health answer has been read yet, so the WebSocket capability is not yet known" },
      nextActionKey: "issues.action.wsUnknown",
    });
  } else if (wsAvail === "unsupported") {
    out.push({
      id: "ws-absent",
      incidentKey: "ws-absent",
      severity: "info",
      areaKey: "issues.area.websocket",
      symptomKey: "issues.symptom.wsAbsent",
      source: "/health ws flag",
      occurredAtMs: null,
      firstObservedAtMs: input.serverNowMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: null,
      cause: { kind: "confirmed", text: "the server answered /health with ws=false and no degraded reason: this build exposes no /ws endpoint, so progress arrives by HTTP polling" },
      nextActionKey: "issues.action.wsAbsent",
    });
  } else if (wsAvail === "supported") {
    out.push({
      id: "ws-idle",
      incidentKey: "ws-idle",
      severity: "info",
      areaKey: "issues.area.websocket",
      symptomKey: "issues.symptom.wsIdle",
      source: "WebSocket client",
      occurredAtMs: null,
      firstObservedAtMs: input.serverNowMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: null,
      cause: { kind: "suspected", text: "the server advertises /ws but no socket is open; still on the reconnect ladder" },
      nextActionKey: "issues.action.wsIdle",
    });
  }

  // 2b. [V4] The native-status probe is FAILING. The panel keeps showing the
  //     last known reading (a failed poll must not be turned into zeros), so it
  //     must also say that the reading is old. Without this the connection
  //     evidence silently stopped being live while looking live - the same
  //     class of dishonesty as the original screenshot.
  if (input.nativeLost) {
    const lastOk = input.nativeLastOkAtMs ?? null;
    out.push({
      id: "native-lost",
      incidentKey: "native-lost",
      severity: "warning",
      areaKey: "issues.area.runner",
      symptomKey: "issues.symptom.nativeLost",
      symptomVars: {
        ageSec: lastOk != null ? Math.round((input.serverNowMs - lastOk) / 1000) : -1,
      },
      source: "native-status poll (/api/native-status)",
      occurredAtMs: lastOk,
      firstObservedAtMs: input.serverNowMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: lastOk,
      cause: {
        kind: "confirmed",
        text: "the last /api/native-status poll did not return a usable body; the connection panel is showing the previous reading, not a new one",
      },
      nextActionKey: "issues.action.nativeLost",
      actionId: "diagnose",
    });
  }

  // 3. Runner readiness / scanner freshness. "No logon observed" is only an
  //    issue when the collector is actually running - otherwise it is a
  //    missing-evidence problem, reported as such.
  if (input.collectorDead) {
    out.push({
      id: "collector-dead",
      incidentKey: "collector-dead",
      severity: "warning",
      areaKey: "issues.area.runner",
      symptomKey: "issues.symptom.collectorDead",
      source: "/api/native-status logonCollector",
      occurredAtMs: null,
      firstObservedAtMs: input.serverNowMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: null,
      cause: { kind: "confirmed", text: "the server-side logon collector never stamped a scan" },
      nextActionKey: "issues.action.collectorDead",
      actionId: "health",
    });
  } else if (input.authScanTsMs != null && input.serverNowMs - input.authScanTsMs > STALE_AFTER_MS) {
    out.push({
      id: "scan-stale",
      incidentKey: "scan-stale",
      severity: "warning",
      areaKey: "issues.area.runner",
      symptomKey: "issues.symptom.scanStale",
      symptomVars: { ageSec: Math.round((input.serverNowMs - input.authScanTsMs) / 1000) },
      source: "/api/native-status logonCollector.scanTs",
      // The reading's own time, and it does not move when the scan does not
      // move - that is the whole difference from the old serverNowMs stamp.
      occurredAtMs: input.authScanTsMs,
      firstObservedAtMs: input.authScanTsMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: input.authScanTsMs,
      cause: { kind: "confirmed", text: "the last scan is older than the 30s server-side tick allows" },
      nextActionKey: "issues.action.scanStale",
      actionId: "health",
    });
  }

  // 4. RDP launch gate.
  if (input.connState === "unavailable" && input.connBlockers.length > 0) {
    out.push({
      id: "launch-gate",
      incidentKey: "launch-gate:" + input.connBlockers.join("+"),
      severity: "warning",
      areaKey: "issues.area.rdpLaunch",
      symptomKey: "issues.symptom.launchGate",
      symptomVars: { blockers: input.connBlockers.join(", ") },
      source: "auto-login gate (credentials / runner DNS / RDP listener)",
      occurredAtMs: input.serverNowMs,
      firstObservedAtMs: input.serverNowMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: input.serverNowMs,
      cause: { kind: "confirmed", text: "one or more launch gates are failing" },
      nextActionKey: "issues.action.launchGate",
      actionId: "preflight-retry",
    });
  }
  if (input.connState === "failed") {
    out.push(connFailedIssue(input));
  }
  // [V4] A rejection that belongs to another account/source is HISTORY. It is
  // still reported - nothing is hidden - but as an info line that cannot move
  // this client's connection state, and it disappears when the collector stops
  // reporting it.
  if (
    input.authUserMatched === false ||
    input.authSourceMatch === "mismatch"
  ) {
    const when = input.authEventTsMs != null ? " at " + new Date(input.authEventTsMs).toISOString() : "";
    out.push({
      id: "conn-foreign-failure",
      incidentKey:
        "conn-foreign-failure:" +
        (input.authRecordId ? "rec-" + input.authRecordId : input.authEventTsMs != null ? "ts-" + input.authEventTsMs : "unattributed"),
      severity: "info",
      areaKey: "issues.area.connection",
      symptomKey: "issues.symptom.connForeignFailure",
      symptomVars: {
        user: input.authTargetUser || "an unnamed account",
        expected: input.expectedUser || "this client",
      },
      source: "server logon collector (4625)" + (input.authRecordId ? " · record " + input.authRecordId : ""),
      occurredAtMs: input.authEventTsMs ?? null,
      firstObservedAtMs: input.authEventTsMs ?? null,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: input.authEventTsMs ?? null,
      cause: { kind: "confirmed", text: "the collector saw a rejection" + when + " that does not match this client's intended account or source, so it cannot decide this connection" },
      nextActionKey: "issues.action.connForeignFailure",
    });
  }

  // 5. Session window.
  if (input.sessionExpired) {
    out.push({
      id: "session-expired",
      incidentKey: "session-expired",
      severity: "warning",
      areaKey: "issues.area.session",
      symptomKey: "issues.symptom.sessionExpired",
      source: "session window (server sessionEnd or the labelled policy window)",
      occurredAtMs: input.serverNowMs,
      firstObservedAtMs: input.serverNowMs,
      lastObservedAtMs: input.serverNowMs,
      resolvedAt: null,
      observedAtMs: input.serverNowMs,
      cause: { kind: "confirmed", text: "the published session deadline has passed" },
      nextActionKey: "issues.action.sessionExpired",
      actionId: "health",
    });
  }

  return out;
}

/**
 * [V3-05 / #202] Deterministic severity ordering.
 *
 * The list used to render `deriveIssues(...).slice(0, 3)` - the first three in
 * PRODUCER order. Because `deriveIssues` pushes in the order it checks
 * subsystems (reachability, websocket, runner, launch, session), a critical
 * reachability failure could be pushed last and then cut away by a `.slice`,
 * leaving the operator looking at three infos. Sorting is the fix, and it is
 * STABLE: within a severity the producer's own order survives, so the list
 * does not shuffle between renders.
 */
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export function orderIssues(issues: Issue[]): Issue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity] || a.index - b.index)
    .map((entry) => entry.issue);
}

/** The action ids the renderer must be able to honour. Kept next to the Issue
 *  type so adding a producer action is a TYPE ERROR until the UI handles it -
 *  the gap #202 named (producers emitting actions the renderer ignores). */
export type IssueActionId = NonNullable<Issue["actionId"]>;

export function worstSeverity(issues: Issue[]): Severity | "none" {
  if (issues.some((i) => i.severity === "critical")) return "critical";
  if (issues.some((i) => i.severity === "warning")) return "warning";
  if (issues.length > 0) return "info";
  return "none";
}

/** A reading older than this is labelled stale rather than shown as current. */
export function isStale(observedAtMs: number | null, nowMs: number): boolean {
  return observedAtMs != null && nowMs - observedAtMs > STALE_AFTER_MS;
}
