// [R-FILES / #217 / #225] The READ half of the Explorer's transport.
//
// WHY THIS IS NOT IN components/explorer/api/*: launch-gates.yml §F45 S3 asserts
// that the S3 op client never enters the shipped single-file bundle - it greps
// ui/dist/index.html for the S3-only idempotency header and the fx.err catalog.
// The v3
// acceptance requires the ROUTED Files page to read the runner's normalized
// index, so a read path must ship. Importing endpoints.ts/fxClient.ts here would
// drag in the whole op client (idempotency header, error catalog, retry policy);
// this module keeps the read on the same documented same-origin transport as
// `transport.ts` - dash token in the HEADER, never in a URL - so the bundle
// carries exactly one S3-lane string, the GET path itself, which is the single
// reviewed exception declared in launch-gates.yml.
//
// The schema gate here is deliberately the SCHEMA-level contract (schemaVersion
// + the three top-level arrays). Per-record refusal is the projection's job
// (lib/explorer/listing.ts counts `invalid` records and produces no row for
// them), so the two layers stay separate and testable on their own.
import { INDEX_SCHEMA_VERSION, type IndexJson, type IndexRoot } from "@/components/explorer/data/schema";
import { getKey } from "@/lib/api";
import { DASH_TOKEN_HEADER } from "./transport";

/** The one GET the shipped bundle is allowed to know about. */
export const FX_LIST_PATH = "/api/fx/list";

export type ReadPhase = "network" | "http" | "parse" | "aborted";

/** A failed read, described by what actually happened - never by a human's
 *  guess. `httpStatus` is null when no response ever arrived. */
export class ExplorerReadError extends Error {
  readonly phase: ReadPhase;
  readonly httpStatus: number | null;
  readonly retryable: boolean;
  readonly hostMessage: string;

  constructor(phase: ReadPhase, message: string, httpStatus: number | null = null, hostMessage = "") {
    super(message);
    this.name = "ExplorerReadError";
    this.phase = phase;
    this.httpStatus = httpStatus;
    this.hostMessage = hostMessage;
    this.retryable = phase === "network" || (httpStatus !== null && (httpStatus === 429 || httpStatus >= 500));
  }
}

export type IndexParse = { ok: true; index: IndexJson } | { ok: false; detail: string };

/** §12.5: a non-v2 index is a fail-visible condition, not a silent downgrade.
 *  The detail text names `schemaVersion` on purpose - the operator-facing
 *  evidence panel shows it verbatim. */
export function parseIndexJson(value: unknown): IndexParse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, detail: "index: expected an object" };
  }
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== INDEX_SCHEMA_VERSION) {
    return {
      ok: false,
      detail: `index: schemaVersion ${String(v.schemaVersion)} is not ${INDEX_SCHEMA_VERSION}; runner needs restart`,
    };
  }
  if (typeof v.generatedAt !== "string") return { ok: false, detail: "index: generatedAt must be a string" };
  if (typeof v.runnerId !== "string") return { ok: false, detail: "index: runnerId must be a string" };
  for (const field of ["roots", "files", "gofileHosts"] as const) {
    if (!Array.isArray(v[field])) return { ok: false, detail: `index: ${field} must be an array` };
  }
  return { ok: true, index: value as IndexJson };
}

export interface ReadIndexOptions {
  /** The root the projection will filter by. The runner ignores it today; the
   *  read asks for the same thing the plan documents so the contract is the
   *  same on both sides of the wire. */
  root?: IndexRoot | null;
  signal?: AbortSignal;
}

/** GET the runner index. Resolves only with a payload that passed
 *  `parseIndexJson`; every other outcome is a typed `ExplorerReadError`, which
 *  is what makes "live mode never substitutes sample files on a listing
 *  failure" a property of the code instead of a promise. */
export async function readIndex(options: ReadIndexOptions = {}): Promise<IndexJson> {
  const query = options.root ? `?root=${encodeURIComponent(options.root)}` : "";
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = getKey();
  if (key) headers[DASH_TOKEN_HEADER] = key;

  let res: Response;
  try {
    res = await fetch(FX_LIST_PATH + query, {
      method: "GET",
      headers,
      cache: "no-store",
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (err) {
    const aborted = (err as { name?: string } | null)?.name === "AbortError";
    const message = aborted ? "the index read was cancelled" : String((err as Error)?.message ?? err);
    throw new ExplorerReadError(aborted ? "aborted" : "network", message, null, aborted ? "" : message);
  }

  if (!res.ok) {
    const detail = `${res.status} ${res.statusText || ""}`.trim();
    throw new ExplorerReadError("http", detail, res.status, detail);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ExplorerReadError("parse", "the runner index was not valid JSON", res.status);
  }

  const parsed = parseIndexJson(body);
  if (!parsed.ok) throw new ExplorerReadError("parse", parsed.detail, res.status);
  return parsed.index;
}
