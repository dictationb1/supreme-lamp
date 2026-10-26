// [SEARCH-REPAIR] Provider contract.
//
// Every adapter declares what it can ACTUALLY do (capabilities), and every hit
// carries its provenance (which list/page it came from, whether the date,
// author, size or licence was supplied by the provider or is genuinely absent).
// A provider that cannot search says so in `capabilities.search === "unsupported"`
// with a reason, instead of shipping a source row that can never return rows.
import type { ProviderContext } from "./core";

export type CapabilityLevel = "supported" | "partial" | "unsupported";

export interface ProviderCapabilities {
  /** Free-text search across the provider's own index/listing. */
  search: CapabilityLevel;
  /** Open ONE pasted URL and return useful structured information. */
  inspect: CapabilityLevel;
  /** Server-side media/content filters that actually change the request. */
  filters: string[];
  /** Real pagination (cursor or page number), not a bigger single request. */
  pagination: CapabilityLevel;
  /** Item detail with file listings. */
  itemDetails: CapabilityLevel;
  /** A downloadable file URL supplied by the provider (not constructed). */
  downloads: CapabilityLevel;
  /** Preview thumbnail supplied by the provider. */
  preview: CapabilityLevel;
  /** Attribution/licence supplied per item. */
  attribution: CapabilityLevel;
  /** Nested list discovery (a list that links to more lists). */
  nestedLists?: CapabilityLevel;
  /** Plain-English explanation shown in the UI, including the caveats we
   *  verified against the live service. */
  notes: string[];
}

export type HitKind =
  | "editorial"
  | "external-resource"
  | "repository"
  | "list-entry"
  | "list-category"
  | "item"
  | "file"
  | "media"
  | "page";

export interface ProviderHit {
  /** Stable within the provider: the same page always yields the same key. */
  id: string;
  providerId: string;
  kind: HitKind;
  title: string;
  description?: string;
  creator?: string;
  /** ISO-8601 date or 4-digit year, ONLY when the provider supplied it. */
  date?: string;
  /** Landing page for the hit. */
  url: string;
  /** A file the provider says exists. Never constructed from a guess. */
  fileUrl?: string;
  fileSizeBytes?: number;
  previewUrl?: string;
  license?: { tag: string; name?: string; url?: string; attribution?: string };
  /** Attribution line: "GitHub README of mfkl/awesome-vlc". */
  source: { label: string; url?: string };
  /** Where inside the provider this hit lives (category path, file list). */
  context?: string[];
  /** Small factual extras rendered in the detail panel. Never invented: a key
   *  is present only when the provider supplied the value. */
  extra?: Record<string, string | number | boolean>;
  provenance: "live";
}

export interface SearchRequest {
  query: string;
  limit?: number;
  page?: number;
  /** Provider-specific filters; each provider reports which it honours. */
  filters?: Record<string, string | string[] | number | boolean | undefined>;
  signal?: AbortSignal;
}

export interface SearchOutcome {
  hits: ProviderHit[];
  /** Honest count: the provider's total when it reports one, else undefined. */
  totalReported?: number;
  hasMore: boolean;
  nextPage?: number;
  /** Which filters actually changed the upstream request. */
  appliedFilters: string[];
  /** What the provider did NOT support for this request. */
  ignoredFilters: string[];
  /** Human-readable note about where the data came from (cache, feed, list). */
  notes: string[];
  tookMs: number;
}

export interface InspectOutcome {
  providerId: string;
  /** What the URL turned out to be. */
  kind: string;
  canonicalUrl: string;
  title: string;
  description?: string;
  date?: string;
  creator?: string;
  license?: { tag: string; name?: string; url?: string; attribution?: string };
  /** Structured rows: README categories, archive files, editorial resources. */
  sections: { key: string; label: string; items: { title: string; url: string; description?: string; meta?: string }[] }[];
  facts: { label: string; value: string }[];
  /** True when this URL can be stored as a source and searched later. */
  addable: boolean;
  /** Why not, when `addable` is false. */
  notAddableReason?: string;
  capabilities: ProviderCapabilities;
  tookMs: number;
}

export interface ProviderDefinition {
  id: string;
  /** i18n key for the display name. */
  nameKey: string;
  label: string;
  homepage: string;
  /** Hosts this provider reads (mirrored by the relay allowlist). */
  hosts: string[];
  defaultEnabled: boolean;
  capabilities: ProviderCapabilities;
  /** URL shapes this provider owns, e.g. /github\.com\/[^/]+\/[^/]+/. */
  urlPatterns: RegExp[];
  /** True when a pasted URL should be resolved to a canonical form first. */
  search?: (req: SearchRequest, ctx: ProviderContext) => Promise<SearchOutcome>;
  inspect?: (url: string, ctx: ProviderContext) => Promise<InspectOutcome>;
}

export function emptyOutcome(started: number, notes: string[] = []): SearchOutcome {
  return {
    hits: [],
    hasMore: false,
    appliedFilters: [],
    ignoredFilters: [],
    notes,
    tookMs: Date.now() - started,
  };
}

export function hitId(providerId: string, url: string): string {
  return `${providerId}:${url}`;
}
