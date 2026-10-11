// [R2 / #199 #200 §7] Troubleshooting issues derived from LIVE store state.
//
// Every issue carries the six fields the operator's brief asks for, and — the
// part that was missing before — separates WHAT WAS OBSERVED from WHAT IS
// SUSPECTED. `cause.kind` is "confirmed" only when a producer reported the
// failure itself; anything inferred from an absence is "suspected" and says so.
//
// Freshness is explicit: each issue names the producer that observed it and,
// where the producer timestamps its reading, how old that reading is. An issue
// whose evidence is stale is labelled stale rather than rendered as current.

export type Severity = "critical" | "warning" | "info";
export type CauseKind = "confirmed" | "suspected";

export interface Issue {
  id: string;
  severity: Severity;
  /** Which subsystem the reader should look at. i18n key suffix. */
  areaKey: string;
  /** What the operator sees going wrong. i18n key suffix. */
  symptomKey: string;
  /** Interpolation values for the symptom string. */
  symptomVars?: Record<string, string | number>;
  /** The producer that reported it, named in the UI verbatim. */
  source: string;
  /** Evidence timestamp (epoch ms) when the producer supplied one. */
  observedAtMs: number | null;
  cause: { kind: CauseKind; text: string };
  /** The next safe corrective action. i18n key suffix + optional action id. */
  nextActionKey: string;
  actionId?: "ws-reconnect" | "diagnose" | "keys" | "health";
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
  collectorDead: boolean;
  authScanTsMs: number | null;
  /** RDP launch request + real connection evidence. */
  connState: string;
  connBlockers: string[];
  /** Session window. */
  sessionExpired: boolean;
}

export function deriveIssues(input: IssueInput): Issue[] {
  const out: Issue[] = [];

  // 1. Browser -> server reachability. Confirmed: the poll itself failed.
  if (input.progressLost) {
    out.push({
      id: "reachability",
      severity: "critical",
      areaKey: "issues.area.reachability",
      symptomKey: "issues.symptom.reachability",
      source: "telemetry poll (/api/progress)",
      observedAtMs: input.serverNowMs,
      cause: { kind: "confirmed", text: "the browser's own poll stopped returning data" },
      nextActionKey: "issues.action.reachability",
      actionId: "diagnose",
    });
  }

  // 2. WebSocket bridge. A missing endpoint is NOT a failure - the PowerShell
  //    server legitimately answers ws=false - so it is info, and the ladder
  //    having been exhausted is the only critical case.
  if (input.wsDead) {
    out.push({
      id: "ws-dead",
      severity: "critical",
      areaKey: "issues.area.websocket",
      symptomKey: "issues.symptom.wsDead",
      symptomVars: { attempts: input.wsAttempts, reason: input.wsDeadReason || "ladder-exhausted" },
      source: "WebSocket client reconnect ladder",
      observedAtMs: input.wsLastDisconnectAtMs,
      cause: { kind: "confirmed", text: "the 1s/3s/10s/30s reconnect ladder was exhausted" },
      nextActionKey: "issues.action.wsReconnect",
      actionId: "ws-reconnect",
    });
  } else if (!input.wsLive && input.wsAvailable) {
    out.push({
      id: "ws-idle",
      severity: "info",
      areaKey: "issues.area.websocket",
      symptomKey: "issues.symptom.wsIdle",
      source: "WebSocket client",
      observedAtMs: null,
      cause: { kind: "suspected", text: "the server advertises /ws but no socket is open; still on the reconnect ladder" },
      nextActionKey: "issues.action.wsIdle",
    });
  } else if (!input.wsLive && !input.wsAvailable) {
    out.push({
      id: "ws-absent",
      severity: "info",
      areaKey: "issues.area.websocket",
      symptomKey: "issues.symptom.wsAbsent",
      source: "/health ws flag",
      observedAtMs: null,
      cause: { kind: "confirmed", text: "this build exposes no /ws endpoint; progress arrives by HTTP polling" },
      nextActionKey: "issues.action.wsAbsent",
    });
  }

  // 3. Runner readiness / scanner freshness. "No logon observed" is only an
  //    issue when the collector is actually running - otherwise it is a
  //    missing-evidence problem, reported as such.
  if (input.collectorDead) {
    out.push({
      id: "collector-dead",
      severity: "warning",
      areaKey: "issues.area.runner",
      symptomKey: "issues.symptom.collectorDead",
      source: "/api/native-status logonCollector",
      observedAtMs: null,
      cause: { kind: "confirmed", text: "the server-side logon collector never stamped a scan" },
      nextActionKey: "issues.action.collectorDead",
      actionId: "health",
    });
  } else if (input.authScanTsMs != null && input.serverNowMs - input.authScanTsMs > STALE_AFTER_MS) {
    out.push({
      id: "scan-stale",
      severity: "warning",
      areaKey: "issues.area.runner",
      symptomKey: "issues.symptom.scanStale",
      symptomVars: { ageSec: Math.round((input.serverNowMs - input.authScanTsMs) / 1000) },
      source: "/api/native-status logonCollector.scanTs",
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
      severity: "warning",
      areaKey: "issues.area.rdpLaunch",
      symptomKey: "issues.symptom.launchGate",
      symptomVars: { blockers: input.connBlockers.join(", ") },
      source: "auto-login gate (credentials / runner DNS / RDP listener)",
      observedAtMs: input.serverNowMs,
      cause: { kind: "confirmed", text: "one or more launch gates are failing" },
      nextActionKey: "issues.action.launchGate",
      actionId: "keys",
    });
  }
  if (input.connState === "failed") {
    out.push({
      id: "conn-failed",
      severity: "critical",
      areaKey: "issues.area.connection",
      symptomKey: "issues.symptom.connFailed",
      source: "server logon collector (4625)",
      observedAtMs: input.serverNowMs,
      cause: { kind: "confirmed", text: "the host rejected the stored credential" },
      nextActionKey: "issues.action.connFailed",
      actionId: "diagnose",
    });
  }

  // 5. Session window.
  if (input.sessionExpired) {
    out.push({
      id: "session-expired",
      severity: "warning",
      areaKey: "issues.area.session",
      symptomKey: "issues.symptom.sessionExpired",
      source: "session window (server sessionEnd or the labelled policy window)",
      observedAtMs: input.serverNowMs,
      cause: { kind: "confirmed", text: "the published session deadline has passed" },
      nextActionKey: "issues.action.sessionExpired",
      actionId: "health",
    });
  }

  return out;
}

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
