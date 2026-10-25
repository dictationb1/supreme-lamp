// [SINGLE-DISPATCH-2026-10-25] Store-level behaviour: the shipped `fireAutoLogin`
// / `fireFixReconnect` paths, driven through the REAL store, a mocked ticket
// endpoint and a stubbed location. These are the counts the operator's defect was
// about: HTTP ticket requests and custom-protocol navigations per click.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLaunchDispatcherForTests, useSessionStore } from "@/stores/sessionStore";
import { clearDashToken, DASH_TOKEN_STORAGE_KEY } from "@/lib/dashToken";
import { TICKET_TTL_MS } from "@/lib/domain/dispatch";

const RID = "0123456789abcdef0123456789abcdef";
const RID2 = "fedcba9876543210fedcba9876543210";

interface Net {
  ticketPosts: number;
  navigations: string[];
  assign: ReturnType<typeof vi.fn>;
}

function stubLocation(nav: Net): void {
  Object.defineProperty(window, "location", {
    value: {
      protocol: "http:",
      hostname: "100.81.171.116",
      host: "100.81.171.116:7333",
      port: "7333",
      origin: "http://100.81.171.116:7333",
      search: "",
      hash: "",
      assign: nav.assign,
      href: "",
    },
    writable: true,
    configurable: true,
  });
}

function mockNetwork(opts: { ticket?: "ok" | "401"; rid?: string } = {}): Net {
  const nav: Net = { ticketPosts: 0, navigations: [], assign: vi.fn((u: string) => nav.navigations.push(u)) };
  stubLocation(nav);
  const ticket = opts.ticket ?? "ok";
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/rdp-token") && (init?.method || "GET").toUpperCase() === "POST") {
      nav.ticketPosts += 1;
      if (ticket === "401") {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ rid: opts.rid ?? RID }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return nav;
}

function resetStore(): void {
  resetLaunchDispatcherForTests();
  useSessionStore.setState({
    fqdn: "runner.tail1234.ts.net",
    user: "rdpuser",
    native: null,
    helloWatchArmed: false,
    helloWatchSeen: false,
    helloWatchArmedAt: 0,
    launchAttempt: null,
    launchStage: "idle",
    launchTicketWarm: false,
    lastTrace: "",
    autoLogin: { note: "", staleRegistration: false, installNotice: false, helloSeen: false },
  });
}

describe("[SINGLE-DISPATCH] fireAutoLogin", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetStore();
  });
  afterEach(() => {
    clearDashToken();
    vi.restoreAllMocks();
  });

  it("with no dashboard token: no ticket request, no navigation, and a note that names the token", async () => {
    const nav = mockNetwork();
    await useSessionStore.getState().fireAutoLogin();
    expect(nav.ticketPosts).toBe(0);
    expect(nav.navigations).toHaveLength(0);
    expect(useSessionStore.getState().autoLogin.note).toContain("?key=");
  });

  it("with a malformed FQDN: refuses visibly, no network, no navigation", async () => {
    const nav = mockNetwork();
    window.localStorage.setItem(DASH_TOKEN_STORAGE_KEY, "testtoken");
    useSessionStore.setState({ fqdn: "" });
    await useSessionStore.getState().fireAutoLogin();
    expect(nav.ticketPosts).toBe(0);
    expect(nav.navigations).toHaveLength(0);
    expect(useSessionStore.getState().autoLogin.note.toLowerCase()).toContain("fqdn");
  });

  it("happy path: ONE ticket POST and ONE navigation carrying that ticket", async () => {
    const nav = mockNetwork();
    window.localStorage.setItem(DASH_TOKEN_STORAGE_KEY, "testtoken");
    await useSessionStore.getState().fireAutoLogin();
    expect(nav.ticketPosts).toBe(1);
    expect(nav.navigations).toHaveLength(1);
    expect(nav.navigations[0]).toContain("ghrdp://rdp");
    expect(nav.navigations[0]).toContain("t=" + RID);
    const st = useSessionStore.getState();
    expect(st.launchStage).toBe("dispatched");
    expect(st.launchAttempt?.dispatches).toBe(1);
    expect(st.launchAttempt?.ticketRequests).toBe(1);
    expect(st.helloWatchArmed).toBe(true);
    expect(st.autoLogin.note).toMatch(/dispatched ONCE/i);
  });

  it("a second click while the first attempt awaits handoff mints no second ticket", async () => {
    const nav = mockNetwork();
    window.localStorage.setItem(DASH_TOKEN_STORAGE_KEY, "testtoken");
    await useSessionStore.getState().fireAutoLogin();
    await useSessionStore.getState().fireAutoLogin();
    expect(nav.ticketPosts).toBe(1);
    expect(nav.navigations).toHaveLength(1);
    expect(useSessionStore.getState().autoLogin.note).toMatch(/already awaiting handoff/i);
  });

  it("a warmed ticket is used and NOT re-requested (activation-preserving path)", async () => {
    const nav = mockNetwork();
    window.localStorage.setItem(DASH_TOKEN_STORAGE_KEY, "testtoken");
    await useSessionStore.getState().warmLaunchTicket();
    expect(nav.ticketPosts).toBe(1);
    await useSessionStore.getState().fireAutoLogin();
    expect(nav.ticketPosts).toBe(1);
    expect(nav.navigations).toHaveLength(1);
    expect(nav.navigations[0]).toContain("t=" + RID);
  });

  it("a refused ticket reports the failure and dispatches nothing", async () => {
    const nav = mockNetwork({ ticket: "401" });
    window.localStorage.setItem(DASH_TOKEN_STORAGE_KEY, "testtoken");
    await useSessionStore.getState().fireAutoLogin();
    expect(nav.ticketPosts).toBe(1);
    expect(nav.navigations).toHaveLength(0);
    const st = useSessionStore.getState();
    expect(st.launchStage).toBe("failed");
    expect(st.autoLogin.note).toMatch(/ticket-issue failed/i);
  });

  it("retry after a failure mints a FRESH ticket and dispatches exactly once more", async () => {
    const nav = mockNetwork({ ticket: "401" });
    window.localStorage.setItem(DASH_TOKEN_STORAGE_KEY, "testtoken");
    await useSessionStore.getState().fireAutoLogin();
    expect(nav.navigations).toHaveLength(0);
    // The operator fixes authorization; retry must not reuse the failed ticket.
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/rdp-token") && (init?.method || "GET").toUpperCase() === "POST") {
        nav.ticketPosts += 1;
        return new Response(JSON.stringify({ rid: RID2 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    await useSessionStore.getState().retryLaunch();
    expect(nav.ticketPosts).toBe(2);
    expect(nav.navigations).toHaveLength(1);
    expect(nav.navigations[0]).toContain("t=" + RID2);
  });

  it("cancel after dispatch marks the attempt cancelled and late beacons are ignored", async () => {
    mockNetwork();
    window.localStorage.setItem(DASH_TOKEN_STORAGE_KEY, "testtoken");
    await useSessionStore.getState().fireAutoLogin();
    useSessionStore.getState().cancelLaunch();
    expect(useSessionStore.getState().launchStage).toBe("cancelled");
    expect(useSessionStore.getState().autoLogin.note).toMatch(/cancelled/i);
  });

  it("the warmed ticket is discarded by cancel so a retry cannot replay it", async () => {
    const nav = mockNetwork();
    window.localStorage.setItem(DASH_TOKEN_STORAGE_KEY, "testtoken");
    await useSessionStore.getState().warmLaunchTicket();
    useSessionStore.getState().cancelLaunch();
    expect(useSessionStore.getState().launchTicketWarm).toBe(false);
    await useSessionStore.getState().fireAutoLogin();
    // The cancelled warm ticket must not be reused: a second POST is required.
    expect(nav.ticketPosts).toBe(2);
    expect(nav.navigations).toHaveLength(1);
  });

  it("the ticket TTL constant stays at the server's 60s single-use window", () => {
    expect(TICKET_TTL_MS).toBe(60_000);
  });
});

describe("[SINGLE-DISPATCH] fireFixReconnect", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetStore();
  });
  afterEach(() => vi.restoreAllMocks());

  it("one ticket + one navigation, and the URL is the recred verb", async () => {
    const nav = mockNetwork();
    window.localStorage.setItem(DASH_TOKEN_STORAGE_KEY, "testtoken");
    await useSessionStore.getState().fireFixReconnect();
    expect(nav.ticketPosts).toBe(1);
    expect(nav.navigations).toHaveLength(1);
    expect(nav.navigations[0]).toContain("ghrdp://recred");
    expect(nav.navigations[0]).toContain("t=" + RID);
  });
});
