// [SEARCH-REPAIR] Text layer: HTML / RSS / Atom / sitemap / Markdown reading
// without a DOM.
//
// Runtime constraint: this code runs in the browser bundle AND under vitest in
// node, so there is no DOMParser dependency and no third-party HTML library.
// The extractors are deliberately tolerant, but they never invent data: a field
// that is absent in the payload stays absent (`undefined`), it is never filled
// with a guessed value.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "-",
  ndash: "-",
  hellip: "...",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  copy: "(c)",
  reg: "(R)",
  trade: "(TM)",
  star: "*",
  check: "✓",
};

export function decodeEntities(input: string): string {
  return String(input || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named != null ? named : m;
  });
}

export function stripHtml(input: string): string {
  return decodeEntities(
    String(input || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Cloudflare / JS wall detection: this is the difference between "the page is
 *  empty" and "the page is behind a challenge", and the UI says which. */
export function detectChallenge(html: string): { challenged: boolean; kind?: string } {
  const s = String(html || "").slice(0, 20_000).toLowerCase();
  if (s.includes("cf-browser-verification") || s.includes("just a moment...") || s.includes("cf_chl_opt")) {
    return { challenged: true, kind: "cloudflare-challenge" };
  }
  if (s.includes("enable javascript and cookies to continue")) {
    return { challenged: true, kind: "javascript-required" };
  }
  if (s.includes("attention required! | cloudflare")) {
    return { challenged: true, kind: "cloudflare-blocked" };
  }
  return { challenged: false };
}

export function absolutize(href: string, base: string): string | null {
  const raw = String(href || "").trim();
  if (!raw) return null;
  if (/^(javascript|mailto|tel|data):/i.test(raw)) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

export interface Anchor {
  /** Absolute URL (resolved against the page). */
  url: string;
  /** The raw href exactly as written in the page. */
  href: string;
  text: string;
  rel?: string;
  /** Text of the enclosing list item / paragraph, used as the description. */
  context: string;
}

export function extractAnchors(html: string, baseUrl: string): Anchor[] {
  const out: Anchor[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html || ""))) !== null) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    if (!hrefMatch) continue;
    const href = decodeEntities(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "");
    const url = absolutize(href, baseUrl);
    if (!url) continue;
    const relMatch = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    out.push({
      url,
      href,
      text: stripHtml(inner),
      rel: relMatch ? (relMatch[1] ?? relMatch[2] ?? relMatch[3]) : undefined,
      context: "",
    });
  }
  // Second pass: attach the sibling text as context, so a link row carries the
  // description printed beside it (WordPress listings put it in the same <li>).
  return out;
}

export function extractTitle(html: string): string {
  const og = /<meta[^>]+property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(html);
  if (og) return decodeEntities(og[1]).trim();
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return t ? stripHtml(t[1]) : "";
}

export interface MetaInfo {
  title: string;
  description?: string;
  published?: string;
  author?: string;
  canonical?: string;
  siteName?: string;
  image?: string;
}

function metaContent(html: string, names: string[]): string | undefined {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
      "i"
    );
    const m = re.exec(html);
    if (m) return decodeEntities(m[1]).trim();
    const re2 = new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name|itemprop)\\s*=\\s*["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      "i"
    );
    const m2 = re2.exec(html);
    if (m2) return decodeEntities(m2[1]).trim();
  }
  return undefined;
}

export function extractMeta(html: string): MetaInfo {
  const out: MetaInfo = { title: extractTitle(html) };
  const desc = metaContent(html, ["description", "og:description", "twitter:description"]);
  if (desc) out.description = desc;
  const published = metaContent(html, ["article:published_time", "datePublished", "date", "og:updated_time"]);
  if (published) out.published = published;
  const author = metaContent(html, ["article:author", "author", "twitter:creator", "og:site_name"]);
  if (author) out.author = author;
  const canonical = /<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(html);
  if (canonical) out.canonical = decodeEntities(canonical[1]).trim();
  const site = metaContent(html, ["og:site_name"]);
  if (site) out.siteName = site;
  const img = metaContent(html, ["og:image", "twitter:image"]);
  if (img) out.image = img;
  return out;
}

/** JSON-LD blocks, parsed; a malformed block is skipped (never thrown). */
export function extractJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      /* one malformed block must not lose the page */
    }
  }
  return out;
}

export interface FeedItem {
  title: string;
  link: string;
  description?: string;
  date?: string;
  guid?: string;
  categories?: string[];
}

function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function firstTag(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (m) return m[1];
  const selfClose = new RegExp(`<${tag}\\b[^>]*href\\s*=\\s*["']([^"']+)["'][^>]*/?>`, "i").exec(block);
  return selfClose ? selfClose[1] : undefined;
}

export function extractFeedItems(xml: string, baseUrl: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = [...xmlBlocks(xml, "item"), ...xmlBlocks(xml, "entry")];
  for (const block of blocks) {
    const title = stripHtml(firstTag(block, "title") ?? "");
    const rawLink = firstTag(block, "link") ?? firstTag(block, "guid") ?? "";
    const link = absolutize(decodeEntities(rawLink).trim(), baseUrl);
    if (!title || !link) continue;
    const desc = stripHtml(firstTag(block, "description") ?? firstTag(block, "summary") ?? firstTag(block, "content:encoded") ?? "");
    const date = firstTag(block, "pubDate") ?? firstTag(block, "published") ?? firstTag(block, "updated") ?? firstTag(block, "dc:date");
    const cats = xmlBlocks(block, "category").map((c) => stripHtml(c)).filter(Boolean);
    const parsedDate = date ? new Date(decodeEntities(date).trim()) : null;
    items.push({
      title,
      link,
      description: desc || undefined,
      date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : undefined,
      guid: firstTag(block, "guid") ? stripHtml(firstTag(block, "guid") as string) : undefined,
      categories: cats.length ? cats : undefined,
    });
  }
  return items;
}

export interface SitemapResult {
  kind: "index" | "urlset" | "none";
  locs: { loc: string; lastmod?: string }[];
}

export function extractSitemap(xml: string): SitemapResult {
  const body = String(xml || "");
  if (/<sitemapindex\b/i.test(body)) {
    const locs: { loc: string; lastmod?: string }[] = [];
    for (const block of xmlBlocks(body, "sitemap")) {
      const loc = firstTag(block, "loc");
      if (!loc) continue;
      const lastmod = firstTag(block, "lastmod");
      locs.push({ loc: decodeEntities(loc).trim(), lastmod: lastmod ? decodeEntities(lastmod).trim() : undefined });
    }
    return { kind: "index", locs };
  }
  if (/<urlset\b/i.test(body)) {
    const locs: { loc: string; lastmod?: string }[] = [];
    for (const block of xmlBlocks(body, "url")) {
      const loc = firstTag(block, "loc");
      if (!loc) continue;
      const lastmod = firstTag(block, "lastmod");
      locs.push({ loc: decodeEntities(loc).trim(), lastmod: lastmod ? decodeEntities(lastmod).trim() : undefined });
    }
    return { kind: "urlset", locs };
  }
  return { kind: "none", locs: [] };
}

// ---------------------------------------------------------------- Markdown --
// Awesome lists are Markdown. Their content is: headings (= categories),
// bullet entries (= resources), and links inside both. The reader below keeps
// the heading path so a result can say WHICH category it came from, and it
// resolves relative links against the repository's default branch.

export interface MarkdownLink {
  title: string;
  url: string;
  description?: string;
  /** Heading path, e.g. ["Contents", "Audio"]. */
  section: string[];
  /** 0 = top-level bullet, 1 = nested, -1 = inline/table. */
  depth: number;
}

export interface MarkdownSection {
  title: string;
  level: number;
  links: MarkdownLink[];
}

const INLINE_LINK = /(!?)\[([^\]\n]{0,300})\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g;
const REF_LINK = /(!?)\[([^\]\n]{0,300})\]\[([^\]\n]{0,80})\]/g;
const REF_DEF = /^\s{0,3}\[([^\]]{1,80})\]:\s*(\S+)/;
const ANGLE_LINK = /<(https?:\/\/[^>\s]+)>/g;

export function parseMarkdownSections(markdown: string, baseUrl: string): MarkdownSection[] {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const refs = new Map<string, string>();
  for (const line of lines) {
    const m = REF_DEF.exec(line);
    if (m) refs.set(m[1].trim().toLowerCase(), m[2].trim());
  }
  const sections: MarkdownSection[] = [];
  let stack: { level: number; title: string }[] = [];
  let inFence = false;
  let current: MarkdownSection = { title: "", level: 0, links: [] };
  sections.push(current);

  const pushLink = (title: string, url: string, description: string | undefined, depth: number) => {
    const resolved = absolutize(url, baseUrl);
    if (!resolved) return;
    if (/^#/.test(url)) return; // a table-of-contents jump is not a resource
    const clean = title.replace(/\s+/g, " ").replace(/^[!\s]+/, "").trim();
    if (!clean || clean.startsWith("!")) return;
    current.links.push({
      title: clean,
      url: resolved,
      description: description && description.trim() ? description.replace(/\s+/g, " ").trim() : undefined,
      section: stack.map((s) => s.title),
      depth,
    });
  };

  for (const rawLine of lines) {
    // Badge shields (`[![alt](img)](target)`) are decoration, not resources:
    // strip every image before reading links, or the label becomes "![alt".
    const raw = rawLine.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      const level = heading[1].length;
      // A heading may itself contain badges/links; keep only its words.
      const title = heading[2]
        .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/#+\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      current = { title, level, links: [] };
      sections.push(current);
      continue;
    }

    // indentation gives the nesting depth of a bullet entry
    const indent = /^(\s*)/.exec(raw)?.[1].length ?? 0;
    const depth = indent >= 2 ? Math.min(3, Math.floor(indent / 2)) : 0;
    // Text after the LAST link on a bullet line is the entry's description.
    const line = raw.replace(/^[\s>*+-]+/, "").replace(/^\d+[.)]\s+/, "");

    let lastEnd = -1;
    INLINE_LINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_LINK.exec(line)) !== null) {
      const [, bang, label, href] = m;
      if (bang === "!") continue;
      const tail = line.slice(m.index + m[0].length);
      // description = the segment up to the next link, trimmed of separators
      const nextIdx = tail.search(/\[[^\]]*\]\(/);
      const rawDesc = nextIdx >= 0 ? tail.slice(0, nextIdx) : tail;
      pushLink(label, href, rawDesc.replace(/^[\s\-–—:.,|]+|[\s|]+$/g, ""), depth);
      lastEnd = m.index + m[0].length;
    }
    REF_LINK.lastIndex = 0;
    while ((m = REF_LINK.exec(line)) !== null) {
      const [, bang, label, ref] = m;
      if (bang === "!") continue;
      const target = refs.get(ref.trim().toLowerCase());
      if (!target) continue;
      pushLink(label, target, line.slice(m.index + m[0].length), depth);
    }
    ANGLE_LINK.lastIndex = 0;
    while ((m = ANGLE_LINK.exec(line)) !== null) {
      if (m.index < lastEnd) continue;
      pushLink(m[1], m[1], line.slice(m.index + m[0].length), depth);
    }
  }
  return sections.filter((s) => s.links.length > 0 || s.title);
}

export function dedupeLinks(links: MarkdownLink[]): MarkdownLink[] {
  const seen = new Map<string, MarkdownLink>();
  for (const l of links) {
    const key = l.url.replace(/#.*$/, "").replace(/\/$/, "");
    if (!seen.has(key)) seen.set(key, l);
  }
  return [...seen.values()];
}

/** Tokenised, case/diacritic-insensitive match used by every "search inside a
 *  listing" adapter. All query tokens must appear in the haystack. */
export function matchesQuery(haystack: string, query: string): boolean {
  const hay = stripHtml(haystack).toLowerCase();
  const tokens = String(query || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
  if (!tokens.length) return true;
  return tokens.every((t) => hay.includes(t));
}

/** Score for ordering: title hits beat description hits, exact phrase wins. */
export function scoreMatch(title: string, description: string, query: string): number {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return 0;
  const t = String(title || "").toLowerCase();
  const d = String(description || "").toLowerCase();
  let score = 0;
  if (t.includes(q)) score += 60;
  if (d.includes(q)) score += 20;
  for (const tok of q.split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 1)) {
    if (t.includes(tok)) score += 12;
    if (d.includes(tok)) score += 4;
  }
  return score;
}

export function truncate(s: string, max: number): string {
  const v = String(s || "").replace(/\s+/g, " ").trim();
  return v.length <= max ? v : v.slice(0, max - 1).trimEnd() + "…";
}
