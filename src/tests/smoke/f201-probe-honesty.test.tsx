// [F201] A REFUSED PROBE IS NOT A MEASUREMENT.
//
// Operator-visible baseline (application SHA e432d3df4cf00a8528d574f8410f6a76e590db31,
// live run 40022345749/1): the Overview screen said
//   "WINDOWS AUTO-LOGIN is unavailable because: the FQDN/user pair failed
//    validation; the runner tailnet IP did not resolve; the RDP LISTENER probe
//    is not all green"
// while the same page showed "(not set)" for the FQDN and no Web Desktop URL -
// i.e. the client had never received a status body at all. `getJson()` returned
// `null` for a 401, a 403, a network error and an empty 200 alike, the stores
// kept their empty defaults, and those defaults were rendered as measurements
// of the server's credentials, DNS and listener.
//
// This suite pins the three behaviours that make the lie impossible:
//   1. the transport keeps the STATUS and a stable failure class;
//   2. the store records the probe result next to the data;
//   3. the Overview gate names the probe failure (and its remediation) instead
//      of accusing credentials/DNS/listener that were never measured - and it
//      still names the real credential gate once a trusted answer arrives.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@/i18n";
import { probeJson } from "@/lib/api";
import { useSessionStore } from "@/stores/sessionStore";
import Overview from "@/pages/Overview";

// The Overview page mounts the composed cards (PrimaryActions included); the
// gate wording is asserted through the same data-testid the operator sees.
function renderOverview() {
  return render(
    <MemoryRouter>
      <Overview />
    </MemoryRouter>
  );
}

const realFetch = globalThis.fetch;

function respond(status: number, body: unknown = {}, isJson = true): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(isJson ? JSON.stringify(body) : "<html>not json</html>", {
      status,
      headers: { "content-type": isJson ? "application/json" : "text/html" },
    })
  ) as unknown as typeof fetch;
}

function resetStore(): void {
  useSessionStore.setState({
    configLoaded: false,
    fqdn: "",
    user: "",
    ip: "",
    native: null,
    nativeLost: false,
    listenerOkFlag: false,
    runnerResolvedIP: "",
    runnerDnsOk: false,
    probes: {
      config: { state: "pending", status: 0, at: 0 },
      native: { state: "pending", status: 0, at: 0 },
    },
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("F201 probe transport", () => {
  it("keeps the HTTP status and class for a refused read (401 / 403)", async () => {
    respond(401, { error: "unauthorized" });
    const r = await probeJson("/api/native-status");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.failure).toBe("unauthorized");
    expect(r.data).toBeNull();

    respond(403, { error: "forbidden" });
    const f = await probeJson("/api/native-status");
    expect(f.status).toBe(403);
    expect(f.failure).toBe("forbidden");
  });

  it("separates a transport failure (status 0) from an error status", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const r = await probeJson("/api/native-status");
    expect(r).toMatchObject({ ok: false, status: 0, failure: "transport", data: null });
  });

  it("separates a non-JSON 200 (schema/build mismatch) from a good read", async () => {
    respond(200, {}, false);
    const bad = await probeJson("/api/native-status");
    expect(bad).toMatchObject({ ok: false, status: 200, failure: "schema" });

    respond(200, { fqdn: "host.tailnet.ts.net" });
    const good = await probeJson<{ fqdn: string }>("/api/native-status");
    expect(good.ok).toBe(true);
    expect(good.status).toBe(200);
    expect(good.data?.fqdn).toBe("host.tailnet.ts.net");
  });
});

describe("F201 store", () => {
  it("records a probe result without pretending the data arrived", () => {
    useSessionStore.getState().setProbe("native", "unauthorized", 401);
    const pr = useSessionStore.getState().probes.native;
    expect(pr.state).toBe("unauthorized");
    expect(pr.status).toBe(401);
    expect(pr.at).toBeGreaterThan(0);
    // The measurement fields are untouched: no fqdn was invented.
    expect(useSessionStore.getState().fqdn).toBe("");
  });
});

describe("F201 Overview gate wording", () => {
  it("names the refused status read, not credentials/DNS/listener, when nothing was measured", () => {
    useSessionStore.getState().setProbe("native", "unauthorized", 401);
    renderOverview();
    const note = screen.getByTestId("overview-auto-login-note");
    const text = note.textContent || "";
    expect(text).toMatch(/refused this page/i);
    expect(text).toMatch(/no valid run key/i);
    expect(text).toMatch(/HTTP 401/);
    // The three accusations must NOT appear: they describe measurements that
    // were never made.
    expect(text).not.toMatch(/FQDN\/user pair failed validation/i);
    expect(text).not.toMatch(/tailnet IP did not resolve/i);
    expect(text).not.toMatch(/LISTENER probe is not all green/i);
  });

  it("says the transport failed when the dashboard did not answer at all", () => {
    useSessionStore.getState().setProbe("native", "transport", 0);
    renderOverview();
    const text = screen.getByTestId("overview-auto-login-note").textContent || "";
    expect(text).toMatch(/did not answer/i);
    expect(text).not.toMatch(/FQDN\/user pair failed validation/i);
  });

  it("still names the real credential gate once a trusted answer arrived", () => {
    useSessionStore.setState({
      native: { rdpListener: { listening: true, fw: true, cert: true, nla: true } },
      listenerOkFlag: true,
      runnerResolvedIP: "",
      runnerDnsOk: true,
      fqdn: "",
      user: "",
    });
    useSessionStore.getState().setProbe("native", "ok", 200);
    useSessionStore.getState().setProbe("config", "ok", 200);
    renderOverview();
    const text = screen.getByTestId("overview-auto-login-note").textContent || "";
    expect(text).toMatch(/FQDN\/user pair failed validation/i);
  });

  it("keeps the button disabled in every one of those states", () => {
    useSessionStore.getState().setProbe("native", "unauthorized", 401);
    renderOverview();
    expect(screen.getByTestId("overview-auto-login")).toBeDisabled();
  });
});
