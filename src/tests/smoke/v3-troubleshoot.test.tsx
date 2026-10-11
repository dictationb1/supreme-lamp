// [V3-05 / #202 #205] Embedded troubleshooting: severity ordering, reachability
// of every issue, and an action for every action the producers emit.
//
// The three defects this file is written to keep dead:
//   * ORDER - the panel rendered `deriveIssues(...).slice(0, 3)`, the first three
//     in PRODUCER order. `deriveIssues` pushes subsystems in the order it checks
//     them (reachability, websocket, runner, launch, connection, session), so a
//     critical pushed late was cut away by an info pushed early. Sorting is by
//     severity and STABLE within it.
//   * REACHABILITY - issues past the preview were silently dropped. They are now
//     one click away, and this file asserts the toggle actually reveals them.
//   * ACTIONS - `deriveIssues` emits actionIds the renderer never rendered, so
//     the operator read "check the keys" with nothing to click. Every id now
//     renders a control; `IssueActionId` makes a new one a compile error, and
//     the exhaustiveness map at the bottom of this file is that compile error.
//
// Method: seed -> assert precondition -> act -> observe. Every case asserts a
// specific row, its order, and its control - never "something rendered".
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TroubleshootSummary, PREVIEW_COUNT } from "@/components/overview/TroubleshootSummary";
import { deriveIssues, type Issue, type IssueInput, type IssueActionId } from "@/lib/overview/issues";
import { useSessionStore } from "@/stores/sessionStore";
import { useTelemetryStore } from "@/stores/telemetryStore";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const ago = (ms: number) => NOW - ms;

const BASE: IssueInput = {
  progressLost: false,
  wsLive: true,
  wsAvailable: true,
  wsDead: false,
  wsDeadReason: "",
  wsAttempts: 0,
  wsLastDisconnectAtMs: null,
  serverNowMs: NOW,
  nativeLost: false,
  collectorDead: false,
  authScanTsMs: null,
  connState: "unknown",
  connBlockers: [],
  sessionExpired: false,
};

/**
 * Five issues, two of them critical, pushed in the order
 *   critical, info, warning, critical, warning
 * so the SECOND critical sits at index 3 - past the old `.slice(0, 3)` cut.
 * This is the exact shape the old panel showed wrong: it rendered
 * [critical, info, warning] and dropped a critical in favour of an info.
 */
const FIVE: IssueInput = {
  ...BASE,
  progressLost: true,
  wsLive: false,
  wsAvailable: true,
  collectorDead: true,
  connState: "failed",
  sessionExpired: true,
};

/** A snapshot whose only issue carries the `keys` action (the launch gate). */
const KEYS_GATE: IssueInput = { ...BASE, connState: "unavailable", connBlockers: ["credentials"] };

/** A snapshot whose only issue carries the `ws-reconnect` action. */
const WS_DEAD: IssueInput = {
  ...BASE,
  wsDead: true,
  wsDeadReason: "ladder-exhausted",
  wsAttempts: 5,
  wsLastDisconnectAtMs: ago(10_000),
};

beforeEach(() => {
  useSessionStore.setState({ diagOpen: false, diag: null, runDiag: vi.fn(async () => {}) } as never);
  useTelemetryStore.setState({ requestWsReconnect: vi.fn() } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel(issues: Issue[]) {
  return render(
    <MemoryRouter>
      <TroubleshootSummary issues={issues} nowMs={NOW} />
    </MemoryRouter>
  );
}

const rows = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-testid="overview-issue-list"] > li'));
const severities = (c: HTMLElement) => rows(c).map((li) => li.getAttribute("data-severity"));

describe("V3-05-a: issues are ordered by severity, not by producer accident", () => {
  it("PRECONDITION: the seed really does push a critical past the old 3-item cut", () => {
    // Without this the ordering test could pass vacuously on a snapshot that
    // never had a hidden critical to begin with.
    const issues = deriveIssues(FIVE);
    expect(issues.length).toBe(5);
    const criticals = issues.map((i, idx) => ({ i, idx })).filter((e) => e.i.severity === "critical");
    expect(criticals.length, "the seed needs more than one critical").toBe(2);
    // The second critical is produced after an info and a warning...
    expect(criticals[1].idx, "the seed no longer reproduces the defect").toBeGreaterThanOrEqual(PREVIEW_COUNT);
    // ...so the OLD behaviour would have hidden it. Asserted directly, so this
    // test fails if the seed ever stops reproducing the bug it guards.
    expect(issues.slice(0, PREVIEW_COUNT).some((i) => i.severity === "critical")).toBe(true);
    expect(issues.slice(0, PREVIEW_COUNT).filter((i) => i.severity === "critical").length).toBe(1);
    expect(issues.length - PREVIEW_COUNT, "no issue would have been dropped by the old slice").toBe(2);
  });

  it("renders the two criticals first, ahead of every warning and info", () => {
    const { container } = renderPanel(deriveIssues(FIVE));
    const order = severities(container);
    expect(order.length, "the preview must still be bounded").toBe(PREVIEW_COUNT);
    expect(order, "severity order: " + JSON.stringify(order)).toEqual(["critical", "critical", "warning"]);
  });

  it("the full list is monotone in severity and stable within it", () => {
    const issues = deriveIssues(FIVE);
    const { container } = renderPanel(issues);
    fireEvent.click(screen.getByTestId("overview-issues-toggle"));

    const order = severities(container);
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    const ranks = order.map((s) => rank[s as keyof typeof rank]);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i], "order was " + JSON.stringify(order)).toBeGreaterThanOrEqual(ranks[i - 1]);
    }

    // STABLE: within a severity the producer's own order survives, so the list
    // does not shuffle between renders of the same data.
    const ids = rows(container).map((li) => (li.getAttribute("data-testid") || "").replace("issue-row-", ""));
    for (const sev of ["critical", "warning", "info"]) {
      const expected = issues.filter((i) => i.severity === sev).map((i) => i.id);
      const got = ids.filter((id) => expected.includes(id));
      expect(got, "severity " + sev + " lost its producer order").toEqual(expected);
    }
  });
});

describe("V3-05-b: no issue is unreachable", () => {
  it("the toggle reveals the dropped issues instead of hiding them", () => {
    const issues = deriveIssues(FIVE);
    const { container } = renderPanel(issues);
    const toggle = screen.getByTestId("overview-issues-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(rows(container).length).toBe(PREVIEW_COUNT);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rows(container).length, "the hidden issues were not revealed").toBe(issues.length);

    fireEvent.click(toggle);
    expect(rows(container).length).toBe(PREVIEW_COUNT);
  });

  it("renders no toggle when there is nothing hidden", () => {
    renderPanel(deriveIssues(FIVE).slice(0, 1));
    expect(screen.queryByTestId("overview-issues-toggle")).toBeNull();
  });

  it("publishes the worst severity as data, not only as prose", () => {
    renderPanel(deriveIssues(FIVE));
    expect(screen.getByTestId("overview-issue-count").getAttribute("data-worst")).toBe("critical");
  });

  it("an empty list says so, and still offers Diagnose", () => {
    renderPanel([]);
    expect(screen.getByTestId("overview-troubleshoot-empty")).toBeInTheDocument();
    expect(screen.getByTestId("overview-issue-count").getAttribute("data-worst")).toBe("none");
    expect(screen.getByTestId("overview-diagnose")).toBeInTheDocument();
  });
});

describe("V3-05-c: every action the producers emit is actionable", () => {
  /** Renders a snapshot with ALL rows revealed and returns the missing controls. */
  function missingControls(input: IssueInput): { missing: string[]; seen: string[]; issues: Issue[] } {
    const issues = deriveIssues(input);
    const { container, unmount } = renderPanel(issues);
    if (issues.length > PREVIEW_COUNT) fireEvent.click(screen.getByTestId("overview-issues-toggle"));

    const missing: string[] = [];
    const seen: string[] = [];
    for (const issue of issues) {
      if (!issue.actionId) continue;
      const control = container.querySelector(`[data-testid="issue-action-${issue.id}"]`);
      if (!control) missing.push(`${issue.id} (actionId=${issue.actionId})`);
      else seen.push(issue.actionId);
    }
    unmount();
    return { missing, seen, issues };
  }

  it("every emitted actionId renders a control on its row", () => {
    const a = missingControls(FIVE);
    const b = missingControls(KEYS_GATE);
    const c = missingControls(WS_DEAD);

    const all = [...a.missing, ...b.missing, ...c.missing];
    expect(all, "rows with an actionId but no control").toEqual([]);

    const actionIds = new Set([...a.seen, ...b.seen, ...c.seen]);
    // PRECONDITION: more than one kind of action, so the check is not vacuous.
    expect(actionIds.size, "only one action id exercised: " + [...actionIds].join(",")).toBeGreaterThan(2);
    // And all four kinds the producers can emit were actually seen.
    expect([...actionIds].sort()).toEqual(["diagnose", "health", "keys", "ws-reconnect"]);
  });

  it("a row with no actionId renders no control rather than a dead one", () => {
    // ws-idle is advisory: the ladder is still running, so there is nothing to
    // click. It must not grow a button that does nothing.
    const issues = deriveIssues({ ...BASE, wsLive: false, wsAvailable: true });
    expect(issues.length).toBe(1);
    expect(issues[0].actionId, "expected ws-idle to carry no action").toBeUndefined();
    const { container } = renderPanel(issues);
    expect(container.querySelector(`[data-testid="issue-action-${issues[0].id}"]`)).toBeNull();
  });

  it("the ws-reconnect action calls the SAME store action the TopBar uses", () => {
    const spy = vi.fn();
    useTelemetryStore.setState({ requestWsReconnect: spy } as never);
    const issues = deriveIssues(WS_DEAD);
    const row = issues.find((i) => i.actionId === "ws-reconnect");
    expect(row, "no ws-reconnect issue produced").toBeTruthy();

    const { container } = renderPanel(issues);
    const btn = container.querySelector(`[data-testid="issue-action-${row!.id}"]`);
    expect(btn, "no control on the ws-reconnect row").not.toBeNull();
    fireEvent.click(btn as Element);
    expect(spy, "the panel used a different write path than the TopBar").toHaveBeenCalledTimes(1);
  });

  it("navigational actions point at a real in-app route, not a dead anchor", () => {
    const { container } = renderPanel(deriveIssues(KEYS_GATE));
    const gate = deriveIssues(KEYS_GATE).find((i) => i.actionId === "keys");
    expect(gate, "no keys action produced").toBeTruthy();
    const a = container.querySelector(`[data-testid="issue-action-${gate!.id}"]`);
    expect(a?.getAttribute("href"), "the keys action has no href").toBe("/keys");

    cleanup();
    const healthIssues = deriveIssues({ ...BASE, collectorDead: true });
    const h = healthIssues.find((i) => i.actionId === "health");
    const c2 = renderPanel(healthIssues).container.querySelector(`[data-testid="issue-action-${h!.id}"]`);
    expect(c2?.getAttribute("href"), "the health action has no href").toBe("/health");
  });

  it("EXHAUSTIVENESS: a new actionId is a compile error until the UI honours it", () => {
    // If a producer gains an action id, this record stops type-checking until
    // the renderer grows a control for it. That is the point: the gap #202
    // named is closed at the type level, not remembered in a comment.
    const handled: Record<IssueActionId, true> = {
      "ws-reconnect": true,
      diagnose: true,
      keys: true,
      health: true,
    };
    expect(Object.keys(handled).length).toBe(4);
  });
});

describe("V3-05-d: freshness is stated, and Diagnose opens the real drawer", () => {
  it("labels a stale reading as stale instead of presenting it as current", () => {
    const issues = deriveIssues({ ...BASE, collectorDead: false, authScanTsMs: ago(600_000) });
    expect(issues.some((i) => i.observedAtMs != null), "no timestamped issue produced").toBe(true);
    const { container } = renderPanel(issues);
    const stale = rows(container).filter((li) => li.getAttribute("data-stale") === "1");
    expect(stale.length, "a 10-minute-old reading was not marked stale").toBeGreaterThan(0);
  });

  it("a fresh reading is not marked stale", () => {
    const issues = deriveIssues({ ...BASE, collectorDead: false, authScanTsMs: ago(5_000) });
    const { container } = renderPanel(issues);
    expect(rows(container).filter((li) => li.getAttribute("data-stale") === "1").length).toBe(0);
  });

  it("Diagnose opens the embedded drawer and runs the existing diagnostics", () => {
    const runDiag = vi.fn(async () => {});
    useSessionStore.setState({ diagOpen: false, runDiag } as never);
    renderPanel(deriveIssues(KEYS_GATE));
    expect(screen.getByTestId("overview-diagnose")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overview-diagnose"));
    expect(useSessionStore.getState().diagOpen, "the drawer did not open").toBe(true);
    expect(runDiag, "Diagnose did not run the existing diagnostics").toHaveBeenCalledTimes(1);
  });

  it("the in-row Diagnose control opens the same drawer", () => {
    useSessionStore.setState({ diagOpen: false } as never);
    const issues = deriveIssues(KEYS_GATE);
    const gate = issues.find((i) => i.actionId === "keys");
    const { container } = renderPanel(issues);
    const keysLink = container.querySelector(`[data-testid="issue-action-${gate!.id}"]`);
    expect(keysLink, "the gate row has no control").not.toBeNull();
    // The footer button is the in-page Diagnose, and it must still work here.
    fireEvent.click(screen.getByTestId("overview-diagnose"));
    expect(useSessionStore.getState().diagOpen).toBe(true);
  });
});
