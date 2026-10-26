// [SEARCH-REPAIR] Small, dependency-free text/HTML/Markdown helpers.
//
// Everything here runs in the BROWSER (the app has no build-time DOM guarantee
// for tests) so it is a tolerant regex tokenizer, not a parser library. It only
// ever extracts what is literally in the payload: no fabricated titles, no
// guessed dates. Every helper is exported so the fixture suite can pin it.

export function decodeEntities(s: string): string {
  return String(s || "")
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent: string) => {
      if (ent[0] === "#") {
        const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      const map: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
        ndash: "–",
        mdash: "—",
        hellip: "…",
        rsquo: "’",
        lsquo: "‘",
        ldquo: "“",
        rdquo: "”",
        middot: "·",
        copy: "©",
      };
      return map[ent.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ");
}

/** Strip tags, decode entities, collapse whitespace. */
export function stripHtml(html: string): string {
  return decodeEntities(
    String(html || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, " ")
      .replace(/<[^>]+>/g, "")
  ).trim();
}

export function truncate(s: string, n: number): string {
  const t = String(s || "");
  return t.length <= n ? t : t.slice(0, Math.max(0, n - 1)).trimEnd() + "…";
}

/** Absolute URL from a possibly relative href; null for javascript:/mailto:/#. */
export function absolutize(href: string, base: string): string | null {
  const raw = String(href || "").trim();
  if (!raw) return null;
  if (/^(javascript|mailto|tel|data):/i.test(raw)) return null;
  if (/^#/.test(raw)) return null;
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** The common link-time shapes of an anti-bot interstitial. */
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

export interface Anchor {
  title: string;
  url: string;
  /** The text after the link, when the listing supplies a description. */
  note?: string;
}

/** All <a href> anchors with readable text, resolved against `base`. */
export function extractAnchors(html: string, base: string, opts: { minText?: number } = {}): Anchor[] {
  const minText = opts.minText ?? 2;
  const out: Anchor[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html || "")))) {
    const title = stripHtml(m[2]);
    if (!title || title.length < minText) continue;
    const url = absolutize(m[1], base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title, url });
  }
  return out;
}

/** Headings with their immediate anchor lists, so a listing keeps its section.
 *  The id is captured from the SAME tag it belongs to (an earlier version
 *  collected ids in a second pass, which shifted every anchor by one as soon as
 *  a heading had no id). */
export function extractHeadingSections(html: string, base: string): { heading: string; id?: string; anchors: Anchor[] }[] {
  const src = String(html || "");
  const tagRe = /<h([1-4])\b([^>]*)>/gi;
  const marks: { start: number; end: number; attrs: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(src))) marks.push({ start: m.index, end: m.index + m[0].length, attrs: m[2] });
  if (!marks.length) {
    const anchors = extractAnchors(src, base);
    return anchors.length ? [{ heading: "", anchors }] : [];
  }
  const out: { heading: string; id?: string; anchors: Anchor[] }[] = [];
  const before = src.slice(0, marks[0].start);
  const leading = extractAnchors(before, base);
  if (leading.length) out.push({ heading: "", anchors: leading });
  for (let i = 0; i < marks.length; i += 1) {
    const from = marks[i].end;
    const to = i + 1 < marks.length ? marks[i + 1].start : src.length;
    const chunk = src.slice(from, to);
    const close = chunk.search(/<\/h[1-4]>/i);
    const heading = close >= 0 ? stripHtml(chunk.slice(0, close)) : "";
    const rest = close >= 0 ? chunk.slice(close) : chunk;
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(marks[i].attrs)?.[1];
    const anchors = extractAnchors(rest, base);
    if (heading || anchors.length) out.push({ heading, id, anchors });
  }
  return out;
}

export function extractMeta(html: string): {
  title?: string;
  description?: string;
  canonical?: string;
  ogTitle?: string;
  published?: string;
  author?: string;
} {
  const src = String(html || "");
  const meta = (name: string): string | undefined => {
    const re = new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, "i");
    const alt = new RegExp(`<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:name|property)\\s*=\\s*["']${name}["']`, "i");
    const m = re.exec(src) || alt.exec(src);
    return m ? decodeEntities(m[1]) : undefined;
  };
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
  const canonical = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(src);
  return {
    title: titleTag ? stripHtml(titleTag[1]) : undefined,
    description: meta("description") || meta("og:description"),
    canonical: canonical ? absolutize(canonical[1], "https://example.invalid/") || canonical[1] : undefined,
    ogTitle: meta("og:title"),
    published: meta("article:published_time") || meta("date") || meta("datePublished"),
    author: meta("author") || meta("article:author"),
  };
}

export interface FeedItem {
  title: string;
  link: string;
  description?: string;
  date?: string;
  categories?: string[];
}

/** RSS 2.0 / RDF / Atom, by tag rather than by parser: tolerant of namespaces. */
export function extractFeedItems(xml: string): FeedItem[] {
  const src = String(xml || "");
  const items: FeedItem[] = [];
  const blocks = src.match(/<item\b[\s\S]*?<\/item>/gi) || src.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const block of blocks) {
    const pick = (tag: string): string | undefined => {
      const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
      if (!m) return undefined;
      return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
    };
    const title = pick("title");
    let link = pick("link");
    if (!link) {
      const href = /<link\b[^>]*href\s*=\s*["']([^"']+)["']/i.exec(block);
      link = href ? href[1] : undefined;
    }
    if (!title || !link) continue;
    const descHtml = pick("description") || pick("summary") || pick("content:encoded") || pick("content");
    const cats = [...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
      .map((m) => stripHtml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")))
      .filter(Boolean);
    const date = pick("pubDate") || pick("dc:date") || pick("published") || pick("updated");
    items.push({
      title,
      link,
      description: descHtml ? truncate(stripHtml(descHtml), 400) : undefined,
      date: date ? new Date(date).toISOString().slice(0, 10).replace(/^Invalid/, "") || undefined : undefined,
      categories: cats.length ? cats : undefined,
    });
  }
  return items;
}

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

export function extractSitemap(xml: string): { kind: "index" | "urlset"; entries: SitemapEntry[] } {
  const src = String(xml || "");
  const kind: "index" | "urlset" = /<sitemapindex\b/i.test(src) ? "index" : "urlset";
  const entries: SitemapEntry[] = [];
  const blocks = src.match(/<(url|sitemap)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(b);
    if (!loc) continue;
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(b);
    const url = absolutize(decodeEntities(loc[1]), "https://example.invalid/");
    if (!url) continue;
    entries.push({ loc: url, lastmod: lastmod ? lastmod[1].slice(0, 10) : undefined });
  }
  return { kind, entries };
}

export interface MarkdownSection {
  level: number;
  title: string;
  /** Raw heading text without #s, with inline markup stripped. */
  text: string;
  links: { title: string; url: string; description?: string }[];
  /** Number of list items (used to tell a list section from a prose section). */
  bullets: number;
}

/** Strip badge markup so headings read as text: "## Audio [![x](y)](z)" -> "Audio". */
export function cleanHeading(raw: string): string {
  return stripHtml(
    String(raw || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
  ).trim();
}

const MD_LINK = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const MD_BULLET = /^\s{0,3}(?:[-*+]|\d+\.)\s+/;

/** Markdown → heading sections, each with the links it contains.
 *  `baseUrl` resolves relative links (a README's `./docs/x.md`) so a nested list
 *  never produces a broken URL. */
export function parseMarkdownSections(md: string, baseUrl: string, titlePrefix = ""): MarkdownSection[] {
  const lines = String(md || "").split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { level: 0, title: titlePrefix, text: titlePrefix, links: [], bullets: 0 };
  let inFence = false;
  const push = () => {
    if (current.links.length || current.bullets || current.level || titlePrefix) sections.push(current);
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      push();
      const raw = heading[2].trim();
      current = { level: heading[1].length, title: cleanHeading(raw), text: raw, links: [], bullets: 0 };
      continue;
    }
    if (MD_BULLET.test(line)) current.bullets += 1;
    const text = line.replace(MD_LINK, (_m, label: string, href: string) => {
      const url = absolutize(href, baseUrl);
      if (url) {
        const note = line.replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/, "").split(" - ")[1];
        current.links.push({ title: stripHtml(label).trim(), url, description: note ? truncate(stripHtml(note), 160) : undefined });
      }
      return label;
    });
    void text;
  }
  push();
  return sections.filter((s) => s.level > 0 || s.links.length || s.bullets);
}

/** Loose query match: every whitespace-separated token must appear in the text. */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = String(query || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (!q.length) return true;
  const hay = String(haystack || "").toLowerCase();
  return q.every((tok) => hay.includes(tok));
}

/** Ranking: title matches weigh more than description matches, prefixes most. */
export function scoreMatch(title: string, description: string, query: string): number {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return 0;
  const t = String(title || "").toLowerCase();
  const d = String(description || "").toLowerCase();
  let score = 0;
  if (t === q) score += 100;
  if (t.startsWith(q)) score += 40;
  if (t.includes(q)) score += 25;
  if (d.includes(q)) score += 8;
  for (const tok of q.split(/\s+/)) {
    if (tok.length < 2) continue;
    if (t.includes(tok)) score += 6;
    else if (d.includes(tok)) score += 2;
  }
  return score;
}
