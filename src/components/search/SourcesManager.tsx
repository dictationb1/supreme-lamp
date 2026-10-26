// [SEARCH-REPAIR] Add Website / Manage Sources.
//
// The operator asked for the ability to add and manage websites WITHOUT editing
// source code. This dialog is that surface, and it is deliberately honest:
//
//   * ADD - URL (required), display name (optional), notes ("what I want to find
//     here", optional). Type detection runs from the URL itself
//     (classifyUrl), a TEST action calls the provider that owns it and shows the
//     real detected capabilities, and SAVE is disabled until the URL parses as
//     https for a host we can read.
//   * BULK - a clearly labelled textarea for pasting several URLs at once; each
//     line is added (and reported) individually.
//   * MANAGE - every source (built-in providers and added websites) with
//     enable/disable, edit (label + notes), retest, remove, and the last test
//     result. Nothing is a decorative button: each control calls the store, and a
//     refusal is rendered as the refusal.
//   * EXPORT/IMPORT - a JSON file so an operator can recover their setup after an
//     ephemeral server run (the server registry is not guaranteed to survive).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Download, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { builtinById, classifyUrl, type ProviderCapabilities } from "@/lib/providers";
import { hostnameOf, normaliseUrl, useSourcesStore, type SourceEntry } from "@/stores/sourcesStore";
import { useToastStore } from "@/stores/toastStore";

export interface SourcesManagerProps {
  open: boolean;
  onClose: () => void;
}

function CapabilityRow({ capabilities, detected }: { capabilities?: ProviderCapabilities; detected?: string }) {
  const { t } = useTranslation();
  if (!capabilities) {
    return (
      <p data-testid="source-capabilities-unknown" className="text-xs text-tertiary">
        {detected || t("sources.capabilities.unknown")}
      </p>
    );
  }
  const rows: { key: string; label: string; value: string }[] = [
    { key: "search", label: t("sources.capabilities.search"), value: t("sources.capabilities.level." + capabilities.search) },
    { key: "inspect", label: t("sources.capabilities.inspect"), value: t("sources.capabilities.level." + capabilities.itemDetail) },
    { key: "pagination", label: t("sources.capabilities.pagination"), value: t("sources.capabilities.level." + capabilities.pagination) },
    { key: "downloads", label: t("sources.capabilities.downloads"), value: t("sources.capabilities.level." + capabilities.files) },
    { key: "attribution", label: t("sources.capabilities.attribution"), value: t("sources.capabilities.level." + capabilities.license) },
  ];
  return (
    <div data-testid="source-capabilities" className="flex flex-col gap-1">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <dt className="text-tertiary">{r.label}</dt>
            <dd className="text-primary">{r.value}</dd>
          </div>
        ))}
      </dl>
      {capabilities.filters.length ? (
        <p className="text-xs text-tertiary">{t("sources.capabilities.filters", { filters: capabilities.filters.join(", ") })}</p>
      ) : null}
      <ul className="list-disc pl-4 text-xs text-tertiary">
        {capabilities.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

export function SourcesManager({ open, onClose }: SourcesManagerProps) {
  const { t } = useTranslation();
  const entries = useSourcesStore((s) => s.entries);
  const loading = useSourcesStore((s) => s.loading);
  const serverReachable = useSourcesStore((s) => s.serverReachable);
  const add = useSourcesStore((s) => s.add);
  const remove = useSourcesStore((s) => s.remove);
  const update = useSourcesStore((s) => s.update);
  const toggle = useSourcesStore((s) => s.toggle);
  const test = useSourcesStore((s) => s.test);
  const refresh = useSourcesStore((s) => s.refresh);
  const exportSources = useSourcesStore((s) => s.exportSources);
  const importSources = useSourcesStore((s) => s.importSources);
  const push = useToastStore((s) => s.push);

  const [tab, setTab] = useState<"add" | "manage" | "transfer">("add");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [bulk, setBulk] = useState("");
  const [bulkReport, setBulkReport] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [importText, setImportText] = useState("");
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      void refresh();
      const id = window.setTimeout(() => urlRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open, refresh]);

  if (!open) return null;

  const normalized = normaliseUrl(url);
  const classification = url.trim() ? classifyUrl(normalized) : null;
  const validUrl = /^https:\/\//i.test(normalized) && Boolean(hostnameOf(normalized));

  const detectedProvider = (() => {
    if (!classification) return null;
    if (!classification.providerId || classification.providerId === "custom") return t("sources.detect.custom");
    // The operator should read a NAME, not an internal id ("fmhy" ->
    // "FMHY (Free Media Heck Yeah)"). Falls back to the id for a future provider
    // that has no name key yet.
    const builtin = builtinById(classification.providerId);
    const name = builtin ? t(builtin.nameKey) : classification.providerId;
    return t("sources.detect.builtin", { provider: name, kind: classification.subkind || "page" });
  })();

  const runTest = async () => {
    if (!validUrl) {
      setTestResult({ ok: false, detail: t("sources.errors.urlInvalid") });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const { inspectUrl } = await import("@/lib/providers");
      const { buildProviderContext } = await import("@/lib/providers/appContext");
      const outcome = await inspectUrl(normalized, buildProviderContext());
      setTestResult({
        ok: outcome.addable,
        detail:
          `${outcome.kind}: ${outcome.title}` +
          (outcome.sections.length ? ` · ${outcome.sections.length} section(s)` : "") +
          (outcome.notAddableReason ? ` · ${outcome.notAddableReason}` : ""),
      });
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setAddError(null);
    if (!validUrl) {
      setAddError(t("sources.errors.urlInvalid"));
      return;
    }
    setSaving(true);
    const res = await add(normalized, { label: label || undefined, notes: notes || undefined });
    setSaving(false);
    if (!res.ok) {
      setAddError(res.error || t("sources.errors.saveFailed"));
      return;
    }
    push(t("sources.added", { host: hostnameOf(normalized) }));
    setUrl("");
    setLabel("");
    setNotes("");
    setTestResult(null);
    setTab("manage");
  };

  const saveBulk = async () => {
    const lines = bulk
      .split(/[\s,]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const report: string[] = [];
    for (const line of lines) {
      const res = await add(line);
      report.push(`${line} — ${res.ok ? t("sources.bulk.ok") : t("sources.bulk.failed") + ": " + (res.error || "?")}`);
    }
    setBulkReport(report);
  };

  const startEdit = (e: SourceEntry) => {
    setEditing(e.id);
    setEditLabel(e.label);
    setEditNotes(e.notes || "");
  };

  const commitEdit = async () => {
    if (!editing) return;
    const res = await update(editing, { label: editLabel.trim() || undefined, notes: editNotes.trim() || undefined });
    if (!res.ok) push(t("sources.errors.saveFailed") + ": " + (res.error || ""));
    setEditing(null);
  };

  const doExport = () => {
    const data = exportSources();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ghrdp-search-sources-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async () => {
    const res = await importSources(importText);
    push(res.ok ? t("sources.import.done", { count: res.imported }) : t("sources.import.failed") + ": " + (res.error || ""));
    if (res.ok) setImportText("");
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        id="search.sourcesManager"
        data-testid="sources-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search.sourcesManager.title"
        className="relative my-8 w-full max-w-2xl rounded-lg border border-default bg-surface p-5 shadow-md"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="search.sourcesManager.title" className="text-base font-semibold text-primary">
              {t("sources.title")}
            </h2>
            <p className="text-xs text-tertiary">
              {serverReachable ? t("sources.storage.server") : t("sources.storage.local")}
            </p>
          </div>
          <button
            type="button"
            data-testid="sources-manager-close"
            aria-label={t("sources.close")}
            onClick={onClose}
            className="rounded text-tertiary hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div role="tablist" aria-label={t("sources.tabs")} className="mt-3 flex gap-1 border-b border-default">
          {(["add", "manage", "transfer"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              id={"sources.tab." + k}
              data-testid={"sources-tab-" + k}
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={
                "px-3 py-1.5 text-sm rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                (tab === k ? "bg-raised text-primary font-medium" : "text-secondary hover:text-primary")
              }
            >
              {t("sources.tab." + k)}
            </button>
          ))}
        </div>

        {tab === "add" ? (
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-secondary" htmlFor="sources.add.url">
              {t("sources.field.url")}
              <input
                ref={urlRef}
                id="sources.add.url"
                data-testid="sources-add-url"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={url}
                aria-invalid={url.trim() && !validUrl ? "true" : "false"}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setTestResult(null);
                  setAddError(null);
                }}
                className="h-11 rounded-md border border-default bg-surface px-3 font-mono text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-secondary" htmlFor="sources.add.label">
              {t("sources.field.label")}
              <input
                id="sources.add.label"
                data-testid="sources-add-label"
                type="text"
                maxLength={50}
                value={label}
                placeholder={hostnameOf(normalized) || t("sources.field.labelPlaceholder")}
                onChange={(e) => setLabel(e.target.value)}
                className="h-11 rounded-md border border-default bg-surface px-3 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-secondary" htmlFor="sources.add.notes">
              {t("sources.field.notes")}
              <textarea
                id="sources.add.notes"
                data-testid="sources-add-notes"
                rows={2}
                maxLength={280}
                value={notes}
                placeholder={t("sources.field.notesPlaceholder")}
                onChange={(e) => setNotes(e.target.value)}
                className="rounded-md border border-default bg-surface p-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>

            {detectedProvider ? (
              <p id="sources.add.detected" data-testid="sources-add-detected" className="text-xs text-secondary">
                {t("sources.detected")}: <span className="font-mono">{detectedProvider}</span>
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="sources-test"
                disabled={!validUrl || testing}
                onClick={() => void runTest()}
                className="inline-flex h-9 items-center gap-1 rounded-md border border-default px-3 text-xs text-secondary hover:bg-raised disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <RefreshCw className={"size-3.5 " + (testing ? "animate-spin" : "")} aria-hidden />
                {t("sources.test")}
              </button>
              <button
                type="button"
                data-testid="sources-save"
                disabled={!validUrl || saving}
                onClick={() => void save()}
                className="inline-flex h-9 items-center gap-1 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Plus className="size-3.5" aria-hidden />
                {t("sources.save")}
              </button>
            </div>

            {testResult ? (
              <p
                data-testid="sources-test-result"
                data-ok={testResult.ok ? "1" : "0"}
                className={"rounded p-2 text-xs " + (testResult.ok ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}
              >
                {testResult.detail}
              </p>
            ) : null}
            {addError ? (
              <p data-testid="sources-add-error" role="alert" className="rounded bg-danger/10 p-2 text-xs text-danger">
                {addError}
              </p>
            ) : null}

            <div className="mt-2 rounded border border-dashed border-default p-3">
              <label className="flex flex-col gap-1 text-sm text-secondary" htmlFor="sources.bulk">
                {t("sources.bulk.label")}
                <textarea
                  id="sources.bulk"
                  data-testid="sources-bulk"
                  rows={3}
                  value={bulk}
                  placeholder={"https://example.org\nhttps://another.example"}
                  onChange={(e) => setBulk(e.target.value)}
                  className="rounded-md border border-default bg-surface p-2 font-mono text-xs text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
              <button
                type="button"
                data-testid="sources-bulk-add"
                disabled={!bulk.trim()}
                onClick={() => void saveBulk()}
                className="mt-2 h-9 rounded-md border border-default px-3 text-xs text-secondary hover:bg-raised disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {t("sources.bulk.add")}
              </button>
              {bulkReport.length ? (
                <ul data-testid="sources-bulk-report" className="mt-2 list-disc pl-4 text-xs text-tertiary">
                  {bulkReport.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "manage" ? (
          <div className="mt-3 flex flex-col gap-2">
            {loading ? <p className="text-xs text-tertiary">{t("sources.loading")}</p> : null}
            <ul className="flex flex-col gap-2">
              {entries.map((e) => (
                <li
                  key={e.id}
                  id={"sources.row." + e.id}
                  data-testid={"sources-row-" + e.id}
                  data-kind={e.kind}
                  data-enabled={e.enabled ? "1" : "0"}
                  className="rounded border border-default bg-raised/30 p-2"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-primary font-medium">{e.label}</span>
                    <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-tertiary">
                      {e.kind === "builtin" ? t("sources.kind.builtin") : t("sources.kind.custom")}
                    </span>
                    <span className="font-mono text-xs text-tertiary break-all">{e.url}</span>
                    <label className="ml-auto inline-flex items-center gap-1 text-xs text-secondary">
                      <input
                        type="checkbox"
                        data-testid={"sources-enable-" + e.id}
                        checked={e.enabled}
                        onChange={(ev) => toggle(e.id, ev.target.checked)}
                      />
                      {t("sources.enabled")}
                    </label>
                  </div>
                  {e.notes ? <p className="mt-1 text-xs text-secondary">{e.notes}</p> : null}
                  {e.lastTest ? (
                    <p
                      data-testid={"sources-lasttest-" + e.id}
                      data-ok={e.lastTest.ok ? "1" : "0"}
                      className={"mt-1 text-xs " + (e.lastTest.ok ? "text-success" : "text-warning")}
                    >
                      {e.lastTest.detail} · {e.lastTest.at.slice(11, 19)}
                    </p>
                  ) : null}
                  {editing === e.id ? (
                    <div className="mt-2 flex flex-col gap-1">
                      <input
                        data-testid={"sources-edit-label-" + e.id}
                        value={editLabel}
                        onChange={(ev) => setEditLabel(ev.target.value)}
                        className="h-9 rounded border border-default bg-surface px-2 text-xs text-primary"
                        aria-label={t("sources.field.label")}
                      />
                      <textarea
                        data-testid={"sources-edit-notes-" + e.id}
                        value={editNotes}
                        rows={2}
                        onChange={(ev) => setEditNotes(ev.target.value)}
                        className="rounded border border-default bg-surface p-2 text-xs text-primary"
                        aria-label={t("sources.field.notes")}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          data-testid={"sources-edit-save-" + e.id}
                          onClick={() => void commitEdit()}
                          className="h-8 rounded border border-default px-2 text-xs text-primary hover:bg-raised"
                        >
                          {t("sources.editSave")}
                        </button>
                        <button
                          type="button"
                          data-testid={"sources-edit-cancel-" + e.id}
                          onClick={() => setEditing(null)}
                          className="h-8 rounded border border-default px-2 text-xs text-secondary hover:bg-raised"
                        >
                          {t("sources.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid={"sources-retest-" + e.id}
                      onClick={() => void test(e.id)}
                      className="h-8 rounded border border-default px-2 text-xs text-secondary hover:bg-raised"
                    >
                      {t("sources.retest")}
                    </button>
                    <button
                      type="button"
                      data-testid={"sources-edit-" + e.id}
                      onClick={() => startEdit(e)}
                      className="h-8 rounded border border-default px-2 text-xs text-secondary hover:bg-raised"
                    >
                      {t("sources.edit")}
                    </button>
                    <button
                      type="button"
                      data-testid={"sources-remove-" + e.id}
                      onClick={() => void remove(e.id)}
                      className="inline-flex h-8 items-center gap-1 rounded border border-default px-2 text-xs text-danger hover:bg-raised"
                    >
                      <Trash2 className="size-3" aria-hidden />
                      {t("sources.remove")}
                    </button>
                    <CapabilityRow capabilities={e.capabilities} detected={e.kind === "custom" ? t("sources.capabilities.custom") : undefined} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {tab === "transfer" ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-xs text-secondary">{t("sources.transfer.help")}</p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="sources-export"
                onClick={doExport}
                className="inline-flex h-9 items-center gap-1 rounded border border-default px-3 text-xs text-secondary hover:bg-raised"
              >
                <Download className="size-3.5" aria-hidden />
                {t("sources.export.button")}
              </button>
              <button
                type="button"
                data-testid="sources-import"
                disabled={!importText.trim()}
                onClick={() => void doImport()}
                className="inline-flex h-9 items-center gap-1 rounded border border-default px-3 text-xs text-secondary hover:bg-raised disabled:opacity-50"
              >
                <Upload className="size-3.5" aria-hidden />
                {t("sources.import.button")}
              </button>
            </div>
            <label className="flex flex-col gap-1 text-xs text-secondary" htmlFor="sources.import.text">
              {t("sources.import.label")}
              <textarea
                id="sources.import.text"
                data-testid="sources-import-text"
                rows={6}
                value={importText}
                placeholder='{"format":"ghrdp.search-sources","version":1,"sources":[]}'
                onChange={(e) => setImportText(e.target.value)}
                className="rounded-md border border-default bg-surface p-2 font-mono text-xs text-primary"
              />
            </label>
            <a
              href="#/search"
              className="text-xs text-tertiary underline underline-offset-2"
              onClick={(e) => {
                e.preventDefault();
                setTab("manage");
              }}
            >
              {t("sources.transfer.backToManage")}
            </a>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

export default SourcesManager;
