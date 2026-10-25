// [F41] Session store - /api/config + /api/native-status state (polling writes
// here; components render view models from lib/domain).
// F27 contract preserved: full password values live ONLY in this store's
// state (the v1 closure equivalent) and are never rendered unmasked; the
// masked field shows bullets and the copy action pulls from here.
import { create } from "zustand";
import { postRdpToken, dispatchProtocolOnce, mintTraceId, fetchPurgeCommand } from "@/lib/api";
import { hasDashToken } from "@/lib/dashToken";
import { FQDN_RE, CGNAT_RE, parseTsUtc } from "@/lib/format";
import { ghrdpRdpUrl, ghrdpRecredUrl, beaconModel, authDiscriminator, type AuthDiscriminator } from "@/lib/domain/native";
import { telescopeTimeline, type TelTimeline } from "@/lib/domain/telescope";
import { liveDispatchStatus, type LiveDispatchResult } from "@/lib/domain/liveDispatch";
import {
  LaunchDispatcher,
  TICKET_TTL_MS,
  type AttemptStage,
  type DispatchAttempt,
  type DispatchResult,
  type LaunchIntent,
} from "@/lib/domain/dispatch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface Secrets {
  credWinPass: string;
  credVncPass: string;
  windowsPassMask?: string;
  vncPassMask?: string;
}

interface AutoLoginState {
  note: string;
  staleRegistration: boolean;
  installNotice: boolean;
  helloSeen: boolean;
}

// [F201 §2] Data-trust state, per probe. `pending` = no answer yet this session;
// `ok` = the last answer was a 200 with a JSON body; every other value is the
// class of failure, and the UI must not derive measurements from an untrusted probe.
export type ProbeState = "pending" | "ok" | "unauthorized" | "forbidden" | "http" | "transport" | "schema";

export interface ProbeReport {
  state: ProbeState;
  status: number;
  at: number;
}

interface SessionState {
  configLoaded: boolean;
  fqdn: string;
  user: string;
  ip: string;
  mirrorIndexUrl: string;
  secrets: Secrets;
  gatedVncPass: string;
  native: Any | null;
  nativeLost: boolean;
  listenerOkFlag: boolean;
  runnerResolvedIP: string;
  runnerDnsOk: boolean;
  lastTrace: string;
  helloWatchArmed: boolean;
  helloWatchSeen: boolean;
  helloWatchArmedAt: number;
  autoLogin: AutoLoginState;
  /**
   * [SINGLE-DISPATCH-2026-10-25] The current launch attempt, exactly as the
   * dispatcher observed it. `null` = nothing was launched from this page. The UI
   * renders the stage verbatim; it must never claim an outcome the page cannot
   * see (a dispatched protocol navigation is NOT proof the handler ran).
   */
  launchAttempt: DispatchAttempt | null;
  /** Stage mirror for cheap selectors/renders. */
  launchStage: AttemptStage;
  /** True when a single-use ticket is already minted and can be sent with the
   *  next click without an await (keeps Chrome's transient activation). */
  launchTicketWarm: boolean;
  recoveryDispatchedAt: number;
  purgeCmd: string;
  beaconInvokedAt: number | null;
  lastHandlerTs: string;
  diagOpen: boolean;
  diagText: string;
  probes: { config: ProbeReport; native: ProbeReport };
  setProbe: (which: "config" | "native", state: ProbeState, status?: number) => void;

  setConfig: (cf: Any) => void;
  setNativeStatus: (s: Any) => void;
  markNativeLost: () => void;
  setAutoLoginNote: (note: string) => void;
  setDiag: (open: boolean, text?: string) => void;
  loadPurgeCmd: () => Promise<void>;
  runDiag: () => Promise<void>;
  fetchCompBundle: () => Promise<void>;
  compBundle: any;
  compBundleStatus: 'idle' | 'fetching' | 'error';
  compBundleError: string;
  compBundleLastFetched: number;
  fireAutoLogin: () => Promise<void>;
  fireFixReconnect: () => Promise<void>;
  fireRunCheck: () => void;
  fireRunDiag: () => void;
  fireAutoLoginNative: () => Promise<void>;
  armHelloWatch: () => void;
  /** Mint ONE single-use ticket ahead of the click (or refresh a stale one). */
  warmLaunchTicket: () => Promise<void>;
  /** Operator-initiated cancel of the CURRENT attempt (a positive observation). */
  cancelLaunch: () => void;
  /** Explicit retry: only from a terminal attempt, and always with a fresh ticket. */
  retryLaunch: () => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  configLoaded: false,
  fqdn: "",
  user: "",
  ip: "",
  mirrorIndexUrl: "",
  secrets: { credWinPass: "", credVncPass: "" },
  gatedVncPass: "",
  native: null,
  nativeLost: false,
  listenerOkFlag: false,
  runnerResolvedIP: "",
  runnerDnsOk: false,
  lastTrace: "",
  helloWatchArmed: false,
  helloWatchSeen: false,
  helloWatchArmedAt: 0,
  autoLogin: { note: "", staleRegistration: false, installNotice: false, helloSeen: false },
  launchAttempt: null,
  launchStage: "idle",
  launchTicketWarm: false,
  recoveryDispatchedAt: 0,
  purgeCmd: "",
  beaconInvokedAt: null,
  lastHandlerTs: "",
  compBundle: null as any,
  compBundleStatus: 'idle',
  compBundleError: '',
  compBundleLastFetched: 0,
  diagOpen: false,
  diagText: "",
  probes: {
    config: { state: "pending", status: 0, at: 0 },
    native: { state: "pending", status: 0, at: 0 },
  },

  setProbe: (which, state, status) =>
    set((prev) => ({
      probes: {
        ...prev.probes,
        [which]: { state, status: Number(status || 0), at: Date.now() },
      },
    })),

  setConfig: (cf) => {
    if (!cf) return;
    // F52: discard even a legacy server's mirror key before UI state storage.
    cf = { ...cf };
    delete cf.mirrorKey;
    const cr = cf.creds || {};
    const fqdn = cr.fqdn || "";
    const user = cr.user || "";
    const ip = cr.ip || "";
    const secrets: Secrets = {
      credWinPass: cr.windowsPass ? String(cr.windowsPass) : "",
      credVncPass: cr.vncPass ? String(cr.vncPass) : "",
      windowsPassMask: cr.windowsPassMask,
      vncPassMask: cr.vncPassMask,
    };
    set({ configLoaded: true, fqdn, user, ip, secrets, mirrorIndexUrl: String(cf.mirrorIndexUrl || "") });
  },

  setNativeStatus: (s) => {
    if (!s) return;
    const fqdn = String(s.fqdn || "");
    const ip = String(s.runnerResolvedIP || "");
    // [F12-1 §1.4] handler-hello beacon input: a beacon newer than the click
    // proves the exe handler ran.
    let helloSeen = get().helloWatchSeen;
    const lastHandlerTs = s && s.lastHandlerVerb && s.lastHandlerVerb.ts ? String(s.lastHandlerVerb.ts) : "";
    if (lastHandlerTs && get().helloWatchArmed) {
      const hts = parseTsUtc(lastHandlerTs);
      if (!isNaN(hts) && hts >= get().helloWatchArmedAt - 10000) {
        helloSeen = true;
        // [SINGLE-DISPATCH-2026-10-25] Tell the attempt registry: a beacon that
        // belongs to THIS attempt (post-dispatch, trace-matched when the beacon
        // carries one) is the only evidence that the native handler ran.
        try { getDispatcher().observeHandler(hts, lastHandlerVerbTrace(s)); } catch { }
        set({ autoLogin: { ...get().autoLogin, note: "launcher beacon received - mstsc should be opening fullscreen", helloSeen: true } });
      }
    }
    set({
      native: s,
      fqdn: fqdn || get().fqdn,
      ip: s.creds && s.creds.ip ? String(s.creds.ip) : get().ip,
      user: s.creds && s.creds.user ? String(s.creds.user) : get().user,
      runnerResolvedIP: ip,
      runnerDnsOk: CGNAT_RE.test(ip),
      listenerOkFlag: listenerOkOf(s),
      lastHandlerTs,
      helloWatchSeen: helloSeen,
    });
  },

  markNativeLost: () => set({ nativeLost: true }),

  setAutoLoginNote: (note) => set({ autoLogin: { ...get().autoLogin, note } }),

  setDiag: (open, text) => set({ diagOpen: open, diagText: text !== undefined ? text : get().diagText }),

  loadPurgeCmd: async () => {
    if (get().purgeCmd) return;
    const cmd = await fetchPurgeCommand();
    set({ purgeCmd: cmd });
  },



  fetchCompBundle: async () => {
    const state = get();
    if (state.compBundleStatus === 'fetching') return;
    if (Date.now() - state.compBundleLastFetched < 10000) return;

    set({ compBundleStatus: 'fetching', compBundleError: '' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const { fetchComprehensiveDiag } = await import("@/api/diag");
      const res = await fetchComprehensiveDiag({ signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        set({ compBundleStatus: 'error', compBundleError: res.errorKey });
      } else {
        set({ compBundle: res.bundle, compBundleStatus: 'idle', compBundleLastFetched: Date.now() });
      }
    } catch (e) {
      clearTimeout(timeout);
      set({ compBundleStatus: 'error', compBundleError: "Network or timeout error" });
    }
  },

  runDiag: async () => {
    const state = get();
    if (state.diagText === "running /diag...") return;

    set({ diagOpen: true, diagText: "running /diag..." });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s bound

    try {
      const r = await fetch("/diag", { cache: "no-store", signal: controller.signal });
      clearTimeout(timeout);
      const d = r.ok ? await r.json() : null;
      set({ diagText: d ? JSON.stringify(d, null, 2) : "Diagnostics failed - server not reachable." });

      try {
        if (d && d.searchEnabled !== undefined) {
          const enabled = !!(d.searchEnabled === true || d.searchEnabled === 'true');
          if (typeof window !== 'undefined') (window as any).__GHRDP_SEARCH_ENABLED = enabled;
          const { announceSearchLane } = await import("@/lib/search/lane");
          announceSearchLane();
        }
        if (typeof window !== 'undefined') (window as any).__GHRDP_SEARCH_INPUT = d?.searchInput || '';
      } catch {}
    } catch (err: any) {
      clearTimeout(timeout);
      set({ diagText: "Diagnostics failed - " + ((err instanceof Error && err.name === 'AbortError') ? 'timed out after 10s' : 'server not reachable') });
    }

    await get().fetchCompBundle();
  },

  armHelloWatch: () => set({ helloWatchArmed: true, helloWatchSeen: false, helloWatchArmedAt: Date.now() }),

  // =========================================================================
  // [SINGLE-DISPATCH-2026-10-25] LAUNCH PATHS - ONE INTENT, ONE DISPATCH
  //
  // What was here: `fireAutoLogin` opened a blank popup, awaited a ticket,
  // assigned `ghrdp://` to that popup AND ALSO called launchProto() - which
  // appended a hidden iframe with the same URL and, 150 ms later, clicked a
  // synthetic anchor with the same URL again. `fireFixReconnect` had the same
  // duplicate shape. So one operator click could reach the external-protocol
  // handler three times, and every dispatch after the first carried a ticket the
  // launcher had already redeemed - the exact condition that makes Windows show
  // its own credential prompt.
  //
  // What replaced it: every launch goes through ONE LaunchDispatcher
  // (src/lib/domain/dispatch.ts). The dispatcher owns the attempt identity, the
  // single ticket, the single navigation and the lifecycle. This file only
  // supplies the ticket transport, the URL builder and the honest operator note.
  //
  // No timers here: nothing closes a window on a four-second deadline, nothing
  // dispatches a "second chance" navigation, and no callback from an old attempt
  // can overwrite a newer one (the dispatcher keys everything by attempt id).
  // =========================================================================

  // A ticket minted ahead of the click. Single-use: consumed by the next
  // attempt, then gone. `at` is the issue time so staleness is provable.
  warmLaunchTicket: async () => {
    if (!hasDashToken()) {
      set({ launchTicketWarm: false });
      return;
    }
    if (warmTicket && Date.now() - warmTicket.at < TICKET_TTL_MS - WARM_MARGIN_MS) {
      set({ launchTicketWarm: true });
      return;
    }
    warmTicket = null;
    const t = await postRdpToken();
    if (t.ok) {
      warmTicket = { rid: t.rid, at: Date.now() };
      set({ launchTicketWarm: true });
    } else {
      set({ launchTicketWarm: false });
    }
  },

  cancelLaunch: () => {
    const d = getDispatcher();
    d.cancel("cancelled by the operator - no further dispatch will be attempted for this attempt");
    warmTicket = null;
    set({ launchTicketWarm: false });
  },

  retryLaunch: async () => {
    const d = getDispatcher();
    if (!d.retryAllowed) {
      get().setAutoLoginNote(
        "RETRY withheld: the current attempt is still awaiting handoff. Cancel it first so a second ticket is not minted against an attempt that may still be in flight.",
      );
      return;
    }
    // Retry re-runs the SAME intent with a FRESH ticket. It is offered only from
    // a terminal attempt (failed / expired / cancelled / unconfirmed).
    warmTicket = null;
    set({ launchTicketWarm: false });
    switch (lastIntent) {
      case "fix-reconnect":
        await get().fireFixReconnect();
        return;
      case "run-check":
        get().fireRunCheck();
        return;
      case "run-diag":
        get().fireRunDiag();
        return;
      case "native-connect":
        await get().fireAutoLoginNative();
        return;
      default:
        await get().fireAutoLogin();
    }
  },

  // [F27 §1.3] WINDOWS AUTO-LOGIN: POST /api/rdp-token -> ghrdp://rdp?server&user[&ip]&t.
  fireAutoLogin: async () => {
    lastIntent = "auto-login";
    const st = get();
    const fqdn = st.fqdn;
    const user = st.user || "rdpuser";
    // [F94 §3.3] A guard that can refuse must always SAY SO. Every exit path
    // below writes a visible reason into #winAutoNote.
    if (!FQDN_RE.test(fqdn)) {
      st.setAutoLoginNote("AUTO-LOGIN refused: the runner FQDN is missing or malformed - reload /api/native-status or re-dispatch the deploy workflow");
      return;
    }
    if (!hasDashToken()) {
      // No token = no ticket. Name the one-click remedy instead of pretending to
      // dispatch: the token gate on this page accepts the key from the main.yml log.
      st.setAutoLoginNote(
        "AUTO-LOGIN refused: no dashboard token (?key=) - the token gate on this page lets you paste the key from the main.yml run log",
      );
      set({ launchStage: "idle" });
      return;
    }
    const warm = !!(warmTicket && Date.now() - warmTicket.at < TICKET_TTL_MS - WARM_MARGIN_MS);
    const d = getDispatcher();
    const res = await d.dispatch("auto-login", (rid, trace) =>
      ghrdpRdpUrl(fqdn, user, st.runnerResolvedIP) + "&trace=" + encodeURIComponent(trace) + "&t=" + encodeURIComponent(rid),
    );
    set({ lastTrace: res.attempt.trace, launchTicketWarm: false });
    applyLaunchResult(res, warm);
  },

  // [F28 §2] FIX & RECONNECT: fresh ticket -> ghrdp://recred?server&user&t.
  fireFixReconnect: async () => {
    lastIntent = "fix-reconnect";
    const st = get();
    const fqdn = st.fqdn;
    const user = st.user || "rdpuser";
    if (!FQDN_RE.test(fqdn)) {
      st.setAutoLoginNote("FIX & RECONNECT refused: the runner FQDN is missing or malformed - reload /api/native-status");
      return;
    }
    if (!hasDashToken()) {
      st.setAutoLoginNote(
        "FIX & RECONNECT refused: no dashboard token (?key=) - the token gate on this page lets you paste the key from the main.yml run log",
      );
      return;
    }
    const warm = !!(warmTicket && Date.now() - warmTicket.at < TICKET_TTL_MS - WARM_MARGIN_MS);
    const d = getDispatcher();
    const res = await d.dispatch("fix-reconnect", (rid, trace) =>
      ghrdpRecredUrl(fqdn, user) + "&trace=" + encodeURIComponent(trace) + "&t=" + encodeURIComponent(rid),
    );
    set({ lastTrace: res.attempt.trace, recoveryDispatchedAt: Date.now(), launchTicketWarm: false });
    applyLaunchResult(res, warm);
  },

  // [F15 §3] RUN CHECK: ghrdp://check - MessageBox on the operator PC. No ticket,
  // but the same one-attempt/one-navigation rule.
  fireRunCheck: () => {
    lastIntent = "run-check";
    const fqdn = get().fqdn;
    const url = "ghrdp://check" + (FQDN_RE.test(fqdn) ? "?server=" + encodeURIComponent(fqdn) : "");
    const res = getDispatcher().dispatchWithoutTicket("run-check", url);
    applyLaunchResult(res, false);
  },

  // [F37 §3] RUN DIAG: ghrdp://diag read-only client telescope.
  fireRunDiag: () => {
    lastIntent = "run-diag";
    const st = get();
    const fqdn = st.fqdn;
    const user = st.user || "rdpuser";
    if (!FQDN_RE.test(fqdn)) {
      st.setAutoLoginNote("RUN DIAG refused: the runner FQDN is missing or malformed - reload /api/native-status");
      return;
    }
    const trace = mintTraceId("client");
    let url = "ghrdp://diag?server=" + encodeURIComponent(fqdn) + "&user=" + encodeURIComponent(user);
    if (CGNAT_RE.test(st.runnerResolvedIP)) url += "&ip=" + encodeURIComponent(st.runnerResolvedIP);
    url += "&trace=" + encodeURIComponent(trace);
    set({ lastTrace: trace });
    const res = getDispatcher().dispatchWithoutTicket("run-diag", url);
    applyLaunchResult(res, false);
  },

  // VPS-only native flow: dashboard bearer -> rid -> ghrdp:connect?rid=<rid>.
  fireAutoLoginNative: async () => {
    lastIntent = "native-connect";
    if (!hasDashToken()) {
      get().setAutoLoginNote("NATIVE CONNECT refused: no dashboard token (?key=) - paste the key from the main.yml run log");
      return;
    }
    const d = getDispatcher();
    const res = await d.dispatch("native-connect", (rid) => "ghrdp:connect?rid=" + encodeURIComponent(rid));
    set({ lastTrace: res.attempt.trace });
    applyLaunchResult(res, false);
  },
}));

// ===========================================================================
// Dispatch plumbing (module scope so the store object stays serialisable-ish).
// ===========================================================================

/** Kept out of the click path so a warm ticket survives a render. */
let warmTicket: { rid: string; at: number } | null = null;
/** A ticket older than this is not usable: the browser needs activation time. */
const WARM_MARGIN_MS = 12_000;
/** The intent of the last launch, so retryLaunch knows what to re-run. */
let lastIntent: LaunchIntent = "auto-login";
let dispatcher: LaunchDispatcher | null = null;

function getDispatcher(): LaunchDispatcher {
  if (dispatcher) return dispatcher;
  dispatcher = new LaunchDispatcher({
    now: () => Date.now(),
    mintId: () => "att-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 8),
    mintTrace: () => mintTraceId("client"),
    requestTicket: async () => {
      // A warmed ticket is consumed here and NOT re-requested: one ticket per
      // attempt, and the click keeps its transient activation because no network
      // round trip happens between the click and the navigation.
      const w = warmTicket;
      warmTicket = null;
      if (w && Date.now() - w.at < TICKET_TTL_MS - WARM_MARGIN_MS) {
        return { ok: true, rid: w.rid };
      }
      const t = await postRdpToken();
      return t.ok ? { ok: true, rid: t.rid } : { ok: false, error: t.error };
    },
    navigate: (url) => dispatchProtocolOnce(url),
    onChange: (attempt) => {
      const note = launchNote(attempt);
      useSessionStore.setState({
        launchAttempt: attempt,
        launchStage: attempt.stage,
        autoLogin: { ...useSessionStore.getState().autoLogin, note },
      });
      if (attempt.stage === "handler-observed") {
        useSessionStore.setState({ helloWatchSeen: true });
      }
    },
  });
  return dispatcher;
}

/** Operator-facing sentence for an attempt stage. Never claims an unseen outcome. */
export function launchNote(a: DispatchAttempt): string {
  switch (a.stage) {
    case "preparing":
      return "requesting a single-use ticket for this attempt - one dispatch will follow";
    case "ticket-issued":
      return "ticket issued for this attempt - handing the protocol URL to the browser once";
    case "dispatched":
      return "protocol dispatched ONCE - if the browser shows ‘Open ghrdp-rdp-launcher?’ click Open. Waiting for the launcher beacon (…); assigning the URL does not prove mstsc opened";
    case "handler-observed":
      return "launcher beacon received - the native handler ran; waiting for a correlated logon before calling the session connected";
    case "connected":
      return "correlated interactive logon observed by the server - the remote session is up";
    case "cancelled":
      return "attempt cancelled - nothing further will be dispatched for it";
    case "expired":
      return "the ticket expired before dispatch - click again for a fresh ticket";
    case "failed":
      return a.failure && a.failure.code === "ticket-refused"
        ? "ticket refused: " + a.failure.detail + " - nothing was dispatched"
        : "the browser refused the protocol navigation - nothing was launched; retry for a fresh ticket";
    case "unconfirmed":
      return "the browser was asked once and no handler beacon arrived within the watch window - the outcome is UNKNOWN (the OS/browser exposes no completion callback). Check %LOCALAPPDATA%\\GhrdpLauncher\\last.log before retrying";
    default:
      return "";
  }
}

/** Write the dispatch outcome where the UI (and the tests) read it. */
function applyLaunchResult(res: DispatchResult, warm: boolean): void {
  const st = useSessionStore.getState();
  setStageFromResult(res);
  if (res.status === "dispatched") {
    st.armHelloWatch();
    const extra = warm
      ? ""
      : " (the ticket had to be fetched after your click; if the browser suppressed its consent prompt, use Retry - it sends a fresh ticket)";
    st.setAutoLoginNote(launchNote(res.attempt) + extra);
    return;
  }
  if (res.status === "duplicate-suppressed") {
    st.setAutoLoginNote(
      res.code === "already-preparing"
        ? "already preparing an attempt - the second click was ignored so no second ticket is minted. Wait for it to finish."
        : "an attempt is already awaiting handoff - the second click was ignored on purpose (one dispatch per intent). Wait for the beacon, or Cancel and retry with a fresh ticket.",
    );
    return;
  }
  if (res.status === "cancelled") {
    st.setAutoLoginNote("attempt cancelled before it was dispatched - the late ticket was dropped");
    return;
  }
  // failed
  if (res.code === "ticket-refused") {
    const noToken = !hasDashToken();
    st.setAutoLoginNote(
      noToken
        ? "AUTO-LOGIN refused: no dashboard token (?key=) - the token gate on this page lets you paste the key from the main.yml run log"
        : "ticket-issue failed (" + (res.attempt.failure ? res.attempt.failure.detail : "unknown") + ") - nothing was dispatched; fix authorization and retry",
    );
    return;
  }
  st.setAutoLoginNote("no navigation reached the browser - nothing was launched. Retry sends a fresh ticket.");
}

function setStageFromResult(res: DispatchResult): void {
  useSessionStore.setState({ launchAttempt: res.attempt, launchStage: res.attempt.stage });
}

/** Test seam: drop the singleton so a suite can drive fresh attempts in isolation. */
export function resetLaunchDispatcherForTests(): void {
  dispatcher = null;
  warmTicket = null;
  lastIntent = "auto-login";
}

export { getDispatcher as _getLaunchDispatcherForTests };

/** The trace a launcher beacon carries, when the server publishes one. */
function lastHandlerVerbTrace(s: Any): string {
  try {
    const lhv = s && s.lastHandlerVerb ? s.lastHandlerVerb : null;
    if (!lhv) return "";
    return String(lhv.trace || lhv.traceId || "");
  } catch {
    return "";
  }
}

function listenerOkOf(s: Any): boolean {
  const rl = s && s.rdpListener;
  if (!rl || typeof rl !== "object") return false;
  const csv = rl.credsspLive === "ok" || (!rl.credsspLive && (!rl.credsspStatus || rl.credsspStatus === "ok" || rl.credsspStatus === "ok-with-cipher-warn"));
  return !!(rl.listening === true && rl.fwRule === true && rl.certOk === true && rl.nla === true && csv);
}

// ---- Derived selectors (recomputed per render, cheap) ----

export function selectTelemetry(s: Any | null): TelTimeline {
  return telescopeTimeline(s, Date.now());
}

export function selectLiveDispatch(s: Any | null): LiveDispatchResult {
  return liveDispatchStatus(s, Date.now());
}

export function selectAuth(s: Any | null): AuthDiscriminator | null {
  if (!s) return null;
  return authDiscriminator(s.rdpListener || null, s);
}

export function selectBeacon(s: Any | null, invokedAt: number | null, nowMs: number) {
  return beaconModel(s && s.lastHandlerVerb ? { verb: s.lastHandlerVerb.verb, details: s.lastHandlerVerb.details, ok: s.lastHandlerVerb.ok, ts: s.lastHandlerVerb.ts } : null, invokedAt, nowMs);
}

export { beaconModel };
