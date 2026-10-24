// [R2 / #194 §5] The store -> verdict bridge for src/lib/overview/readiness.ts.
//
// Split out so the derivation itself stays pure and unit-testable: this hook is
// only a field mapping. `logonRowText` is the SAME function the bottom bar and
// LogPanel use, so the Overview can never report a connection state that the
// status bar contradicts.
//
// [V4 / 2026-10-25] THE MAPPING NOW CARRIES IDENTITY. The old version passed
// only `authResult` + two timestamps, which is why the verdict could not tell
// this client's 4625 from anyone else's, could not tell a console sign-in from
// an inbound RDP session, and had no way to date the incident. Every field the
// server publishes for correlation is forwarded verbatim - and an ABSENT field
// is forwarded as absent (undefined), never as a convenient default, so the
// state machine reports "unavailable correlation" instead of guessing.
import { useSessionStore } from "@/stores/sessionStore";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { validFqdnUser } from "@/lib/domain/native";
import { logonRowText } from "@/lib/domain/native";
import { deriveConnectionState, type ConnVerdict, type CorrelationState } from "@/lib/overview/readiness";
import { useNow } from "@/lib/useNow";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Pass a value through only when the server actually reported it. */
function optBool(v: unknown): boolean | null | undefined {
  if (typeof v === "boolean") return v;
  if (v === null) return null;
  return undefined;
}
function optStr(v: unknown): string | undefined {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s ? s : undefined;
}
function optNum(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** A normalized source address the server may publish only for tailnet peers. */
const TAILNET_V4 = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
const TAILNET_V6 = /^fd7a:115c:a1e0:/i;

export function isTailnetAddress(addr?: string): boolean {
  const a = String(addr || "").trim();
  if (!a) return false;
  return TAILNET_V4.test(a) || TAILNET_V6.test(a);
}

export function useConnectionVerdict(): ConnVerdict {
  useNow(1000);
  const fqdn = useSessionStore((s) => s.fqdn);
  const user = useSessionStore((s) => s.user);
  const listenerOkFlag = useSessionStore((s) => s.listenerOkFlag);
  const runnerDnsOk = useSessionStore((s) => s.runnerDnsOk);
  const helloWatchArmed = useSessionStore((s) => s.helloWatchArmed);
  const helloWatchSeen = useSessionStore((s) => s.helloWatchSeen);
  const helloWatchArmedAt = useSessionStore((s) => s.helloWatchArmedAt);
  const lastTrace = useSessionStore((s) => s.lastTrace);
  const native = useSessionStore((s) => s.native);
  // [V4] The server clock is the ONE time basis for collector evidence. Using
  // Date.now() against a runner timestamp was the second half of the timestamp
  // defect: two clocks silently compared.
  const serverNowMs = useTelemetryStore((s) => s.serverNow());
  const serverClockKnown = useTelemetryStore((s) => s.serverClockKnown);
  // [V3-02 / D5] The run start is what lets the verdict place a logon INSIDE
  // the current run instead of promoting a previous session's 4624.
  const runStartedAtMs = useTelemetryStore((s) => s.runStartedAtMs);

  const s: Any = native || {};
  const rl = s.rdpListener || null;
  const authLast: Any = (rl && rl.authLast) || null;
  const collector = rl?.logonCollector || s.logonCollector || null;
  // The row text is still the shared producer of the human-readable line; the
  // state machine gets the raw fields below.
  const row = logonRowText(authLast, collector, serverNowMs);

  const a: Any = authLast || {};
  const remote: Any = a.remote || null;
  const session: Any = a.session || null;
  // If the server published no server clock yet, fall back to the browser clock
  // but let the caller know (the freshness label degrades to "undated" when the
  // scan stamp is absent anyway).
  const nowMs = serverClockKnown ? serverNowMs : Date.now();

  // The intended account: what the operator selected, echoed by the server when
  // it publishes one. Never inferred from the event itself.
  const expectedUser = optStr(a.expectedUser) || user || "";

  const correlation: CorrelationState | undefined =
    a.correlation === "complete" || a.correlation === "partial" || a.correlation === "none" || a.correlation === "unavailable"
      ? a.correlation
      : undefined;

  return deriveConnectionState({
    credOk: validFqdnUser(fqdn, user),
    runnerDnsOk,
    listenerOk: listenerOkFlag,
    helloWatchArmed,
    helloWatchSeen,
    helloWatchArmedAt,
    authResult: (row.result as "success" | "failed" | "none" | "" | null) ?? null,
    authEventTs: row.eventTs || "",
    authScanTs: row.scanTs || "",
    collectorDead: !!row.dead,
    runStartedAtMs,
    nowMs,

    expectedUser,
    authTargetUser: optStr(a.targetUser),
    authUserMatched: optBool(a.userMatched),
    authSource: optStr(a.source),
    authSourceMatch:
      a.sourceMatch === "match" || a.sourceMatch === "mismatch" || a.sourceMatch === "unknown" || a.sourceMatch === "not-reported"
        ? a.sourceMatch
        : undefined,
    authStatus: optStr(a.status),
    authSub: optStr(a.sub),
    authSubMeaning: optStr(a.subMeaning),
    authRecordId: optStr(a.recordId),
    authLogonType: optStr(a.logonType),
    authRemoteInteractive: optBool(a.remoteInteractive) ?? undefined,
    authSessionActive: optBool(session?.active),
    authSessionName: optStr(session?.name),
    authSessionState: optStr(session?.state),
    authSessionLogonTs: optStr(session?.logonTs),
    authCorrelation: correlation,
    authRemoteEventTs: optStr(remote?.seen ? remote?.eventTs : undefined),
    authExcludedUserCount: optNum(a.excludedUser),
    authExcludedSourceCount: optNum(a.excludedSource),
    attemptRid: optStr(lastTrace),
    attemptAtMs: helloWatchArmedAt > 0 ? helloWatchArmedAt : undefined,
    runId: optStr(s.runId) || optStr(s.buildSha),
  });
}
