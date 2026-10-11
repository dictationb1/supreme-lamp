// [R-FILES / #217] The request lifecycle behind the explorer's rows.
//
// CONTRACT (this is what "live mode never substitutes sample files" means in
// code, not in prose):
//
//   1. When live mode is off (no dash token - i.e. the dashboard was opened
//      without ?key=, which DashTokenGate already explains full-screen) the
//      page keeps rendering the LABELLED synthetic sample and says so. That is
//      the only path on which a fixture is allowed to become rows.
//   2. When live mode is on, every non-ready outcome is its OWN state -
//      loading / empty / unauthorized / unavailable / failed - each with a
//      recovery action. There is NO fallback that paints sample rows after a
//      failed listing, and no code path returns the fixture here at all.
//   3. A response is applied only if it belongs to the request the page is
//      still waiting for. Changing folders (or re-rooting) therefore cannot
//      show a late response for the previous folder.
//   4. Refresh re-issues the SAME live request (`reload()`); it never re-reads
//      a local fixture.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFxApi, type FxApi } from "@/components/explorer/api/endpoints";
import { createFxClient } from "@/components/explorer/api/fxClient";
import { FxError } from "@/components/explorer/api/errors";
import { getKey } from "@/lib/api";
import { readFxCsrfCookie } from "@/lib/explorer/transport";
import { projectListing, type ListingCounts, type ListingProjection } from "./listing";

export type ListingStatus =
  | "off"
  | "loading"
  | "ready"
  | "empty"
  | "not-indexed"
  | "unauthorized"
  | "unavailable"
  | "failed";

export interface ListingError {
  /** Small, stable machine label - never a stack, never a token. */
  kind: ListingStatus;
  /** Short operator-facing reason (host message, truncated and redacted). */
  message: string;
  /** HTTP status when there was one; null for transport/parse failures. */
  httpStatus: number | null;
  /** Which contract phase failed, from FxError (`dns`|`tcp`|`tls`|`auth`|`http`|`parse`). */
  phase: string;
  retryable: boolean;
  at: string;
}

export interface ListingState {
  status: ListingStatus;
  rows: ListingProjection["rows"];
  counts: ListingCounts | null;
  projection: ListingProjection | null;
  error: ListingError | null;
  /** Monotonic counter of completed attempts; the page shows it in diagnostics. */
  attempts: number;
}

const EMPTY_STATE: ListingState = {
  status: "off",
  rows: [],
  counts: null,
  projection: null,
  error: null,
  attempts: 0,
};

/** Only a same-origin relative path is ever requested: the client refuses a
 *  token in a URL, and this hook never builds one. */
function createApi(): FxApi {
  return createFxApi(
    createFxClient({
      dashToken: getKey(),
      csrfToken: () => readFxCsrfCookie(),
    })
  );
}

function describeError(err: unknown, at: string): ListingError {
  if (err instanceof FxError) {
    const status = err.httpStatus ?? null;
    const kind: ListingStatus =
      status === 401 || status === 403 ? "unauthorized" : err.phase === "parse" || err.phase === "http" ? "failed" : "unavailable";
    return {
      kind,
      message: String(err.hostMessage || err.messageKey || "listing failed").slice(0, 300),
      httpStatus: status,
      phase: String(err.phase),
      retryable: err.retryable !== false,
      at,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  const aborted = /abort/i.test(message);
  return {
    kind: aborted ? "unavailable" : "failed",
    message: message.slice(0, 300),
    httpStatus: null,
    phase: aborted ? "aborted" : "parse",
    retryable: !aborted,
    at,
  };
}

export interface UseListingOptions {
  /** The explorer's selected location (Windows path, as the tree renders it). */
  locationPath: string;
  /** Live mode = the dashboard carries a dash token, so reads can succeed. */
  live: boolean;
}

export function useListing({ locationPath, live }: UseListingOptions): ListingState & { reload: () => void } {
  const [state, setState] = useState<ListingState>(EMPTY_STATE);
  const [nonce, setNonce] = useState(0);
  // The identity of the request the page is currently waiting for. A response
  // whose key is stale is DROPPED even if it arrives later, which is the whole
  // fix for "switching folders can show the previous folder's listing".
  const requestKeyRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!live) {
      requestKeyRef.current = "";
      abortRef.current?.abort();
      abortRef.current = null;
      setState({ ...EMPTY_STATE, status: "off" });
      return;
    }

    const key = `${locationPath}\u0000${nonce}`;
    requestKeyRef.current = key;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, status: "loading", error: null }));

    let cancelled = false;
    (async () => {
      const at = new Date().toISOString();
      try {
        const api = createApi();
        const index = await api.listIndex({ signal: controller.signal });
        if (cancelled || requestKeyRef.current !== key) return; // stale: never painted
        const projection = projectListing(index, locationPath);
        if (!projection) {
          setState((prev) => ({
            ...prev,
            status: "not-indexed",
            rows: [],
            counts: null,
            projection: null,
            error: { kind: "not-indexed", message: "location is outside every indexed root", httpStatus: null, phase: "parse", retryable: false, at },
            attempts: prev.attempts + 1,
          }));
          return;
        }
        setState((prev) => ({
          status: projection.counts.childrenInDir === 0 ? "empty" : "ready",
          rows: projection.rows,
          counts: projection.counts,
          projection,
          error: null,
          attempts: prev.attempts + 1,
        }));
      } catch (err) {
        if (cancelled || requestKeyRef.current !== key) return; // stale failure: also dropped
        const described = describeError(err, at);
        setState((prev) => ({
          status: described.kind,
          rows: [],
          counts: null,
          projection: null,
          error: described,
          attempts: prev.attempts + 1,
        }));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [live, locationPath, nonce]);

  return useMemo(() => ({ ...state, reload }), [state, reload]);
}
