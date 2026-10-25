// [SINGLE-DISPATCH-2026-10-25] ONE EXPLICIT USER INTENT -> ONE DISPATCH.
//
// WHAT WAS WRONG (confirmed in the supplied revision, not a hypothesis).
//
// `fireAutoLogin()` opened a blank popup, awaited a ticket, assigned the
// `ghrdp://` URL to that popup AND THEN called `launchProto(ghrdpUrl)` - which
// itself appended a hidden iframe with the SAME protocol URL and, 150 ms later,
// synthesized a click on a fresh anchor pointing at the SAME URL. One click could
// therefore reach the browser's external-protocol handler up to three times.
// `fireFixReconnect()` had the same shape. The comment above the anchor click
// claimed the second dispatch was "harmless because the ticket is single-use" -
// that argument is not accepted here: a redeemed ticket turns the second
// navigation into a rejected attempt, which is exactly the state that makes
// Windows fall back to an interactive prompt, and it also produces duplicate
// "Open ghrdp-rdp-launcher?" prompts.
//
// WHAT THIS MODULE IS. A small, DOM-free state machine for one launch attempt,
// plus a single `dispatchProtocolOnce()` that can never navigate twice.
//
// CONTRACT
//   * one attempt identity per explicit user intent (click);
//   * one ticket acquisition per attempt, counted;
//   * at most one custom-protocol navigation per attempt, counted;
//   * no speculative automatic second dispatch, ever;
//   * a rapid duplicate click (double click, key repeat, impatient operator)
//     while an attempt is PREPARING or AWAITING HANDOFF is suppressed and
//     reported - it does not mint another ticket;
//   * a retry is a NEW attempt with a FRESH ticket, and it is only offered after
//     a demonstrable failure (ticket refused, no dispatch path) or when the
//     previous attempt ended in an honest non-terminal state
//     (unconfirmed / expired / cancelled);
//   * late callbacks from an older attempt can never overwrite a newer one;
//   * closing an owned helper window is only ever done for a helper this module
//     opened AND before any permission prompt can be pending - never on an
//     arbitrary timer.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not claim that assigning a location
// proves the external application opened. `dispatched` means "the browser was
// asked once"; the OS/browser exposes no callback for "the handler ran", so the
// attempt ends in `unconfirmed` unless a handler beacon or a correlated logon is
// observed.

/** What the operator asked for. One intent = one attempt. */
export type LaunchIntent = "auto-login" | "fix-reconnect" | "run-check" | "run-diag" | "native-connect";

/**
 * The attempt lifecycle, exactly as the application can observe it.
 *
 * `awaiting-handoff` and `unconfirmed` exist because the browser/OS boundary is
 * opaque: after a custom-protocol navigation the page cannot know whether the
 * protocol handler ran, whether a consent prompt is still open, or whether the
 * operator cancelled the native dialog. Those cases are NOT failures and are
 * NOT cancellations - they are unknown, and the UI must say so.
 */
export type AttemptStage =
  | "idle"
  | "preparing"
  | "ticket-issued"
  | "dispatched"
  | "handler-observed"
  | "connected"
  | "cancelled"
  | "failed"
  | "expired"
  | "unconfirmed";

/** Server-issued single-use ticket (60 s). Never logged, never rendered. */
export interface AttemptTicket {
  rid: string;
  trace: string;
  issuedAt: number;
  expiresAt: number;
}

export interface AttemptFailure {
  /** Stable machine code the UI can translate: ticket-refused | no-dispatch-path | ... */
  code: string;
  /** Human detail (already safe - never contains a ticket or a password). */
  detail: string;
}

export interface DispatchAttempt {
  id: string;
  intent: LaunchIntent;
  stage: AttemptStage;
  createdAt: number;
  updatedAt: number;
  trace: string;
  ticket: AttemptTicket | null;
  /** How many tickets this attempt asked the server for. Always 0 or 1. */
  ticketRequests: number;
  /** How many custom-protocol navigations this attempt performed. Always 0 or 1. */
  dispatches: number;
  dispatchedAt: number | null;
  handlerSeenAt: number | null;
  connectedAt: number | null;
  cancelledAt: number | null;
  failure: AttemptFailure | null;
  /** Why the attempt was suppressed/superseded, when it was. */
  note: string;
  /** The attempt that replaced this one, if any. */
  supersededBy: string | null;
}

export interface DispatchResult {
  /** `dispatched` is the only status that means the browser was asked once. */
  status: "dispatched" | "duplicate-suppressed" | "cancelled" | "failed";
  attempt: DispatchAttempt;
  /** Stable code for the UI/i18n layer. */
  code?:
    | "already-preparing"
    | "awaiting-handoff"
    | "cancelled-before-dispatch"
    | "ticket-refused"
    | "no-dispatch-path";
}

/** The server's ticket lifetime. A ticket is single-use and dies after 60 s. */
export const TICKET_TTL_MS = 60_000;
/**
 * How long an attempt stays "awaiting handoff" before the outcome is called
 * unconfirmed. This is the launcher-beacon window (the store arms a 20 s watch),
 * after which silence means "unknown", not "failed".
 */
export const HANDOFF_WINDOW_MS = 20_000;
/** A beacon timestamp further than this before the dispatch cannot belong to it. */
export const BEACON_SKEW_MS = 10_000;
/** The terminal states a retry is allowed from. */
const TERMINAL: AttemptStage[] = ["cancelled", "failed", "expired", "unconfirmed", "connected"];

/** Everything the dispatcher needs from the outside world (injectable = testable). */
export interface DispatchEnv {
  now(): number;
  mintId(): string;
  mintTrace(): string;
  /** POST /api/rdp-token. Called exactly once per attempt that gets this far. */
  requestTicket(): Promise<{ ok: true; rid: string } | { ok: false; error: string }>;
  /**
   * Perform ONE custom-protocol navigation. Implementations must not fall back to
   * a second navigation path: a pre-dispatch failure returns "failed" and the
   * attempt stops there (the operator may then explicitly retry with a fresh
   * ticket).
   */
  navigate(url: string): "dispatched" | "failed";
  /** Called when the attempt produced its final answer for this attempt. */
  onChange?(attempt: DispatchAttempt): void;
}

function clone(a: DispatchAttempt): DispatchAttempt {
  return { ...a, ticket: a.ticket ? { ...a.ticket } : null, failure: a.failure ? { ...a.failure } : null };
}

/**
 * One dispatcher per page. Holds the current attempt plus a short history so the
 * UI can show what happened without inventing anything.
 */
export class LaunchDispatcher {
  private current: DispatchAttempt | null = null;
  private history: DispatchAttempt[] = [];
  private readonly env: DispatchEnv;
  /** Attempt ids explicitly cancelled by the operator (late callbacks drop). */
  private readonly cancelled = new Set<string>();

  constructor(env: DispatchEnv) {
    this.env = env;
  }

  private emit(a: DispatchAttempt | null): DispatchAttempt | null {
    if (a && this.env.onChange) {
      try {
        this.env.onChange(clone(a));
      } catch {
        /* the UI must never break the dispatch path */
      }
    }
    return a ? clone(a) : null;
  }

  private push(a: DispatchAttempt): void {
    this.history.push(clone(a));
    if (this.history.length > 20) this.history.shift();
  }

  /** The attempt the UI should describe right now (null before any click). */
  get attempt(): DispatchAttempt | null {
    if (!this.current) return null;
    this.expireIfDue(this.env.now());
    return clone(this.current);
  }

  get attempts(): DispatchAttempt[] {
    return this.history.map(clone);
  }

  /**
   * In flight = a click that has not reached a terminal state yet.
   * PREPARING blocks a second click for as long as the ticket request runs (the
   * slow-ticket case), so a double click cannot mint two tickets.
   */
  private inFlight(now: number): DispatchAttempt | null {
    const a = this.current;
    if (!a) return null;
    if (a.stage === "preparing" || a.stage === "ticket-issued") return a;
    if (a.stage === "dispatched" || a.stage === "handler-observed" || a.stage === "connected") {
      const since = a.dispatchedAt ?? a.createdAt;
      if (now - since < HANDOFF_WINDOW_MS) return a;
    }
    return null;
  }

  /**
   * Move an attempt forward when its own deadlines pass. Called from every read
   * path, so the UI never shows a stale stage.
   */
  private expireIfDue(now: number): void {
    const a = this.current;
    if (!a) return;
    if (a.stage === "ticket-issued" && a.ticket && now > a.ticket.expiresAt) {
      a.stage = "expired";
      a.updatedAt = now;
      a.note = "the ticket expired before the browser was asked - click again for a fresh ticket";
      this.emit(a);
      return;
    }
    if (a.stage === "dispatched" && a.dispatchedAt != null && now - a.dispatchedAt >= HANDOFF_WINDOW_MS) {
      a.stage = "unconfirmed";
      a.updatedAt = now;
      a.note =
        "the browser was asked once; the OS/browser exposes no completion callback, so the outcome is unknown (no handler beacon)";
      this.emit(a);
    }
  }

  /**
   * THE ONE ENTRY POINT. Returns without navigating when a duplicate arrives.
   *
   * `buildUrl(rid, trace)` is called exactly once, after the ticket, so the URL
   * always carries THIS attempt's ticket and trace.
   */
  async dispatch(intent: LaunchIntent, buildUrl: (rid: string, trace: string) => string): Promise<DispatchResult> {
    const now = this.env.now();
    const dup = this.inFlight(now);
    if (dup) {
      const code = dup.stage === "preparing" || dup.stage === "ticket-issued" ? "already-preparing" : "awaiting-handoff";
      return { status: "duplicate-suppressed", attempt: clone(dup), code };
    }
    const attempt: DispatchAttempt = {
      id: this.env.mintId(),
      intent,
      stage: "preparing",
      createdAt: now,
      updatedAt: now,
      trace: this.env.mintTrace(),
      ticket: null,
      ticketRequests: 0,
      dispatches: 0,
      dispatchedAt: null,
      handlerSeenAt: null,
      connectedAt: null,
      cancelledAt: null,
      failure: null,
      note: "",
      supersededBy: null,
    };
    this.current = attempt;
    this.emit(attempt);

    attempt.ticketRequests += 1;
    let issued: { ok: true; rid: string } | { ok: false; error: string };
    try {
      issued = await this.env.requestTicket();
    } catch {
      issued = { ok: false, error: "ticket request failed before a response arrived" };
    }
    const after = this.env.now();
    attempt.updatedAt = after;

    // A cancellation (or a superseding attempt) that happened WHILE the ticket
    // was in flight wins: the late ticket is dropped and never dispatched.
    if (this.cancelled.has(attempt.id) || attempt.stage === "cancelled") {
      attempt.note = "cancelled while the ticket was in flight - the late ticket was not used";
      this.push(attempt);
      this.emit(attempt);
      return { status: "cancelled", attempt: clone(attempt), code: "cancelled-before-dispatch" };
    }
    if (this.current !== attempt) {
      // Superseded by a newer attempt: never touch the newer state.
      return { status: "cancelled", attempt: clone(attempt), code: "cancelled-before-dispatch" };
    }

    if (!issued.ok) {
      attempt.stage = "failed";
      attempt.failure = { code: "ticket-refused", detail: issued.error };
      attempt.note = "no ticket was issued, so nothing was dispatched";
      this.push(attempt);
      this.emit(attempt);
      return { status: "failed", attempt: clone(attempt), code: "ticket-refused" };
    }

    attempt.ticket = {
      rid: issued.rid,
      trace: attempt.trace,
      issuedAt: after,
      expiresAt: after + TICKET_TTL_MS,
    };
    attempt.stage = "ticket-issued";
    this.emit(attempt);

    const url = buildUrl(issued.rid, attempt.trace);
    // EXACTLY ONE navigation. `navigate` owns the choice of mechanism and never
    // gets a second chance from here.
    let outcome: "dispatched" | "failed" = "failed";
    try {
      outcome = this.env.navigate(url);
    } catch {
      outcome = "failed";
    }
    const dispatchedAt = this.env.now();
    if (outcome !== "dispatched") {
      attempt.stage = "failed";
      attempt.failure = {
        code: "no-dispatch-path",
        detail: "the browser refused the protocol navigation before it was attempted",
      };
      attempt.note = "no navigation reached the browser - nothing was launched";
      attempt.updatedAt = dispatchedAt;
      this.push(attempt);
      this.emit(attempt);
      return { status: "failed", attempt: clone(attempt), code: "no-dispatch-path" };
    }
    attempt.stage = "dispatched";
    attempt.dispatchedAt = dispatchedAt;
    attempt.dispatches += 1;
    attempt.updatedAt = dispatchedAt;
    attempt.note = "the browser was asked once - waiting for the launcher beacon";
    this.emit(attempt);
    return { status: "dispatched", attempt: clone(attempt) };
  }

  /**
   * A dispatch that needs no ticket (RUN CHECK / RUN DIAG): same attempt registry,
   * same one-navigation rule, same duplicate suppression - just no ticket step.
   */
  dispatchWithoutTicket(intent: LaunchIntent, url: string): DispatchResult {
    const now = this.env.now();
    const dup = this.inFlight(now);
    if (dup) {
      const code = dup.stage === "preparing" || dup.stage === "ticket-issued" ? "already-preparing" : "awaiting-handoff";
      return { status: "duplicate-suppressed", attempt: clone(dup), code };
    }
    const attempt: DispatchAttempt = {
      id: this.env.mintId(),
      intent,
      stage: "preparing",
      createdAt: now,
      updatedAt: now,
      trace: this.env.mintTrace(),
      ticket: null,
      ticketRequests: 0,
      dispatches: 0,
      dispatchedAt: null,
      handlerSeenAt: null,
      connectedAt: null,
      cancelledAt: null,
      failure: null,
      note: "",
      supersededBy: null,
    };
    this.current = attempt;
    this.emit(attempt);
    let outcome: "dispatched" | "failed" = "failed";
    try {
      outcome = this.env.navigate(url);
    } catch {
      outcome = "failed";
    }
    attempt.updatedAt = this.env.now();
    if (outcome !== "dispatched") {
      attempt.stage = "failed";
      attempt.failure = { code: "no-dispatch-path", detail: "the browser refused the protocol navigation" };
      attempt.note = "no navigation reached the browser - nothing was launched";
      this.push(attempt);
      this.emit(attempt);
      return { status: "failed", attempt: clone(attempt), code: "no-dispatch-path" };
    }
    attempt.stage = "dispatched";
    attempt.dispatchedAt = attempt.updatedAt;
    attempt.dispatches += 1;
    attempt.note = "the browser was asked once";
    this.emit(attempt);
    return { status: "dispatched", attempt: clone(attempt) };
  }

  /**
   * Operator-initiated cancel. This is a POSITIVE observation (the operator said
   * so) and is the only way an attempt becomes `cancelled`. A closed popup, a lost
   * focus event or a missing beacon never reaches this method.
   */
  cancel(reason = "cancelled by the operator"): DispatchAttempt | null {
    const a = this.current;
    if (!a) return null;
    if (TERMINAL.includes(a.stage)) return clone(a);
    this.cancelled.add(a.id);
    a.stage = "cancelled";
    a.cancelledAt = this.env.now();
    a.updatedAt = a.cancelledAt;
    a.note = reason;
    this.emit(a);
    return clone(a);
  }

  /**
   * A handler beacon was observed. The beacon must belong to THIS attempt: it
   * must not predate the dispatch (beyond the clock-skew allowance) and, when it
   * carries a trace, the trace must be this attempt's.
   */
  observeHandler(beaconTsMs: number, trace?: string): DispatchAttempt | null {
    const a = this.current;
    if (!a) return null;
    if (a.stage === "cancelled" || a.stage === "failed" || a.stage === "expired") return clone(a);
    const dispatchedAt = a.dispatchedAt;
    if (dispatchedAt == null) return clone(a);
    if (!isFinite(beaconTsMs) || beaconTsMs < dispatchedAt - BEACON_SKEW_MS) return clone(a);
    const beaconTrace = String(trace || "").trim();
    if (beaconTrace && a.trace && beaconTrace !== a.trace) return clone(a);
    a.stage = "handler-observed";
    a.handlerSeenAt = beaconTsMs;
    a.updatedAt = this.env.now();
    a.note = "launcher beacon received - the native handler ran";
    this.emit(a);
    return clone(a);
  }

  /**
   * A correlated logon was observed by the server. Only reachable from an attempt
   * this browser issued (a connected session with no attempt is NOT this
   * attempt's proof - the caller keeps that in the session state instead).
   */
  observeConnected(atMs?: number): DispatchAttempt | null {
    const a = this.current;
    if (!a) return null;
    if (a.stage === "cancelled" || a.stage === "failed" || a.stage === "expired") return clone(a);
    a.stage = "connected";
    a.connectedAt = atMs ?? this.env.now();
    a.updatedAt = this.env.now();
    a.note = "a correlated interactive logon was observed by the server";
    this.emit(a);
    return clone(a);
  }

  /** True when a retry is allowed: the previous attempt reached a terminal state. */
  get retryAllowed(): boolean {
    const a = this.current;
    if (!a) return true;
    return TERMINAL.includes(a.stage) || this.inFlight(this.env.now()) === null;
  }

  /** Reset for tests / logout. */
  reset(): void {
    this.current = null;
    this.history = [];
    this.cancelled.clear();
  }
}

/**
 * Perform ONE custom-protocol navigation.
 *
 * The supported flow is a TOP-LEVEL navigation from inside the click handler
 * (transient activation intact): the dashboard stays loaded - an unregistered
 * protocol shows the browser's own consent prompt and never replaces the page -
 * and no helper window has to be opened, so there is nothing to close on a timer.
 *
 * Only when the DOM cannot be touched at all does this fall back to a bare
 * location assignment, and that fallback is itself the ONLY navigation attempted:
 * there is no iframe, no synthetic anchor click, no delayed second dispatch.
 */
export function dispatchProtocolOnce(
  url: string,
  opts: { assign?: (u: string) => void } = {},
): "dispatched" | "failed" {
  const assign =
    opts.assign ??
    ((u: string) => {
      // `location.assign` is the single top-level navigation.
      window.location.assign(u);
    });
  try {
    assign(url);
    return "dispatched";
  } catch {
    return "failed";
  }
}
