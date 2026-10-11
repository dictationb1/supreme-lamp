// [V3-01 / V3-06] The v3 shell contract.
//
// WHY THIS FILE EXISTS. The redesign was previously only *true of Overview*:
// every other route invented its own header, and the material system was one
// blurred top bar over content that painted at a flat 0.86. These cases pin the
// two things that make v3 a product rather than a page:
//   1. EVERY route renders the shared PageHeader with a name and a purpose;
//   2. the app paints exactly ONE steady-state backdrop-sampling surface.
//
// Method follows #202's rule: seed -> assert precondition -> act -> observe.
// Where a control is absent the test FAILS; it never falls back to asserting
// something weaker that happens to be present.
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { useSidebarStore, useGlassStore } from "@/stores/prefsStore";
import { __setSupportsBackdropFilter } from "@/lib/glass/quality";

/** jsdom has no fetch; the shell polls on mount. */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "" }))
  );
}

const ROUTES: { hash: string; testId: string; label: RegExp }[] = [
  { hash: "#/", testId: "overview-header", label: /overview/i },
  { hash: "#/sessions", testId: "page-sessions", label: /sessions/i },
  { hash: "#/connections", testId: "page-connections", label: /connections/i },
  { hash: "#/keys", testId: "page-keys", label: /keys/i },
  { hash: "#/files", testId: "page-files", label: /file explorer/i },
  { hash: "#/mirror", testId: "page-mirror", label: /mirror/i },
  { hash: "#/search", testId: "page-search", label: /search/i },
  { hash: "#/telemetry", testId: "page-telemetry", label: /telemetry/i },
  { hash: "#/health", testId: "page-health", label: /health/i },
  { hash: "#/collector", testId: "page-collector", label: /collector/i },
  { hash: "#/settings", testId: "page-settings", label: /settings/i },
];

beforeEach(() => {
  window.localStorage.clear();
  __setSupportsBackdropFilter(true);
  useSidebarStore.setState({ mobileOpen: false, collapsed: false });
  useGlassStore.setState({ quality: "auto", clarity: 0.75, variant: "tinted" });
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __setSupportsBackdropFilter(null);
  window.location.hash = "";
});

describe("V3-01-a: every route opens with the shared page identity", () => {
  it.each(ROUTES)("$hash renders a PageHeader with a title and a purpose", ({ hash, testId, label }) => {
    window.location.hash = hash;
    const { unmount } = render(<App />);
    const header = screen.getByTestId(testId);
    // Precondition: the header labels its own region, so the title is its name.
    const headingId = header.getAttribute("aria-labelledby");
    expect(headingId, `${testId} has no aria-labelledby`).toBeTruthy();
    const heading = document.getElementById(headingId as string);
    expect(heading, `${testId} labels a node that does not exist`).not.toBeNull();
    expect((heading?.textContent || "").trim()).toMatch(label);
    // The purpose line is what the old pages lacked entirely.
    const subtitle = within(header).getByTestId(testId + "-subtitle");
    expect((subtitle.textContent || "").trim().length, `${testId} subtitle is empty`).toBeGreaterThan(10);
    unmount();
  });

  it("the page name is rendered ONCE per route - no duplicated hero", () => {
    window.location.hash = "#/files";
    render(<App />);
    // The old Explorer opened with an <h1> title AND a description paragraph;
    // the shared header replaced both, so no h1/h2 pair repeats the name.
    const headings = Array.from(document.querySelectorAll("h1, h2")).map((h) => (h.textContent || "").trim());
    const explorer = headings.filter((h) => /file explorer/i.test(h));
    expect(explorer.length, "the page title is duplicated: " + JSON.stringify(headings)).toBe(1);
  });
});

describe("V3-01-b: the material stack is one shared sampling surface", () => {
  it("paints exactly one sheet, and nothing else samples the backdrop", () => {
    window.location.hash = "#/";
    const { container } = render(<App />);
    const sheets = container.querySelectorAll('[data-glass-level="sheet"]');
    expect(sheets.length, "there must be exactly one app glass sheet").toBe(1);
    expect(sheets[0].getAttribute("data-glass-samples")).toBe("1");

    const samplers = container.querySelectorAll('[data-glass-samples="1"]');
    expect(samplers.length, "more than one element owns a backdrop filter").toBe(1);
  });

  it("every content panel is paint-only", () => {
    window.location.hash = "#/settings";
    const { container } = render(<App />);
    const cards = container.querySelectorAll('[data-glass-level="card"]');
    expect(cards.length, "expected content panels on Settings").toBeGreaterThan(0);
    for (const c of Array.from(cards)) {
      expect(c.getAttribute("data-glass-samples"), c.outerHTML.slice(0, 80)).toBe("0");
    }
  });

  it("the sheet sits between the decorative field and the content", () => {
    window.location.hash = "#/";
    const { container } = render(<App />);
    const field = container.querySelector('[data-testid="app-backdrop"]');
    const sheet = container.querySelector('[data-testid="app-glass-sheet"]');
    expect(field, "the decorative field is missing").not.toBeNull();
    expect(sheet, "the app glass sheet is missing").not.toBeNull();
    // Document order is the paint order here: field, then sheet, then content.
    const order = Array.from(container.querySelectorAll('[data-testid="app-backdrop"], [data-testid="app-glass-sheet"]'));
    expect(order[0].getAttribute("data-testid")).toBe("app-backdrop");
    expect(order[1].getAttribute("data-testid")).toBe("app-glass-sheet");
  });

  it("opaque mode removes the sheet as well as the field", () => {
    useGlassStore.setState({ quality: "opaque" });
    window.location.hash = "#/";
    const { container } = render(<App />);
    expect(container.querySelector('[data-testid="app-glass-sheet"]')).toBeNull();
    expect(container.querySelector('[data-testid="app-backdrop"]')).toBeNull();
    // ...and what is left still has content.
    expect(screen.getByTestId("overview-header")).toBeInTheDocument();
  });
});

describe("V3-01-c: navigation is grouped without breaking the locked contract", () => {
  const NAV_ORDER = [
    "/", "/search", "/sessions", "/connections", "/keys",
    "/files", "/mirror", "/telemetry", "/health", "/collector", "/settings",
  ];

  it("still renders exactly 11 links in the locked order", () => {
    window.location.hash = "#/";
    const { container } = render(<App />);
    const nav = container.querySelector('[data-testid="sidebar"] nav');
    const links = Array.from(nav?.querySelectorAll("a") || []);
    expect(links.length).toBe(11);
    expect(links.map((a) => (a.getAttribute("href") || "").replace(/^#/, ""))).toEqual(NAV_ORDER);
  });

  it("renders four labelled groups, and together they hold all 11 destinations", () => {
    window.location.hash = "#/";
    const { container } = render(<App />);
    const groups = ["nav-group-operate", "nav-group-access", "nav-group-data", "nav-group-system"];
    let seen: string[] = [];
    for (const g of groups) {
      const el = container.querySelector(`[data-testid="${g}"]`);
      expect(el, "missing nav group " + g).not.toBeNull();
      seen = seen.concat(
        Array.from(el!.querySelectorAll("a")).map((a) => (a.getAttribute("href") || "").replace(/^#/, ""))
      );
    }
    expect(seen).toEqual(NAV_ORDER);
  });

  it("each group is announced, so a collapsed rail keeps its structure", () => {
    useSidebarStore.setState({ collapsed: true });
    window.location.hash = "#/";
    const { container } = render(<App />);
    const lists = container.querySelectorAll('[data-testid^="nav-group-"] ul[aria-label]');
    expect(lists.length, "collapsed groups must still be labelled").toBe(4);
  });
});

describe("V3-01-d: the compact status header", () => {
  it("exposes one glanceable indicator and hides the detail until it is asked for", () => {
    window.location.hash = "#/";
    render(<App />);
    const summary = screen.getByTestId("topbar-status-summary");
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(summary.getAttribute("aria-controls") as string);
    expect(panel, "the disclosure points at a panel that does not exist").not.toBeNull();
    // The producers are still in the DOM - moved, not deleted.
    for (const id of ["pillConn", "pillMirror", "pillWatcher", "pillRust", "pillClock"]) {
      expect(document.getElementById(id), id + " was removed from the product").not.toBeNull();
    }
  });
});
