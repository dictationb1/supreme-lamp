// [SEARCH-REPAIR] Openverse provider (current API: /v1/images/ and /v1/audio/).
//
// Verified against the live service (2026-10-26): anonymous requests work, the
// filters that change the request are q, page, page_size, license, license_type,
// creator, source, extension and category, and every result carries the licence,
// its URL, the attribution line and the original landing page.
//
// openverse.org itself is a JavaScript front end; a pasted openverse.org search
// URL is therefore TRANSLATED into the API query it represents instead of being
// scraped (which could only ever return an empty shell).
import { ProviderError, getJson, type ProviderContext } from "./core";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome } from "./types";

const API = "https://api.openverse.org/v1";

export type OpenverseMedia = "images" | "audio";

export const OPENVERSE_CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  pagination: "supported",
  filters: ["mediaType", "license", "licenseType", "creator", "source", "extension", "category"],
  itemDetail: "partial",
  files: "supported",
  preview: "supported",
  license: "supported",
  notes: [
    "Searches the current /v1/images/ and /v1/audio/ endpoints; the media type chooses which one is called.",
    "Licence and media filters are sent to Openverse, so pagination counts and totals match the request the operator configured.",
    "Anonymous use is allowed and is the default; an access token is optional and only raises the rate limit. A 401 (bad token) is reported as an authentication problem, a 403 as a refusal, and only a 429 or an exhausted budget as a rate limit.",
    "Every hit carries the licence, the attribution line and the original creator page as Openverse supplies them.",
  ],
};

export interface OpenverseSearchOptions {
  query: string;
  mediaType?: OpenverseMedia;
  license?: string[];
  licenseType?: string;
  creator?: string;
  source?: string;
  extension?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

interface OVResult {
  id?: string;
  title?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  attribution?: string;
  source?: string;
  provider?: string;
  foreign_landing_url?: string;
  url?: string;
  thumbnail?: string;
  filesize?: number;
  filetype?: string;
  width?: number;
  height?: number;
  duration?: number;
  category?: string;
  mature?: boolean;
}

function licenceTag(license?: string): string {
  const l = String(license || "").toLowerCase();
  if (!l) return "open-access";
  if (l === "cc0" || l === "pdm") return "public-domain";
  return "creative-commons";
}

function toHit(r: OVResult, providerId: string): ProviderHit | null {
  const landing = r.foreign_landing_url || r.url;
  if (!landing) return null;
  const license = r.license
    ? {
        tag: licenceTag(r.license),
        name: `${String(r.license).toUpperCase()}${r.license_version ? " " + r.license_version : ""}`,
        url: r.license_url,
        attribution: r.attribution || `"${r.title || "Untitled"}" by ${r.creator || "unknown"} - ${String(r.license).toUpperCase()}`,
      }
    : undefined;
  return {
    id: `ov:${r.id ?? landing}`,
    providerId,
    kind: "media",
    title: r.title || "(untitled)",
    creator: r.creator,
    url: landing,
    fileUrl: r.url,
    previewUrl: r.thumbnail,
    fileSizeBytes: typeof r.filesize === "number" ? r.filesize : undefined,
    license: license
      ? { name: license.name, url: license.url, attribution: license.attribution }
      : undefined,
    source: { label: `Openverse${r.source ? ` › ${r.source}` : ""}${r.provider ? ` (${r.provider})` : ""}`, url: "https://openverse.org" },
    extra: {
      ...(r.license ? { license: String(r.license).toUpperCase() } : {}),
      ...(r.source ? { collection: r.source } : {}),
      ...(r.filetype ? { filetype: r.filetype } : {}),
      ...(typeof r.width === "number" && typeof r.height === "number" ? { dimensions: `${r.width}×${r.height}` } : {}),
      ...(typeof r.duration === "number" ? { durationMs: r.duration } : {}),
      ...(r.creator_url ? { creatorUrl: r.creator_url } : {}),
    },
  };
}

function authHeaders(ctx: ProviderContext): Record<string, string> {
  // OPTIONAL: anonymous Openverse works. The token only raises the ceiling.
  return ctx.openverseToken ? { Authorization: `Bearer ${ctx.openverseToken}` } : {};
}

export async function openverseSearch(o: OpenverseSearchOptions, ctx: ProviderContext, providerId = "openverse"): Promise<SearchOutcome> {
  const started = Date.now();
  const mediaType: OpenverseMedia = o.mediaType === "audio" ? "audio" : "images";
  const pageSize = Math.max(1, Math.min(50, o.pageSize ?? 20));
  const page = Math.max(1, o.page ?? 1);
  const params = new URLSearchParams();
  params.set("q", String(o.query || "").trim());
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  const applied: string[] = ["q", "page", "page_size"];
  if (o.license && o.license.length) {
    params.set("license", o.license.join(","));
    applied.push("license");
  }
  if (o.licenseType) {
    params.set("license_type", o.licenseType);
    applied.push("license_type");
  }
  if (o.creator) {
    params.set("creator", o.creator);
    applied.push("creator");
  }
  if (o.source) {
    params.set("source", o.source);
    applied.push("source");
  }
  if (o.extension) {
    params.set("extension", o.extension);
    applied.push("extension");
  }
  if (o.category) {
    params.set("category", o.category);
    applied.push("category");
  }
  const url = `${API}/${mediaType}/?${params.toString()}`;
  let data: { result_count?: number; page_count?: number; results?: OVResult[] };
  try {
    data = (await getJson<typeof data>(url, ctx, { headers: authHeaders(ctx) })).data;
  } catch (e) {
    if (e instanceof ProviderError && e.code === "AUTH_REQUIRED") {
      throw new ProviderError(
        "AUTH_REQUIRED",
        "Openverse rejected this client's credentials. Anonymous search normally works - remove the configured token or supply a valid one.",
        { status: 401, url, retryable: false }
      );
    }
    if (e instanceof ProviderError && e.code === "FORBIDDEN") {
      // A plain 403 is a REFUSAL, not a limit: the shared transport already
      // upgrades a 403 whose rate-limit headers say the budget is spent to
      // RATE_LIMITED, so anything that reaches here has no such evidence and
      // must not be guessed into a "wait and retry" message.
      throw new ProviderError(
        "FORBIDDEN",
        "Openverse refused this request (403). That is a refusal rather than a rate limit - an anonymous client is normally allowed, so check the query and any configured token.",
        { status: 403, url, retryable: false }
      );
    }
    throw e;
  }
  const results = Array.isArray(data.results) ? data.results : [];
  const hits = results.map((r) => toHit(r, providerId)).filter((h): h is ProviderHit => Boolean(h));
  const total = Number(data.result_count ?? hits.length);
  const pages = Number(data.page_count ?? 1);
  return {
    hits,
    totalReported: total,
    hasMore: page < pages,
    nextPage: page < pages ? page + 1 : undefined,
    appliedFilters: applied,
    ignoredFilters: [],
    notes: [
      `${total.toLocaleString()} ${mediaType === "audio" ? "audio" : "image"} result(s); page ${page} of ${pages}.`,
      ctx.openverseToken ? "Authenticated (token configured)." : "Anonymous request (Openverse's own rate limit applies).",
    ],
    tookMs: Date.now() - started,
  };
}

/** Translate an openverse.org URL into the API query it represents. */
export function parseOpenverseUrl(url: string): { query: string; mediaType: OpenverseMedia; license?: string } | null {
  let u: URL;
  try {
    u = new URL(String(url || "").trim());
  } catch {
    return null;
  }
  if (!/(^|\.)openverse\.org$/.test(u.hostname.toLowerCase())) return null;
  const q = u.searchParams.get("q") || u.searchParams.get("query") || "";
  const type = (u.searchParams.get("type") || u.searchParams.get("media") || "").toLowerCase();
  const mediaType: OpenverseMedia = type === "audio" || /\/audio/.test(u.pathname) ? "audio" : "images";
  return { query: q, mediaType, license: u.searchParams.get("license") || undefined };
}

export async function openverseInspect(url: string, ctx: ProviderContext, providerId = "openverse"): Promise<InspectOutcome> {
  const started = Date.now();
  const parsed = parseOpenverseUrl(url);
  if (!parsed) throw new ProviderError("UNSUPPORTED", "That is not an openverse.org URL.", { url, retryable: false });
  const facts: InspectOutcome["facts"] = [
    { label: "Site", value: "openverse.org (JavaScript front end)", fromProvider: false },
    { label: "Interface used", value: "api.openverse.org/v1", fromProvider: false },
  ];
  if (!parsed.query) {
    return {
      providerId,
      kind: "homepage",
      canonicalUrl: url,
      title: "Openverse",
      description: "Openly licensed images and audio. Add it as a source and search from the Search page - Openverse has no page content to read.",
      sections: [],
      facts,
      addable: true,
      capabilities: OPENVERSE_CAPABILITIES,
      provenance: "live",
      tookMs: Date.now() - started,
    };
  }
  // A search URL is a real query: run it and show what it returns.
  const out = await openverseSearch({ query: parsed.query, mediaType: parsed.mediaType, license: parsed.license ? [parsed.license] : undefined, pageSize: 10 }, ctx, providerId);
  facts.unshift({ label: "Query", value: parsed.query, fromProvider: false });
  facts.push({ label: "Media type", value: parsed.mediaType, fromProvider: false });
  facts.push({ label: "Results", value: String(out.totalReported ?? out.hits.length), fromProvider: true });
  return {
    providerId,
    kind: "search",
    canonicalUrl: url,
    title: `Openverse ${parsed.mediaType} for "${parsed.query}"`,
    description: `${(out.totalReported ?? out.hits.length).toLocaleString()} result(s) in Openverse.`,
    sections: [
      {
        key: "results",
        label: "Current results",
        items: out.hits.map((h) => ({ title: h.title, url: h.url, note: [h.creator, h.license?.name].filter(Boolean).join(" · ") })),
      },
    ],
    facts,
    addable: true,
    capabilities: OPENVERSE_CAPABILITIES,
    provenance: "live",
    tookMs: Date.now() - started,
  };
}
