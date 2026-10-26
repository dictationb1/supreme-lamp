// [SEARCH-REPAIR] Curated-list providers: fmhy.net, rentry.org, and any other
// website the operator adds.
//
// These sites have NO search API, and pretending otherwise is what produced the
// old "enabled source that can never return results". Each one is instead read
// through the interface it really exposes:
//   * fmhy.net      - /sitemap.xml lists its pages; each page is a taxonomy with
//                     headings, anchors (fmhy.net/misc#-food) and ⭐ resources.
//                     A query is matched against the entries of the most relevant
//                     pages, bounded to `maxPages` and cancellable.
//   * rentry.org    - /<slug>/raw returns the page MARKDOWN, which is the clean
//                     interface (the HTML is a rendered wrapper). The megathread
//                     links its own sub-pages, so discovery follows those links
//                     one level down, incrementally.
//   * any website   - feed → sitemap → on-site search form → page links, in that
//                     order, with the probe reporting which of them exist.
import { ProviderError, getResource, type ProviderContext } from "./core";
import {
  absolutize,
  decodeEntities,
  detectChallenge,
  extractAnchors,
  extractFeedItems,
  extractHeadingSections,
  extractMeta,
  extractSitemap,
  matchesQuery,
  parseMarkdownSections,
  scoreMatch,
  stripHtml,
  truncate,
} from "./text";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome } from "./types";

// ------------------------------------------------------------------ fmhy ----

export const FMHY_CAPABILITIES: ProviderCapabilities = {
  search: "partial",
  pagination: "unsupported",
  filters: ["pages"],
  itemDetail: "partial",
  files: "unsupported",
  preview: "unsupported",
  license: "unsupported",
  notes: [
    "fmhy.net exposes no search endpoint (/search answers 404) and no API: it is a wiki of taxonomy pages.",
    "Search therefore reads the pages its sitemap lists, picks the ones whose path matches the query, and matches the anchors inside them - reporting which page and which section each hit came from.",
    "Every entry keeps its section anchor (e.g. fmhy.net/misc#-food), its ⭐ starred marker and any safety warning text that follows it.",
    "Coverage is the pages read in this search (bounded and stated), not the whole wiki.",
  ],
};

const SAFETY = /(⚠|unsafe|malware|virus|scam|caution|warning|don't use|do not use)/i;

function fmhySectionLabel(heading: string): string {
  return heading.replace(/^[\p{Emoji}\uFE0F\u200D\s]+/u, "").trim() || heading.trim();
}

export interface FmhyPage {
  url: string;
  title: string;
  description?: string;
  sections: { label: string; anchor?: string; items: { title: string; url: string; note?: string; starred: boolean; warning?: string }[] }[];
  entries: number;
}

/** Parse one fmhy wiki page into anchored, badge-aware sections. */
export function parseFmhyPage(html: string, baseUrl: string): FmhyPage {
  const meta = extractMeta(html);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const groups = extractHeadingSections(html, baseUrl);
  const sections: FmhyPage["sections"] = [];
  let entries = 0;
  for (const g of groups) {
    if (!g.anchors.length) continue;
    const items = g.anchors.slice(0, 200).map((a) => {
      // The text immediately AFTER a link in an fmhy list is its description and
      // often carries the warning text; the ⭐ is inside the link label.
      const starred = /⭐|star/i.test(a.title);
      const title = a.title.replace(/⭐/g, "").trim();
      const note = a.note ? truncate(a.note, 200) : undefined;
      const warning = note && SAFETY.test(note) ? note : undefined;
      return { title: title || a.url, url: a.url, note, starred, warning };
    });
    entries += items.length;
    sections.push({
      label: fmhySectionLabel(g.heading) || "Top of page",
      anchor: g.id ? `${new URL(baseUrl).origin}${new URL(baseUrl).pathname}#${g.id}` : undefined,
      items,
    });
  }
  return {
    url: meta.canonical || baseUrl,
    title: meta.ogTitle || meta.title || (h1 ? stripHtml(h1[1]) : "fmhy.net"),
    description: meta.description,
    sections,
    entries,
  };
}

export function isFmhyUrl(url: string): boolean {
  try {
    return /(^|\.)fmhy\.net$/.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export interface FmhySearchOptions {
  query: string;
  /** Extra pages to read regardless of path matching (e.g. the source's page). */
  pages?: string[];
  maxPages?: number;
  limit?: number;
  signal?: AbortSignal;
}

async function fmhyPages(ctx: ProviderContext): Promise<string[]> {
  const res = await getResource("https://fmhy.net/sitemap.xml", ctx, { accept: "application/xml, text/xml;q=0.9, */*" });
  return extractSitemap(res.text).entries.map((e) => e.loc);
}

export async function fmhySearch(o: FmhySearchOptions, ctx: ProviderContext, seedUrl: string, providerId = "fmhy"): Promise<SearchOutcome> {
  const started = Date.now();
  const query = String(o.query || "").trim();
  const limit = Math.max(1, Math.min(50, o.limit ?? 20));
  const maxPages = Math.max(1, Math.min(4, o.maxPages ?? 2));
  const notes: string[] = [];
  const seedPath = (() => {
    try {
      return new URL(seedUrl).pathname.replace(/^\/+|\/+$/g, "") || "misc";
    } catch {
      return "misc";
    }
  })();

  let candidates: string[] = [];
  try {
    candidates = await fmhyPages(ctx);
    notes.push(`Sitemap lists ${candidates.length} page(s).`);
  } catch (e) {
    notes.push(`Sitemap unavailable (${(e as ProviderError).code}); using the configured page only.`);
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
  const toRead: string[] = [...(o.pages || [])];
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
    const page = parseFmhyPage(html, loc);
    let matched = 0;
    for (const section of page.sections) {
      for (const item of section.items) {
        if (hits.length >= limit) break;
        if (!matchesQuery(`${item.title} ${item.note ?? ""} ${section.label}`, query)) continue;
        hits.push({
          id: `fmhy:${loc}:${item.url}`,
          providerId,
          kind: "list-entry",
          title: item.title,
          url: item.url,
          description: item.note,
          source: { label: `fmhy.net${section.label ? ` › ${section.label}` : ""}`, url: section.anchor || loc },
          context: section.label ? [section.label] : [],
          extra: {
            page: loc,
            ...(section.anchor ? { anchor: section.anchor } : {}),
            ...(item.starred ? { starred: true } : {}),
            ...(item.warning ? { warning: item.warning } : {}),
          },
        });
        matched += 1;
      }
    }
    notes.push(`${loc}: ${matched} matching entr(ies) of ${page.entries}.`);
  }
  hits.sort((a, b) => scoreMatch(b.title, b.description || "", query) - scoreMatch(a.title, a.description || "", query));
  return {
    hits: hits.slice(0, limit),
    hasMore: hits.length >= limit,
    appliedFilters: ["pages"],
    ignoredFilters: [],
    notes: [...notes, "fmhy.net has no search API (/search 404s); entries are matched locally and name their page and section."],
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
  const page = parseFmhyPage(res.text, res.finalUrl || url);
  const starred = page.sections.reduce((n, s) => n + s.items.filter((i) => i.starred).length, 0);
  const warned = page.sections.reduce((n, s) => n + s.items.filter((i) => i.warning).length, 0);
  return {
    providerId,
    kind: "wiki-page",
    canonicalUrl: page.url,
    title: page.title || "fmhy.net",
    description: page.description,
    sections: page.sections.slice(0, 60).map((s, i) => ({
      key: `sec-${i}`,
      label: s.label,
      anchor: s.anchor,
      items: s.items.slice(0, 120).map((it) => ({
        title: it.title,
        url: it.url,
        note: it.note,
        badge: it.starred ? "starred" : it.warning ? "warning" : undefined,
      })),
    })),
    facts: [
      { label: "Page", value: new URL(url).pathname || "/", fromProvider: false },
      { label: "Sections", value: String(page.sections.length), fromProvider: true },
      { label: "Entries", value: String(page.entries), fromProvider: true },
      { label: "Starred", value: String(starred), fromProvider: true },
      { label: "With warnings", value: String(warned), fromProvider: true },
      { label: "Search interface", value: "none - pages are read and matched locally", fromProvider: false },
    ],
    addable: true,
    capabilities: FMHY_CAPABILITIES,
    provenance: "live",
    tookMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------- rentry ----

export const RENTRY_CAPABILITIES: ProviderCapabilities = {
  search: "partial",
  pagination: "unsupported",
  filters: ["depth", "pages"],
  itemDetail: "partial",
  files: "unsupported",
  preview: "unsupported",
  license: "unsupported",
  notes: [
    "rentry.org publishes each page as raw Markdown at /<slug>/raw, which is the interface used here (the HTML is a rendered wrapper with no more data).",
    "The canonical host is rentry.co; rentry.org is an alias and both are accepted.",
    "The megathread links its own sub-pages, so discovery follows those links one level down, incrementally, and stops at the configured cap.",
    "Entries keep their heading trail (e.g. 'megathread › Music') so a hit is attributable to a section.",
  ],
};

const RENTRY_CANONICAL = "rentry.co";

export function isRentryUrl(url: string): boolean {
  try {
    return /(^|\.)rentry\.(org|co)$/.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function rentrySlug(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+|\/+$/g, "").replace(/\/raw$/, "");
  } catch {
    return "";
  }
}

export interface RentrySearchOptions {
  query: string;
  /** 0 = only this page, 1 = also follow the page's own sub-page links. */
  depth?: number;
  maxPages?: number;
  limit?: number;
  signal?: AbortSignal;
}

function rawUrl(slug: string): string {
  return `https://${RENTRY_CANONICAL}/${encodeURIComponent(slug)}/raw`;
}

export async function rentrySearch(o: RentrySearchOptions, ctx: ProviderContext, seedUrl: string, providerId = "rentry"): Promise<SearchOutcome> {
  const started = Date.now();
  const query = String(o.query || "").trim();
  const limit = Math.max(1, Math.min(50, o.limit ?? 20));
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
    ctx.onProgress?.({ providerId, stage: "page", message: `rentry/${slug}`, done: fetched, total: maxPages });
    let text: string;
    try {
      const res = await getResource(rawUrl(slug), ctx, { accept: "text/plain" });
      text = res.text;
    } catch (e) {
      if (slug === seed) throw e;
      notes.push(`Sub-page ${slug} unavailable (${(e as ProviderError).code}).`);
      continue;
    }
    const sections = parseMarkdownSections(text, `https://${RENTRY_CANONICAL}/${slug}`);
    let matched = 0;
    for (const sec of sections) {
      for (const link of sec.links) {
        if (hits.length >= limit) break;
        const label = sec.title || slug;
        if (!matchesQuery(`${link.title} ${link.description ?? ""} ${label}`, query)) continue;
        if (/\/raw(\?|$)/.test(link.url)) continue;
        hits.push({
          id: `rentry:${slug}:${link.url}`,
          providerId,
          kind: "list-entry",
          title: link.title,
          url: link.url,
          description: link.description,
          source: { label: `rentry/${slug}${sec.title ? ` › ${sec.title}` : ""}`, url: `https://${RENTRY_CANONICAL}/${slug}` },
          context: [slug, ...(sec.title ? [sec.title] : [])],
          extra: { page: slug, ...(sec.title ? { section: sec.title } : {}) },
        });
        matched += 1;
      }
      if (level < depth && fetched + queue.length < maxPages) {
        for (const link of sec.links) {
          if (!isRentryUrl(link.url) || /\/raw(\?|$)/.test(link.url)) continue;
          const child = rentrySlug(link.url);
          if (!child || visited.has(child) || queue.some((q) => q.slug === child)) continue;
          // Only this page's own family: a curated page must not turn a search
          // into a crawl of the whole site.
          if (/^megathread/.test(child) || child.startsWith(seed)) queue.push({ slug: child, level: level + 1 });
        }
      }
    }
    notes.push(`rentry/${slug}: ${matched} matching entr(ies).`);
  }
  return {
    hits: hits.slice(0, limit),
    hasMore: hits.length >= limit || queue.length > 0,
    appliedFilters: ["depth", "pages"],
    ignoredFilters: [],
    notes: [...notes, `Read ${visited.size} page(s) (depth ${depth}, cap ${maxPages}). Curation pages are not a ranked index: matches are literal entries.`],
    tookMs: Date.now() - started,
  };
}

export async function rentryInspect(url: string, ctx: ProviderContext, providerId = "rentry"): Promise<InspectOutcome> {
  const started = Date.now();
  const slug = rentrySlug(url);
  if (!isRentryUrl(url) || !slug) throw new ProviderError("UNSUPPORTED", "That is not a rentry.org page URL.", { url, retryable: false });
  const res = await getResource(rawUrl(slug), ctx, { accept: "text/plain" });
  const sections = parseMarkdownSections(res.text, `https://${RENTRY_CANONICAL}/${slug}`);
  const subpages = sections
    .flatMap((s) => s.links)
    .filter((l) => isRentryUrl(l.url) && /\/(megathread|piracy)/i.test(l.url));
  const titleLine = /^#\s+(.+)$/m.exec(res.text);
  return {
    providerId,
    kind: "curated-page",
    canonicalUrl: `https://${RENTRY_CANONICAL}/${slug}`,
    title: titleLine ? stripHtml(titleLine[1]) : slug,
    sections: sections
      .filter((s) => s.links.length)
      .slice(0, 40)
      .map((s, i) => ({
        key: `sec-${i}`,
        label: s.title || `Section ${i + 1}`,
        items: s.links.slice(0, 120).map((l) => ({ title: l.title || l.url, url: l.url, note: l.description })),
      })),
    facts: [
      { label: "Page", value: slug, fromProvider: false },
      { label: "Sections", value: String(sections.filter((s) => s.links.length).length), fromProvider: true },
      { label: "Entries", value: String(sections.reduce((n, s) => n + s.links.length, 0)), fromProvider: true },
      { label: "Own sub-pages", value: String(subpages.length), fromProvider: true },
      { label: "Interface", value: "raw Markdown at /<slug>/raw", fromProvider: false },
    ],
    addable: true,
    capabilities: RENTRY_CAPABILITIES,
    provenance: "live",
    tookMs: Date.now() - started,
  };
}

// -------------------------------------------------- generic custom website ---

export const GENERIC_CAPABILITIES: ProviderCapabilities = {
  search: "partial",
  pagination: "unsupported",
  filters: ["source"],
  itemDetail: "partial",
  files: "unsupported",
  preview: "partial",
  license: "unsupported",
  notes: [
    "A website added by URL is read through the interface it actually exposes: an RSS/Atom feed first, then its sitemap, then a readable on-site search form, then the page's own links.",
    "Sites with no feed, no sitemap and no readable links are reported as NOT addable rather than saved as a source that can never return results.",
    "A site that answers a bot challenge or refuses the browser is named as such; it is not reported as 'no results'.",
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

/** Probe a site for the interfaces it really exposes. Cheap, bounded, explicit. */
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
    if (ctx.signal?.aborted) break;
    const candidate = `${origin}${path}`;
    try {
      const res = await getResource(candidate, ctx, { accept: "*/*" });
      const head = res.text.slice(0, 400).toLowerCase();
      const isFeed = /<rss|<feed|<rdf/.test(head);
      const isSitemap = /<urlset|<sitemapindex/.test(head);
      if (kind === "index" && isSitemap) out.sitemaps.push(candidate);
      else if (kind !== "index" && isFeed) out.feeds.push(candidate);
    } catch {
      /* absence is a real answer */
    }
  }
  if (!out.feeds.length) notes.push("No RSS/Atom feed found at /feed, /rss.xml or /atom.xml.");
  if (!out.sitemaps.length) notes.push("No sitemap found at /sitemap.xml.");
  try {
    const res = await getResource(url, ctx, { accept: "text/html" });
    const ch = detectChallenge(res.text);
    if (ch.challenged) out.challenge = ch.kind;
    const meta = extractMeta(res.text);
    out.title = meta.title || "";
    out.description = meta.description;
    out.jsonLd = /application\/ld\+json/i.test(res.text);
    const anchors = extractAnchors(res.text, res.finalUrl || url);
    out.entryLinks = anchors.filter((a) => a.title.length > 2).length;
    const form = /<form[^>]+action\s*=\s*["']([^"']*)["'][^>]*>([\s\S]{0,600}?)<\/form>/i.exec(res.text);
    if (form) {
      const action = form[1];
      const name = /<input[^>]+name\s*=\s*["']([^"']+)["']/i.exec(form[2])?.[1];
      if (name && /^(s|q|query|search|searchterm|keywords)$/i.test(name)) {
        const target = absolutize(action || url, res.finalUrl || url) || url;
        out.searchParam = `${target}${target.includes("?") ? "&" : "?"}${encodeURIComponent(name)}=`;
        notes.push(`The page has its own search form (${name}); searches use it.`);
      }
    }
  } catch (e) {
    const err = e as ProviderError;
    if (err.code === "RELAY_UNAVAILABLE" || err.code === "CORS_BLOCKED") {
      notes.push("The site could not be read directly from the browser (no CORS header). The server relay is required.");
      out.challenge = "cors";
    } else if (err.code === "NOT_FOUND") {
      throw new ProviderError("NOT_FOUND", "The site answered 404 for this page.", { url, retryable: false });
    } else throw e;
  }
  return out;
}

export interface GenericSearchOptions {
  query: string;
  url: string;
  limit?: number;
  signal?: AbortSignal;
}

export async function genericSearch(o: GenericSearchOptions, ctx: ProviderContext, providerId: string): Promise<SearchOutcome> {
  const started = Date.now();
  const caps = await detectSiteCapabilities(o.url, ctx);
  // A site that answered a bot challenge or refused the browser outright is NOT
  // "no results": say which of the two it is, so the operator knows whether to
  // enable the relay or to stop trying.
  if (caps.challenge === "cors") {
    throw new ProviderError(
      "RELAY_UNAVAILABLE",
      "This site sends no CORS header, so the browser cannot read it and the dashboard server relay is not configured in this build.",
      { url: o.url, retryable: false }
    );
  }
  if (caps.challenge) {
    throw new ProviderError("FORBIDDEN", `This site answered a bot challenge (${caps.challenge}), so it cannot be read without a browser session.`, {
      url: o.url,
      retryable: false,
    });
  }
  const query = o.query.trim();
  const limit = Math.max(1, Math.min(50, o.limit ?? 20));
  const hits: ProviderHit[] = [];
  const notes = [...caps.notes];
  const host = (() => {
    try {
      return new URL(o.url).hostname;
    } catch {
      return o.url;
    }
  })();

  for (const feed of caps.feeds) {
    if (ctx.signal?.aborted || hits.length >= limit) break;
    try {
      const res = await getResource(feed, ctx, { accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*" });
      const items = extractFeedItems(res.text);
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
          source: { label: `${host} feed`, url: feed },
          extra: { origin: "feed" },
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
      const locs = (sm.kind === "index" ? sm.entries.slice(0, 3).map((e) => e.loc) : sm.entries.map((e) => e.loc)).slice(0, 2000);
      const matched: { loc: string; lastmod?: string }[] = [];
      for (const entry of sm.entries) {
        let path = "";
        try {
          path = decodeURIComponent(new URL(entry.loc).pathname).replace(/[-_/]+/g, " ");
        } catch {
          continue;
        }
        if (matchesQuery(path, query) && matched.length < limit) matched.push(entry);
      }
      void locs;
      for (const m of matched) {
        hits.push({
          id: `web:sitemap:${m.loc}`,
          providerId,
          kind: "page",
          title: m.loc.replace(/^https?:\/\/[^/]+\//, "").replace(/[-_/]+/g, " "),
          url: m.loc,
          date: m.lastmod,
          source: { label: `${host} sitemap`, url: caps.sitemaps[0] },
          extra: { origin: "sitemap" },
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
      const groups = extractHeadingSections(res.text, res.finalUrl || o.url);
      let n = 0;
      for (const g of groups) {
        for (const a of g.anchors) {
          if (hits.length >= limit) break;
          if (!matchesQuery(a.title, query)) continue;
          hits.push({
            id: `web:site-search:${a.url}`,
            providerId,
            kind: "link",
            title: a.title,
            url: a.url,
            source: { label: `${host} on-site search`, url: caps.searchParam },
            context: g.heading ? [g.heading] : [],
            extra: { origin: "on-site-search" },
          });
          n += 1;
        }
      }
      notes.push(`On-site search returned ${n} readable match(es).`);
    } catch (e) {
      notes.push(`On-site search failed (${(e as ProviderError).code}).`);
    }
  }

  if (!hits.length && !caps.feeds.length && !caps.sitemaps.length && !caps.searchParam) {
    try {
      const res = await getResource(o.url, ctx, { accept: "text/html" });
      const anchors = extractAnchors(res.text, res.finalUrl || o.url);
      let n = 0;
      for (const a of anchors) {
        if (hits.length >= limit) break;
        if (!matchesQuery(a.title, query)) continue;
        hits.push({
          id: `web:page:${a.url}`,
          providerId,
          kind: "link",
          title: a.title,
          url: a.url,
          source: { label: `${host} page`, url: o.url },
          extra: { origin: "page-links" },
        });
        n += 1;
      }
      notes.push(`Page links: ${n} readable match(es) of ${anchors.length}.`);
    } catch (e) {
      notes.push(`Page unreadable (${(e as ProviderError).code}).`);
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
      .filter((a) => a.title.length > 2)
      .slice(0, 120)
      .map((a) => ({ title: a.title, url: a.url }));
  } catch {
    /* the capability probe already reported the reason */
  }
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();
  const addable = !caps.challenge && Boolean(caps.feeds.length || caps.sitemaps.length || caps.searchParam || caps.entryLinks > 0);
  return {
    providerId,
    kind: "website",
    canonicalUrl: url,
    title: caps.title || host,
    description: caps.description,
    sections: nav.length ? [{ key: "links", label: "Links on this page", items: nav }] : [],
    facts: [
      { label: "Host", value: host, fromProvider: false },
      { label: "Feeds", value: caps.feeds.join(", ") || "none found", fromProvider: true },
      { label: "Sitemaps", value: caps.sitemaps.join(", ") || "none found", fromProvider: true },
      { label: "Readable links", value: String(caps.entryLinks), fromProvider: true },
      ...(caps.searchParam ? [{ label: "On-site search", value: caps.searchParam, fromProvider: true }] : []),
      ...(caps.challenge ? [{ label: "Restriction", value: caps.challenge, fromProvider: true }] : []),
    ],
    addable,
    notAddableReason:
      caps.challenge === "cors"
        ? "The site cannot be read from the browser without the server relay."
        : caps.challenge
          ? `The site answered a bot challenge (${caps.challenge}); it cannot be searched from here.`
          : addable
            ? undefined
            : "The site exposes no feed, sitemap, search form or readable links, so it could never return a result.",
    capabilities: GENERIC_CAPABILITIES,
    provenance: "live",
    tookMs: Date.now() - started,
  };
}

export { decodeEntities };
