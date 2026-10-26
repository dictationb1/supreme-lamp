// [SEARCH-REPAIR] Listing/curation providers: rentry.org, fmhy.net, and the
// generic page/feed reader used for operator-added websites.
//
// What these sites really are (probed live 2026-10-26, evidence in
// docs/reports/search-repair/evidence/live-probe.json):
//   * rentry.org serves the SAME page as HTML and as RAW MARKDOWN at
//     /<slug>/raw - the raw form is the correct machine-readable interface, and
//     its links are how the megathread reaches its sub-pages. Its canonical host
//     is rentry.co (the HTML <link rel=canonical> says so) while rentry.org keeps
//     working, so both hosts are treated as the same source.
//   * fmhy.net answers /sitemap.xml with a <urlset> of its top-level pages and
//     answers /search?... with 404 - there is NO search endpoint. Searching it
//     means reading its pages and matching locally, and this adapter says so
//     instead of pretending there is a query API.
//   * both send access-control-allow-origin: * - no relay needed.
//
// A "hit" here is a RESOURCE ON A CURATED PAGE (kind list-entry), with the page
// and its heading as context, so the operator can always see where the
// recommendation came from.
import { ProviderError, getResource, type ProviderContext } from "./core";
import {
  absolutize,
  decodeEntities,
  detectChallenge,
  extractAnchors,
  extractMeta,
  extractSitemap,
  matchesQuery,
  parseMarkdownSections,
  scoreMatch,
  stripHtml,
  truncate,
  type Anchor,
} from "./text";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome } from "./types";

export const RENTRY_CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  inspect: "supported",
  filters: ["depth", "pages"],
  pagination: "partial",
  itemDetails: "supported",
  downloads: "unsupported",
  preview: "unsupported",
  attribution: "supported",
  nestedLists: "supported",
  notes: [
    "rentry.org serves raw Markdown at /<slug>/raw; that is the interface this adapter reads, so headings and links are exact.",
    "The megathread links its own sub-pages (megathread-anime, megathread-books, ...); those are followed one level deep, incrementally and cancellably.",
    "The canonical host is rentry.co, but rentry.org keeps serving the same pages - both are accepted and neither is treated as a foreign host.",
    "Curation is community text, not a search index: results are literal entries on the page, with their section as context.",
  ],
};

export const FMHY_CAPABILITIES: ProviderCapabilities = {
  search: "partial",
  inspect: "supported",
  filters: ["pages"],
  pagination: "partial",
  itemDetails: "supported",
  downloads: "unsupported",
  preview: "unsupported",
  attribution: "supported",
  nestedLists: "partial",
  notes: [
    "fmhy.net has NO search endpoint: /search?... answers 404 (verified live 2026-10-26).",
    "Search reads the site map (/sitemap.xml), picks the pages whose slug matches the query, reads those pages, and matches their link text locally.",
    "Only the pages the query actually touches are fetched, one at a time, and the number fetched is reported.",
    "The wiki's own starred (community-vetted) marks are text, so they are preserved verbatim in the entry's label rather than re-ranked.",
  ],
};

const RENTRY_HOSTS = ["rentry.org", "rentry.co", "www.rentry.org", "www.rentry.co"];

export function isRentryUrl(url: string): boolean {
  try {
    return RENTRY_HOSTS.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function rentrySlug(url: string): string {
  try {
    const segs = new URL(url).pathname.split("/").filter(Boolean);
    return decodeURIComponent(segs[0] || "");
  } catch {
    return "";
  }
}

function rawUrl(slug: string): string {
  return `https://rentry.org/${encodeURIComponent(slug)}/raw`;
}

/** Heading-grouped anchors, so an HTML listing keeps its section context. */
export function extractAnchorGroups(html: string, baseUrl: string): { heading: string; anchors: Anchor[] }[] {
  const groups: { heading: string; anchors: Anchor[] }[] = [];
  const parts = String(html || "").split(/<h[1-4][^>]*>/i);
  // The first chunk is everything before the first heading.
  const firstAnchors = extractAnchors(parts[0] || "", baseUrl);
  if (firstAnchors.length) groups.push({ heading: "", anchors: firstAnchors });
  for (let i = 1; i < parts.length; i += 1) {
    const chunk = parts[i];
    const close = chunk.search(/<\/h[1-4]>/i);
    const heading = close >= 0 ? stripHtml(chunk.slice(0, close)) : "";
    const rest = close >= 0 ? chunk.slice(close) : chunk;
    const anchors = extractAnchors(rest, baseUrl);
    if (anchors.length) groups.push({ heading: heading.replace(/^#+\s*/, "").trim(), anchors });
  }
  return groups;
}

export interface RentrySearchOptions {
  query: string;
  /** 0 = only this page, 1 = follow the page's own sub-page links once. */
  depth?: number;
  /** Hard cap on pages fetched, so a search can never crawl the whole site. */
  maxPages?: number;
  limit?: number;
  signal?: AbortSignal;
}

function rentryEntryHit(
  link: { title: string; url: string; description?: string; section: string[] },
  page: string,
  providerId: string
): ProviderHit {
  return {
    id: `rentry:${page}:${link.url}`,
    providerId,
    kind: "list-entry",
    title: link.title,
    description: link.description,
    url: link.url,
    source: { label: `rentry.org/${page}${link.section.length ? ` › ${link.section.join(" › ")}` : ""}`, url: `https://rentry.org/${page}` },
    context: [page, ...link.section],
    extra: { page, ...(link.section.length ? { section: link.section.join(" › ") } : {}) },
    provenance: "live",
  };
}

export async function rentrySearch(o: RentrySearchOptions, ctx: ProviderContext, seedUrl: string, providerId = "rentry"): Promise<SearchOutcome> {
  const started = Date.now();
  const query = String(o.query || "").trim();
  const limit = o.limit ?? 20;
  const depth = Math.max(0, Math.min(2, o.depth ?? 1));
  const maxPages = Math.max(1, Math.min(8, o.maxPages ?? 4));
  const seed = rentrySlug(seedUrl);
  if (!seed) throw new ProviderError("UNSUPPORTED", "A rentry.org page URL is required (https://rentry.org/<slug>).", { url: seedUrl, retryable: false });

  const hits: ProviderHit[] = [];
  const notes: string[] = [];
  const visited = new Set<string>();
  const queue: { slug: string; level: number }[] = [{ slug: seed, level: 0 }];
  let fetched = 0;

  while (queue.length && fetched < maxPages) {
    if (ctx.signal?.aborted) break;
    const { slug, level } = queue.shift() as { slug: string; level: number };
    if (visited.has(slug)) continue;
    visited.add(slug);
    fetched += 1;
    ctx.onProgress?.({ providerId, stage: "page", message: `rentry.org/${slug}`, done: fetched, total: maxPages });
    let text: string;
    try {
      const res = await getResource(rawUrl(slug), ctx, { accept: "text/plain" });
      text = res.text;
    } catch (e) {
      if (slug === seed) throw e;
      notes.push(`Sub-page ${slug} unavailable (${(e as ProviderError).code}).`);
      continue;
    }
    const sections = parseMarkdownSections(text, `https://rentry.org/${slug}`);
    let matchedHere = 0;
    for (const sec of sections) {
      for (const link of sec.links) {
        if (hits.length >= limit) break;
        if (!matchesQuery(`${link.title} ${link.description ?? ""} ${sec.title}`, query)) continue;
        if (link.url.includes("/raw")) continue;
        hits.push(rentryEntryHit(link, slug, providerId));
        matchedHere += 1;
      }
      // Discover this page's own sub-pages (the megathread's "greatest treasures").
      if (level < depth && fetched + queue.length < maxPages) {
        for (const link of sec.links) {
          if (!isRentryUrl(link.url) || /\/raw(\?|$)/.test(link.url)) continue;
          const child = rentrySlug(link.url);
          if (!child || visited.has(child) || queue.some((q) => q.slug === child)) continue;
          if (/^megathread/.test(child) || child.startsWith(seed)) queue.push({ slug: child, level: level + 1 });
        }
      }
    }
    notes.push(`rentry.org/${slug}: ${matchedHere} matching entry(ies).`);
  }
  const totalLinks = [...visited].length;
  return {
    hits: hits.slice(0, limit),
    hasMore: hits.length >= limit || queue.length > 0,
    appliedFilters: ["depth", "pages"],
    ignoredFilters: [],
    notes: [
      ...notes,
      `Read ${totalLinks} page(s) (depth ${depth}, cap ${maxPages}). Curation pages are not a ranked index: matches are literal entries.`,
    ],
    tookMs: Date.now() - started,
  };
}

export async function rentryInspect(url: string, ctx: ProviderContext, providerId = "rentry"): Promise<InspectOutcome> {
  const started = Date.now();
  const slug = rentrySlug(url);
  if (!isRentryUrl(url) || !slug) throw new ProviderError("UNSUPPORTED", "That is not a rentry.org page URL.", { url, retryable: false });
  const res = await getResource(rawUrl(slug), ctx, { accept: "text/plain" });
  const text = res.text;
  const firstHeading = /^\s{0,3}#\s+(.+)$/m.exec(text)?.[1]?.trim();
  const sections = parseMarkdownSections(text, `https://rentry.org/${slug}`);
  const linkedPages = new Set<string>();
  let linkCount = 0;
  const outSections = sections
    .filter((s) => s.links.length)
    .map((s) => ({
      key: s.title || "root",
      label: s.title || "Top of page",
      items: s.links.slice(0, 200).map((l) => {
        linkCount += 1;
        if (isRentryUrl(l.url)) {
          const child = rentrySlug(l.url);
          if (child && child !== slug) linkedPages.add(child);
        }
        return { title: l.title, url: l.url, description: l.description };
      }),
    }));
  return {
    providerId,
    kind: "curated-page",
    canonicalUrl: `https://rentry.org/${slug}`,
    title: firstHeading || `rentry.org/${slug}`,
    description: `${linkedPages.size} linked sub-page(s), ${linkCount} entries.`,
    sections: outSections,
    facts: [
      { label: "Page", value: `rentry.org/${slug}` },
      { label: "Entries", value: String(linkCount) },
      { label: "Sub-pages linked", value: [...linkedPages].slice(0, 12).join(", ") || "none" },
      { label: "Read from", value: "raw Markdown (/raw)" },
    ],
    addable: true,
    capabilities: RENTRY_CAPABILITIES,
    tookMs: Date.now() - started,
  };
}

// ------------------------------------------------------------------- FMHY --

export function isFmhyUrl(url: string): boolean {
  try {
    return /(^|\.)fmhy\.net$/.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export interface FmhySearchOptions {
  query: string;
  /** Extra pages to read regardless of slug match (e.g. the source's own page). */
  pages?: string[];
  maxPages?: number;
  limit?: number;
  signal?: AbortSignal;
}

async function fmhySitemapPages(ctx: ProviderContext): Promise<string[]> {
  const res = await getResource("https://fmhy.net/sitemap.xml", ctx, { accept: "application/xml, text/xml;q=0.9, */*" });
  const sm = extractSitemap(res.text);
  return sm.locs.map((l) => l.loc);
}

export async function fmhySearch(o: FmhySearchOptions, ctx: ProviderContext, seedUrl: string, providerId = "fmhy"): Promise<SearchOutcome> {
  const started = Date.now();
  const query = String(o.query || "").trim();
  const limit = o.limit ?? 20;
  const maxPages = Math.max(1, Math.min(4, o.maxPages ?? 2));
  const notes: string[] = [];
  const seedPath = (() => {
    try {
      return new URL(seedUrl).pathname.replace(/^\/+/, "").replace(/\/$/, "") || "misc";
    } catch {
      return "misc";
    }
  })();

  let candidates: string[] = [];
  try {
    const sitemap = await fmhySitemapPages(ctx);
    candidates = sitemap;
    notes.push(`Sitemap lists ${sitemap.length} page(s).`);
  } catch (e) {
    notes.push(`Sitemap unavailable (${(e as ProviderError).code}); using the source page only.`);
  }
  const scored = candidates
    .map((loc) => {
      let path = "";
      try {
        path = new URL(loc).pathname.replace(/^\/+|\/+$/g, "");
      } catch {
        path = "";
      }
      let score = 0;
      if (path && matchesQuery(path.replace(/[-/]+/g, " "), query)) score += 20;
      if (path === seedPath) score += 6;
      return { loc, path, score };
    })
    .filter((c) => c.path)
    .sort((a, b) => b.score - a.score);
  const toRead: string[] = [];
  for (const p of o.pages ?? []) if (!toRead.includes(p)) toRead.push(p);
  for (const c of scored) {
    if (toRead.length >= maxPages) break;
    if (!toRead.includes(c.loc)) toRead.push(c.loc);
  }

  const hits: ProviderHit[] = [];
  let read = 0;
  for (const loc of toRead.slice(0, maxPages)) {
    if (ctx.signal?.aborted) break;
    read += 1;
    ctx.onProgress?.({ providerId, stage: "page", message: loc, done: read, total: Math.min(maxPages, toRead.length) });
    let html: string;
    try {
      const res = await getResource(loc, ctx, { accept: "text/html" });
      html = res.text;
    } catch (e) {
      notes.push(`${loc} unavailable (${(e as ProviderError).code}).`);
      continue;
    }
    if (detectChallenge(html).challenged) {
      notes.push(`${loc} answered a bot challenge; skipped.`);
      continue;
    }
    const groups = extractAnchorGroups(html, loc);
    let matchedHere = 0;
    for (const g of groups) {
      for (const a of g.anchors) {
        if (hits.length >= limit) break;
        if (!a.text || a.text.length < 2) continue;
        if (!matchesQuery(`${a.text}`, query)) continue;
        hits.push({
          id: `fmhy:${loc}:${a.url}`,
          providerId,
          kind: "list-entry",
          title: a.text,
          url: a.url,
          source: { label: `fmhy.net${g.heading ? ` › ${g.heading}` : ""}`, url: loc },
          context: g.heading ? [g.heading] : [],
          extra: { page: loc, ...(g.heading ? { section: g.heading } : {}) },
          provenance: "live",
        });
        matchedHere += 1;
      }
    }
    notes.push(`${loc}: ${matchedHere} matching entr(ies).`);
  }
  hits.sort((a, b) => scoreMatch(b.title, "", query) - scoreMatch(a.title, "", query));
  return {
    hits: hits.slice(0, limit),
    hasMore: hits.length >= limit,
    appliedFilters: ["pages"],
    ignoredFilters: [],
    notes: [...notes, "fmhy.net exposes no search API (its /search path 404s); this is page reading plus local matching."],
    tookMs: Date.now() - started,
  };
}

export async function fmhyInspect(url: string, ctx: ProviderContext, providerId = "fmhy"): Promise<InspectOutcome> {
  const started = Date.now();
  if (!isFmhyUrl(url)) throw new ProviderError("UNSUPPORTED", "That is not an fmhy.net URL.", { url, retryable: false });
  const res = await getResource(url, ctx, { accept: "text/html" });
  if (detectChallenge(res.text).challenged) {
    throw new ProviderError("FORBIDDEN", "fmhy.net served a bot-challenge page.", { url, retryable: false });
  }
  const meta = extractMeta(res.text);
  const h1 = stripHtml((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(res.text) || [])[1] || "");
  const groups = extractAnchorGroups(res.text, res.finalUrl || url);
  let entries = 0;
  const sections = groups
    .filter((g) => g.heading || g.anchors.length)
    .slice(0, 60)
    .map((g) => {
      entries += g.anchors.length;
      return {
        key: g.heading || "root",
        label: g.heading || "Top of page",
        items: g.anchors.slice(0, 120).map((a) => ({ title: a.text || a.url, url: a.url })),
      };
    });
  return {
    providerId,
    kind: "wiki-page",
    canonicalUrl: meta.canonical || res.finalUrl || url,
    title: meta.title || h1 || "fmhy.net",
    description: meta.description,
    sections,
    facts: [
      { label: "Page", value: new URL(url).pathname || "/" },
      { label: "Sections", value: String(sections.length) },
      { label: "Links", value: String(entries) },
      { label: "Search interface", value: "none - pages are read and matched locally" },
    ],
    addable: true,
    capabilities: FMHY_CAPABILITIES,
    tookMs: Date.now() - started,
  };
}

// -------------------------------------------------- generic custom website --

export const GENERIC_CAPABILITIES: ProviderCapabilities = {
  search: "partial",
  inspect: "supported",
  filters: ["source"],
  pagination: "unsupported",
  itemDetails: "partial",
  downloads: "unsupported",
  preview: "partial",
  attribution: "partial",
  notes: [
    "A website added by URL is read through the interface it actually exposes: an RSS/Atom feed first, then its sitemap, then the page itself.",
    "Sites whose HTML has no readable links, or that answer with a bot challenge, are reported as unsupported rather than saved as a source that can never return results.",
    "Hosts that send no CORS header need the dashboard server relay (/api/providers/relay); without it the adapter names that exact limitation.",
  ],
};

export interface DetectedCapabilities {
  feeds: string[];
  sitemaps: string[];
  searchParam?: string;
  jsonLd: boolean;
  challenge?: string;
  title: string;
  description?: string;
  entryLinks: number;
  notes: string[];
}

/** Probe a site for the interfaces it really exposes. Cheap, bounded, and it
 *  reports every attempt - the operator sees why a site is or is not usable. */
export async function detectSiteCapabilities(url: string, ctx: ProviderContext): Promise<DetectedCapabilities> {
  const notes: string[] = [];
  const out: DetectedCapabilities = { feeds: [], sitemaps: [], jsonLd: false, title: "", entryLinks: 0, notes };
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    throw new ProviderError("UNSUPPORTED", "That is not a valid URL.", { url, retryable: false });
  }
  for (const [kind, path] of [["feed", "/feed"], ["rss", "/rss.xml"], ["atom", "/atom.xml"], ["index", "/sitemap.xml"]] as const) {
    const candidate = `${origin}${path}`;
    try {
      const res = await getResource(candidate, ctx, { accept: "*/*" });
      const head = res.text.slice(0, 400).toLowerCase();
      const isFeed = /<rss|<feed|<rdf/.test(head);
      const isSitemap = /<urlset|<sitemapindex/.test(head);
      if (kind === "index" && isSitemap) out.sitemaps.push(candidate);
      else if (kind !== "index" && isFeed) out.feeds.push(candidate);
    } catch {
      /* absence is the answer; no note needed for a 404 */
    }
  }
  if (!out.feeds.length) notes.push("No RSS/Atom feed found at /feed, /rss.xml or /atom.xml.");
  if (!out.sitemaps.length) notes.push("No sitemap found at /sitemap.xml.");
  try {
    const res = await getResource(url, ctx, { accept: "text/html" });
    const ch = detectChallenge(res.text);
    if (ch.challenged) out.challenge = ch.kind;
    const meta = extractMeta(res.text);
    out.title = meta.title;
    out.description = meta.description;
    out.jsonLd = /application\/ld\+json/i.test(res.text);
    const anchors = extractAnchors(res.text, res.finalUrl || url);
    out.entryLinks = anchors.filter((a) => a.text.length > 2).length;
    const form = /<form[^>]+action\s*=\s*["']([^"']*)["'][^>]*>([\s\S]{0,600}?)<\/form>/i.exec(res.text);
    if (form) {
      const action = form[1];
      const inputs = form[2];
      const name = /<input[^>]+name\s*=\s*["']([^"']+)["']/i.exec(inputs)?.[1];
      if (name && /^(s|q|query|search|searchterm|keywords)$/i.test(name)) {
        const target = absolutize(action || url, res.finalUrl || url) || url;
        out.searchParam = `${target}${target.includes("?") ? "&" : "?"}${encodeURIComponent(name)}=`;
        notes.push(`The page has its own search form (${name}); searches can use it.`);
      }
    }
    if (/\/(gcsearch|search)\b/i.test(res.finalUrl || "") && /google|cse|customsearch/i.test(res.text)) {
      notes.push("This site's search page is a Google Custom Search widget, which cannot be read server-side.");
    }
  } catch (e) {
    const err = e as ProviderError;
    if (err.code === "RELAY_UNAVAILABLE" || err.code === "CORS_BLOCKED") {
      notes.push("The site could not be read directly from the browser (no CORS header). The server relay is required.");
      out.challenge = "cors";
    } else if (err.code === "NOT_FOUND") {
      throw new ProviderError("NOT_FOUND", "The site answered 404 for its homepage.", { url, retryable: false });
    } else throw e;
  }
  return out;
}

export async function genericSearch(
  o: { query: string; url: string; limit?: number; signal?: AbortSignal },
  ctx: ProviderContext,
  providerId: string
): Promise<SearchOutcome> {
  const started = Date.now();
  const caps = await detectSiteCapabilities(o.url, ctx);
  const query = o.query.trim();
  const limit = o.limit ?? 20;
  const hits: ProviderHit[] = [];
  const notes = [...caps.notes];

  for (const feed of caps.feeds) {
    if (ctx.signal?.aborted || hits.length >= limit) break;
    try {
      const res = await getResource(feed, ctx, { accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*" });
      const { extractFeedItems } = await import("./text");
      const items = extractFeedItems(res.text, o.url);
      let n = 0;
      for (const it of items) {
        if (hits.length >= limit) break;
        if (!matchesQuery(`${it.title} ${it.description ?? ""}`, query)) continue;
        hits.push({
          id: `web:${feed}:${it.link}`,
          providerId,
          kind: "page",
          title: it.title,
          description: it.description ? truncate(it.description, 300) : undefined,
          date: it.date,
          url: it.link,
          source: { label: `${new URL(feed).hostname} feed`, url: feed },
          extra: { origin: "feed" },
          provenance: "live",
        });
        n += 1;
      }
      notes.push(`${feed}: ${n} matching item(s) of ${items.length}.`);
    } catch (e) {
      notes.push(`${feed} unavailable (${(e as ProviderError).code}).`);
    }
  }

  if (!hits.length && caps.sitemaps.length) {
    try {
      const res = await getResource(caps.sitemaps[0], ctx, { accept: "application/xml, text/xml;q=0.9, */*" });
      const sm = extractSitemap(res.text);
      const locs = sm.kind === "index" ? sm.locs.slice(0, 3).map((l) => l.loc) : sm.locs.map((l) => l.loc);
      const matched: string[] = [];
      for (const loc of locs) {
        let path = "";
        try {
          path = decodeURIComponent(new URL(loc).pathname).replace(/[-_/]+/g, " ");
        } catch {
          continue;
        }
        if (matchesQuery(path, query) && matched.length < limit) matched.push(loc);
      }
      for (const loc of matched) {
        hits.push({
          id: `web:sitemap:${loc}`,
          providerId,
          kind: "page",
          title: loc.replace(/^https?:\/\/[^/]+\//, "").replace(/[-_/]+/g, " "),
          url: loc,
          source: { label: `${new URL(loc).hostname} sitemap`, url: caps.sitemaps[0] },
          extra: { origin: "sitemap" },
          provenance: "live",
        });
      }
      notes.push(`Sitemap: ${matched.length} URL(s) matched the query in their path.`);
    } catch (e) {
      notes.push(`Sitemap unreadable (${(e as ProviderError).code}).`);
    }
  }

  if (!hits.length && caps.searchParam) {
    try {
      const res = await getResource(caps.searchParam + encodeURIComponent(query), ctx, { accept: "text/html" });
      const groups = extractAnchorGroups(res.text, res.finalUrl || o.url);
      let n = 0;
      for (const g of groups) {
        for (const a of g.anchors) {
          if (hits.length >= limit) break;
          if (!a.text || !matchesQuery(a.text, query)) continue;
          hits.push({
            id: `web:site-search:${a.url}`,
            providerId,
            kind: "page",
            title: a.text,
            url: a.url,
            source: { label: `${new URL(o.url).hostname} on-site search`, url: caps.searchParam },
            context: g.heading ? [g.heading] : [],
            extra: { origin: "on-site-search" },
            provenance: "live",
          });
          n += 1;
        }
      }
      notes.push(`On-site search returned ${n} readable match(es).`);
    } catch (e) {
      notes.push(`On-site search failed (${(e as ProviderError).code}).`);
    }
  }

  if (!caps.feeds.length && !caps.sitemaps.length && !caps.searchParam && !hits.length) {
    notes.push("This site exposes no feed, sitemap or readable search form, so it cannot be searched by this build. It can still be inspected page by page.");
  }

  return {
    hits: hits.slice(0, limit),
    hasMore: false,
    appliedFilters: caps.feeds.length ? ["feed"] : caps.sitemaps.length ? ["sitemap"] : caps.searchParam ? ["on-site-search"] : [],
    ignoredFilters: [],
    notes,
    tookMs: Date.now() - started,
  };
}

export async function genericInspect(url: string, ctx: ProviderContext, providerId: string): Promise<InspectOutcome> {
  const started = Date.now();
  const caps = await detectSiteCapabilities(url, ctx);
  let nav: { title: string; url: string }[] = [];
  try {
    const res = await getResource(url, ctx, { accept: "text/html" });
    nav = extractAnchors(res.text, res.finalUrl || url)
      .filter((a) => a.text.length > 2 && a.url.startsWith("http"))
      .slice(0, 120)
      .map((a) => ({ title: a.text, url: a.url }));
  } catch {
    /* the capability probe already reported the reason */
  }
  const sections = nav.length ? [{ key: "links", label: "Links on this page", items: nav }] : [];
  return {
    providerId,
    kind: "website",
    canonicalUrl: url,
    title: caps.title || new URL(url).hostname,
    description: caps.description,
    sections,
    facts: [
      { label: "Host", value: new URL(url).hostname },
      { label: "Feeds", value: caps.feeds.join(", ") || "none found" },
      { label: "Sitemaps", value: caps.sitemaps.join(", ") || "none found" },
      { label: "Readable links", value: String(caps.entryLinks) },
      ...(caps.searchParam ? [{ label: "On-site search", value: caps.searchParam }] : []),
      ...(caps.challenge ? [{ label: "Restriction", value: caps.challenge }] : []),
    ],
    addable: Boolean(caps.feeds.length || caps.sitemaps.length || caps.searchParam || caps.entryLinks > 0),
    notAddableReason: caps.challenge === "cors" ? "The site cannot be read from the browser without the server relay." : undefined,
    capabilities: GENERIC_CAPABILITIES,
    tookMs: Date.now() - started,
  };
}

export { decodeEntities };
