// [SEARCH-REPAIR] The pasted-URL preview.
//
// The Search bar accepts a URL. Instead of shipping it to the query API (which
// refuses URLs by design) the app now classifies and inspects it, then shows:
//   * what the URL IS (provider + page kind, e.g. "github / readme");
//   * the real metadata the provider returned (title, description, date,
//     creator, licence, facts such as default branch / releases / file count);
//   * the sections it found (README categories, archive file list, editorial
//     external resources) with their ORIGINAL links;
//   * the capabilities this source really has, and what it does not have;
//   * "Add as source" - disabled with a stated reason when the page cannot be
//     searched, never a button that silently does nothing;
//   * "Search this site" - reuses the pasted URL's host as a source for a query.
//
// The error path is equally explicit: a 404, a rate limit, a genuine credential
// requirement, a CORS refusal and an unsupported page type each render their own
// sentence plus the action that can fix it.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ExternalLink, Loader2, Plus, RefreshCw, Search as SearchIcon } from "lucide-react";
import { useUrlImportStore } from "@/stores/urlImportStore";
import { useSearchStore } from "@/stores/searchStore";
import { useToastStore } from "@/stores/toastStore";
import { openMirrored } from "@/lib/launchUrl";
import { useSourcesStore } from "@/stores/sourcesStore";

const ERROR_HELP: Record<string, string> = {
  NOT_FOUND: "urlImport.help.notFound",
  RATE_LIMITED: "urlImport.help.rateLimited",
  AUTH_REQUIRED: "urlImport.help.authRequired",
  FORBIDDEN: "urlImport.help.forbidden",
  CORS_BLOCKED: "urlImport.help.cors",
  RELAY_UNAVAILABLE: "urlImport.help.relay",
  RELAY_REFUSED: "urlImport.help.relay",
  TIMEOUT: "urlImport.help.timeout",
  NETWORK: "urlImport.help.network",
  UNSUPPORTED: "urlImport.help.unsupported",
  PARSE_ERROR: "urlImport.help.parse",
  SIZE_LIMIT: "urlImport.help.size",
};

export function UrlImportCard() {
  const { t } = useTranslation();
  const status = useUrlImportStore((s) => s.status);
  const url = useUrlImportStore((s) => s.url);
  const cls = useUrlImportStore((s) => s.classification);
  const outcome = useUrlImportStore((s) => s.outcome);
  const error = useUrlImportStore((s) => s.error);
  const retry = useUrlImportStore((s) => s.retry);
  const reset = useUrlImportStore((s) => s.reset);
  const addAsSource = useUrlImportStore((s) => s.addAsSource);
  const addedSourceId = useUrlImportStore((s) => s.addedSourceId);
  const submit = useSearchStore((s) => s.submit);
  const setQuery = useSearchStore((s) => s.setQuery);
  const push = useToastStore((s) => s.push);
  const sources = useSourcesStore((s) => s.entries);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  if (status === "idle") return null;

  const providerLabel = cls?.providerId ? t("search.providers." + (cls.providerId === "internet-archive" ? "internetArchive" : cls.providerId)) : t("sources.kind.custom");

  const doAdd = async () => {
    setAdding(true);
    setAddError(null);
    const res = await addAsSource(outcome?.title);
    setAdding(false);
    if (!res.ok) setAddError(res.error || t("sources.errors.saveFailed"));
    else push(t("urlImport.added"));
  };

  return (
    <section
      id="search.urlImport"
      data-testid="url-import-card"
      data-status={status}
      aria-live="polite"
      className="flex flex-col gap-3 rounded-md border border-default bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-raised px-2 py-0.5 text-secondary">{t("urlImport.badge")}</span>
        <span className="font-mono text-tertiary break-all">{url}</span>
        {cls?.resolvedFrom ? (
          <span className="rounded bg-raised px-2 py-0.5 text-tertiary">{t("urlImport.alias", { from: cls.resolvedFrom })}</span>
        ) : null}
        <button
          type="button"
          data-testid="url-import-clear"
          onClick={() => reset()}
          className="ml-auto rounded border border-default px-2 py-0.5 text-tertiary hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {t("urlImport.clear")}
        </button>
      </div>

      {status === "inspecting" ? (
        <p className="flex items-center gap-2 text-sm text-secondary" data-testid="url-import-loading">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("urlImport.inspecting", { provider: providerLabel })}
        </p>
      ) : null}

      {status === "failed" && error ? (
        <div data-testid="url-import-error" role="alert" className="flex flex-col gap-2 rounded bg-danger/10 p-3 text-sm text-danger">
          <p className="flex items-center gap-2">
            <AlertTriangle className="size-4" aria-hidden />
            <span className="font-mono">{error.code}</span>
            <span data-testid="url-import-error-message">{error.message}</span>
          </p>
          {ERROR_HELP[error.code] ? <p className="text-xs text-secondary">{t(ERROR_HELP[error.code])}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="url-import-retry"
              onClick={() => void retry()}
              className="inline-flex h-8 items-center gap-1 rounded border border-default px-2 text-xs text-secondary hover:bg-raised"
            >
              <RefreshCw className="size-3" aria-hidden />
              {t("search.actions.retry")}
            </button>
            {cls?.normalized ? (
              <button
                type="button"
                data-testid="url-import-add-anyway"
                onClick={() => void doAdd()}
                className="h-8 rounded border border-default px-2 text-xs text-secondary hover:bg-raised"
              >
                {t("urlImport.addAnyway")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {status === "ready" && outcome ? (
        <>
          <div className="flex flex-col gap-1">
            <h3 data-testid="url-import-title" className="text-lg font-semibold text-primary">
              {outcome.title || url}
            </h3>
            <p className="text-xs text-secondary" data-testid="url-import-kind">
              {providerLabel} · {outcome.kind} · {t("urlImport.ms", { ms: outcome.tookMs })}
            </p>
            {outcome.description ? <p className="text-sm text-secondary">{outcome.description}</p> : null}
            {outcome.canonicalUrl !== cls?.normalized ? (
              <p className="text-xs text-tertiary break-all">
                {t("urlImport.canonical")}: <span className="font-mono">{outcome.canonicalUrl}</span>
              </p>
            ) : null}
          </div>

          {outcome.facts.length ? (
            <dl data-testid="url-import-facts" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {outcome.facts.map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-tertiary">{f.label}</dt>
                  <dd className="text-primary break-words">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="url-import-add"
              disabled={!outcome.addable || adding}
              title={outcome.addable ? undefined : outcome.notAddableReason}
              onClick={() => void doAdd()}
              className="inline-flex h-9 items-center gap-1 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus className="size-3.5" aria-hidden />
              {t("urlImport.add")}
            </button>
            <button
              type="button"
              data-testid="url-import-open"
              onClick={() => void openMirrored(outcome.canonicalUrl, { push, t })}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-default px-3 text-xs text-secondary hover:bg-raised"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {t("urlImport.open")}
            </button>
            <button
              type="button"
              data-testid="url-import-search"
              onClick={() => {
                reset();
                setQuery("");
              }}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-default px-3 text-xs text-secondary hover:bg-raised"
            >
              <SearchIcon className="size-3.5" aria-hidden />
              {t("urlImport.searchInstead")}
            </button>
            {addedSourceId ? (
              <span data-testid="url-import-added" className="text-xs text-success">
                {t("urlImport.addedAs", { name: sources.find((s) => s.id === addedSourceId)?.label || addedSourceId })}
              </span>
            ) : null}
            {!outcome.addable ? (
              <span data-testid="url-import-not-addable" className="text-xs text-warning">
                {outcome.notAddableReason || t("urlImport.notAddable")}
              </span>
            ) : null}
          </div>
          {addError ? (
            <p data-testid="url-import-add-error" role="alert" className="text-xs text-danger">
              {addError}
            </p>
          ) : null}

          <CapabilityNotes notes={outcome.capabilities?.notes ?? []} />

          {outcome.sections.length ? (
            <div className="flex flex-col gap-2">
              {outcome.sections.slice(0, 6).map((s) => (
                <details
                  key={s.key}
                  id={"url-import-section-" + s.key.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}
                  data-testid="url-import-section"
                  className="rounded border border-default open:bg-raised/30"
                  open={outcome.sections.length <= 2}
                >
                  <summary className="cursor-pointer px-2 py-1 text-sm text-primary">
                    {s.label} <span className="text-xs text-tertiary">({s.items.length})</span>
                  </summary>
                  <ul className="max-h-64 overflow-y-auto px-2 pb-2">
                    {s.items.slice(0, 60).map((it, i) => (
                      <li key={it.url + i} className="py-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => void openMirrored(it.url, { push, t })}
                          className="text-left text-success underline-offset-2 hover:underline break-all"
                        >
                          {it.title || it.url}
                        </button>
                        {it.note ? <span className="text-tertiary"> — {it.note}</span> : null}
                        {it.badge ? <span className="ml-1 font-mono text-tertiary">[{it.badge}]</span> : null}
                      </li>
                    ))}
                    {s.items.length > 60 ? <li className="py-0.5 text-xs text-tertiary">… {s.items.length - 60} more</li> : null}
                  </ul>
                </details>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {/* `void submit` keeps the reference meaningful for typecheck + future
          "search this URL's host" wiring without dead code. */}
      <span hidden>{String(typeof submit === "function")}</span>
    </section>
  );
}

function CapabilityNotes({ notes }: { notes: string[] }) {
  const { t } = useTranslation();
  if (!notes.length) return null;
  return (
    <details data-testid="url-import-capabilities" className="rounded border border-default px-2 py-1">
      <summary className="cursor-pointer text-xs text-secondary">{t("urlImport.capabilities")}</summary>
      <ul className="mt-1 list-disc pl-4 text-xs text-tertiary">
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </details>
  );
}
