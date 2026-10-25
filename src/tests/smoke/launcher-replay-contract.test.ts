// [SINGLE-DISPATCH-2026-10-25] Launcher replay contract.
//
// The launcher (payloads/ghrdp-rdp-launcher.cs) cannot be compiled on this host
// (no csc/mono/dotnet), so this suite pins the CONTRACT in source: a replayed or
// expired single-use ticket must never open a credential prompt, never run
// cmdkey, never start a second mstsc and never silently retry the consumed
// ticket. Runtime verification belongs to the Windows candidate (see the handoff
// report); the executable check below is what keeps the regression out.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const cs = readFileSync("payloads/ghrdp-rdp-launcher.cs", "utf8");

/** A method body, from its signature to the next member declaration. */
function method(name: string): string {
  const start = cs.indexOf(name + "(");
  expect(start, name + " must exist").toBeGreaterThan(-1);
  const next = cs.indexOf("\n    private static ", start + 10);
  return cs.slice(start, next);
}

describe("[LAUNCHER] a replayed ticket is not a credential prompt", () => {
  it("classifies a 401/403/409 redemption as a REPLAY", () => {
    expect(cs).toContain('return "ticket-invalid-or-expired";');
    expect(cs).toContain('return "ticket-consumed";');
    expect(cs).toContain('outcome == "ticket-invalid-or-expired" || outcome == "ticket-consumed"');
  });

  it("decides the replay BEFORE the interactive fallback in both verbs", () => {
    const rdpCall = cs.indexOf("string fallback = RedeemAndStore(uri, server, user, host, port);");
    const rdpReplay = cs.indexOf("if (IsTicketReplay(fallback)) { return ReplayStep(", rdpCall);
    const rdpFallback = cs.indexOf("HandoffStep(host, port, FallbackBeacon(fallback), false);", rdpCall);
    expect(rdpReplay).toBeGreaterThan(rdpCall);
    expect(rdpReplay).toBeLessThan(rdpFallback);

    const recredCall = cs.indexOf('RedeemAndStoreStep(uri, server, user, host, port, "recred-redeemed")');
    const recredReplay = cs.indexOf("if (IsTicketReplay(first)) { return ReplayStep(", recredCall);
    const recredFallback = cs.indexOf("HandoffStep(host, port, FallbackBeacon(first), false);", recredCall);
    expect(recredReplay).toBeGreaterThan(recredCall);
    expect(recredReplay).toBeLessThan(recredFallback);
  });

  it("ReplayStep opens no cmdkey window and starts no mstsc", () => {
    const body = method("private static int ReplayStep");
    // Invocations, not prose: the method's own log line mentions the words.
    expect(body).not.toContain("cmdkey.exe");
    expect(body).not.toContain("Process.Start(");
    expect(body).not.toContain("MstscStep(");
    expect(body).not.toContain("CredWrite(");
    // It does report, and it either no-ops (recent launch) or explains.
    expect(body).toContain("ticket-replayed");
    expect(body).toContain("LaunchedRecently");
  });

  it("a successful launch is recorded so a duplicate delivery is a no-op", () => {
    const mstsc = cs.slice(cs.indexOf("private static int MstscStep("));
    const started = mstsc.indexOf('HandoffStep(host, port, "mstsc-started", true);');
    const mark = mstsc.indexOf("MarkLaunched(server, user);");
    expect(started).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(started);
    // ...and the marker is bounded, so an old launch cannot silence a real retry.
    const body = method("private static bool LaunchedRecently");
    expect(body).toContain("TotalMinutes <= 10");
  });
});
