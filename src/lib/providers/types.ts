// [SEARCH-REPAIR] Shared provider types.
//
// A provider is anything that can answer two questions truthfully:
//   1. "what do you have for this query?"      -> SearchOutcome
//   2. "what is this URL?"                     -> InspectOutcome
// Every field below exists because the UI must not invent data: `date`,
// `creator`, `fileSizeBytes` and `license` are optional and stay undefined when
// the provider did not supply them (no plausible-looking filler).

export type CapabilityLevel = "supported" | "partial" | "unsupported";

export interface ProviderCapabilities {
  /** Free-text query support. */
  search: CapabilityLevel;
  pagination: CapabilityLevel;
  /** Structured filters that actually change the HTTP request. */
  filters: string[];
  /** Per-item detail beyond the list row. */
  itemDetail: CapabilityLevel;
  /** Direct file/download URLs supplied by the provider. */
  files: CapabilityLevel;
  /** Thumbnail/preview URL supplied by the provider. */
  preview: CapabilityLevel;
  /** Machine-readable licence + attribution per item. */
  license: CapabilityLevel;
  notes: string[];
}

export interface ProviderHit {
  /** Stable within one provider+query: the same item always yields the same id. */
  id: string;
  providerId: string;
  kind:
    | "repo"
    | "readme-section"
    | "list-entry"
    | "archive-item"
    | "archive-file"
    | "media"
    | "article"
    | "editorial"
    | "external-resource"
    | "wiki-page"
    | "link"
    | "page";
  title: string;
  url: string;
  description?: string;
  /** Only when the provider stated it. */
  creator?: string;
  /** Only when the provider stated it (ISO date or year). */
  date?: string;
  /** Only when the provider gave a direct file URL. */
  fileUrl?: string;
  previewUrl?: string;
  fileSizeBytes?: number;
  license?: { name: string; url?: string; attribution?: string };
  /** Human-readable provenance, e.g. "README of sindresorhus/awesome › Audio". */
  source?: { label: string; url?: string };
  /** Category / section trail inside the source. */
  context?: string[];
  extra?: Record<string, string | number | boolean | undefined>;
}

export interface SearchOutcome {
  hits: ProviderHit[];
  /** The provider's own total when it reports one. */
  totalReported?: number;
  hasMore: boolean;
  nextPage?: number;
  /** Filters that were really applied to the request. */
  appliedFilters: string[];
  /** Filters the provider cannot honour (never silently dropped). */
  ignoredFilters: string[];
  notes: string[];
  tookMs: number;
}

export interface SectionItem {
  title: string;
  url: string;
  note?: string;
  /** e.g. "starred" for FMHY ⭐ resources. */
  badge?: string;
}

export interface InspectSection {
  key: string;
  label: string;
  items: SectionItem[];
  /** Anchor on the page, e.g. "fmhy.net/misc#-food". */
  anchor?: string;
}

export interface InspectFact {
  label: string;
  value: string;
  /** true when the value came from the provider, false when computed locally. */
  fromProvider?: boolean;
}

export interface InspectOutcome {
  providerId: string;
  /** What the URL turned out to be, e.g. "repo" | "readme" | "archive-item". */
  kind: string;
  canonicalUrl: string;
  title: string;
  description?: string;
  sections: InspectSection[];
  facts: InspectFact[];
  /** true only when this URL can be searched afterwards. */
  addable: boolean;
  notAddableReason?: string;
  capabilities?: ProviderCapabilities;
  /** Whether data came from the live provider in this call. */
  provenance?: "live" | "cached";
  tookMs: number;
}
