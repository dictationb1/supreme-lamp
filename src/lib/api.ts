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

// [F15 §3] + [SINGLE-DISPATCH-2026-10-25] protocol verbs: dispatch the custom
// handler WITHOUT losing the dashboard, and WITHOUT a second dispatch.
//
// HISTORY, because it is the defect being repaired. The original contract used a
// top-level navigation (window.location.href) - the dashboard navigated away and
// the operator lost the page and its evidence. The replacement tried a hidden
// iframe and then, 150 ms later, synthesized a click on a temporary anchor so a
// browser that ignored the iframe would still have "a second chance". That second
// chance is not harmless: it reaches the external-protocol handler twice, and the
// second navigation carries an already-redeemed single-use ticket, which is
// exactly the case that sends Windows into an interactive credential prompt.
//
// The shipped contract is now:
//   * `dispatchProtocolOnce()` performs exactly ONE navigation and reports whether
//     it reached the browser;
//   * the navigation is a top-level `location.assign` from inside the operator's
//     click handler, so the page is NOT lost (an unregistered protocol only shows
//     the browser's consent prompt) and transient activation is intact;
//   * there is no iframe, no synthetic click, no delayed second attempt;
//   * a pre-dispatch failure is reported as "failed" so the caller can offer an
//     explicit retry with a FRESH ticket - never a silent second dispatch.
import { dispatchProtocolOnce } from "@/lib/domain/dispatch";

export { dispatchProtocolOnce, LaunchDispatcher } from "@/lib/domain/dispatch";
export type { DispatchAttempt, AttemptStage, DispatchResult } from "@/lib/domain/dispatch";

export function launchProto(url: string): "dispatched" | "failed" {
  return dispatchProtocolOnce(url);
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
