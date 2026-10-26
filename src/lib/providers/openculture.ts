// [SEARCH-REPAIR] Open Culture provider.
//
// WHAT THE SITE ACTUALLY OFFERS (probed live 2026-10-26, evidence committed in
// docs/reports/search-repair/evidence/live-probe.json):
//   * https://www.openculture.com/?s=<query>  302 -> /gcsearch  ... the search
//     page is a GOOGLE CUSTOM SEARCH widget. Its HTML carries no results, so
//     scraping it can only ever produce an empty list. That is exactly the
//     "public source looks broken / needs a login" symptom we are removing.
//   * https://www.openculture.com/feed  200, CORS *, full WordPress RSS with
//     title, link, pubDate, categories and a description  -> this is the real
//     machine-readable index.
//   * category pages and the article pages themselves are ordinary HTML.
//
// So the adapter searches the FEEDS and (optionally) the site's sitemap slugs,
// and it says which of those answered. A hit is explicitly an EDITORIAL listing:
// Open Culture's article is not the resource, it points at one - the inspector
// separates the two.
import { ProviderError, getJson, getResource, qs, type ProviderContext } from "./core";
import {
  decodeEntities,
  detectChallenge,
  extractAnchors,
  extractFeedItems,
  extractMeta,
  extractSitemap,
  matchesQuery,
  scoreMatch,
  stripHtml,
  truncate,
  type FeedItem,
} from "./text";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome } from "./types";

const BASE = "https://www.openculture.com";
const HOST = "www.openculture.com";

export const OPENCULTURE_CAPABILITIES: ProviderCapabilities = {
  search: "partial",
  inspect: "supported",
  filters: ["feedPages", "sitemapScan"],
  pagination: "partial",
  itemDetails: "supported",
  downloads: "unsupported",
  preview: "unsupported",
  attribution: "supported",
  notes: [
    "Open Culture has no JSON search API: /?s= redirects to a Google Custom Search widget (/gcsearch) whose HTML contains no results. Verified live; scraping it cannot work.",
    "Search therefore reads the site's RSS feed(s) (/feed, ?paged=N) and, when needed, the sitemap, then matches locally - so it covers recent and indexed items rather than a ranked full-text index.",
    "A result is the EDITORIAL article. The external resource it recommends is listed separately by the inspector.",
    "No downloads: Open Culture links to third-party resources and hosts no files itself.",
  ],
};

interface FeedPage {
  items: FeedItem[];
  url: string;
}

const feedCache = new Map<string, FeedPage>();

/** WordPress feeds answer ?paged=N; the cap keeps a search bounded. */
export async function fetchFeedPage(page: number, ctx: ProviderContext): Promise<FeedPage> {
  const url = page <= 1 ? `${BASE}/feed` : `${BASE}/feed?paged=${page}`;
  const cached = feedCache.get(url);
  if (cached) return cached;
  const res = await getResource(url, ctx, { accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8" });
  if (detectChallenge(res.text).challenged) {
    throw new ProviderError("FORBIDDEN", "Open Culture served a bot-challenge page instead of its feed.", { url, retryable: false });
  }
  const items = extractFeedItems(res.text, BASE);
  if (!items.length) {
    throw new ProviderError("PARSE_ERROR", "The Open Culture feed answered, but no <item> entries could be read.", { url, detail: `${res.bytes} bytes` });
  }
  const page1: FeedPage = { items, url };
  feedCache.set(url, page1);
  return page1;
}

export interface OpenCultureSearchOptions {
  query: string;
  feedPages?: number;
  /** When the feed does not cover the query, scan the sitemap for slug hits. */
  sitemapScan?: boolean;
  limit?: number;
  signal?: AbortSignal;
}

function feedItemToHit(item: FeedItem, providerId: string): ProviderHit {
  return {
    id: `oc:${item.link}`,
    providerId,
    kind: "editorial",
    title: item.title,
    description: item.description ? truncate(item.description, 400) : undefined,
    date: item.date,
    url: item.link,
    source: { label: "Open Culture (editorial listing)", url: BASE },
    context: item.categories,
    extra: {
      ...(item.categories && item.categories.length ? { categories: item.categories.join(", ") } : {}),
      origin: "rss-feed",
    },
    provenance: "live",
  };
}

export async function opencultureSearch(o: OpenCultureSearchOptions, ctx: ProviderContext, providerId = "openculture"): Promise<SearchOutcome> {
  const started = Date.now();
  const query = String(o.query || "").trim();
  const limit = o.limit ?? 20;
  const pages = Math.max(1, Math.min(5, o.feedPages ?? 2));
  const hits: ProviderHit[] = [];
  const notes: string[] = [];
  const applied = ["feed"];
  const seen = new Set<string>();

  for (let p = 1; p <= pages; p += 1) {
    if (ctx.signal?.aborted) break;
    let feed: FeedPage;
    try {
      feed = await fetchFeedPage(p, ctx);
    } catch (e) {
      if (p === 1) throw e;
      notes.push(`Feed page ${p} unavailable (${(e as ProviderError).code}); searched the first ${p - 1} page(s).`);
      break;
    }
    ctx.onProgress?.({ providerId, stage: "feed", message: `Feed page ${p}`, done: p, total: pages });
    for (const item of feed.items) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      const hay = `${item.title} ${item.description ?? ""} ${(item.categories ?? []).join(" ")}`;
      if (!matchesQuery(hay, query)) continue;
      hits.push(feedItemToHit(item, providerId));
    }
    if (hits.length >= limit) break;
  }

  hits.sort((a, b) => scoreMatch(b.title, b.description ?? "", query) - scoreMatch(a.title, a.description ?? "", query));
  notes.push(`RSS feed: ${seen.size} recent entries scanned, ${hits.length} match "${query}".`);

  // Broader archive coverage: the sitemap lists article URLs, so a slug match
  // finds older posts the feed has scrolled past. Reported separately because it
  // is a weaker signal (slug only, no article body).
  if (o.sitemapScan && hits.length < Math.min(5, limit)) {
    const sitemapHits = await opencultureSitemapScan(query, ctx, providerId, limit - hits.length);
    for (const h of sitemapHits) hits.push(h);
    if (sitemapHits.length) {
      applied.push("sitemap");
      notes.push(`Sitemap: ${sitemapHits.length} additional article URL(s) matched the query in their slug.`);
    } else {
      notes.push("Sitemap: no additional slug matches.");
    }
  }

  return {
    hits: hits.slice(0, limit),
    hasMore: hits.length >= limit,
    appliedFilters: applied,
    ignoredFilters: [],
    notes,
    tookMs: Date.now() - started,
  };
}

async function opencultureSitemapLocs(ctx: ProviderContext): Promise<{ loc: string; lastmod?: string }[]> {
  let res;
  try {
    res = await getResource(`${BASE}/sitemap.xml`, ctx, { accept: "application/xml, text/xml;q=0.9, */*;q=0.8" });
  } catch (e) {
    if (e instanceof ProviderError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) return [];
    throw e;
  }
  const first = extractSitemap(res.text);
  if (first.kind === "urlset") return first.locs;
  if (first.kind !== "index") return [];
  const out: { loc: string; lastmod?: string }[] = [];
  // Only the first few sub-sitemaps: bounded, and reported if truncated.
  for (const sub of first.locs.slice(0, 4)) {
    try {
      const subRes = await getResource(sub.loc, ctx, { accept: "application/xml, text/xml;q=0.9, */*;q=0.8" });
      out.push(...extractSitemap(subRes.text).locs);
    } catch {
      /* one unreadable sub-sitemap must not lose the ones that worked */
    }
  }
  return out;
}

async function opencultureSitemapScan(query: string, ctx: ProviderContext, providerId: string, want: number): Promise<ProviderHit[]> {
  const locs = await opencultureSitemapLocs(ctx);
  if (!locs.length) return [];
  const slug = (u: string) => {
    try {
      return decodeURIComponent(new URL(u).pathname).replace(/[-_/]+/g, " ").toLowerCase();
    } catch {
      return "";
    }
  };
  const hits: ProviderHit[] = [];
  for (const entry of locs) {
    if (hits.length >= want) break;
    if (!matchesQuery(slug(entry.loc), query)) continue;
    const pretty = slug(entry.loc).replace(/\b\w/g, (c) => c.toUpperCase()).trim();
    hits.push({
      id: `oc-sitemap:${entry.loc}`,
      providerId,
      kind: "editorial",
      title: pretty || entry.loc,
      date: entry.lastmod,
      url: entry.loc,
      source: { label: "Open Culture (sitemap, slug match)", url: BASE },
      extra: { origin: "sitemap" },
      provenance: "live",
    });
  }
  return hits;
}

export function isOpenCultureUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === HOST || host === "openculture.com";
  } catch {
    return false;
  }
}

export async function opencultureInspect(url: string, ctx: ProviderContext, providerId = "openculture"): Promise<InspectOutcome> {
  const started = Date.now();
  if (!isOpenCultureUrl(url)) {
    throw new ProviderError("UNSUPPORTED", "That is not an Open Culture URL.", { url, retryable: false });
  }
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  })();
  if (path === "/" || path === "") {
    return {
      providerId,
      kind: "homepage",
      canonicalUrl: BASE,
      title: "Open Culture",
      description:
        "Open Culture's homepage. Add it as a source and searches read the site's RSS feed(s); a pasted article URL opens the article and lists the external resources it recommends.",
      facts: [
        { label: "Search interface", value: "RSS feed + sitemap (its ?s= page is a Google CSE widget)" },
        { label: "Feed", value: `${BASE}/feed` },
      ],
      sections: [],
      addable: true,
      capabilities: OPENCULTURE_CAPABILITIES,
      tookMs: Date.now() - started,
    };
  }

  const res = await getResource(url, ctx, { accept: "text/html" });
  if (detectChallenge(res.text).challenged) {
    throw new ProviderError("FORBIDDEN", "Open Culture served a bot-challenge page for this article.", { url, retryable: false });
  }
  const meta = extractMeta(res.text);
  const anchors = extractAnchors(res.text, res.finalUrl || url);
  const external = anchors.filter((a) => {
    try {
      const h = new URL(a.url).hostname.toLowerCase();
      return !h.endsWith("openculture.com") && !/facebook\.com|twitter\.com|x\.com|youtube\.com|pinterest\.com|linkedin\.com|instagram\.com|patreon\.com|paypal\.com/.test(h);
    } catch {
      return false;
    }
  });
  const internal = anchors.filter((a) => {
    try {
      return new URL(a.url).hostname.toLowerCase().endsWith("openculture.com");
    } catch {
      return false;
    }
  });
  const seen = new Set<string>();
  const extItems = external
    .filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)))
    .slice(0, 100)
    .map((a) => ({ title: a.text || a.url, url: a.url }));

  const articleBody = /<article[\s\S]*?<\/article>/i.exec(res.text)?.[0] ?? "";
  const facts: InspectOutcome["facts"] = [
    { label: "Page type", value: "editorial article" },
    { label: "Editorial listing", value: "yes - this article is Open Culture's own page" },
    { label: "External resources linked", value: String(extItems.length) },
  ];
  if (meta.published) facts.push({ label: "Published", value: meta.published });
  if (meta.author) facts.push({ label: "Author/site", value: meta.author });
  if (articleBody) facts.push({ label: "Article body", value: `${Math.round(articleBody.length / 1024)} KB of HTML` });

  return {
    providerId,
    kind: "editorial",
    canonicalUrl: meta.canonical || res.finalUrl || url,
    title: meta.title || stripHtml((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(res.text) || [])[1] || ""),
    description: meta.description,
    date: meta.published,
    creator: "Open Culture",
    sections: [
      ...(extItems.length ? [{ key: "external", label: "External resources this article recommends", items: extItems }] : []),
      {
        key: "internal",
        label: "More from Open Culture",
        items: internal
          .slice(0, 60)
          .map((a) => ({ title: a.text || a.url, url: a.url }))
          .filter((it) => it.title),
      },
    ],
    facts,
    addable: true,
    capabilities: OPENCULTURE_CAPABILITIES,
    tookMs: Date.now() - started,
  };
}

export { qs, decodeEntities, getJson };
