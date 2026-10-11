// [R-FILES / #217] The explorer's non-ready states, one per outcome.
//
// The page used to have exactly two states: "fixture rows" and "fetched root
// empty". A listing that failed, was refused, or had not answered yet simply
// did not exist, which is why "Refresh" could look successful while nothing had
// been read. Each state below is therefore separate, named, and reachable:
//
//   loading      - a request is in flight (skeleton, aria-busy, no fake rows)
//   empty        - the directory answered and has no indexed children
//   not-indexed  - the selected location is outside the watcher's roots
//   unauthorized - 401/403: the dash token was refused
//   unavailable  - transport/stream ended before a schema-checked body
//   failed       - the body arrived but did not satisfy the index contract
//
// Only `empty` is rendered by the results list itself; the rest replace it, so
// no state can be confused with "the folder is empty".
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import type { ListingState } from "@/lib/explorer/useListing";

export interface ExplorerListingStateProps {
  state: ListingState;
  onRetry: () => void;
}

const ICONS = {
  loading: Loader2,
  empty: null,
  "not-indexed": AlertTriangle,
  unauthorized: ShieldAlert,
  unavailable: WifiOff,
  failed: AlertTriangle,
} as const;

export function ExplorerListingState({ state, onRetry }: ExplorerListingStateProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const status = state.status;
  if (status === "ready" || status === "off") return null;

  const Icon = ICONS[status] || AlertTriangle;
  const title = t(`files.listing.${status}.title`);
  const body = t(`files.listing.${status}.body`);

  return (
    <section
      id="f57.explorer.listingState"
      data-testid="explorer-listing-state"
      data-status={status}
      data-attempts={String(state.attempts)}
      aria-live="polite"
      aria-busy={status === "loading" ? "true" : "false"}
      className="w-full md:flex-1 min-w-0 bg-surface border border-default rounded-md p-4 flex flex-col gap-3"
    >
      <div className="flex items-start gap-2">
        {Icon ? <Icon className={"size-5 shrink-0 " + (status === "loading" ? "animate-spin text-tertiary" : "text-warning")} aria-hidden /> : null}
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="text-sm font-semibold text-primary" data-testid="explorer-listing-title">
            {title}
          </h2>
          <p className="text-xs text-secondary">{body}</p>
        </div>
      </div>

      {status === "loading" ? (
        <div data-testid="explorer-listing-skeleton" className="flex flex-col gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 rounded bg-raised" />
          ))}
        </div>
      ) : null}

      {status !== "loading" ? (
        <div className="flex items-center gap-2">
          {/* A retry is offered for every state the operator can re-attempt -
              including `failed` (the runner may have restarted) and
              `unauthorized` (the key may have been pasted meanwhile). Only
              `not-indexed` is structural: re-asking cannot change the answer. */}
          {status !== "not-indexed" ? (
            <button
              type="button"
              id="f57.explorer.listingRetry"
              data-testid="explorer-listing-retry"
              onClick={onRetry}
              className="h-9 px-3 rounded-md border border-default text-xs text-secondary inline-flex items-center gap-1 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {t("files.listing.retry")}
            </button>
          ) : null}
          <button
            type="button"
            id="f57.explorer.listingEvidence"
            data-testid="explorer-listing-evidence"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="h-9 px-3 rounded-md border border-default text-xs text-secondary inline-flex items-center gap-1 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
            {t("files.listing.evidence")}
          </button>
        </div>
      ) : null}

      {open && status !== "loading" ? (
        // Diagnostics belong where the problem is (#205): the answer the page
        // actually received, in the operator's language, next to no invented
        // success. Tokens are never part of this payload - `hostMessage` comes
        // from the contract error, redacted at construction in api/errors.
        <dl id="f57.explorer.listingEvidenceBody" data-testid="explorer-listing-evidence-body" className="grid grid-cols-[8rem_1fr] gap-1 text-[11px] font-mono text-tertiary">
          <dt>{t("files.listing.field.status")}</dt>
          <dd data-testid="evidence-status">{status}</dd>
          <dt>{t("files.listing.field.phase")}</dt>
          <dd data-testid="evidence-phase">{state.error?.phase || "—"}</dd>
          <dt>{t("files.listing.field.http")}</dt>
          <dd data-testid="evidence-http">{state.error?.httpStatus == null ? "—" : String(state.error.httpStatus)}</dd>
          <dt>{t("files.listing.field.detail")}</dt>
          <dd data-testid="evidence-message" className="break-all">{state.error?.message || "—"}</dd>
          <dt>{t("files.listing.field.attempts")}</dt>
          <dd data-testid="evidence-attempts">{String(state.attempts)}</dd>
        </dl>
      ) : null}
    </section>
  );
}
