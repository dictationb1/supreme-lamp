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
import { OPENCULTURE_CAPABILITIES, isOpenCultureUrl, opencultureInspect, opencultureSearch } from "./openculture";
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
    label: "GitHub (repositories, awesome lists, releases)",
    homepage: "https://github.com",
    hosts: ["github.com", "api.github.com", "raw.githubusercontent.com", "awesome.re"],
    defaultEnabled: true,
    capabilities: GITHUB_CAPABILITIES,
    filterKeys: ["listMode"],
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
    filterKeys: ["mediaType", "license", "creator", "source"],
  },
  {
    id: "openculture",
    nameKey: "search.providers.openCulture",
    label: "Open Culture",
    homepage: "https://www.openculture.com",
    hosts: ["openculture.com", "www.openculture.com"],
    defaultEnabled: true,
    capabilities: OPENCULTURE_CAPABILITIES,
    filterKeys: ["feedPages", "sitemapScan"],
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

  if (parseGithubUrl(normalized)) {
    const ref = parseGithubUrl(normalized)!;
    return {
      url: raw,
      normalized,
      kind: "url",
      providerId: "github",
      subkind: ref.kind,
      resolvedFrom: ref.resolvedFrom,
    };
  }
  if (/(^|\.)archive\.org$/.test(host) && parseArchiveUrl(normalized)) {
    const p = parseArchiveUrl(normalized)!;
    return { url: raw, normalized, kind: "url", providerId: "internet-archive", subkind: p.kind };
  }
  if (parseOpenverseUrl(normalized)) {
    const p = parseOpenverseUrl(normalized)!;
    return { url: raw, normalized, kind: "url", providerId: "openverse", subkind: p.query ? "search" : "homepage" };
  }
  if (isOpenCultureUrl(normalized)) {
    const path = new URL(normalized).pathname;
    return { url: raw, normalized, kind: "url", providerId: "openculture", subkind: path === "/" ? "homepage" : "article" };
  }
  if (isFmhyUrl(normalized)) {
    return { url: raw, normalized, kind: "url", providerId: "fmhy", subkind: "wiki-page" };
  }
  if (isRentryUrl(normalized)) {
    return { url: raw, normalized, kind: "url", providerId: "rentry", subkind: "curated-page" };
  }
  return { url: raw, normalized, kind: "url", providerId: "custom" };
}

export function looksLikeUrl(input: string): boolean {
  const s = String(input || "").trim();
  return /^https?:\/\//i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s);
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

function sourceToRunner(src: SourceSpec) {
  switch (src.providerId) {
    case "github":
      return (q: string, ctx: ProviderContext, signal?: AbortSignal) => githubSearch({ query: q, limit: 20, signal }, { ...ctx, signal });
    case "internet-archive":
      return (q: string, ctx: ProviderContext, signal?: AbortSignal) =>
        archiveSearch({ query: q, rows: 20, signal }, { ...ctx, signal });
    case "openverse":
      return (q: string, ctx: ProviderContext, signal?: AbortSignal) =>
        openverseSearch({ query: q, pageSize: 20, signal }, { ...ctx, signal });
    case "openculture":
      return (q: string, ctx: ProviderContext, signal?: AbortSignal) =>
        opencultureSearch({ query: q, feedPages: 2, sitemapScan: true, signal }, { ...ctx, signal });
    case "fmhy":
      return (q: string, ctx: ProviderContext, signal?: AbortSignal) =>
        fmhySearch({ query: q, maxPages: 2, signal }, { ...ctx, signal }, src.baseUrl || "https://fmhy.net/misc");
    case "rentry":
      return (q: string, ctx: ProviderContext, signal?: AbortSignal) =>
        rentrySearch({ query: q, depth: 1, maxPages: 4, signal }, { ...ctx, signal }, src.baseUrl || "https://rentry.org/megathread");
    default:
      return (q: string, ctx: ProviderContext, signal?: AbortSignal) =>
        genericSearch({ query: q, url: src.baseUrl || "", signal }, { ...ctx, signal }, src.id);
  }
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
        const run = sourceToRunner(src);
        const out = await run(opts.query, ctx, opts.signal);
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
