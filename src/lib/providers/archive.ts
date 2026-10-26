// [SEARCH-REPAIR] Internet Archive provider.
//
// Uses ONLY the interfaces the archive documents and actually serves:
//   GET /advancedsearch.php   metadata search  (CORS: *)
//   GET /metadata/{id}        item metadata + file list (CORS: *)
//   GET /download/{id}/{f}    file bytes (NO CORS -> relay or link-out)
// Verified live 2026-10-26: advancedsearch + metadata answer with
// `access-control-allow-origin: *`; the /download host does not, so a file is
// offered as a link (and through the relay when the operator enables it) rather
// than silently failing in the browser.
import { ProviderError, getJson, qs, type ProviderContext } from "./core";
import { detectChallenge, extractAnchors, extractMeta, matchesQuery, scoreMatch, stripHtml, truncate } from "./text";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome } from "./types";

const SEARCH = "https://archive.org/advancedsearch.php";
const METADATA = "https://archive.org/metadata";

export const MEDIATYPES = ["texts", "audio", "movies", "software", "image", "etree", "web", "data", "collection"] as const;

export const ARCHIVE_CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  inspect: "supported",
  filters: ["mediatype", "collection", "language", "year", "sort", "rows"],
  pagination: "supported",
  itemDetails: "supported",
  downloads: "supported",
  preview: "supported",
  attribution: "supported",
  notes: [
    "Search runs on /advancedsearch.php and returns the archive's own fields only (title, creator, year, mediatype, downloads, licence).",
    "Item details come from /metadata/{id}, which also supplies the real file list and sizes.",
    "Files are downloadable from /download/{id}/{name}; that host sends no CORS header, so files are offered as links (or via the server relay when enabled).",
    "Preview thumbnails come from /services/img/{id}.",
  ],
};

interface AdvancedSearchDoc {
  identifier?: string;
  title?: string | string[];
  creator?: string | string[];
  year?: string | number;
  date?: string;
  mediatype?: string;
  downloads?: number;
  item_size?: number;
  licenseurl?: string;
  collection?: string | string[];
  language?: string | string[];
  description?: string | string[];
}

function firstOf(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v.length ? String(v[0]) : undefined;
  return v != null ? String(v) : undefined;
}

function detailsUrl(id: string): string {
  return `https://archive.org/details/${encodeURIComponent(id)}`;
}

function downloadUrl(id: string, file?: string): string {
  const base = `https://archive.org/download/${encodeURIComponent(id)}/`;
  return file ? base + file.split("/").map(encodeURIComponent).join("/") : base;
}

function docToHit(doc: AdvancedSearchDoc, providerId: string): ProviderHit | null {
  const id = String(doc.identifier ?? "").trim();
  if (!id) return null;
  const title = firstOf(doc.title) || id;
  const creator = firstOf(doc.creator);
  const year = doc.year != null ? String(doc.year) : doc.date ? String(doc.date).slice(0, 4) : undefined;
  const licence = doc.licenseurl
    ? {
        tag: /creativecommons\.org\/(?:publicdomain|zero)/.test(doc.licenseurl) ? "public-domain" : "creative-commons",
        url: doc.licenseurl,
        name: doc.licenseurl.replace(/^https?:\/\//, ""),
        attribution: `Internet Archive item ${id}`,
      }
    : undefined;
  return {
    id: `ia:${id}`,
    providerId,
    kind: "item",
    title,
    description: firstOf(doc.description) ? truncate(stripHtml(firstOf(doc.description) as string), 400) : undefined,
    creator,
    date: year,
    url: detailsUrl(id),
    previewUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
    fileSizeBytes: typeof doc.item_size === "number" ? doc.item_size : undefined,
    license: licence,
    source: { label: `Internet Archive${doc.mediatype ? ` (${doc.mediatype})` : ""}`, url: detailsUrl(id) },
    extra: {
      identifier: id,
      ...(doc.mediatype ? { mediatype: doc.mediatype } : {}),
      ...(typeof doc.downloads === "number" ? { downloads: doc.downloads } : {}),
      ...(firstOf(doc.collection) ? { collection: firstOf(doc.collection) as string } : {}),
    },
    provenance: "live",
  };
}

export interface ArchiveSearchOptions {
  query: string;
  mediatype?: string;
  collection?: string;
  language?: string;
  yearFrom?: number;
  yearTo?: number;
  sort?: "relevance" | "date" | "downloads" | "title";
  page?: number;
  rows?: number;
  signal?: AbortSignal;
}

function buildArchiveQuery(o: ArchiveSearchOptions): string {
  const parts: string[] = [String(o.query || "").trim()];
  if (o.mediatype) parts.push(`mediatype:${o.mediatype}`);
  if (o.collection) parts.push(`collection:${o.collection}`);
  if (o.language) parts.push(`language:${o.language}`);
  if (o.yearFrom || o.yearTo) {
    const from = o.yearFrom ?? 0;
    const to = o.yearTo ?? 3000;
    parts.push(`year:[${from} TO ${to}]`);
  }
  return parts.filter(Boolean).join(" AND ");
}

export async function archiveSearch(o: ArchiveSearchOptions, ctx: ProviderContext, providerId = "internet-archive"): Promise<SearchOutcome> {
  const started = Date.now();
  const rows = Math.max(1, Math.min(100, o.rows ?? 20));
  const page = Math.max(1, o.page ?? 1);
  const fl = ["identifier", "title", "creator", "year", "date", "mediatype", "downloads", "item_size", "licenseurl", "collection", "description", "language"];
  const params = new URLSearchParams();
  params.set("q", buildArchiveQuery(o));
  for (const f of fl) params.append("fl[]", f);
  params.set("rows", String(rows));
  params.set("page", String(page));
  params.set("output", "json");
  const sortMap: Record<string, string> = { date: "date desc", downloads: "downloads desc", title: "titleSorter asc" };
  if (o.sort && sortMap[o.sort]) params.append("sort[]", sortMap[o.sort]);

  const url = `${SEARCH}?${params.toString()}`;
  const { data } = await getJson<{ response?: { numFound?: number; start?: number; docs?: AdvancedSearchDoc[] } }>(url, ctx);
  const docs = data.response?.docs ?? [];
  const hits = docs.map((d) => docToHit(d, providerId)).filter((h): h is ProviderHit => Boolean(h));
  const found = Number(data.response?.numFound ?? hits.length);
  const applied: string[] = ["rows", "page"];
  if (o.mediatype) applied.push("mediatype");
  if (o.collection) applied.push("collection");
  if (o.language) applied.push("language");
  if (o.yearFrom || o.yearTo) applied.push("year");
  if (o.sort && sortMap[o.sort]) applied.push("sort");
  return {
    hits,
    totalReported: found,
    hasMore: page * rows < found,
    nextPage: page * rows < found ? page + 1 : undefined,
    appliedFilters: applied,
    ignoredFilters: [],
    notes: [`advancedsearch.php: ${found.toLocaleString()} items for "${o.query}"${o.mediatype ? ` in ${o.mediatype}` : ""}.`],
    tookMs: Date.now() - started,
  };
}

export interface ArchiveFile {
  name: string;
  format?: string;
  sizeBytes?: number;
  md5?: string;
  url: string;
}

export interface ArchiveItem {
  identifier: string;
  title: string;
  description?: string;
  creator?: string;
  date?: string;
  mediatype?: string;
  license?: { tag: string; name?: string; url?: string; attribution?: string };
  detailsUrl: string;
  files: ArchiveFile[];
  metadata: Record<string, string>;
}

interface MetadataResp {
  metadata?: Record<string, unknown>;
  files?: { name?: string; format?: string; size?: string | number; md5?: string; source?: string }[];
  is_dark?: boolean;
  message?: string;
}

export async function archiveItem(identifier: string, ctx: ProviderContext): Promise<ArchiveItem> {
  const id = String(identifier || "").trim();
  if (!id) throw new ProviderError("UNSUPPORTED", "An Internet Archive identifier is required.", { retryable: false });
  const { data } = await getJson<MetadataResp>(`${METADATA}/${encodeURIComponent(id)}`, ctx);
  if (!data || data.is_dark) {
    throw new ProviderError("NOT_FOUND", `The archive item "${id}" is dark (unavailable) or does not exist.`, { retryable: false });
  }
  const md = data.metadata ?? {};
  const pick = (k: string): string | undefined => {
    const v = md[k];
    if (v == null) return undefined;
    return Array.isArray(v) ? String(v[0]) : String(v);
  };
  const files: ArchiveFile[] = (data.files ?? [])
    .filter((f) => f && f.name && f.name !== "__ia_thumb.jpg")
    .map((f) => ({
      name: String(f.name),
      format: f.format ? String(f.format) : undefined,
      sizeBytes: f.size != null && Number.isFinite(Number(f.size)) ? Number(f.size) : undefined,
      md5: f.md5 ? String(f.md5) : undefined,
      url: downloadUrl(id, String(f.name)),
    }));
  const licUrl = pick("licenseurl");
  return {
    identifier: id,
    title: pick("title") || id,
    description: pick("description") ? truncate(stripHtml(pick("description") as string), 1200) : undefined,
    creator: pick("creator"),
    date: pick("date") || pick("year") || pick("publicdate")?.slice(0, 10),
    mediatype: pick("mediatype"),
    license: licUrl
      ? {
          tag: /creativecommons\.org\/(?:publicdomain|zero)/.test(licUrl) ? "public-domain" : "creative-commons",
          url: licUrl,
          name: licUrl.replace(/^https?:\/\//, ""),
          attribution: `Internet Archive item ${id}`,
        }
      : undefined,
    detailsUrl: detailsUrl(id),
    files,
    metadata: Object.fromEntries(
      Object.entries(md)
        .filter(([, v]) => v != null && (typeof v === "string" || typeof v === "number"))
        .slice(0, 40)
        .map(([k, v]) => [k, String(v)] as [string, string])
    ),
  };
}

/** Which Internet Archive URL shape is this? Item page, download directory,
 *  single file, or API. The distinction matters: only an item is addable as a
 *  source, and only a file is directly downloadable. */
export function parseArchiveUrl(url: string): { kind: "details" | "download" | "file" | "metadata" | "thumb"; identifier: string; file?: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)archive\.org$/.test(host)) return null;
  const segs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (host === "services-img" || host === "services") {
    const idx = segs.indexOf("img");
    if (idx >= 0 && segs[idx + 1]) return { kind: "thumb", identifier: segs[idx + 1] };
    return null;
  }
  if (segs[0] === "details" && segs[1]) return { kind: "details", identifier: segs[1] };
  if (segs[0] === "metadata" && segs[1]) return { kind: "metadata", identifier: segs[1] };
  if (segs[0] === "download" && segs[1]) {
    const rest = segs.slice(2).join("/");
    return rest ? { kind: "file", identifier: segs[1], file: rest } : { kind: "download", identifier: segs[1] };
  }
  return null;
}

export async function archiveInspect(url: string, ctx: ProviderContext, providerId = "internet-archive"): Promise<InspectOutcome> {
  const started = Date.now();
  const parsed = parseArchiveUrl(url);
  if (!parsed) throw new ProviderError("UNSUPPORTED", "That is not an archive.org item or file URL.", { url, retryable: false });
  const item = await archiveItem(parsed.identifier, ctx);
  const facts: InspectOutcome["facts"] = [
    { label: "Identifier", value: item.identifier },
    { label: "Media type", value: item.mediatype ?? "not reported" },
    { label: "Files", value: String(item.files.length) },
  ];
  if (item.creator) facts.push({ label: "Creator", value: item.creator });
  if (item.date) facts.push({ label: "Date", value: item.date });
  if (parsed.file) facts.push({ label: "Requested file", value: parsed.file });
  const sections: InspectOutcome["sections"] = [
    {
      key: "files",
      label: "Files available from this item",
      items: item.files.slice(0, 300).map((f) => ({
        title: f.name,
        url: f.url,
        description: f.format,
        meta: f.sizeBytes != null ? `${(f.sizeBytes / 1024 / 1024).toFixed(1)} MB` : undefined,
      })),
    },
  ];
  const metaItems = Object.entries(item.metadata)
    .filter(([k]) => !["identifier", "title", "description", "mediatype"].includes(k))
    .slice(0, 40)
    .map(([k, v]) => ({ title: k, url: item.detailsUrl, description: truncate(v, 240) }));
  if (metaItems.length) sections.push({ key: "metadata", label: "Item metadata", items: metaItems });
  return {
    providerId,
    kind: parsed.kind === "file" ? "file" : "item",
    canonicalUrl: item.detailsUrl,
    title: item.title,
    description: item.description,
    date: item.date,
    creator: item.creator,
    license: item.license,
    sections,
    facts,
    addable: parsed.kind !== "file",
    notAddableReason: parsed.kind === "file" ? "A single archived file is not a searchable source; add the item or the archive instead." : undefined,
    capabilities: ARCHIVE_CAPABILITIES,
    tookMs: Date.now() - started,
  };
}

/** Collection browsing helper: the archive's own listing of a collection's
 *  newest items (used by the item-detail screen and the custom-source preview). */
export async function archiveCollectionFeed(collection: string, ctx: ProviderContext, rows = 20): Promise<ProviderHit[]> {
  const out = await archiveSearch({ query: `collection:${collection}`, rows, sort: "date" }, ctx);
  return out.hits;
}

/** Fallback used when a details page must be read as HTML (relay transport). */
export async function archiveDetailsPageFacts(html: string): Promise<{ title?: string; description?: string }> {
  if (detectChallenge(html).challenged) return {};
  const meta = extractMeta(html);
  const anchors = extractAnchors(html, "https://archive.org/");
  return { title: meta.title || undefined, description: meta.description || anchors.length ? meta.description : meta.description };
}

export { matchesQuery, scoreMatch, qs };
