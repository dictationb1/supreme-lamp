// [R2 / #194 §5] The store -> verdict bridge for src/lib/overview/readiness.ts.
//
// Split out so the derivation itself stays pure and unit-testable: this hook is
// only a field mapping. `logonRowText` is the SAME function the bottom bar and
// LogPanel use, so the Overview can never report a connection state that the
// status bar contradicts.
import { useSessionStore } from "@/stores/sessionStore";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { validFqdnUser } from "@/lib/domain/native";
import { logonRowText } from "@/lib/domain/native";
import { deriveConnectionState, type ConnVerdict } from "@/lib/overview/readiness";
import { useNow } from "@/lib/useNow";

export function useConnectionVerdict(): ConnVerdict {
  useNow(1000);
  const fqdn = useSessionStore((s) => s.fqdn);
  const user = useSessionStore((s) => s.user);
  const listenerOkFlag = useSessionStore((s) => s.listenerOkFlag);
  const runnerDnsOk = useSessionStore((s) => s.runnerDnsOk);
  const helloWatchArmed = useSessionStore((s) => s.helloWatchArmed);
  const helloWatchSeen = useSessionStore((s) => s.helloWatchSeen);
  const helloWatchArmedAt = useSessionStore((s) => s.helloWatchArmedAt);
  const native = useSessionStore((s) => s.native);
  const serverNow = useTelemetryStore((s) => s.serverNow);

  const s = native || {};
  const rl = s.rdpListener || null;
  const authLast = (rl && rl.authLast) || null;
  const collector = rl?.logonCollector || s.logonCollector || null;
  const row = logonRowText(authLast, collector, serverNow());

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
    nowMs: Date.now(),
  });
}
