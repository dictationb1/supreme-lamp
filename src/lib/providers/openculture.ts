// [SEARCH-REPAIR] Open Culture provider.
//
// WHAT IS ACTUALLY AVAILABLE (measured, see the live probe evidence):
//   * https://www.openculture.com/feed - WordPress RSS, CORS `*`, ~35 recent
//     items with title, link, pubDate, categories and a description. This is the
//     only real queryable surface.
//   * /sitemap.xml - the site's sitemap (Yoast-style), which lets an older post
//     be found by its slug.
//   * /?s=<query> - a 302 to /gcsearch, a Google Custom Search page whose
//     results are rendered by Google's JavaScript. It cannot be parsed, so it is
//     never used and never offered.
//
// Therefore "search" here honestly means: read the feed, match locally, and fall
// back to slug matching in the sitemap. The result is the EDITORIAL article; the
// external resource it recommends is reported separately by the inspector, which
// is the distinction the operator asked for.
import { ProviderError, getResource, type ProviderContext } from "./core";
import { decodeEntities, detectChallenge, extractFeedItems, extractSitemap, extractMeta, matchesQuery, scoreMatch, stripHtml, truncate, type FeedItem } from "./text";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome } from "./types";

const BASE = "https://www.openculture.com";

export const OPENCULTURE_CAPABILITIES: ProviderCapabilities = {
  search: "partial",
  pagination: "partial",
  filters: ["feedPages", "sitemap"],
  itemDetail: "supported",
  files: "unsupported",
  preview: "partial",
  license: "partial",
  notes: [
    "Open Culture has no JSON search API. Its /?s= search redirects to a Google Custom Search widget whose results exist only inside Google's script, so that page is never used.",
    "Search reads the site's own RSS feed(s) and matches locally, then falls back to matching URLs in its sitemap. Coverage is therefore 'recent feed + indexed slugs', not a ranked full-text index - the UI says so.",
    "A hit is the Open Culture ARTICLE. Links to third-party courses, books and videos are reported separately as external resources.",
    "Nothing is downloaded by this app: Open Culture links out and hosts no files of its own.",
  ],
};

interface FeedPage {
  items: FeedItem[];
  url: string;
}

const feedCache = new Map<string, FeedPage>();

/** Drop the in-memory feed pages. Called between searches and by the tests so
 *  a long-lived tab never serves yesterday's feed for a fresh query. */
export function clearOpenCultureCache(): void {
  feedCache.clear();
}

/** WordPress feeds answer ?paged=N; the cap keeps a search bounded. */
export async function fetchFeedPage(page: number, ctx: ProviderContext): Promise<FeedPage> {
  const url = page <= 1 ? `${BASE}/feed` : `${BASE}/feed?paged=${page}`;
  const cached = feedCache.get(url);
  if (cached) return cached;
  const res = await getResource(url, ctx, { accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8" });
  if (detectChallenge(res.text).challenged) {
    throw new ProviderError("FORBIDDEN", "Open Culture served a bot-challenge page instead of its feed.", { url, retryable: false });
  }
  const items = extractFeedItems(res.text);
  if (!items.length) {
    throw new ProviderError("PARSE_ERROR", "The Open Culture feed answered, but no <item> entries could be read.", {
      url,
      detail: `${res.bytes} bytes`,
    });
  }
  const feed: FeedPage = { items, url };
  feedCache.set(url, feed);
  return feed;
}

export interface OpenCultureSearchOptions {
  query: string;
  feedPages?: number;
  /** Slug matching inside the sitemap when the feed has nothing. */
  sitemap?: boolean;
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
  };
}

async function sitemapEntries(ctx: ProviderContext): Promise<{ loc: string; lastmod?: string }[]> {
  const first = await getResource(`${BASE}/sitemap.xml`, ctx, { accept: "application/xml, text/xml;q=0.9, */*;q=0.8" });
  const sm = extractSitemap(first.text);
  if (sm.kind === "urlset") return sm.entries;
  const out: { loc: string; lastmod?: string }[] = [];
  for (const sub of sm.entries.slice(0, 3)) {
    if (ctx.signal?.aborted) break;
    try {
      const res = await getResource(sub.loc, ctx, { accept: "application/xml, text/xml;q=0.9, */*;q=0.8" });
      out.push(...extractSitemap(res.text).entries);
    } catch {
      /* one unreadable sub-sitemap must not lose the others */
    }
  }
  return out;
}

function slugOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname)
      .replace(/\.html?$/i, "")
      .replace(/[-_/]+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function humanise(slug: string): string {
  return slug.replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function opencultureSearch(o: OpenCultureSearchOptions, ctx: ProviderContext, providerId = "openculture"): Promise<SearchOutcome> {
  const started = Date.now();
  const query = String(o.query || "").trim();
  const limit = Math.max(1, Math.min(50, o.limit ?? 20));
  const pages = Math.max(1, Math.min(3, o.feedPages ?? 2));
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

  if (o.sitemap !== false && hits.length < Math.min(5, limit)) {
    try {
      const entries = await sitemapEntries(ctx);
      let added = 0;
      for (const entry of entries) {
        if (hits.length >= limit) break;
        if (seen.has(entry.loc)) continue;
        const slug = slugOf(entry.loc);
        if (!slug || !matchesQuery(slug, query)) continue;
        seen.add(entry.loc);
        hits.push({
          id: `oc-sitemap:${entry.loc}`,
          providerId,
          kind: "editorial",
          title: humanise(slug),
          date: entry.lastmod,
          url: entry.loc,
          source: { label: "Open Culture (sitemap, slug match)", url: BASE },
          extra: { origin: "sitemap" },
        });
        added += 1;
      }
      applied.push("sitemap");
      notes.push(`Sitemap: ${entries.length} URL(s) scanned, ${added} additional slug match(es). Slugs are weaker evidence than feed titles.`);
    } catch (e) {
      notes.push(`Sitemap unavailable (${(e as ProviderError).code}); feed results only.`);
    }
  }

  return {
    hits: hits.slice(0, limit),
    totalReported: undefined,
    hasMore: false,
    appliedFilters: applied,
    ignoredFilters: [],
    notes: [...notes, "Open Culture exposes no server-side search: results are feed entries plus sitemap slug matches."],
    tookMs: Date.now() - started,
  };
}

export function isOpenCultureUrl(url: string): boolean {
  try {
    return /(^|\.)openculture\.com$/.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Inspect an Open Culture page: the editorial article, its metadata, and the
 *  external resources it links to (kept apart from the article itself). */
export async function opencultureInspect(url: string, ctx: ProviderContext, providerId = "openculture"): Promise<InspectOutcome> {
  const started = Date.now();
  if (!isOpenCultureUrl(url)) throw new ProviderError("UNSUPPORTED", "That is not an openculture.com URL.", { url, retryable: false });
  const res = await getResource(url, ctx, { accept: "text/html" });
  if (detectChallenge(res.text).challenged) {
    throw new ProviderError("FORBIDDEN", "Open Culture served a bot challenge instead of the page.", { url, retryable: false });
  }
  const meta = extractMeta(res.text);
  const external: { title: string; url: string; note?: string }[] = [];
  const internal: { title: string; url: string }[] = [];
  const seenExt = new Set<string>();
  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(res.text))) {
    const title = stripHtml(m[2]);
    if (!title || title.length < 3) continue;
    let abs: URL;
    try {
      abs = new URL(decodeEntities(m[1]), res.finalUrl || BASE);
    } catch {
      continue;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    if (isOpenCultureUrl(abs.toString())) {
      if (internal.length < 40) internal.push({ title, url: abs.toString() });
    } else if (!seenExt.has(abs.toString()) && external.length < 40) {
      seenExt.add(abs.toString());
      external.push({ title, url: abs.toString() });
    }
  }
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(res.text);
  const facts: InspectOutcome["facts"] = [
    { label: "Page", value: new URL(url).pathname, fromProvider: false },
    ...(meta.published ? [{ label: "Published", value: String(meta.published).slice(0, 10), fromProvider: true }] : []),
    ...(meta.author ? [{ label: "Author", value: meta.author, fromProvider: true }] : []),
    { label: "External resources", value: String(external.length), fromProvider: true },
    { label: "Search interface", value: "RSS feed + sitemap only (no search API)", fromProvider: false },
  ];
  return {
    providerId,
    kind: "article",
    canonicalUrl: meta.canonical || res.finalUrl || url,
    title: meta.ogTitle || meta.title || (h1 ? stripHtml(h1[1]) : "Open Culture"),
    description: meta.description,
    sections: [
      ...(external.length ? [{ key: "external", label: "External resources this article recommends", items: external, anchor: "editorial vs external" }] : []),
      ...(internal.length ? [{ key: "internal", label: "More on Open Culture", items: internal }] : []),
    ],
    facts,
    addable: true,
    capabilities: OPENCULTURE_CAPABILITIES,
    provenance: "live",
    tookMs: Date.now() - started,
  };
}
