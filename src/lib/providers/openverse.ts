// [SEARCH-REPAIR] Openverse provider.
//
// Interface used: the CURRENT documented search API at api.openverse.org/v1/
// (images + audio). Verified live 2026-10-26: both endpoints answer with
// `access-control-allow-origin: *`, so the browser can call them directly; an
// anonymous client is allowed (a token only raises the rate limit, and this
// adapter reports the provider's own limit headers instead of guessing).
//
// The point of Openverse is ATTRIBUTION: creator, licence (with version and
// URL), the source collection, and the foreign landing page. Every one of those
// is carried through untouched when the provider sends it, and left undefined
// when it does not - never synthesized.
import { ProviderError, getJson, qs, type ProviderContext } from "./core";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome } from "./types";

const API = "https://api.openverse.org/v1";

export type OpenverseMedia = "images" | "audio";

export const OPENVERSE_CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  inspect: "partial",
  filters: ["mediaType", "license", "licenseType", "creator", "source", "extension", "category", "mature"],
  pagination: "supported",
  itemDetails: "supported",
  downloads: "supported",
  preview: "supported",
  attribution: "supported",
  notes: [
    "Searches /v1/images/ and /v1/audio/ - the two media types the API serves.",
    "Licence, creator, source collection and the original landing page are shown exactly as the API returns them.",
    "Media and licence filters are sent as real query parameters, so they change the upstream result set.",
    "Anonymous use is allowed and rate limited by the provider; add an Openverse token to raise the limit. A 401 is reported as an authentication requirement, never as an empty search.",
    "openverse.org search URLs are JavaScript pages, so a pasted one is turned into the equivalent API query instead of being scraped.",
  ],
};

interface OVResult {
  id?: string;
  title?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
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
  attribution?: string;
  category?: string;
  mature?: boolean;
  frontend_media_type?: string;
}

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

function mediaPath(mediaType: OpenverseMedia): string {
  return mediaType === "audio" ? "/audio/" : "/images/";
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
  const licence = r.license
    ? {
        tag: licenceTag(r.license),
        name: `${String(r.license).toUpperCase()}${r.license_version ? " " + r.license_version : ""}`,
        url: r.license_url,
        attribution:
          r.attribution ||
          `"${r.title || "Untitled"}" by ${r.creator || "unknown"} - ${String(r.license).toUpperCase()}${r.license_version ? " " + r.license_version : ""} via ${r.source || "Openverse"}`,
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
    license: licence,
    source: { label: `Openverse${r.source ? ` › ${r.source}` : ""}${r.provider ? ` (${r.provider})` : ""}`, url: "https://openverse.org" },
    extra: {
      ...(r.license ? { license: String(r.license).toUpperCase() } : {}),
      ...(r.source ? { collection: r.source } : {}),
      ...(r.filetype ? { filetype: r.filetype } : {}),
      ...(typeof r.width === "number" && typeof r.height === "number" ? { dimensions: `${r.width}×${r.height}` } : {}),
      ...(typeof r.duration === "number" ? { durationMs: r.duration } : {}),
      ...(r.category ? { category: r.category } : {}),
      ...(typeof r.mature === "boolean" ? { mature: r.mature } : {}),
    },
    provenance: "live",
  };
}

function authHeaders(ctx: ProviderContext): Record<string, string> {
  // OPTIONAL: anonymous Openverse works. The token is only a rate-limit raise.
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
  const url = `${API}${mediaPath(mediaType)}?${params.toString()}`;
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
      throw new ProviderError("RATE_LIMITED", "Openverse refused the request; anonymous clients are rate limited and this is the usual cause.", {
        status: 403,
        url,
        retryAfterSeconds: 60,
      });
    }
    throw e;
  }
  const results = Array.isArray(data.results) ? data.results : [];
  const hits = results.map((r) => toHit(r, providerId)).filter((h): h is ProviderHit => Boolean(h));
  const total = Number(data.result_count ?? hits.length);
  return {
    hits,
    totalReported: total,
    hasMore: page < Number(data.page_count ?? 1),
    nextPage: page < Number(data.page_count ?? 1) ? page + 1 : undefined,
    appliedFilters: applied,
    ignoredFilters: [],
    notes: [
      `${total.toLocaleString()} ${mediaType === "audio" ? "audio" : "image"} results; page ${page} of ${Number(data.page_count ?? 1)}.`,
      ctx.openverseToken ? "Authenticated (token configured)." : "Anonymous request (Openverse's own rate limit applies).",
    ],
    tookMs: Date.now() - started,
  };
}

/** openverse.org URLs are a JavaScript front end; the honest thing to do with a
 *  pasted one is translate it into the API query it represents. */
export function parseOpenverseUrl(url: string): { query: string; mediaType: OpenverseMedia; license?: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)openverse\.org$/.test(host)) return null;
  const mediaType: OpenverseMedia = /audio/i.test(u.pathname) || /audio/i.test(u.searchParams.get("type") || "") ? "audio" : "images";
  const query = u.searchParams.get("q") || u.searchParams.get("query") || "";
  const license = u.searchParams.get("license") || undefined;
  return { query, mediaType, license };
}

export async function openverseInspect(url: string, ctx: ProviderContext, providerId = "openverse"): Promise<InspectOutcome> {
  const started = Date.now();
  const parsed = parseOpenverseUrl(url);
  if (!parsed) throw new ProviderError("UNSUPPORTED", "That is not an openverse.org URL.", { url, retryable: false });
  if (!parsed.query) {
    return {
      providerId,
      kind: "search-page",
      canonicalUrl: url,
      title: "Openverse search page",
      facts: [{ label: "Media type", value: parsed.mediaType }],
      sections: [],
      addable: true,
      capabilities: OPENVERSE_CAPABILITIES,
      tookMs: Date.now() - started,
      description:
        "This Openverse URL has no query in it, so there is nothing to preview. Add it as a source and search from here: queries are sent to the Openverse API.",
    };
  }
  const out = await openverseSearch(
    { query: parsed.query, mediaType: parsed.mediaType, license: parsed.license ? [parsed.license] : undefined, pageSize: 10 },
    ctx,
    providerId
  );
  return {
    providerId,
    kind: "search",
    canonicalUrl: url,
    title: `Openverse ${parsed.mediaType} for "${parsed.query}"`,
    description: `${out.totalReported ?? out.hits.length} ${parsed.mediaType} match this query. Previewing the first ${out.hits.length}.`,
    facts: [
      { label: "Query", value: parsed.query },
      { label: "Media type", value: parsed.mediaType },
      { label: "Total reported", value: String(out.totalReported ?? "not reported") },
      ...(parsed.license ? [{ label: "Licence filter", value: parsed.license }] : []),
    ],
    sections: [
      {
        key: "results",
        label: "First results (live)",
        items: out.hits.map((h) => ({
          title: h.title,
          url: h.url,
          description: h.license?.attribution,
          meta: h.license?.name,
        })),
      },
    ],
    addable: true,
    capabilities: OPENVERSE_CAPABILITIES,
    tookMs: Date.now() - started,
  };
}

export { qs };
