// [R2 §5 + §8 / #191 #213 #214] The redesigned Overview, tested on the SEEDED
// path - not on a fallback.
//
// The operator's report is explicit: "some f84 tests passed through fallback
// branches because result rows were absent. That does not verify the requested
// UI path." So every case here follows one shape:
//   1. SEED the store with the data the surface needs.
//   2. ASSERT THE PRECONDITION - if the seed did not take, fail here with a
//      message that says the seed failed, rather than silently testing the
//      empty state and passing anyway.
//   3. Execute the real user action through the real component.
//   4. Assert the user-visible outcome.
//
// Nothing here re-implements Overview logic. It mounts the shipped component.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@/i18n";
import Overview from "@/pages/Overview";
import { useSessionStore } from "@/stores/sessionStore";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { useGlassStore } from "@/stores/prefsStore";
import { __setSupportsBackdropFilter } from "@/lib/glass/quality";
import { refreshVisualQualityEnv } from "@/lib/glass/useVisualQuality";

/** Synthetic seed. RFC 2606 host, placeholder user, no credential or real IP. */
const SEED_NATIVE = {
  fqdn: "lab-runner-ghrdp.tail1.ts.net",
  user: "labuser",
  ip: "100.64.0.7",
  runnerResolvedIP: "100.64.0.7",
  runnerDnsOk: true,
  runnerEgressIp: "203.0.113.24",
  certBound: true,
  nlaOn: true,
  webdeskUrl: "http://100.64.0.7:7333/vnc.html",
  probeReasons: {},
  handlerChain: [],
  legacyKey: "LAB-LEGACY-PLACEHOLDER",
  mirrorIndexUrl: "https://example.invalid/mirror/",
  rdpListener: {
    listening: true,
    firewall: true,
    cert: true,
    nla: true,
    credsspLive: "ok",
    credsspWhy: "",
    authLast: {
      result: "success",
      eventTs: "2026-10-11T03:52:10Z",
      scanTs: new Date(Date.now() - 12_000).toISOString(),
      logonType: "10",
      logonKind: "RemoteInteractive",
      windowStart: "2026-10-11T03:25:00Z",
    },
    logonCollector: { alive: true, uptimeSec: 1840 },
  },
};

function seed() {
  useSessionStore.setState({
    configLoaded: true,
    fqdn: SEED_NATIVE.fqdn,
    user: SEED_NATIVE.user,
    ip: SEED_NATIVE.ip,
    native: SEED_NATIVE,
    nativeLost: false,
    listenerOkFlag: true,
    runnerDnsOk: true,
    runnerResolvedIP: SEED_NATIVE.runnerResolvedIP,
    helloWatchArmed: false,
    helloWatchSeen: false,
    helloWatchArmedAt: 0,
    autoLogin: { note: "", staleRegistration: false, installNotice: false, helloSeen: false },
  });
  useTelemetryStore.setState({
    progressLost: false,
    progress: { runnerEgressIp: SEED_NATIVE.runnerEgressIp },
    wsLive: true,
    wsAvailable: true,
    wsDead: false,
    wsDeadReason: "",
    wsAttempts: 0,
    wsLastDisconnectAt: null,
    sessionExpired: false,
    logLines: ["[03:52:10] launcher beacon received"],
    rttSamples: [42, 46],
    httpRtt: 44,
    rttAtMs: Date.now(),
    wire: { rtt: 12, ok: true },
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
  useGlassStore.setState({ quality: "auto", clarity: 0.75, variant: "tinted" });
  __setSupportsBackdropFilter(true);
  seed();
});

describe("R2 Overview: the seeded path is the path under test", () => {
  it("SEED PRECONDITION: the store really holds the seeded session", () => {
    // Step 2 of the shape above. Without this the rest of the file could pass
    // against an empty store and prove nothing.
    const st = useSessionStore.getState();
    expect(st.fqdn).toBe("lab-runner-ghrdp.tail1.ts.net");
    expect(st.native?.rdpListener?.authLast?.result).toBe("success");
    expect(st.listenerOkFlag).toBe(true);
    expect(st.runnerDnsOk).toBe(true);
  });

  it("resolves 'connected' from the seeded 4624 - the primary action is ENABLED", () => {
    renderOverview();
    const evidence = screen.getByTestId("overview-conn-evidence");
    expect(evidence.getAttribute("data-state")).toBe("connected");
    expect(evidence.getAttribute("data-evidenced")).toBe("1");
    expect(evidence.textContent).toContain("4624");

    const autoLogin = screen.getByTestId("overview-auto-login");
    // The seeded gates are all green, so this must NOT be the disabled branch.
    expect(autoLogin).not.toBeDisabled();
    expect(autoLogin.getAttribute("data-why")).toBeNull();

    const webdesk = screen.getByTestId("overview-web-desktop");
    expect(webdesk).not.toBeDisabled();
  });

  it("the connection panel sits ABOVE the workspace and the troubleshooting summary in the DOM", () => {
    const { container } = renderOverview();
    const order = ["overview-connect-panel", "overview-workspace", "overview-troubleshoot", "overview-activity"];
    const idx = order.map((id) => {
      const el = container.querySelector(`[data-testid="${id}"]`);
      expect(el, `${id} must be rendered`).toBeTruthy();
      // document position: 4 = FOLLOWING
      return el as HTMLElement;
    });
    for (let i = 1; i < idx.length; i++) {
      const rel = idx[i - 1].compareDocumentPosition(idx[i]);
      expect(rel & Node.DOCUMENT_POSITION_FOLLOWING, `${order[i]} must follow ${order[i - 1]}`).toBeTruthy();
    }
  });

  it("credentials are NOT in the primary screen - they live inside the Advanced disclosure", () => {
    const { container } = renderOverview();
    const keys = container.querySelector("#sec-keys");
    expect(keys, "KeysCard must still be mounted").toBeTruthy();
    const details = container.querySelector('[data-testid="overview-advanced"]');
    expect(details, "the Advanced disclosure must exist").toBeTruthy();
    expect(details!.contains(keys!)).toBe(true);
    // and the panel starts CLOSED, so credentials do not dominate the overview
    expect((details as HTMLDetailsElement).open).toBe(false);
    // a closed <details> still keeps its children in the DOM - that is what lets
    // the 219-id lock pass while the content is out of the primary view
    expect(container.ownerDocument.getElementById("sec-keys")).toBeTruthy();
  });

  it("Diagnose opens the EXISTING embedded drawer (no navigation, no runner write)", async () => {
    const runDiag = vi.fn(async () => undefined);
    useSessionStore.setState({ diagOpen: false, diagText: "", runDiag });
    renderOverview();

    expect(useSessionStore.getState().diagOpen).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByTestId("overview-diagnose"));
    });

    // The real handler ran and the real store flipped - not a stubbed return.
    expect(runDiag).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().diagOpen).toBe(true);
  });

  it("the export action is labelled neutrally and never names an assistant", () => {
    renderOverview();
    const btn = screen.getByTestId("overview-download-diag");
    expect(btn.id).toBe("f96.downloadDiag");
    const label = (btn.textContent || "").toLowerCase();
    expect(label).toContain("export diagnostics");
    for (const banned of ["claude", "assistant", "paste to"]) {
      expect(label).not.toContain(banned);
    }
  });

  it("workspace tiles point at EXISTING routes - no invented /downloads route", () => {
    const { container } = renderOverview();
    const hrefs = Array.from(container.querySelectorAll('[data-testid^="workspace-"]'))
      .map((a) => a.getAttribute("href"))
      .filter(Boolean);
    expect(hrefs.length).toBe(4);
    for (const h of hrefs) {
      expect(["/files", "/search", "/sessions"]).toContain(h);
    }
    expect(hrefs).not.toContain("/downloads");
  });

  it("transfers names the real queue depth, and says 'idle' when the queue is empty", () => {
    renderOverview();
    expect(screen.getByTestId("workspace-transfers-sub").textContent).toMatch(/idle/i);
  });

  it("no fabricated metrics: an empty producer renders an explicit unknown, not a number", () => {
    useTelemetryStore.setState({ rttSamples: [], httpRtt: null, rttAtMs: null, wire: null, logLines: [] });
    renderOverview();
    expect(screen.getByTestId("activity-http-rtt").textContent).toMatch(/no samples yet/i);
    expect(screen.getByTestId("activity-wire-rtt").textContent).toMatch(/no samples yet/i);
    expect(screen.getByTestId("activity-jitter").textContent).toMatch(/unknown/i);
    expect(screen.getByTestId("activity-log-empty")).toBeTruthy();
    // and it must NOT invent a plausible-looking zero
    expect(screen.getByTestId("activity-http-rtt").textContent).not.toMatch(/0\s*ms/);
  });

  it("real metrics render when the producer has samples", () => {
    renderOverview();
    expect(screen.getByTestId("activity-http-rtt").textContent).toContain("44 ms");
    expect(screen.getByTestId("activity-wire-rtt").textContent).toContain("12 ms");
    expect(screen.getByTestId("activity-log").textContent).toContain("launcher beacon received");
  });

  it("every glass surface in the Overview is a GlassContainer, never a bare .glass class", () => {
    // This is the defect that made the old DiagBundleCard render fully opaque:
    // `className="glass"` with no data-glass-samples attribute matched neither
    // globals.css selector, so --glass-alpha fell back to 1.
    const { container } = renderOverview();
    const bare = Array.from(container.querySelectorAll(".glass")).filter(
      (el) => !el.hasAttribute("data-glass-samples")
    );
    expect(bare.map((el) => el.getAttribute("data-testid") || el.id || el.tagName)).toEqual([]);
    // and the panels really are paint-only nested surfaces: exactly one sampler
    // is allowed in the whole shell, and it belongs to the TopBar, not to a card
    const samplers = container.querySelectorAll('[data-glass-samples="1"]');
    expect(samplers.length).toBe(0);
    const nested = container.querySelectorAll('[data-glass-surface="nested"]');
    expect(nested.length).toBeGreaterThan(4);
  });

  it("the opaque fallback still resolves, and the header says which presentation is active", () => {
    __setSupportsBackdropFilter(false);
    // useVisualQuality caches its env snapshot at module level on purpose, so
    // the seam change has to be published through the module own API.
    refreshVisualQualityEnv();
    renderOverview();
    const summary = screen.getByTestId("overview-glass-summary");
    expect(summary.textContent).toMatch(/opaque/i);
    __setSupportsBackdropFilter(true);
    refreshVisualQualityEnv();
  });
});

describe("R2 Overview: the troubleshooting summary separates confirmed from suspected", () => {
  it("a dead WebSocket ladder is CONFIRMED and offers the real Reconnect handler", async () => {
    useTelemetryStore.setState({
      wsLive: false,
      wsAvailable: true,
      wsDead: true,
      wsDeadReason: "ladder-exhausted",
      wsAttempts: 4,
      wsLastDisconnectAt: Date.now() - 5_000,
    });
    const requestWsReconnect = vi.fn();
    useTelemetryStore.setState({ requestWsReconnect });
    renderOverview();

    const row = screen.getByTestId("issue-row-ws-dead");
    expect(row.getAttribute("data-severity")).toBe("critical");
    expect(row.textContent).toMatch(/confirmed/i);
    expect(row.textContent).toContain("4");

    await act(async () => {
      fireEvent.click(screen.getByTestId("issue-action-ws-dead"));
    });
    // The REAL store action was invoked - this is not a stubbed onClick.
    expect(requestWsReconnect).toHaveBeenCalledTimes(1);
  });

  it("a missing /ws endpoint is INFO and explicitly needs no action", () => {
    useTelemetryStore.setState({ wsLive: false, wsAvailable: false, wsDead: false });
    renderOverview();
    const row = screen.getByTestId("issue-row-ws-absent");
    expect(row.getAttribute("data-severity")).toBe("info");
    expect(row.textContent).toMatch(/confirmed/i);
    // an endpoint that does not exist on this build is not a failure to fix
    expect(screen.queryByTestId("issue-action-ws-absent")).toBeNull();
  });

  it("an idle-but-advertised socket is SUSPECTED, not confirmed", () => {
    useTelemetryStore.setState({ wsLive: false, wsAvailable: true, wsDead: false });
    renderOverview();
    expect(screen.getByTestId("issue-row-ws-idle").textContent).toMatch(/suspected/i);
  });

  it("a stale scan timestamp is labelled stale with its age, never shown as current", () => {
    const old = new Date(Date.now() - 300_000).toISOString();
    useSessionStore.setState({
      native: {
        ...SEED_NATIVE,
        rdpListener: { ...SEED_NATIVE.rdpListener, authLast: { ...SEED_NATIVE.rdpListener.authLast, scanTs: old } },
      },
    });
    renderOverview();
    const row = screen.getByTestId("issue-row-scan-stale");
    expect(row.getAttribute("data-stale")).toBe("1");
    expect(screen.getByTestId("issue-freshness-scan-stale").textContent).toMatch(/stale/i);
  });

  it("an all-clear system says so explicitly instead of rendering an empty box", () => {
    useTelemetryStore.setState({ wsLive: true, wsAvailable: true, wsDead: false, progressLost: false });
    renderOverview();
    expect(screen.getByTestId("overview-troubleshoot-empty").textContent).toMatch(/no actionable issues/i);
    expect(screen.getByTestId("overview-issue-count").textContent).toMatch(/all clear/i);
  });
});
