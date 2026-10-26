// [SEARCH-REPAIR] Provider core: the ONE transport + error vocabulary every
// adapter shares.
//
// WHY THIS FILE EXISTS (the defect it repairs): the previous adapters lived in
// payloads/ghrdp-server.ps1 and every failure - a CORS refusal, a 404, a 429, a
// missing token, a parser that found nothing - collapsed into one generic line
// in the UI, so a public GitHub README looked like it needed a password. Here a
// failure is a TYPED value with the provider's own evidence (status, retry
// hint, host, which parse step broke), and the UI renders the specific
// sentence that matches it.
//
// Transport rules (verified against the live providers on 2026-10-26, see
// docs/reports/search-repair/evidence/live-probe.json):
//   * direct browser fetch is used when the provider answers with
//     `access-control-allow-origin` (Open Culture RSS * , archive.org *,
//     Openverse *, api.github.com *, fmhy.net *, rentry.org *);
//   * github.com HTML and archive.org/download/* send NO CORS header, so those
//     two are only used through the server relay (/api/providers/relay) - and
//     the adapters never depend on them for a required result: the GitHub API
//     and archive.org metadata/files give the same data with CORS.
// A transport failure is never reported as "authentication required".

export type ProviderErrorCode =
  | "CANCELLED"
  | "TIMEOUT"
  | "NETWORK"
  | "RELAY_UNAVAILABLE"
  | "RELAY_REFUSED"
  | "CORS_BLOCKED"
  | "RATE_LIMITED"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SERVER_ERROR"
  | "HTTP_ERROR"
  | "SIZE_LIMIT"
  | "PARSE_ERROR"
  | "UNSUPPORTED";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly url?: string;
  readonly host?: string;
  readonly detail?: string;
  readonly retryable: boolean;
  readonly providerId?: string;

  constructor(
    code: ProviderErrorCode,
    message: string,
    opts: {
      status?: number;
      retryAfterSeconds?: number;
      url?: string;
      detail?: string;
      providerId?: string;
      retryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = opts.status;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.url = opts.url;
    this.detail = opts.detail;
    this.providerId = opts.providerId;
    this.retryable =
      opts.retryable ??
      (code === "TIMEOUT" || code === "NETWORK" || code === "SERVER_ERROR" || code === "RATE_LIMITED");
    try {
      this.host = opts.url ? new URL(opts.url).hostname : undefined;
    } catch {
      this.host = undefined;
    }
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/** Abort-aware cancellation check shared by every adapter loop. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal && signal.aborted) {
    throw new ProviderError("CANCELLED", "The request was cancelled.", { retryable: false });
  }
}

export interface ProviderContext {
  /** Injected for tests (deterministic fixtures) and for the browser. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Server relay base, e.g. "/api/providers/relay". Empty = direct only. */
  relayBase?: string;
  /** Optional provider token (GitHub PAT, Openverse token). NEVER required for
   *  public content: a public README must never ask for a password. */
  githubToken?: string;
  openverseToken?: string;
  timeoutMs?: number;
  /** Called for observable, incrementally reported progress (nested lists). */
  onProgress?: (ev: ProviderProgress) => void;
  /** Cooperative pause between pages so a long nested crawl stays cancellable. */
  maxRequests?: number;
}

export interface ProviderProgress {
  providerId: string;
  stage: string;
  message: string;
  done?: number;
  total?: number;
}

export interface RawResponse {
  status: number;
  ok: boolean;
  url: string;
  finalUrl: string;
  headers: Headers;
  text: string;
  transport: "direct" | "relay";
  bytes: number;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BYTES = 2_000_000;

function retryAfterFrom(headers: Headers): number | undefined {
  const ra = headers.get("retry-after");
  if (!ra) return undefined;
  const n = Number(ra);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  const when = Date.parse(ra);
  if (!Number.isNaN(when)) return Math.max(0, Math.round((when - Date.now()) / 1000));
  return undefined;
}

/** Rate-limit evidence: GitHub uses x-ratelimit-*, Openverse uses
 *  x-ratelimit-available / ratelimit-*. Return the seconds to wait when the
 *  provider says "you are out", else undefined. */
function rateLimitFromHeaders(headers: Headers): number | undefined {
  const remaining = headers.get("x-ratelimit-remaining");
  if (remaining != null && Number(remaining) === 0) {
    const reset = headers.get("x-ratelimit-reset");
    if (reset && Number.isFinite(Number(reset))) {
      return Math.max(1, Math.round(Number(reset) - Date.now() / 1000));
    }
    const ra = retryAfterFrom(headers);
    return ra ?? 60;
  }
  const avail = headers.get("x-ratelimit-available");
  if (avail != null && Number(avail) <= 0) return retryAfterFrom(headers) ?? 60;
  return undefined;
}

function classifyStatus(status: number, headers: Headers, url: string): ProviderError {
  const limited = rateLimitFromHeaders(headers);
  if (status === 429) {
    return new ProviderError("RATE_LIMITED", "The provider is rate limiting this client.", {
      status,
      url,
      retryAfterSeconds: retryAfterFrom(headers) ?? limited ?? 60,
    });
  }
  if (status === 401) {
    return new ProviderError(
      "AUTH_REQUIRED",
      "The provider requires a credential for THIS request.",
      { status, url, retryable: false }
    );
  }
  if (status === 403) {
    // A 403 with the rate-limit budget exhausted is a LIMIT, not a refusal to
    // serve the content, and definitively not a missing password.
    if (limited != null) {
      return new ProviderError("RATE_LIMITED", "The provider's rate limit is exhausted.", {
        status,
        url,
        retryAfterSeconds: limited,
      });
    }
    return new ProviderError("FORBIDDEN", "The provider refused this request (403).", {
      status,
      url,
      retryable: false,
    });
  }
  if (status === 404 || status === 410) {
    return new ProviderError("NOT_FOUND", "The page or item does not exist (404).", {
      status,
      url,
      retryable: false,
    });
  }
  if (status >= 500) {
    return new ProviderError("SERVER_ERROR", `The provider failed with HTTP ${status}.`, { status, url });
  }
  return new ProviderError("HTTP_ERROR", `The provider answered HTTP ${status}.`, {
    status,
    url,
    retryable: false,
  });
}

function isAbortError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * GET a URL and return the body, or throw a typed ProviderError.
 *
 * `transport: "relay"` routes through the dashboard server's
 * /api/providers/relay so a host that sends no CORS header can still be read.
 * A relay refusal is named RELAY_UNAVAILABLE / RELAY_REFUSED - it never turns
 * into "please sign in".
 */
export async function getResource(
  url: string,
  ctx: ProviderContext,
  opts: { accept?: string; transport?: "auto" | "direct" | "relay"; headers?: Record<string, string> } = {}
): Promise<RawResponse> {
  throwIfAborted(ctx.signal);
  const transportPref = opts.transport ?? "auto";
  const direct = async (): Promise<RawResponse> => {
    const f = ctx.fetchImpl ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new ProviderError("NETWORK", "No fetch implementation is available.", { url });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener("abort", onAbort);
    try {
      const res = await f(url, {
        method: "GET",
        redirect: "follow",
        credentials: "omit",
        signal: controller.signal,
        headers: {
          Accept: opts.accept ?? "*/*",
          ...(opts.headers || {}),
        },
      });
      const text = await res.text();
      if (text.length > MAX_BYTES) {
        throw new ProviderError("SIZE_LIMIT", "The provider response was larger than the 2 MB reader cap.", {
          status: res.status,
          url,
        });
      }
      if (!res.ok) throw classifyStatus(res.status, res.headers, res.url || url);
      return {
        status: res.status,
        ok: true,
        url,
        finalUrl: res.url || url,
        headers: res.headers,
        text,
        transport: "direct",
        bytes: text.length,
      };
    } catch (e) {
      if (isProviderError(e)) throw e;
      if (ctx.signal?.aborted) {
        throw new ProviderError("CANCELLED", "The request was cancelled.", { url, retryable: false });
      }
      if (isAbortError(e)) {
        throw new ProviderError("TIMEOUT", `The provider did not answer within ${(ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s.`, { url });
      }
      // A browser reports an opaque failure for BOTH an offline network and a
      // CORS refusal; the message differs, so keep it and name the remedy.
      const msg = String((e as Error)?.message || e);
      const cors = /cors|failed to fetch|networkerror|load failed/i.test(msg);
      throw new ProviderError(cors ? "CORS_BLOCKED" : "NETWORK", cors
        ? "The browser could not read this host directly (CORS). Use the server relay for this source."
        : "The provider could not be reached.", { url, detail: msg.slice(0, 240) });
    } finally {
      clearTimeout(timeout);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
  };

  const viaRelay = async (): Promise<RawResponse> => {
    const base = ctx.relayBase;
    if (!base) {
      throw new ProviderError(
        "RELAY_UNAVAILABLE",
        "This host does not allow direct browser access (no CORS header) and the server relay is not configured in this build.",
        { url }
      );
    }
    const f = ctx.fetchImpl ?? globalThis.fetch;
    const relayUrl = `${base}${base.includes("?") ? "&" : "?"}url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await f(relayUrl, { method: "GET", credentials: "omit", signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        let code = "RELAY_REFUSED";
        let message = `The server relay refused this URL (HTTP ${res.status}).`;
        try {
          const body = JSON.parse(text) as { code?: string; messageKey?: string; details?: { reason?: string } };
          if (body.code) code = body.code === "RATE_LIMITED" ? "RATE_LIMITED" : "RELAY_REFUSED";
          if (body.messageKey) message = `${message} ${body.messageKey}`;
          if (body.details?.reason) message = `${message} (${body.details.reason})`;
        } catch {
          /* a non-JSON relay error body keeps the status-derived sentence */
        }
        throw new ProviderError(code as ProviderErrorCode, message, {
          status: res.status,
          url,
          retryAfterSeconds: retryAfterFrom(res.headers),
        });
      }
      const finalHost = res.headers.get("x-relay-final-url") || url;
      return {
        status: 200,
        ok: true,
        url,
        finalUrl: finalHost,
        headers: res.headers,
        text,
        transport: "relay",
        bytes: text.length,
      };
    } catch (e) {
      if (isProviderError(e)) throw e;
      if (isAbortError(e)) throw new ProviderError("TIMEOUT", "The relay did not answer in time.", { url });
      throw new ProviderError("RELAY_UNAVAILABLE", "The dashboard server relay is unreachable.", {
        url,
        detail: String((e as Error)?.message || e).slice(0, 200),
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  if (transportPref === "direct") return direct();
  if (transportPref === "relay") return viaRelay();
  try {
    return await direct();
  } catch (e) {
    if (isProviderError(e) && (e.code === "CORS_BLOCKED" || e.code === "NETWORK") && ctx.relayBase) {
      // Only a transport-level refusal falls back; an HTTP status is the
      // provider's answer and must not be re-sent through the relay.
      return viaRelay();
    }
    if (isProviderError(e) && (e.code === "CORS_BLOCKED" || e.code === "NETWORK")) {
      throw new ProviderError("RELAY_UNAVAILABLE", e.message, { url, detail: e.detail });
    }
    throw e;
  }
}

/** JSON convenience: parse failure is PARSE_ERROR with the host, never a shrug. */
export async function getJson<T>(url: string, ctx: ProviderContext, opts: { transport?: "auto" | "direct" | "relay"; headers?: Record<string, string> } = {}): Promise<{ data: T; res: RawResponse }> {
  const res = await getResource(url, ctx, { ...opts, accept: "application/json" });
  try {
    return { data: JSON.parse(res.text) as T, res };
  } catch (e) {
    throw new ProviderError("PARSE_ERROR", "The provider answered with something that is not JSON.", {
      url,
      status: res.status,
      detail: String((e as Error)?.message || e).slice(0, 200),
    });
  }
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  return p.toString();
}

/** Host names an adapter is allowed to touch; used by the relay allowlist
 *  mirror on the client so a custom source can never redirect the relay. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function normalizeHttpUrl(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  let candidate = s;
  if (/^\/\//.test(candidate)) candidate = "https:" + candidate;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = "https://" + candidate.replace(/^\/+/, "");
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  // Fragments are meaningful for a README anchor (`#readme`) but not for the
  // request itself, so callers that fetch strip them; the classifier keeps them.
  return u.toString();
}
