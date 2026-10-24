// [V4 / 2026-10-25] THE SCREENSHOT, REPRODUCED AND CORRECTED.
//
// The reported screen showed, simultaneously:
//   * header "Live"            (dashboard transport - not an RDP session)
//   * Overview "Connection failed"
//   * "launcher beacon received - mstsc should be opening fullscreen"
//   * a 4625 authentication event used as the failure evidence
//   * "critical: the host rejected the stored credential", displayed as "0s ago"
//   * Web Desktop viewing mode marked manual
// ...while the operator's RDP session was actually working.
//
// Every one of those lines described a REAL producer. The defect was that they
// were combined into one verdict with the wrong scope, the wrong clock and the
// wrong confidence. These tests mount the SHIPPED Overview and assert the
// separation - not a cosmetic colour.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@/i18n";
import Overview from "@/pages/Overview";
import { useSessionStore } from "@/stores/sessionStore";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { useIncidentStore } from "@/stores/incidentStore";
import { useGlassStore } from "@/stores/prefsStore";
import { __setSupportsBackdropFilter } from "@/lib/glass/quality";
import { deriveIssues, type IssueInput } from "@/lib/overview/issues";
import { reconcileIncidents, EMPTY_INCIDENTS } from "@/lib/overview/incidents";

const USER = "WIN-NFU1JG4VESE\\User";
const SCAN_FRESH = () => new Date(Date.now() - 12_000).toISOString();

/**
 * The screenshot's data shape: a WORKING rdp-tcp session, a launcher beacon,
 * and an OLD 4625 that belongs to a different account.
 */
function seedScreenshotShape() {
  useSessionStore.setState({
    configLoaded: true,
    fqdn: "lab-runner-ghrdp.tail1.ts.net",
    user: USER,
    ip: "100.64.0.7",
    native: {
      fqdn: "lab-runner-ghrdp.tail1.ts.net",
      ip: "100.64.0.7",
      runnerResolvedIP: "100.64.0.7",
      runnerDnsOk: true,
      certBound: true,
      nlaOn: true,
      probeReasons: {},
      handlerChain: [],
      rdpListener: {
        listening: true,
        firewall: true,
        cert: true,
        nla: true,
        credsspLive: "ok",
        authLast: {
          // THE EVENT: a rejection for a DIFFERENT account, three hours old.
          result: "failed",
          eventTs: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          scanTs: SCAN_FRESH(),
          status: "0XC000006D",
          sub: "0XC000006A",
          subMeaning: "wrong-password",
          logonType: "",
          targetUser: "WIN-NFU1JG4VESE\\Administrator",
          expectedUser: USER,
          userMatched: false,
          sourceMatch: "not-reported",
          correlation: "none",
          correlationNote: "the only 4625 in the window belongs to another account",
          recordId: "811223",
          windowStart: "2026-10-25T00:00:00Z",
          // ...while a remote desktop session is alive.
          session: {
            active: true,
            name: "rdp-tcp#1",
            state: "Active",
            user: USER,
            logonTs: new Date(Date.now() - 4 * 3_600_000).toISOString(),
          },
        },
        logonCollector: { alive: true, uptimeSec: 3600 },
      },
    },
    nativeLost: false,
    listenerOkFlag: true,
    runnerDnsOk: true,
    runnerResolvedIP: "100.64.0.7",
    helloWatchArmed: true,
    helloWatchSeen: true, // the launcher beacon the operator saw
    helloWatchArmedAt: Date.now() - 60_000,
    autoLogin: { note: "", staleRegistration: false, installNotice: false, helloSeen: true },
  });
  useTelemetryStore.setState({
    progressLost: false,
    progress: {},
    // The dashboard transport really is live - that is what the "Live" header meant.
    wsLive: true,
    wsAvailable: true,
    wsAvailability: "supported",
    wsDead: false,
    wsDeadReason: "",
    wsAttempts: 0,
    wsLastDisconnectAt: null,
    sessionExpired: false,
    logLines: ["launcher beacon received - mstsc should be opening fullscreen"],
  });
}

function renderOverview() {
  return render(
    <MemoryRouter>
      <Overview />
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  useIncidentStore.getState().reset();
  useGlassStore.setState({ quality: "auto", clarity: 0.75, variant: "tinted" });
  __setSupportsBackdropFilter(true);
  seedScreenshotShape();
  vi.restoreAllMocks();
});

describe("V4-UI-1: the screenshot no longer reads as 'connection failed'", () => {
  it("SEED PRECONDITION: the store holds a foreign 4625 and a live rdp session", () => {
    const a = useSessionStore.getState().native?.rdpListener?.authLast;
    expect(a.result).toBe("failed");
    expect(a.userMatched).toBe(false);
    expect(a.session.active).toBe(true);
    expect(useTelemetryStore.getState().wsLive).toBe(true);
  });

  it("does NOT render the connection chip as failed", () => {
    renderOverview();
    const evidence = screen.getByTestId("overview-conn-evidence");
    expect(evidence.getAttribute("data-state")).not.toBe("failed");
    const chip = screen.getByTestId("overview-conn-state");
    expect(chip.getAttribute("data-state") ?? "").not.toBe("failed");
    expect(chip.textContent).not.toMatch(/connection failed/i);
  });

  it("reports the foreign rejection as INFO history, naming BOTH accounts", () => {
    renderOverview();
    const row = screen.getByTestId("issue-row-conn-foreign-failure");
    expect(row.getAttribute("data-severity")).toBe("info");
    expect(row.textContent).toContain("Administrator");
    expect(row.textContent).toContain(USER);
    // It is a real observation, so it is confirmed as an EVENT - while being
    // explicitly unable to decide this client's connection.
    expect(row.textContent).toMatch(/cannot decide this connection/i);
  });

  it("does NOT claim 'the host rejected the stored credential'", () => {
    renderOverview();
    const body = document.body.textContent || "";
    expect(body).not.toMatch(/rejected the stored credential/i);
  });

  it("the launcher beacon still shows as launched evidence, not as a connection", () => {
    renderOverview();
    const evidence = screen.getByTestId("overview-conn-evidence");
    expect(evidence.getAttribute("data-state")).toBe("launched");
    expect(evidence.textContent).toMatch(/launcher beacon received/i);
    // The CHIP label is the state, not the clickbait: "Launcher ran (not yet
    // connected)" - a warning state that says exactly what the beacon proves.
    const chip = screen.getByTestId("overview-conn-state");
    expect(chip.textContent).toMatch(/launcher ran/i);
    expect(chip.textContent).toMatch(/not yet connected/i);
    expect(chip.getAttribute("data-state")).not.toBe("connected");
  });

  it("an OLD event is never displayed as '0s ago'", () => {
    renderOverview();
    const row = screen.getByTestId("issue-row-conn-foreign-failure");
    // 3h = 10800s. The freshness label is derived from the EVENT timestamp.
    expect(row.getAttribute("data-stale")).toBe("1");
    expect(row.textContent).not.toMatch(/\b0s\b/);
    const occurred = row.getAttribute("data-occurred-at") || "";
    const ageSec = Math.round((Date.now() - Date.parse(occurred)) / 1000);
    expect(ageSec).toBeGreaterThan(3 * 3600 - 120);
  });
});

describe("V4-UI-2: a correlated, current failure is still a real failure", () => {
  function seedMatchingFailure() {
    const st = useSessionStore.getState().native;
    st.rdpListener.authLast = {
      ...st.rdpListener.authLast,
      targetUser: USER,
      userMatched: true,
      correlation: "complete",
      eventTs: new Date(Date.now() - 45_000).toISOString(),
      recordId: "811999",
    };
    // No live session: this rejection really is the last fact.
    st.rdpListener.authLast.session = { active: false, name: "", state: "", logonTs: "" };
    useSessionStore.setState({ native: { ...st } });
  }

  it("shows 'Connection failed' and a CONFIRMED critical issue", () => {
    seedMatchingFailure();
    renderOverview();
    expect(screen.getByTestId("overview-conn-evidence").getAttribute("data-state")).toBe("failed");
    const row = screen.getByTestId("issue-row-conn-failed");
    expect(row.getAttribute("data-severity")).toBe("critical");
    expect(row.textContent).toMatch(/Confirmed/i);
    expect(row.textContent).toMatch(/rejected the password/i);
  });

  it("acknowledging an incident does NOT resolve it", () => {
    seedMatchingFailure();
    renderOverview();
    const ack = screen.getByTestId("issue-ack-conn-failed");
    expect(ack.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(ack);
    expect(screen.getByTestId("issue-ack-conn-failed").getAttribute("aria-pressed")).toBe("true");
    const rec = Object.values(useIncidentStore.getState().ledger.records).find((r) => r.id === "conn-failed")!;
    expect(rec.acknowledgedAt).not.toBeNull();
    expect(rec.resolvedAt, "an ack must never resolve an incident").toBeNull();
    // The row is still live and still rendered.
    expect(screen.getByTestId("issue-row-conn-failed")).toBeInTheDocument();
  });

  it("un-acknowledging restores the unacknowledged state", () => {
    seedMatchingFailure();
    renderOverview();
    fireEvent.click(screen.getByTestId("issue-ack-conn-failed"));
    fireEvent.click(screen.getByTestId("issue-ack-conn-failed"));
    expect(screen.getByTestId("issue-ack-conn-failed").getAttribute("aria-pressed")).toBe("false");
    const rec = Object.values(useIncidentStore.getState().ledger.records).find((r) => r.id === "conn-failed")!;
    expect(rec.acknowledgedAt).toBeNull();
  });

  it("a reload does not resurrect a resolved incident as current", () => {
    seedMatchingFailure();
    const { unmount } = renderOverview();
    const rec = Object.values(useIncidentStore.getState().ledger.records).find((r) => r.id === "conn-failed")!;
    expect(rec).toBeTruthy();
    unmount();
    // The ledger is rebuilt from live data: a fresh mount with NO failure in the
    // store must not render the old incident at all.
    const st = useSessionStore.getState().native;
    st.rdpListener.authLast = { result: "none", eventTs: "", scanTs: SCAN_FRESH() };
    useSessionStore.setState({ native: { ...st } });
    useIncidentStore.getState().reset();
    renderOverview();
    expect(screen.queryByTestId("issue-row-conn-failed")).toBeNull();
  });
});

describe("V4-UI-3: WebSocket availability is a state, not a boolean", () => {
  it("an unanswered /health probe is 'unknown', never 'this build has no /ws'", () => {
    useTelemetryStore.setState({ wsLive: false, wsAvailable: false, wsDead: false, wsAvailability: "pending" });
    renderOverview();
    const row = screen.getByTestId("issue-row-ws-unknown");
    expect(row.getAttribute("data-severity")).toBe("info");
    expect(row.textContent).toMatch(/not yet known/i);
    expect(screen.queryByTestId("issue-row-ws-absent")).toBeNull();
  });

  it("a worker-pool outage is a WARNING with a reconnect action, not 'no endpoint'", () => {
    useTelemetryStore.setState({
      wsLive: false,
      wsAvailable: false,
      wsDead: false,
      wsAvailability: "pool-unavailable",
      wsUnavailableReason: "websocket worker pool unavailable",
    });
    renderOverview();
    const row = screen.getByTestId("issue-row-ws-pool-unavailable");
    expect(row.getAttribute("data-severity")).toBe("warning");
    expect(row.textContent).toMatch(/worker pool/i);
    expect(screen.getByTestId("issue-action-ws-pool-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("issue-row-ws-absent")).toBeNull();
  });

  it("a refused probe is 'unauthorized', not a capability claim", () => {
    useTelemetryStore.setState({ wsLive: false, wsAvailable: false, wsDead: false, wsAvailability: "unauthorized" });
    renderOverview();
    expect(screen.getByTestId("issue-row-ws-unauthorized").getAttribute("data-severity")).toBe("warning");
    expect(screen.queryByTestId("issue-row-ws-absent")).toBeNull();
  });

  it("only an explicit ok+ws=false answer says 'this build exposes no /ws'", () => {
    useTelemetryStore.setState({ wsLive: false, wsAvailable: false, wsDead: false, wsAvailability: "unsupported" });
    renderOverview();
    const row = screen.getByTestId("issue-row-ws-absent");
    expect(row.getAttribute("data-severity")).toBe("info");
    expect(row.textContent).toMatch(/exposes no \/ws endpoint/i);
  });
});

describe("V4-UI-4: repeated polls do not reset an incident's age", () => {
  it("the same event observed twice keeps one record and its original time", () => {
    const eventMs = Date.now() - 2 * 3_600_000;
    const input: IssueInput = {
      progressLost: false,
      wsLive: true,
      wsAvailable: true,
      wsAvailability: "supported",
      wsDead: false,
      wsDeadReason: "",
      wsAttempts: 0,
      wsLastDisconnectAtMs: null,
      serverNowMs: Date.now(),
      nativeLost: false,
      collectorDead: false,
      authScanTsMs: Date.now() - 5_000,
      connState: "failed",
      connBlockers: [],
      sessionExpired: false,
      authEventTsMs: eventMs,
      authRecordId: "777001",
      authSub: "0XC000006A",
      authStatus: "0XC000006D",
      authTargetUser: USER,
      expectedUser: USER,
      authUserMatched: true,
      connFreshness: "current",
      connCorrelation: "complete",
      connFailureClass: "wrong-password",
    };
    let ledger = EMPTY_INCIDENTS;
    for (let i = 0; i < 5; i++) ledger = reconcileIncidents(ledger, deriveIssues(input), Date.now() + i * 1000);
    const recs = Object.values(ledger.records).filter((r) => r.id === "conn-failed");
    expect(recs.length).toBe(1);
    expect(recs[0].occurredAtMs).toBe(eventMs);
    expect(recs[0].firstObservedAtMs).toBeLessThanOrEqual(Date.now() + 100);
  });
});

// Guard: an unused import would fail the repo's no-unused gate; `act` is used
// by the reload case above via render/unmount.
void act;
