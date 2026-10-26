// [SEARCH-REPAIR] Provider registry + the search lane.
//
// One place decides: which provider owns a pasted URL, which providers a query
// fans out to, and how each source's outcome is reported (results, empty,
// rate-limited, auth-required, unsupported, cancelled). The UI consumes the
// events; it never re-implements a provider rule.
import { ProviderError, hostOf, isProviderError, normalizeHttpUrl, type ProviderContext } from "./core";
import { GITHUB_CAPABILITIES, githubInspect, githubSearch, parseGithubUrl } from "./github";
import { ARCHIVE_CAPABILITIES, archiveInspect, archiveSearch, parseArchiveUrl } from "./archive";
import { OPENVERSE_CAPABILITIES, openverseInspect, openverseSearch, parseOpenverseUrl } from "./openverse";
import { OPENCULTURE_CAPABILITIES, clearOpenCultureCache, isOpenCultureUrl, opencultureInspect, opencultureSearch } from "./openculture";
import {
  FMHY_CAPABILITIES,
  GENERIC_CAPABILITIES,
  RENTRY_CAPABILITIES,
  fmhyInspect,
  fmhySearch,
  genericInspect,
  genericSearch,
  isFmhyUrl,
  isRentryUrl,
  rentryInspect,
  rentrySearch,
} from "./listings";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome } from "./types";

export * from "./types";
export { ProviderError, isProviderError, normalizeHttpUrl, hostOf } from "./core";

export type BuiltinProviderId = "github" | "internet-archive" | "openverse" | "openculture" | "fmhy" | "rentry";

export interface BuiltinProvider {
  id: BuiltinProviderId;
  nameKey: string;
  label: string;
  homepage: string;
  hosts: string[];
  defaultEnabled: boolean;
  capabilities: ProviderCapabilities;
  /** Filters the UI may offer for this provider (subset of capabilities.filters). */
  filterKeys: string[];
}

export const BUILTIN_PROVIDERS: BuiltinProvider[] = [
  {
    id: "github",
    nameKey: "search.providers.github",
    label: "GitHub (repositories, READMEs, awesome lists)",
    homepage: "https://github.com",
    hosts: ["github.com", "api.github.com", "raw.githubusercontent.com", "awesome.re"],
    defaultEnabled: true,
    capabilities: GITHUB_CAPABILITIES,
    filterKeys: ["sort", "listMode"],
  },
  {
    id: "internet-archive",
    nameKey: "search.providers.internetArchive",
    label: "Internet Archive",
    homepage: "https://archive.org",
    hosts: ["archive.org"],
    defaultEnabled: true,
    capabilities: ARCHIVE_CAPABILITIES,
    filterKeys: ["mediatype", "collection", "language", "year", "sort"],
  },
  {
    id: "openverse",
    nameKey: "search.providers.openverse",
    label: "Openverse (images & audio)",
    homepage: "https://openverse.org",
    hosts: ["openverse.org", "api.openverse.org"],
    defaultEnabled: true,
    capabilities: OPENVERSE_CAPABILITIES,
    filterKeys: ["mediaType", "license", "licenseType", "creator", "source"],
  },
  {
    id: "openculture",
    nameKey: "search.providers.openCulture",
    label: "Open Culture",
    homepage: "https://www.openculture.com",
    hosts: ["openculture.com", "www.openculture.com"],
    defaultEnabled: true,
    capabilities: OPENCULTURE_CAPABILITIES,
    filterKeys: ["feedPages", "sitemap"],
  },
  {
    id: "fmhy",
    nameKey: "search.providers.fmhy",
    label: "FMHY (Free Media Heck Yeah)",
    homepage: "https://fmhy.net",
    hosts: ["fmhy.net", "www.fmhy.net"],
    defaultEnabled: false,
    capabilities: FMHY_CAPABILITIES,
    filterKeys: ["pages"],
  },
  {
    id: "rentry",
    nameKey: "search.providers.rentry",
    label: "rentry.org curated pages",
    homepage: "https://rentry.org",
    hosts: ["rentry.org", "rentry.co", "www.rentry.org", "www.rentry.co"],
    defaultEnabled: false,
    capabilities: RENTRY_CAPABILITIES,
    filterKeys: ["depth", "pages"],
  },
];

export function builtinById(id: string): BuiltinProvider | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id);
}

/** Every host the relay may be asked for by a BUILT-IN provider. Custom sources
 *  add their own exact host; nothing else is ever relayed. */
export const BUILTIN_RELAY_HOSTS: string[] = Array.from(
  new Set(
    BUILTIN_PROVIDERS.flatMap((p) => p.hosts).concat([
      "archive.org",
      "services.archive.org",
      "api.openverse.org",
      "www.openculture.com",
      "fmhy.net",
      "rentry.org",
      "rentry.co",
    ])
  )
);

export interface UrlClassification {
  url: string;
  /** http(s) normalised form, or null when the input is not a URL at all. */
  normalized: string | null;
  kind: "url" | "query";
  providerId: BuiltinProviderId | "custom" | null;
  /** What the URL is inside that provider (repo, item, article, page...). */
  subkind?: string;
  /** Set when the URL is a known alias of another canonical URL. */
  resolvedFrom?: string;
  reason?: string;
}

/** Classify a pasted URL. `www.` variants, fragments (`#readme`), API hosts,
 *  canonical aliases (awesome.re) and provider-specific paths are all handled
 *  here so no caller has to guess - and so a legitimate canonical redirect is
 *  never reported as a hostname mismatch. */
export function classifyUrl(input: string): UrlClassification {
  const raw = String(input || "").trim();
  const normalized = normalizeHttpUrl(raw);
  if (!normalized) return { url: raw, normalized: null, kind: "query", providerId: null, reason: "not a URL" };
  const host = hostOf(normalized);

  const gh = parseGithubUrl(normalized);
  if (gh && (host === "github.com" || host === "api.github.com" || host === "raw.githubusercontent.com" || host === "awesome.re")) {
    return { url: raw, normalized, kind: "url", providerId: "github", subkind: gh.kind, resolvedFrom: gh.resolvedFrom };
  }
  const ia = parseArchiveUrl(normalized);
  if (ia) return { url: raw, normalized, kind: "url", providerId: "internet-archive", subkind: ia.kind };
  if (parseOpenverseUrl(normalized)) {
    const p = parseOpenverseUrl(normalized)!;
    return { url: raw, normalized, kind: "url", providerId: "openverse", subkind: p.query ? "search" : "homepage" };
  }
  if (isOpenCultureUrl(normalized)) {
    let path = "/";
    try {
      path = new URL(normalized).pathname;
    } catch {
      path = "/";
    }
    return { url: raw, normalized, kind: "url", providerId: "openculture", subkind: path === "/" || path === "" ? "homepage" : "article" };
  }
  if (isFmhyUrl(normalized)) return { url: raw, normalized, kind: "url", providerId: "fmhy", subkind: "wiki-page" };
  if (isRentryUrl(normalized)) return { url: raw, normalized, kind: "url", providerId: "rentry", subkind: "curated-page" };
  return { url: raw, normalized, kind: "url", providerId: "custom" };
}

export function looksLikeUrl(input: string): boolean {
  const s = String(input || "").trim();
  return /^https?:\/\//i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s);
}

/** Clear every adapter's in-memory cache (feed pages). Called by the Search
 *  store at the start of a new search, and by the tests. */
export function clearProviderCaches(): void {
  clearOpenCultureCache();
}

// ------------------------------------------------------------- the lane ----

export type SourceStatusValue = "queued" | "running" | "complete" | "empty" | "failed" | "cancelled" | "unsupported";

export interface SourceSpec {
  /** Registry id (a builtin provider id, or the stored custom source id). */
  id: string;
  label: string;
  kind: "builtin" | "custom";
  baseUrl?: string;
  /** Free-text operator notes: what they want to find on this site. */
  notes?: string;
  providerId?: BuiltinProviderId;
  nameKey?: string;
}

export interface SourceOutcome {
  sourceId: string;
  label: string;
  status: SourceStatusValue;
  hits: ProviderHit[];
  totalReported?: number;
  notes: string[];
  appliedFilters: string[];
  ignoredFilters: string[];
  hasMore: boolean;
  error?: { code: string; message: string; retryAfterSeconds?: number };
  tookMs: number;
}

export type LaneEvent =
  | { type: "source-start"; sourceId: string; label: string }
  | { type: "source-progress"; sourceId: string; message: string; done?: number; total?: number }
  | { type: "source-done"; outcome: SourceOutcome }
  | { type: "lane-done"; tookMs: number; outcomes: SourceOutcome[] };

export interface LaneOptions {
  query: string;
  sources: SourceSpec[];
  ctx?: ProviderContext;
  limit?: number;
  filters?: Record<string, string | string[] | number | boolean | undefined>;
  onEvent?: (ev: LaneEvent) => void;
  onHits?: (sourceId: string, hits: ProviderHit[]) => void;
  signal?: AbortSignal;
}

type Runner = (query: string, ctx: ProviderContext, src: SourceSpec, limit: number) => Promise<SearchOutcome>;

const RUNNERS: Record<BuiltinProviderId, Runner> = {
  github: (q, ctx, _src, limit) => githubSearch({ query: q, limit, maxLists: 1 }, ctx),
  "internet-archive": (q, ctx, _src, limit) => archiveSearch({ query: q, rows: limit, signal: ctx.signal }, ctx),
  openverse: (q, ctx, _src, limit) => openverseSearch({ query: q, pageSize: Math.min(50, limit) }, ctx),
  openculture: (q, ctx, _src, limit) => opencultureSearch({ query: q, feedPages: 2, sitemap: true, limit }, ctx),
  fmhy: (q, ctx, src, limit) => fmhySearch({ query: q, maxPages: 2, limit }, ctx, src.baseUrl || "https://fmhy.net/misc"),
  rentry: (q, ctx, src, limit) => rentrySearch({ query: q, depth: 1, maxPages: 4, limit }, ctx, src.baseUrl || "https://rentry.org/megathread"),
};

function runnerFor(src: SourceSpec): Runner {
  if (src.kind === "builtin" && src.providerId && RUNNERS[src.providerId]) return RUNNERS[src.providerId];
  return (q, ctx, spec, limit) => genericSearch({ query: q, url: spec.baseUrl || "", limit, signal: ctx.signal }, ctx, spec.id);
}

function errorToOutcome(src: SourceSpec, e: unknown, started: number): SourceOutcome {
  if (isProviderError(e)) {
    const cancelled = e.code === "CANCELLED";
    const unsupported = e.code === "UNSUPPORTED";
    return {
      sourceId: src.id,
      label: src.label,
      status: cancelled ? "cancelled" : unsupported ? "unsupported" : "failed",
      hits: [],
      notes: [],
      appliedFilters: [],
      ignoredFilters: [],
      hasMore: false,
      error: { code: e.code, message: e.message, retryAfterSeconds: e.retryAfterSeconds },
      tookMs: Date.now() - started,
    };
  }
  return {
    sourceId: src.id,
    label: src.label,
    status: "failed",
    hits: [],
    notes: [],
    appliedFilters: [],
    ignoredFilters: [],
    hasMore: false,
    error: { code: "UNKNOWN", message: String((e as Error)?.message || e) },
    tookMs: Date.now() - started,
  };
}

function outcomeFromSearch(src: SourceSpec, out: SearchOutcome): SourceOutcome {
  return {
    sourceId: src.id,
    label: src.label,
    status: out.hits.length ? "complete" : "empty",
    hits: out.hits,
    totalReported: out.totalReported,
    notes: out.notes,
    appliedFilters: out.appliedFilters,
    ignoredFilters: out.ignoredFilters,
    hasMore: out.hasMore,
    tookMs: out.tookMs,
  };
}

/** Run every source in PARALLEL. One source failing never removes another
 *  source's results, and a failing source never blocks the lane. */
export async function runProviderLane(opts: LaneOptions): Promise<SourceOutcome[]> {
  const started = Date.now();
  const outcomes: SourceOutcome[] = [];
  const sources = opts.sources.filter((s) => s.kind === "custom" || s.providerId);
  if (!sources.length) {
    opts.onEvent?.({ type: "lane-done", tookMs: 0, outcomes });
    return outcomes;
  }
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
  await Promise.all(
    sources.map(async (src) => {
      const sourceStarted = Date.now();
      opts.onEvent?.({ type: "source-start", sourceId: src.id, label: src.label });
      const ctx: ProviderContext = {
        ...(opts.ctx || {}),
        signal: opts.signal ?? opts.ctx?.signal,
        onProgress: (p) => opts.onEvent?.({ type: "source-progress", sourceId: src.id, message: p.message, done: p.done, total: p.total }),
      };
      try {
        const out = await runnerFor(src)(opts.query, ctx, src, limit);
        const outcome = outcomeFromSearch(src, out);
        outcomes.push(outcome);
        opts.onHits?.(src.id, outcome.hits);
        opts.onEvent?.({ type: "source-done", outcome });
      } catch (e) {
        const outcome = errorToOutcome(src, e, sourceStarted);
        outcomes.push(outcome);
        opts.onEvent?.({ type: "source-done", outcome });
      }
    })
  );
  const ordered = [...outcomes].sort((a, b) => sources.findIndex((s) => s.id === a.sourceId) - sources.findIndex((s) => s.id === b.sourceId));
  opts.onEvent?.({ type: "lane-done", tookMs: Date.now() - started, outcomes: ordered });
  return ordered;
}

// ------------------------------------------------------------ inspection ---

export async function inspectUrl(url: string, ctx: ProviderContext, customSourceId?: string): Promise<InspectOutcome> {
  const cls = classifyUrl(url);
  const target = cls.normalized || url;
  if (!cls.normalized) {
    throw new ProviderError("UNSUPPORTED", "That is not a URL this build can open.", { url, retryable: false });
  }
  switch (cls.providerId) {
    case "github":
      return githubInspect(target, ctx);
    case "internet-archive":
      return archiveInspect(target, ctx);
    case "openverse":
      return openverseInspect(target, ctx);
    case "openculture":
      return opencultureInspect(target, ctx);
    case "fmhy":
      return fmhyInspect(target, ctx);
    case "rentry":
      return rentryInspect(target, ctx);
    default:
      return genericInspect(target, ctx, customSourceId || "custom");
  }
}

export function capabilitiesFor(providerId: string): ProviderCapabilities {
  const b = builtinById(providerId);
  if (b) return b.capabilities;
  return GENERIC_CAPABILITIES;
}

export { GENERIC_CAPABILITIES };
