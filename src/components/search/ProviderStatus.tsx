// [SEARCH-REPAIR] Provider status + provider result details.
//
// `ProviderStatusList` is the "which sources completed, failed, or are still
// running" surface. One row per enabled source, in source order, with:
//   status | result count | the provider's own notes | applied/ignored filters |
//   progress ("Reading sindresorhus/awesome (2/3)") | the typed error + a retry.
// A failed source NEVER hides the rows of the sources that worked.
//
// `ProviderResultDetail` is the result -> details half of the brief: it shows
// what the provider actually supplied (attribution, licence evidence, category
// path, file URL, extras) and the original page link, and it says "not stated"
// for anything absent instead of filling a blank with a plausible value.
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useSearchStore, type ProviderSourceState } from "@/stores/searchStore";
import { useToastStore } from "@/stores/toastStore";
import { openMirrored } from "@/lib/launchUrl";
import { docUrl } from "@/lib/repoIdentity";

const STATUS_STYLE: Record<string, string> = {
  complete: "text-success",
  empty: "text-secondary",
  running: "text-accent",
  queued: "text-tertiary",
  failed: "text-danger",
  cancelled: "text-warning",
  unsupported: "text-warning",
};

function StatusIcon({ status }: { status: string }) {
  const cls = "size-3.5 shrink-0 " + (STATUS_STYLE[status] || "text-tertiary");
  if (status === "complete") return <CheckCircle2 className={cls} aria-hidden />;
  if (status === "failed" || status === "unsupported") return <XCircle className={cls} aria-hidden />;
  if (status === "cancelled") return <AlertTriangle className={cls} aria-hidden />;
  if (status === "running") return <Loader2 className={cls + " animate-spin"} aria-hidden />;
  return <Clock className={cls} aria-hidden />;
}

/** A retry is only offered when it can actually help (a rate limit names its
 *  wait; an unsupported capability cannot be retried into working). */
function isRetryable(state: ProviderSourceState): boolean {
  if (state.status === "failed") return true;
  if (state.status === "cancelled") return true;
  return false;
}

export function ProviderStatusList() {
  const { t } = useTranslation();
  const states = useSearchStore((s) => s.providerStates);
  const running = useSearchStore((s) => s.providerLaneRunning);
  const tookMs = useSearchStore((s) => s.providerLaneTookMs);
  const retry = useSearchStore((s) => s.retryProviderSource);
  const rows = Object.values(states);

  if (!rows.length) return null;
  const done = rows.filter((r) => r.status !== "queued" && r.status !== "running").length;

  return (
    <section
      id="search.providers.statusList"
      data-testid="provider-status-list"
      aria-label={t("search.providers.statusLabel")}
      className="flex flex-col gap-1"
    >
      <div className="flex items-center gap-2 text-xs text-secondary">
        <span className="font-semibold text-primary">{t("search.providers.statusLabel")}</span>
        <span data-testid="provider-status-progress" data-running={running ? "1" : "0"} className="font-mono">
          {t("search.providers.doneOf", { done, total: rows.length })}
          {tookMs ? ` · ${tookMs} ms` : ""}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((s) => (
          <li
            key={s.sourceId}
            id={"search.providers.row." + s.sourceId}
            data-testid={"provider-row-" + s.sourceId}
            data-status={s.status}
            className="rounded border border-default bg-surface px-2 py-1.5 text-xs"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <StatusIcon status={s.status} />
              <span className="text-primary">{s.label}</span>
              <span className={"font-mono " + (STATUS_STYLE[s.status] || "text-secondary")}>
                {t("search.providers.status." + s.status)}
              </span>
              {s.resultCount > 0 ? (
                <span className="font-mono text-secondary">{t("search.adapter.resultCount", { count: s.resultCount })}</span>
              ) : null}
              {s.appliedFilters.length ? (
                <span className="text-tertiary">{t("search.providers.filtersApplied", { filters: s.appliedFilters.join(", ") })}</span>
              ) : null}
              {s.ignoredFilters.length ? (
                <span className="text-warning">{t("search.providers.filtersIgnored", { filters: s.ignoredFilters.join(", ") })}</span>
              ) : null}
              {s.progress ? <span className="text-tertiary truncate">{s.progress}</span> : null}
              {isRetryable(s) ? (
                <button
                  type="button"
                  data-testid={"provider-retry-" + s.sourceId}
                  onClick={() => void retry(s.sourceId)}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-default px-1.5 py-0.5 text-tertiary hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <RefreshCw className="size-3" aria-hidden />
                  {t("search.actions.retry")}
                </button>
              ) : null}
            </div>
            {s.error ? (
              <p data-testid={"provider-error-" + s.sourceId} className="mt-1 text-danger">
                <span className="font-mono">{s.error.code}</span> — {s.error.message}
                {s.error.retryAfterSeconds ? ` (${t("search.providers.retryAfter", { seconds: s.error.retryAfterSeconds })})` : ""}
              </p>
            ) : null}
            {s.notes.length ? (
              <ul className="mt-1 list-disc pl-4 text-tertiary">
                {s.notes.slice(0, 4).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

const EXTRA_LABELS: Record<string, string> = {
  stars: "stars",
  defaultBranch: "default branch",
  topics: "topics",
  mediatype: "media type",
  downloads: "downloads",
  collection: "collection",
  identifier: "identifier",
  filetype: "file type",
  dimensions: "dimensions",
  category: "category",
  section: "section",
  page: "page",
  list: "list",
  licence: "licence",
  license: "licence",
  mature: "mature",
  origin: "found via",
  mentionedTimes: "mentioned",
  archived: "archived",
  durationMs: "duration (ms)",
};

export function ProviderResultDetail({ resultId }: { resultId: string }) {
  const { t } = useTranslation();
  const hit = useSearchStore((s) => s.providerHits[resultId]);
  const result = useSearchStore((s) => s.results[resultId]);
  const push = useToastStore((s) => s.push);
  if (!hit || !result) return null;
  const extras = Object.entries(hit.extra || {});
  return (
    <details
      id={"search.providers.detail." + result.resultId}
      data-testid="provider-result-detail"
      className="rounded border border-default bg-raised/40 px-2 py-1 text-xs"
    >
      <summary className="cursor-pointer text-secondary">{t("search.providers.details")}</summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-tertiary">{t("search.providers.sourceLine")}</dt>
        <dd className="text-primary break-words">{hit.source?.label ?? hit.providerId}</dd>
        {hit.context && hit.context.length ? (
          <>
            <dt className="text-tertiary">{t("search.providers.categoryPath")}</dt>
            <dd className="text-primary break-words">{hit.context.join(" › ")}</dd>
          </>
        ) : null}
        <dt className="text-tertiary">{t("search.providers.licence")}</dt>
        <dd className="text-primary break-words">{result.licenceEvidence || t("search.providers.notStated")}</dd>
        {hit.license?.url ? (
          <>
            <dt className="text-tertiary">{t("search.providers.licenceUrl")}</dt>
            <dd className="text-primary break-all">{hit.license.url}</dd>
          </>
        ) : null}
        {hit.fileUrl ? (
          <>
            <dt className="text-tertiary">{t("search.providers.file")}</dt>
            <dd className="break-all">
              <button
                type="button"
                data-testid="provider-file-open"
                onClick={() => void openMirrored(hit.fileUrl as string, { push, t })}
                className="text-success underline underline-offset-2"
              >
                {hit.fileUrl}
              </button>
              {hit.fileSizeBytes != null ? <span className="ml-1 text-tertiary">({Math.round(hit.fileSizeBytes / 1024)} KB)</span> : null}
            </dd>
          </>
        ) : null}
        {extras.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-tertiary">{EXTRA_LABELS[k] || k}</dt>
            <dd className="text-primary break-words">{String(v)}</dd>
          </div>
        ))}
      </dl>
      <a
        href={docUrl("searchRepair")}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-block text-tertiary underline underline-offset-2"
      >
        {t("search.providers.howItWorks")}
      </a>
    </details>
  );
}
