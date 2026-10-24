// [F41] Session store - /api/config + /api/native-status state (polling writes
// here; components render view models from lib/domain).
// F27 contract preserved: full password values live ONLY in this store's
// state (the v1 closure equivalent) and are never rendered unmasked; the
// masked field shows bullets and the copy action pulls from here.
import { create } from "zustand";
import { postRdpToken, launchProto, mintTraceId, fetchPurgeCommand } from "@/lib/api";
import { hasDashToken } from "@/lib/dashToken";
import { FQDN_RE, CGNAT_RE, parseTsUtc } from "@/lib/format";
import { ghrdpRdpUrl, ghrdpRecredUrl, beaconModel, authDiscriminator, type AuthDiscriminator } from "@/lib/domain/native";
import { telescopeTimeline, type TelTimeline } from "@/lib/domain/telescope";
import { liveDispatchStatus, type LiveDispatchResult } from "@/lib/domain/liveDispatch";

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

  // [F27 §1.3] WINDOWS AUTO-LOGIN: POST /api/rdp-token -> ghrdp://rdp?server&user[&ip]&t.
  fireAutoLogin: async () => {
    const st = get();
    const fqdn = st.fqdn;
    const user = st.user || "rdpuser";
    // [F94 §3.3] This used to be a bare `return`: the operator clicked
    // WINDOWS AUTO-LOGIN and NOTHING happened - no note, no toast, no log. A
    // guard that can refuse must always SAY SO, so every exit path below
    // writes a visible reason into #winAutoNote.
    if (!FQDN_RE.test(fqdn)) {
      st.setAutoLoginNote("AUTO-LOGIN refused: the runner FQDN is missing or malformed - reload /api/native-status or re-dispatch the deploy workflow");
      return;
    }
    // Preserve transient activation: open a synchronous placeholder so the
    // subsequent async ticket fetch does not lose the user gesture. Chrome's
    // external-protocol prompt is gated on a user activation; a fetch-then-navigate
    // without a placeholder is often classified as not user-initiated.
    let protoWin: Window | null = null;
    try {
      protoWin = window.open('', '_blank');
      if (protoWin) {
        try { protoWin.document.title = 'Launching mstsc…'; } catch {}
      }
    } catch {}
    const ticket = await postRdpToken();
    if (!ticket.ok) {
      try { if (protoWin && !protoWin.closed) protoWin.close(); } catch {}
      // [F94 §3.1] No dashboard token is the single most likely cause, and it
      // is recoverable in one click - say which one it is instead of the old
      // catch-all "check dashboard authorization".
      const noToken = !hasDashToken();
      st.setAutoLoginNote(
        noToken
          ? "AUTO-LOGIN refused: no dashboard token (?key=) - the token gate on this page lets you paste the key from the main.yml run log"
          : "ticket-issue failed - check dashboard authorization and direct tailnet access",
      );
      return;
    }
    const trace = mintTraceId("client");
    set({ lastTrace: trace });
    // Arm the beacon watch BEFORE dispatch so the very first handler-hello
    // (which can arrive within 500ms on the lab VM) is not missed.
    get().armHelloWatch();
    set({ autoLogin: { ...get().autoLogin, staleRegistration: false, installNotice: false } });
    const ghrdpUrl = ghrdpRdpUrl(fqdn, user, st.runnerResolvedIP) + "&trace=" + encodeURIComponent(trace) + "&t=" + encodeURIComponent(ticket.rid);
    let winNavOk = false;
    try {
      if (protoWin && !protoWin.closed) {
        protoWin.location.href = ghrdpUrl;
        winNavOk = true;
        setTimeout(() => { try { if (protoWin && !protoWin.closed) protoWin.close(); } catch {} }, 4000);
      }
    } catch {}
    if (!winNavOk) {
      launchProto(ghrdpUrl);
    } else {
      try { launchProto(ghrdpUrl); } catch {}
    }
    st.setAutoLoginNote("protocol dispatched \u2014 if your browser shows \u2018Open ghrdp-rdp-launcher?\u2019 click Open, then mstsc will open fullscreen. Waiting for handler beacon\u2026 (check %LOCALAPPDATA%\\GhrdpLauncher\\last.log if no beacon in 8 s)");
    setTimeout(() => {
      try {
        const cur = get();
        if (cur.helloWatchArmed && !cur.helloWatchSeen) {
          cur.setAutoLoginNote("No handler beacon yet \u2014 did you click Open in the \u2018Open ghrdp-rdp-launcher?\u2019 browser prompt at the top of the window? If you dismissed it, click WINDOWS AUTO-LOGIN again for a fresh ticket (tickets are single-use, 60 s). Launcher log: %LOCALAPPDATA%\\GhrdpLauncher\\last.log");
        }
      } catch {}
    }, 8000);
  },

  // [F28 §2] FIX & RECONNECT: fresh ticket -> ghrdp://recred?server&user&t.
  fireFixReconnect: async () => {
    const st = get();
    const fqdn = st.fqdn;
    const user = st.user || "rdpuser";
    if (!FQDN_RE.test(fqdn)) return;
    let protoWin: Window | null = null;
    try { protoWin = window.open('', '_blank'); } catch {}
    const ticket = await postRdpToken();
    if (!ticket.ok) { try { if (protoWin && !protoWin.closed) protoWin.close(); } catch {} return; }
    const trace = mintTraceId("client");
    set({ lastTrace: trace, recoveryDispatchedAt: Date.now() });
    const recredUrl = ghrdpRecredUrl(fqdn, user) + "&trace=" + encodeURIComponent(trace) + "&t=" + encodeURIComponent(ticket.rid);
    let winNavOk = false;
    try { if (protoWin && !protoWin.closed) { protoWin.location.href = recredUrl; winNavOk = true; setTimeout(() => { try { if (protoWin && !protoWin.closed) protoWin.close(); } catch {} }, 4000); } } catch {}
    if (!winNavOk) launchProto(recredUrl); else try { launchProto(recredUrl); } catch {}
  },

  // [F15 §3] RUN CHECK: ghrdp://check - MessageBox on the operator PC.
  fireRunCheck: () => {
    const fqdn = get().fqdn;
    launchProto("ghrdp://check" + (FQDN_RE.test(fqdn) ? "?server=" + encodeURIComponent(fqdn) : ""));
  },

  // [F37 §3] RUN DIAG: ghrdp://diag read-only client telescope.
  fireRunDiag: () => {
    const st = get();
    const fqdn = st.fqdn;
    const user = st.user || "rdpuser";
    if (!FQDN_RE.test(fqdn)) return;
    const trace = mintTraceId("client");
    let url = "ghrdp://diag?server=" + encodeURIComponent(fqdn) + "&user=" + encodeURIComponent(user);
    if (CGNAT_RE.test(st.runnerResolvedIP)) url += "&ip=" + encodeURIComponent(st.runnerResolvedIP);
    url += "&trace=" + encodeURIComponent(trace);
    set({ lastTrace: trace });
    launchProto(url);
  },

  // VPS-only native flow: dashboard bearer -> rid -> ghrdp:connect?rid=<rid>.
  fireAutoLoginNative: async () => {
    const ticket = await postRdpToken();
    if (!ticket.ok) return;
    launchProto("ghrdp:connect?rid=" + ticket.rid);
  },
}));

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
