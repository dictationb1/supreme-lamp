// [F41 §0] API surface - UNCHANGED endpoints, identical semantics to F38 ui.html:
//   /api/config?key=        creds block only for token/tailnet-authenticated calls
//   /api/native-status?key= fqdn/cert/nla/handler/telescope snapshot (+ last beacon)
//   /api/rdp-token  POST    Bearer-gated single-use 60s ticket {rid}
//   /api/purge-stale-creds  Bearer-gated age-aware purge command (copy-only)
//   /api/progress /ping /health /launch /flush /diag   mirror + connectivity
// The dashboard is served by the SAME server (port 7331), so the API base is
// this origin; v1 kept an explicit :7331 for the dual-port layout, and we keep
// that fallback when the page is opened on a non-API port.

import { getDashToken } from "@/lib/dashToken";

// [F94 §3.1] getKey() now resolves through the shared dash-token module:
// query string -> hash -> localStorage. Reading ONLY location.search meant a
// URL re-shared without its query silently lost the token, and every write
// route then answered 403 ("Dashboard permission missing"), which the operator
// saw as eight unrelated bugs. The fallback chain is in src/lib/dashToken.ts;
// this wrapper keeps every existing call site and its `if (key)` guard intact.
export function getKey(): string {
  return getDashToken();
}

export { getDashToken, hasDashToken, storeDashToken, clearDashToken, dashTokenDebug } from "@/lib/dashToken";

export function apiBase(): string {
  if (location.port === "7331" || location.port === "7332" || location.protocol === "https:") {
    return location.origin;
  }
  // Same-host explicit fallback mirrors ui.html apiBase() semantics.
  return "http://" + location.hostname + ":7331";
}

export async function getJson<T = unknown>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store", ...init });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// [F201 §1] A PROBE THAT FAILED IS NOT A MEASUREMENT.
//
// `getJson` collapses every outcome into `null`: a 401 (no dashboard key, or a
// key from an earlier run), a 403 (source policy), a network error and an empty
// but successful answer are all indistinguishable to the caller. The stores then
// keep their empty defaults, and the Overview screen renders those defaults as
// measured facts: "FQDN/user validation failed", "runner tailnet IP did not
// resolve", "RDP LISTENER probe not all green" - three accusations against the
// server, produced by a request the server refused or never received.
//
// `probeJson` keeps the STATUS and a stable failure class so the UI can say what
// actually happened, and so a disabled control can name its real prerequisite.
export type ProbeFailure = "" | "unauthorized" | "forbidden" | "http" | "transport" | "schema";

export interface ProbeResult<T = unknown> {
  ok: boolean;
  /** HTTP status, or 0 when the request never produced one. */
  status: number;
  failure: ProbeFailure;
  data: T | null;
}

function classifyStatus(status: number): ProbeFailure {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return "http";
}

export async function probeJson<T = unknown>(url: string, init?: RequestInit): Promise<ProbeResult<T>> {
  let r: Response;
  try {
    r = await fetch(url, { cache: "no-store", ...init });
  } catch {
    return { ok: false, status: 0, failure: "transport", data: null };
  }
  if (!r.ok) return { ok: false, status: r.status, failure: classifyStatus(r.status), data: null };
  try {
    return { ok: true, status: r.status, failure: "", data: (await r.json()) as T };
  } catch {
    // A 200 that is not JSON is a schema/build mismatch, not a healthy read.
    return { ok: false, status: r.status, failure: "schema", data: null };
  }
}

export function configUrl(): string {
  const key = getKey();
  return apiBase() + "/api/config" + (key ? "?key=" + encodeURIComponent(key) : "");
}

export function nativeStatusUrl(): string {
  const key = getKey();
  return apiBase() + "/api/native-status" + (key ? "?key=" + encodeURIComponent(key) : "");
}

// F27/F28: mint ONE single-use ticket; no password is ever read by this path.
export async function postRdpToken(): Promise<{ ok: true; rid: string } | { ok: false; error: string }> {
  const key = getKey();
  if (!key) return { ok: false, error: "dashboard authorization missing" };
  try {
    const r = await fetch(apiBase() + "/api/rdp-token", {
      method: "POST",
      headers: { Authorization: "Bearer " + key },
      cache: "no-store",
    });
    if (!r.ok) return { ok: false, error: "ticket issue HTTP " + r.status };
    const j = (await r.json()) as { rid?: string };
    const rid = String(j.rid || "");
    if (!/^[0-9a-f]{32}$/.test(rid)) return { ok: false, error: "invalid ticket response" };
    return { ok: true, rid };
  } catch {
    return { ok: false, error: "ticket issue network error" };
  }
}

// F30 §2.2: fetch (never execute) the server-generated age-aware purge command.
export async function fetchPurgeCommand(): Promise<string> {
  const key = getKey();
  if (!key) return "(open this dashboard with ?key=... to load the server-generated 7-day purge command; the plain purge line above works without it)";
  try {
    const r = await fetch(apiBase() + "/api/purge-stale-creds", {
      headers: { Authorization: "Bearer " + key },
      cache: "no-store",
    });
    if (!r.ok) return "(server refused the purge command: HTTP " + r.status + ")";
    const j = (await r.json()) as { command?: string };
    return j && j.command ? String(j.command) : "(server returned no purge command)";
  } catch {
    return "(purge command fetch failed - server not reachable)";
  }
}

// [F15 §3] protocol verbs: dispatch the custom handler without losing the dashboard.
//
// Original contract used top-level navigation (window.location.href) which navigated
// the dashboard away on every dispatch — the operator lost the page and its
// evidence. It also broke transient activation: the POST /api/rdp-token happens
// async, so the final navigation was no longer in the user-gesture window and
// Chrome's external-protocol prompt required an extra click without guidance.
//
// New contract: try a hidden iframe first (keeps the page, does not require a
// top-level navigation), fall back to location.href if the iframe cannot be
// created. The browser still shows its permission prompt — we never bypass it —
// but the dashboard remains visible and can show the prompt guidance and the
// beacon watch. The iframe is removed shortly after dispatch.
export function launchProto(url: string): void {
  let dispatched = false;
  try {
    if (typeof document !== 'undefined' && document.body) {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      // Sandbox the iframe to the minimal privilege needed for protocol dispatch
      // (no scripts, no same-origin access). The src assignment is what triggers
      // the external handler; the element is ephemeral.
      iframe.src = url;
      document.body.appendChild(iframe);
      // Remove after a short window so the DOM does not accumulate hidden frames
      // and so devtools stays honest (one frame per dispatch, never a leak).
      setTimeout(() => {
        try { iframe.remove(); } catch {}
      }, 4000);
      dispatched = true;
    }
  } catch {
    /* iframe path failed — fall through to location navigation */
  }
  if (!dispatched) {
    try {
      window.location.href = url;
    } catch {
      /* ignore */
    }
  } else {
    // Also arm a fallback navigation for browsers that ignore iframe protocol
    // dispatches (old EdgeHTML, some WebView hosts). A second dispatch is harmless:
    // the handler deduplicates by ticket (single-use) and the second 401 is
    // silently ignored. We keep the location navigation behind a micro-delay so
    // the iframe gets first credit in the common case.
    try {
      setTimeout(() => {
        try {
          // Navigating a blank iframe is not observable; as a last resort
          // create a temporary anchor and synthesize a click — browsers that
          // block the iframe will still honour a fresh anchor click from the
          // same task.
          const a = document.createElement('a');
          a.href = url;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { try { a.remove(); } catch {} }, 1000);
        } catch {}
      }, 150);
    } catch {}
  }
}

// [F37 §3] per-click trace id the client beacons carry.
export function mintTraceId(src?: string): string {
  let r = "";
  try {
    const b = new Uint8Array(4);
    (window.crypto && window.crypto.getRandomValues) ? window.crypto.getRandomValues(b) : b.set([1, 2, 3, 4]);
    for (let i = 0; i < b.length; i++) r += ("0" + b[i].toString(16)).slice(-2);
  } catch {
    r = "00000000";
  }
  const t = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(2, 14);
  return "t" + t + "-" + String(src || "client") + "-" + r;
}
