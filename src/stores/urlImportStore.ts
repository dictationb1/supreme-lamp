// [SEARCH-REPAIR] URL inspection / "add as source" store.
//
// The Search bar accepts a pasted URL as well as a query. A URL takes a
// completely different path: it is CLASSIFIED (which provider owns it, what kind
// of page it is), INSPECTED (one real request to that provider's own interface)
// and PREVIEWED (title, description, date, licence, sections/entries, the
// capabilities that are actually supported), and only then offered as a source.
//
// Three rules, all of them responses to reported defects:
//   1. a public URL never triggers a credential prompt - GitHub READMEs, archive
//      items and Open Culture articles are public and are read anonymously;
//   2. an error is the provider's own error (NOT_FOUND / RATE_LIMITED /
//      AUTH_REQUIRED / CORS_BLOCKED / UNSUPPORTED ...), with the remedy attached;
//   3. "Add as source" is only offered when the inspection says the source can
//      actually answer a later search - never as a decorative button.
import { create } from "zustand";
import { classifyUrl, inspectUrl, isProviderError, type InspectOutcome, type UrlClassification } from "@/lib/providers";
import { buildProviderContext } from "@/lib/providers/appContext";
import { useSourcesStore } from "@/stores/sourcesStore";

export type UrlImportStatus = "idle" | "inspecting" | "ready" | "failed";

export interface UrlImportError {
  code: string;
  message: string;
  retryAfterSeconds?: number;
  retryable?: boolean;
}

interface UrlImportState {
  status: UrlImportStatus;
  url: string;
  classification: UrlClassification | null;
  outcome: InspectOutcome | null;
  error: UrlImportError | null;
  generation: number;
  addedSourceId: string | null;
  inspectingMs: number;
  inspect: (url: string, generation: number) => Promise<void>;
  reset: () => void;
  addAsSource: (label?: string, notes?: string) => Promise<{ ok: boolean; error?: string }>;
  retry: () => Promise<void>;
}

let inFlight: AbortController | null = null;

export const useUrlImportStore = create<UrlImportState>((set, get) => ({
  status: "idle",
  url: "",
  classification: null,
  outcome: null,
  error: null,
  generation: 0,
  addedSourceId: null,
  inspectingMs: 0,

  inspect: async (url, generation) => {
    const classification = classifyUrl(url);
    if (!classification.normalized) {
      set({
        status: "failed",
        url,
        classification,
        outcome: null,
        error: {
          code: "UNSUPPORTED",
          message: "That is not a URL this build can open. Paste an https:// address, or type a query.",
          retryable: false,
        },
        generation,
        addedSourceId: null,
      });
      return;
    }
    inFlight?.abort();
    inFlight = new AbortController();
    const started = Date.now();
    set({ status: "inspecting", url, classification, outcome: null, error: null, generation, addedSourceId: null, inspectingMs: 0 });
    try {
      const outcome = await inspectUrl(classification.normalized, buildProviderContext({ signal: inFlight.signal }));
      if (get().generation !== generation) return; // a newer paste won
      set({ status: "ready", outcome, inspectingMs: Date.now() - started });
    } catch (e) {
      if (get().generation !== generation) return;
      const err: UrlImportError = isProviderError(e)
        ? { code: e.code, message: e.message, retryAfterSeconds: e.retryAfterSeconds, retryable: e.retryable }
        : { code: "UNKNOWN", message: e instanceof Error ? e.message : String(e), retryable: true };
      set({ status: "failed", error: err, inspectingMs: Date.now() - started });
    }
  },

  reset: () => {
    inFlight?.abort();
    inFlight = null;
    set({ status: "idle", url: "", classification: null, outcome: null, error: null, addedSourceId: null, inspectingMs: 0 });
  },

  addAsSource: async (label, notes) => {
    const outcome = get().outcome;
    const cls = get().classification;
    if (!outcome || !cls?.normalized) return { ok: false, error: "nothing to add" };
    if (!outcome.addable) return { ok: false, error: outcome.notAddableReason || "This page cannot be searched" };
    const res = await useSourcesStore.getState().add(outcome.canonicalUrl || cls.normalized, {
      label: label || outcome.title,
      notes,
    });
    if (res.ok) {
      set({ addedSourceId: res.entry?.id ?? null });
      await useSourcesStore.getState().refresh();
    }
    return { ok: res.ok, error: res.error };
  },

  retry: async () => {
    const { url, generation } = get();
    if (!url) return;
    await get().inspect(url, generation);
  },
}));

export function resetUrlImportStore(): void {
  inFlight?.abort();
  inFlight = null;
  useUrlImportStore.setState({ status: "idle", url: "", classification: null, outcome: null, error: null, generation: 0, addedSourceId: null, inspectingMs: 0 });
}
