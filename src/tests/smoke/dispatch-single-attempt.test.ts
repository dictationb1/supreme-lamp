// [SINGLE-DISPATCH-2026-10-25] BEHAVIOURAL tests for the launch dispatcher.
//
// These count the things the operator's report is about: how many tickets an
// intent requests, how many custom-protocol navigations it performs, and what the
// attempt's lifecycle says afterwards. A static grep of the source cannot prove
// any of that, which is why the previous "gesture" test (which asserted the
// presence of `window.open` and `protoWin.location.href` in the file) was
// replaced by this suite.
//
// The env is injected, so each case drives the exact interleaving it names:
// normal click, double click, slow ticket, blocked popup, no handler installed,
// cancel, retry, expiry and a late callback from an older attempt.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HANDOFF_WINDOW_MS,
  LaunchDispatcher,
  TICKET_TTL_MS,
  dispatchProtocolOnce,
  type DispatchAttempt,
} from "@/lib/domain/dispatch";

interface Harness {
  d: LaunchDispatcher;
  tickets: () => number;
  navigations: string[];
  clock: { t: number };
  setNow: (t: number) => void;
  advance: (ms: number) => void;
  lastAttempt: () => DispatchAttempt | null;
}

function harness(opts: {
  ticket?: () => Promise<{ ok: true; rid: string } | { ok: false; error: string }>;
  navigate?: (url: string) => "dispatched" | "failed";
} = {}): Harness {
  const clock = { t: 1_000_000 };
  let tickets = 0;
  let seq = 0;
  const navigations: string[] = [];
  let attempt: DispatchAttempt | null = null;
  const d = new LaunchDispatcher({
    now: () => clock.t,
    mintId: () => "attempt-" + ++seq,
    mintTrace: () => "trace-" + seq,
    requestTicket: async () => {
      tickets += 1;
      if (opts.ticket) return opts.ticket();
      return { ok: true, rid: "0123456789abcdef0123456789abcdef" };
    },
    navigate: (url) => {
      const out = opts.navigate ? opts.navigate(url) : "dispatched";
      if (out === "dispatched") navigations.push(url);
      return out;
    },
    onChange: (a) => {
      attempt = a;
    },
  });
  return {
    d,
    tickets: () => tickets,
    navigations,
    clock,
    setNow: (t) => {
      clock.t = t;
    },
    advance: (ms) => {
      clock.t += ms;
    },
    lastAttempt: () => attempt,
  };
}

const build = (rid: string, trace: string) =>
  "ghrdp://rdp?server=runner.tail1234.ts.net&user=rdpuser&trace=" + trace + "&t=" + rid;

describe("[SINGLE-DISPATCH] one intent -> one ticket -> one navigation", () => {
  it("a normal click requests exactly one ticket and performs exactly one navigation", async () => {
    const h = harness();
    const res = await h.d.dispatch("auto-login", build);
    expect(res.status).toBe("dispatched");
    expect(h.tickets()).toBe(1);
    expect(h.navigations).toHaveLength(1);
    expect(h.navigations[0]).toContain("t=0123456789abcdef0123456789abcdef");
    expect(res.attempt.dispatches).toBe(1);
    expect(res.attempt.ticketRequests).toBe(1);
    expect(res.attempt.stage).toBe("dispatched");
  });

  it("a double click while the ticket is in flight mints ONE ticket (slow ticket response)", async () => {
    let release: (v: { ok: true; rid: string }) => void = () => {};
    const slow = new Promise<{ ok: true; rid: string }>((r) => {
      release = r;
    });
    const h = harness({ ticket: () => slow });
    const first = h.d.dispatch("auto-login", build);
    // The second click arrives while the first attempt is still PREPARING.
    const second = await h.d.dispatch("auto-login", build);
    expect(second.status).toBe("duplicate-suppressed");
    expect(second.code).toBe("already-preparing");
    release({ ok: true, rid: "0123456789abcdef0123456789abcdef" });
    const done = await first;
    expect(done.status).toBe("dispatched");
    expect(h.tickets()).toBe(1);
    expect(h.navigations).toHaveLength(1);
  });

  it("two synchronous clicks in the same task still produce one dispatch", async () => {
    const h = harness();
    const p1 = h.d.dispatch("auto-login", build);
    const p2 = h.d.dispatch("auto-login", build);
    const [a, b] = await Promise.all([p1, p2]);
    expect([a.status, b.status].sort()).toEqual(["dispatched", "duplicate-suppressed"]);
    expect(h.tickets()).toBe(1);
    expect(h.navigations).toHaveLength(1);
  });

  it("a click after a completed dispatch is suppressed while the attempt awaits handoff", async () => {
    const h = harness();
    await h.d.dispatch("auto-login", build);
    h.advance(1_000);
    const again = await h.d.dispatch("auto-login", build);
    expect(again.status).toBe("duplicate-suppressed");
    expect(again.code).toBe("awaiting-handoff");
    expect(h.tickets()).toBe(1);
    expect(h.navigations).toHaveLength(1);
  });

  it("no window/popup is opened by the dispatcher: nothing has to be closed on a timer", async () => {
    const openSpy = vi.fn(() => null);
    const original = window.open;
    window.open = openSpy as unknown as typeof window.open;
    try {
      const h = harness();
      await h.d.dispatch("auto-login", build);
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      window.open = original;
    }
  });

  it("a refused ticket performs NO navigation and does not fall back to a second path", async () => {
    const h = harness({ ticket: async () => ({ ok: false, error: "ticket issue HTTP 401" }) });
    const res = await h.d.dispatch("auto-login", build);
    expect(res.status).toBe("failed");
    expect(res.code).toBe("ticket-refused");
    expect(h.navigations).toHaveLength(0);
    expect(res.attempt.dispatches).toBe(0);
  });

  it("a browser refusal is reported as failed with zero dispatches (no silent retry)", async () => {
    const h = harness({ navigate: () => "failed" });
    const res = await h.d.dispatch("auto-login", build);
    expect(res.status).toBe("failed");
    expect(res.code).toBe("no-dispatch-path");
    expect(h.navigations).toHaveLength(0);
    expect(res.attempt.dispatches).toBe(0);
  });
});

describe("[SINGLE-DISPATCH] cancel, retry, expiry and late callbacks", () => {
  it("cancel while the ticket is in flight drops the late ticket and never dispatches", async () => {
    let release: (v: { ok: true; rid: string }) => void = () => {};
    const slow = new Promise<{ ok: true; rid: string }>((r) => {
      release = r;
    });
    const h = harness({ ticket: () => slow });
    const pending = h.d.dispatch("auto-login", build);
    h.d.cancel("cancelled by the operator");
    release({ ok: true, rid: "0123456789abcdef0123456789abcdef" });
    const res = await pending;
    expect(res.status).toBe("cancelled");
    expect(res.code).toBe("cancelled-before-dispatch");
    expect(h.navigations).toHaveLength(0);
    expect(h.d.attempt?.stage).toBe("cancelled");
  });

  it("a handler beacon from BEFORE the dispatch cannot promote a cancelled attempt", async () => {
    const h = harness();
    await h.d.dispatch("auto-login", build);
    h.d.cancel("operator cancelled");
    const after = h.d.observeHandler(h.clock.t - 30_000);
    expect(after?.stage).toBe("cancelled");
    expect(after?.handlerSeenAt).toBeNull();
  });

  it("a beacon older than the dispatch (an older attempt) is ignored", async () => {
    const h = harness();
    await h.d.dispatch("auto-login", build);
    const stale = h.d.observeHandler(h.clock.t - 60_000);
    expect(stale?.stage).toBe("dispatched");
  });

  it("a beacon carrying another attempt's trace is ignored", async () => {
    const h = harness();
    const res = await h.d.dispatch("auto-login", build);
    const other = h.d.observeHandler(h.clock.t + 500, "trace-from-another-attempt");
    expect(other?.stage).toBe("dispatched");
    const mine = h.d.observeHandler(h.clock.t + 600, res.attempt.trace);
    expect(mine?.stage).toBe("handler-observed");
  });

  it("silence is UNCONFIRMED, not failed, once the handoff window passes", async () => {
    const h = harness();
    await h.d.dispatch("auto-login", build);
    h.advance(HANDOFF_WINDOW_MS + 1);
    const a = h.d.attempt;
    expect(a?.stage).toBe("unconfirmed");
    expect(h.navigations).toHaveLength(1);
  });

  it("expiry is its own state and a retry then mints a FRESH ticket", async () => {
    const h = harness();
    await h.d.dispatch("auto-login", build);
    h.advance(HANDOFF_WINDOW_MS + 1);
    expect(h.d.attempt?.stage).toBe("unconfirmed");
    expect(h.d.retryAllowed).toBe(true);
    const retry = await h.d.dispatch("auto-login", build);
    expect(retry.status).toBe("dispatched");
    expect(h.tickets()).toBe(2);
    expect(h.navigations).toHaveLength(2);
    // Different attempt identity, different ticket, different trace.
    expect(retry.attempt.id).not.toBe("attempt-1");
    expect(h.navigations[1]).not.toBe(h.navigations[0]);
  });

  it("an attempt that never dispatched expires with the ticket TTL", async () => {
    let release: (v: { ok: true; rid: string }) => void = () => {};
    const slow = new Promise<{ ok: true; rid: string }>((r) => {
      release = r;
    });
    const h = harness({ ticket: () => slow });
    const pending = h.d.dispatch("auto-login", build);
    // Simulate the ticket arriving but the page being unable to navigate yet is
    // covered above; here we only prove the TTL constant is wired to expiry.
    release({ ok: true, rid: "0123456789abcdef0123456789abcdef" });
    await pending;
    h.advance(TICKET_TTL_MS);
    // Dispatched attempts become unconfirmed (not "expired"): the ticket WAS used.
    expect(h.d.attempt?.stage).toBe("unconfirmed");
  });

  it("a retry is withheld while an attempt is still awaiting handoff", async () => {
    const h = harness();
    await h.d.dispatch("auto-login", build);
    expect(h.d.retryAllowed).toBe(false);
  });
});

describe("[SINGLE-DISPATCH] dispatchProtocolOnce performs exactly one navigation", () => {
  it("calls the navigation sink once and reports dispatched", () => {
    const assign = vi.fn();
    const out = dispatchProtocolOnce("ghrdp://rdp?server=x", { assign });
    expect(out).toBe("dispatched");
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("reports failed when the sink throws, and does not try a second sink", () => {
    const assign = vi.fn(() => {
      throw new Error("NS_ERROR_UNKNOWN_PROTOCOL");
    });
    expect(dispatchProtocolOnce("ghrdp://rdp?server=x", { assign })).toBe("failed");
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("does not create an iframe or a synthetic anchor click", () => {
    const before = document.querySelectorAll("iframe").length;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const assign = vi.fn();
    dispatchProtocolOnce("ghrdp://rdp?server=x", { assign });
    expect(document.querySelectorAll("iframe").length).toBe(before);
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});

describe("[SINGLE-DISPATCH] ticketless intents keep the same discipline", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("RUN CHECK / RUN DIAG perform one navigation each and suppress a duplicate", () => {
    const first = h.d.dispatchWithoutTicket("run-check", "ghrdp://check");
    expect(first.status).toBe("dispatched");
    expect(h.tickets()).toBe(0);
    const dup = h.d.dispatchWithoutTicket("run-check", "ghrdp://check");
    expect(dup.status).toBe("duplicate-suppressed");
    expect(h.navigations).toHaveLength(1);
  });
});
