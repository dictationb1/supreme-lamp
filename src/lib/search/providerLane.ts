// [SEARCH-REPAIR] The client-side provider lane.
//
// WHY IT EXISTS: the previous fan-out ran entirely inside
// payloads/ghrdp-server.ps1, so a provider that was not compiled into that
// script simply could not be searched, and ANY provider failure reached the UI
// as one opaque string. The lane here runs the providers the app ships
// (src/lib/providers/*), reports each source separately, and keeps the results
// of sources that succeeded when another one fails - which is the behaviour the
// operator asked for and which the old single-error screen made impossible.
//
// Guarantees implemented here (and pinned by the tests):
//   * a source that fails never removes another source's results;
//   * a response that belongs to an older query generation is dropped;
//   * cancellation aborts the in-flight requests and reports CANCELLED, not an
//     error;
//   * every hit carries its provider, its provenance and only the fields the
//     provider actually supplied.
import type { Category, LicenceTag, SearchResult } from "@/api/search";
import type { ProviderHit } from "@/lib/providers";
import { runProviderLane, type LaneEvent, type SourceOutcome, type SourceSpec } from "@/lib/providers";

const VALID_LICENCES: LicenceTag[] = ["public-domain", "open-access", "creative-commons", "purchase", "own-storage"];

/** Stable, short, collision-resistant id (FNV-1a over the provider+hit key). */
export function stableResultId(providerId: string, hitId: string): string {
  let h = 0x811c9dc5;
  const s = `${providerId}::${hitId}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "pv-" + h.toString(16).padStart(8, "0");
}

function categoryFor(hit: ProviderHit): Category {
  if (hit.providerId === "github") return "software";
  if (hit.providerId === "internet-archive") {
    const mt = String(hit.extra?.mediatype ?? "");
    if (mt === "texts") return "books";
    if (mt === "audio" || mt === "etree") return "audio";
    if (mt === "movies") return "video";
    if (mt === "software" || mt === "data") return "software";
    return "media";
  }
  if (hit.providerId === "openverse") {
    return hit.extra?.durationMs != null || hit.extra?.filetype === "mp3" || hit.extra?.filetype === "ogg" ? "audio" : "media";
  }
  if (hit.kind === "media") return "media";
  return "media";
}

function licenceFor(hit: ProviderHit): { tag: LicenceTag; evidence: string } {
  const label = String(hit.license?.name || "").toUpperCase();
  // The app's badge vocabulary is fixed; a licence the vocabulary does not
  // cover is reported as creative-commons only when it really is one, and the
  // exact name+URL is always kept in the evidence line below.
  const tag: LicenceTag | undefined = !label
    ? undefined
    : /CC0|PDM|PUBLIC DOMAIN/.test(label)
      ? "public-domain"
      : /CREATIVE COMMONS|\bCC\b/.test(label)
        ? "creative-commons"
        : undefined;
  const sourceLabel = hit.source?.label || hit.providerId;
  if (tag && VALID_LICENCES.includes(tag)) {
    return {
      tag,
      evidence: hit.license?.name
        ? `${hit.license.name}${hit.license.url ? ` (${hit.license.url})` : ""} - supplied by ${sourceLabel}`
        : `licence supplied by ${sourceLabel}`,
    };
  }
  return {
    tag: "open-access",
    evidence: `The provider did not state a licence for this item (${sourceLabel}). Treat the badge as "not stated".`,
  };
}

export function hitToResult(hit: ProviderHit): SearchResult {
  const licence = licenceFor(hit);
  return {
    resultId: stableResultId(hit.providerId, hit.id),
    adapterId: hit.providerId,
    nameKey: `search.providers.${hit.providerId === "internet-archive" ? "internetArchive" : hit.providerId}`,
    category: categoryFor(hit),
    title: hit.title,
    creator: hit.creator ?? null,
    snippet: hit.description ?? null,
    sizeBytes: hit.fileSizeBytes ?? null,
    contentLength: null,
    licenceTag: licence.tag,
    licenceEvidence: licence.evidence,
    sourceSnapshotId: `provider:${hit.providerId}:live`,
    sourceUrl: hit.url,
    previewUrl: hit.fileUrl ?? hit.previewUrl ?? null,
    purchaseUrl: null,
    transportHint: hit.fileUrl ?? null,
    mimeType: null,
    date: hit.date ?? null,
    availability: hit.license ? "licence-stated" : "licence-unknown",
  };
}

/**
 * A kill switch for the client lane. ON in the application; the vitest setup
 * turns it OFF so a unit test that only wants the server lane is not
 * surprised by real provider traffic (the lane's own tests turn it back on and
 * inject a fetch). Production never flips it.
 */
let laneEnabled = true;

export function setProviderLaneEnabled(enabled: boolean): void {
  laneEnabled = enabled;
}

/**
 * The storage key an operator (or a hermetic E2E lane) sets to `off` to keep the
 * browser from querying the public providers directly.
 *
 * WHY IT MUST EXIST AND WHY IT IS NOT A TOGGLE IN THE UI: the client lane is the
 * feature - it is ON in every real session. But the F78/F79 Chromium lane runs
 * the PRODUCTION bundle against a FIXTURE backend that returns a fixed two-row
 * answer on purpose, and Playwright's runner has working internet egress: with
 * the lane unconditionally on, ten real GitHub rows landed on top of the two
 * fixture rows, so `toHaveCount(2)` saw 12 and the "xyz returns nothing" state
 * never appeared. That is the same dishonesty as a fixture silently replacing a
 * production result, just mirrored - a real result silently replacing the
 * fixture of a hermetic test. The switch lives here, is read once at load, and
 * is documented in docs/reports/search-repair/README.md §"Lane kill switch".
 */
export const SEARCH_LANE_STORAGE_KEY = "ghrdp:search.lane";

/** Resolve the lane's initial state from the environment it is loaded in. */
export function resolveLaneEnabled(win?: { localStorage?: Storage; __GHRDP_PROVIDER_LANE__?: unknown } | null): boolean {
  const w = win === undefined ? (typeof window === "undefined" ? null : (window as unknown as { localStorage?: Storage; __GHRDP_PROVIDER_LANE__?: unknown })) : win;
  if (!w) return true;
  // A page-level override wins (a spec can set it before the bundle boots).
  if (w.__GHRDP_PROVIDER_LANE__ === false) return false;
  try {
    const store = w.localStorage;
    if (store && store.getItem(SEARCH_LANE_STORAGE_KEY) === "off") return false;
  } catch {
    // private mode / disabled storage: the lane stays on, which is the safe default
  }
  return true;
}

laneEnabled = resolveLaneEnabled();

export function isProviderLaneEnabled(): boolean {
  return laneEnabled;
}

export interface ProviderLaneCallbacks {
  onEvent: (ev: LaneEvent) => void;
  onHits: (sourceId: string, rows: SearchResult[], hits: ProviderHit[]) => void;
}

/** Start the lane. Returns the promise so callers can await it in tests. */
export function startProviderLane(opts: {
  query: string;
  sources: SourceSpec[];
  signal?: AbortSignal;
  ctx: Parameters<typeof runProviderLane>[0]["ctx"];
  callbacks: ProviderLaneCallbacks;
}): Promise<SourceOutcome[]> {
  return runProviderLane({
    query: opts.query,
    sources: opts.sources,
    ctx: opts.ctx,
    signal: opts.signal,
    onEvent: opts.callbacks.onEvent,
    onHits: (sourceId, hits) => opts.callbacks.onHits(sourceId, hits.map(hitToResult), hits),
  });
}

/** Aggregate a lane's outcomes into the one sentence the UI shows above the
 *  results. Named "summary" because it must never claim more than it knows. */
export function summariseOutcomes(outcomes: SourceOutcome[]): {
  ok: number;
  empty: number;
  failed: number;
  cancelled: number;
  unsupported: number;
  total: number;
} {
  const count = (s: SourceOutcome["status"]) => outcomes.filter((o) => o.status === s).length;
  return {
    ok: count("complete"),
    empty: count("empty"),
    failed: count("failed"),
    cancelled: count("cancelled"),
    unsupported: count("unsupported"),
    total: outcomes.length,
  };
}
