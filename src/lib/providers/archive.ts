// [SEARCH-REPAIR] Internet Archive provider.
//
// Interfaces used (all CORS `*`, verified live - see
// docs/reports/search-repair/evidence/live-probe.json):
//   * https://archive.org/advancedsearch.php?q=...&fl[]=...&rows=&page=&output=json
//     - real query language (mediatype:, collection:, year ranges), real
//       numFound total, real page/rows pagination, real sort.
//   * https://archive.org/metadata/<identifier>
//     - item metadata PLUS the authoritative file list (name, size, format,
//       md5), so a file listing is never guessed from a URL pattern.
// The scrape endpoint is NOT used: its parameter set differs (cursor/count) and
// the advancedsearch API already answers everything this app needs.
import { ProviderError, getJson, type ProviderContext } from "./core";
import { stripHtml, truncate } from "./text";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome } from "./types";

const SEARCH = "https://archive.org/advancedsearch.php";
const META = "https://archive.org/metadata";

export const MEDIATYPES = ["texts", "audio", "movies", "software", "image", "etree", "web", "data", "collection"] as const;
export type ArchiveMediatype = (typeof MEDIATYPES)[number];

export const ARCHIVE_CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  pagination: "supported",
  filters: ["mediatype", "collection", "language", "year", "sort"],
  itemDetail: "supported",
  files: "supported",
  preview: "supported",
  license: "partial",
  notes: [
    "Queries run against archive.org's own advancedsearch index, so the total, the page size and the sort order are the archive's, not a local guess.",
    "Every item row comes with its identifier; the item's real file list (name, size, format) is read from its metadata document rather than constructed from a URL.",
    "Download URLs are the archive's own /download/<identifier>/<file> paths, reported only for files the metadata document lists.",
    "The download host does not allow browser reads, so 'open the file' is offered as a link; the metadata itself is read through the CORS-enabled endpoint.",
  ],
};

export type ArchiveSort = "relevance" | "date" | "downloads" | "title";

export interface ArchiveSearchOptions {
  query: string;
  mediatype?: ArchiveMediatype;
  collection?: string;
  language?: string;
  yearFrom?: number;
  yearTo?: number;
  sort?: ArchiveSort;
  page?: number;
  rows?: number;
  signal?: AbortSignal;
}

interface AdvancedSearchDoc {
  identifier?: string;
  title?: string | string[];
  creator?: string | string[];
  year?: string | number;
  date?: string;
  mediatype?: string;
  downloads?: number;
  licenseurl?: string;
  description?: string | string[];
  collection?: string | string[];
  item_size?: number;
  language?: string | string[];
}

function firstString(v: string | string[] | number | undefined): string | undefined {
  if (Array.isArray(v)) return v.find((x) => typeof x === "string" && x.trim()) || undefined;
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function buildQuery(o: ArchiveSearchOptions): string {
  const parts: string[] = [];
  const q = String(o.query || "").trim();
  if (q) parts.push(q);
  if (o.mediatype) parts.push(`mediatype:${o.mediatype}`);
  if (o.collection) parts.push(`collection:${o.collection}`);
  if (o.language) parts.push(`language:${o.language}`);
  if (o.yearFrom || o.yearTo) parts.push(`year:[${o.yearFrom ?? 0} TO ${o.yearTo ?? 3000}]`);
  return parts.join(" AND ") || "*:*";
}

const SORTS: Record<Exclude<ArchiveSort, "relevance">, string> = {
  date: "date desc",
  downloads: "downloads desc",
  title: "titleSorter asc",
};

function docToHit(d: AdvancedSearchDoc, providerId: string): ProviderHit | null {
  const identifier = firstString(d.identifier);
  if (!identifier) return null;
  const title = firstString(d.title) || identifier;
  const creator = firstString(d.creator);
  const year = firstString(d.year);
  const date = firstString(d.date);
  const description = firstString(d.description);
  return {
    id: `ia:${identifier}`,
    providerId,
    kind: "archive-item",
    title,
    url: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    description: description ? truncate(stripHtml(description), 260) : undefined,
    // ONLY what the archive stated: many items genuinely have no creator/year.
    ...(creator ? { creator } : {}),
    ...(year || date ? { date: year || (date ? date.slice(0, 10) : undefined) } : {}),
    ...(typeof d.item_size === "number" ? { fileSizeBytes: d.item_size } : {}),
    ...(d.licenseurl ? { license: { name: firstString(d.licenseurl) as string, url: firstString(d.licenseurl) } } : {}),
    previewUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    source: { label: `Internet Archive${d.mediatype ? ` › ${firstString(d.mediatype)}` : ""}`, url: "https://archive.org" },
    extra: {
      identifier,
      ...(d.mediatype ? { mediatype: firstString(d.mediatype) } : {}),
      ...(typeof d.downloads === "number" ? { downloads: d.downloads } : {}),
      ...(firstString(d.collection) ? { collection: firstString(d.collection) } : {}),
    },
  };
}

export async function archiveSearch(o: ArchiveSearchOptions, ctx: ProviderContext, providerId = "internet-archive"): Promise<SearchOutcome> {
  const started = Date.now();
  const rows = Math.max(1, Math.min(100, o.rows ?? 20));
  const page = Math.max(1, o.page ?? 1);
  const fl = ["identifier", "title", "creator", "year", "date", "mediatype", "downloads", "item_size", "licenseurl", "collection", "description", "language"];
  const params = new URLSearchParams();
  params.set("q", buildQuery(o));
  for (const f of fl) params.append("fl[]", f);
  params.set("rows", String(rows));
  params.set("page", String(page));
  params.set("output", "json");
  const applied = ["rows", "page"];
  if (o.mediatype) applied.push("mediatype");
  if (o.collection) applied.push("collection");
  if (o.language) applied.push("language");
  if (o.yearFrom || o.yearTo) applied.push("year");
  if (o.sort && o.sort !== "relevance" && SORTS[o.sort]) {
    params.append("sort[]", SORTS[o.sort]);
    applied.push("sort");
  }
  const url = `${SEARCH}?${params.toString()}`;
  const { data } = await getJson<{ response?: { numFound?: number; start?: number; docs?: AdvancedSearchDoc[] } }>(url, ctx);
  if (!data || !data.response) {
    throw new ProviderError("PARSE_ERROR", "archive.org answered, but not with a search response.", { url });
  }
  const docs = data.response.docs ?? [];
  const hits = docs.map((d) => docToHit(d, providerId)).filter((h): h is ProviderHit => Boolean(h));
  const found = Number(data.response.numFound ?? hits.length);
  return {
    hits,
    totalReported: found,
    hasMore: page * rows < found,
    nextPage: page * rows < found ? page + 1 : undefined,
    appliedFilters: applied,
    ignoredFilters: [],
    notes: [`advancedsearch.php: ${found.toLocaleString()} item(s) for "${o.query || "*"}"${o.mediatype ? ` in ${o.mediatype}` : ""}.`],
    tookMs: Date.now() - started,
  };
}

export interface ArchiveFile {
  name: string;
  format?: string;
  sizeBytes?: number;
  md5?: string;
  /** The archive's own download URL for this file. */
  url: string;
}

export interface ArchiveItem {
  identifier: string;
  title: string;
  description?: string;
  creator?: string;
  date?: string;
  mediatype?: string;
  collection: string[];
  language?: string;
  license?: { name: string; url?: string };
  files: ArchiveFile[];
  detailsUrl: string;
}

interface ApiMetadata {
  metadata?: {
    identifier?: string;
    title?: string;
    description?: string | string[];
    creator?: string | string[];
    date?: string;
    publicdate?: string;
    mediatype?: string;
    collection?: string | string[];
    language?: string | string[];
    licenseurl?: string;
    year?: string;
  };
  files?: { name?: string; format?: string; size?: string; md5?: string }[];
  is_dark?: boolean;
}

export async function archiveItem(identifier: string, ctx: ProviderContext): Promise<ArchiveItem> {
  const id = String(identifier || "").trim();
  if (!id) throw new ProviderError("UNSUPPORTED", "An archive.org identifier is required.", { retryable: false });
  const url = `${META}/${encodeURIComponent(id)}`;
  const { data } = await getJson<ApiMetadata>(url, ctx);
  if (!data || (!data.metadata && !data.files)) {
    throw new ProviderError("NOT_FOUND", `archive.org has no item called "${id}".`, { url, status: 404, retryable: false });
  }
  const m = data.metadata || {};
  const files: ArchiveFile[] = (data.files || [])
    .filter((f) => f.name)
    .map((f) => ({
      name: String(f.name),
      format: f.format,
      sizeBytes: f.size ? Number(f.size) : undefined,
      md5: f.md5,
      url: `https://archive.org/download/${encodeURIComponent(id)}/${String(f.name).split("/").map(encodeURIComponent).join("/")}`,
    }))
    .filter((f) => Number.isFinite(f.sizeBytes ?? 0) || f.format);
  const licenseUrl = firstString(m.licenseurl);
  return {
    identifier: firstString(m.identifier) || id,
    title: firstString(m.title) || id,
    description: firstString(m.description) ? truncate(stripHtml(firstString(m.description) as string), 600) : undefined,
    creator: firstString(m.creator),
    date: firstString(m.date) || firstString(m.year) || (m.publicdate ? String(m.publicdate).slice(0, 10) : undefined),
    mediatype: firstString(m.mediatype),
    collection: (Array.isArray(m.collection) ? m.collection : m.collection ? [m.collection] : []).filter(Boolean) as string[],
    language: firstString(m.language),
    ...(licenseUrl ? { license: { name: licenseUrl.replace(/^https?:\/\/(www\.)?creativecommons\.org\//, "CC "), url: licenseUrl } } : {}),
    files,
    detailsUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
  };
}

/** Parse the three archive.org URL shapes (details / download / file). */
export function parseArchiveUrl(url: string): { kind: "details" | "download" | "file" | "metadata"; identifier: string; file?: string } | null {
  let u: URL;
  try {
    u = new URL(String(url || "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)archive\.org$/.test(host)) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs[0] === "details" && segs[1]) return { kind: "details", identifier: decodeURIComponent(segs[1]) };
  if (segs[0] === "metadata" && segs[1]) return { kind: "metadata", identifier: decodeURIComponent(segs[1]) };
  if (segs[0] === "download" && segs[1]) {
    const file = segs.slice(2).map(decodeURIComponent).join("/");
    return file ? { kind: "file", identifier: decodeURIComponent(segs[1]), file } : { kind: "download", identifier: decodeURIComponent(segs[1]) };
  }
  if (segs[0] === "services" && segs[1] === "img" && segs[2]) return { kind: "details", identifier: decodeURIComponent(segs[2]) };
  return null;
}

export async function archiveInspect(url: string, ctx: ProviderContext, providerId = "internet-archive"): Promise<InspectOutcome> {
  const started = Date.now();
  const parsed = parseArchiveUrl(url);
  if (!parsed) {
    throw new ProviderError("UNSUPPORTED", "That archive.org URL is not an item, a download or a file.", { url, retryable: false });
  }
  const item = await archiveItem(parsed.identifier, ctx);
  const files = item.files.slice(0, 120).map((f) => ({
    title: f.name,
    url: f.url,
    note: [f.format, f.sizeBytes ? `${Math.round(f.sizeBytes / 1024).toLocaleString()} KB` : undefined].filter(Boolean).join(" · ") || undefined,
  }));
  const facts: InspectOutcome["facts"] = [
    { label: "Identifier", value: item.identifier, fromProvider: true },
    { label: "Media type", value: item.mediatype || "not stated", fromProvider: Boolean(item.mediatype) },
    { label: "Files", value: String(item.files.length), fromProvider: true },
    ...(item.creator ? [{ label: "Creator", value: item.creator, fromProvider: true }] : []),
    ...(item.date ? [{ label: "Date", value: item.date, fromProvider: true }] : []),
    ...(item.language ? [{ label: "Language", value: item.language, fromProvider: true }] : []),
    ...(item.license ? [{ label: "Licence", value: item.license.name, fromProvider: true }] : []),
    ...(item.collection.length ? [{ label: "Collections", value: item.collection.join(", "), fromProvider: true }] : []),
  ];
  if (parsed.kind === "file" || parsed.kind === "download") {
    facts.unshift({ label: "Requested", value: parsed.file ? `file: ${parsed.file}` : "the item's download folder", fromProvider: false });
  }
  return {
    providerId,
    kind: parsed.kind === "details" || parsed.kind === "metadata" ? "archive-item" : parsed.file ? "archive-file" : "archive-item",
    canonicalUrl: item.detailsUrl,
    title: item.title,
    description: item.description,
    sections: files.length ? [{ key: "files", label: `Files in this item (${item.files.length})`, items: files }] : [],
    facts,
    addable: true,
    capabilities: ARCHIVE_CAPABILITIES,
    provenance: "live",
    tookMs: Date.now() - started,
  };
}
