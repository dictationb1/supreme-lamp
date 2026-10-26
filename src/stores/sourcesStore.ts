// [SEARCH-REPAIR] ONE source registry for the Search page.
//
// Before this file the app had two disconnected notions of "a source":
// the hard-coded server adapter list (fan-out ids the operator could not edit)
// and the F58 custom-site registry (rows that could only be added, never
// edited, disabled, retested or exported). This store merges them into the one
// thing the Search page needs: an ordered list of sources with
//   id / label / kind / baseUrl / notes / enabled / capabilities,
// where built-in providers are configurable locally and custom sources are
// persisted by the server registry when it is reachable, with a localStorage
// mirror so the operator's setup survives an ephemeral server run.
//
// Persistence boundary (documented, and what the tests exercise):
//   * server:  GET/POST /api/f58/sources, POST /api/f58/sources (upsert by
//              hostname), DELETE /api/f58/sources/<id>  - survives a page
//              reload, and a server restart as long as the server persists its
//              store; an ephemeral run loses it, which is why export exists;
//   * local:   `ghrdp:searchSources` holds the operator's overrides for BOTH
//              kinds (enabled/notes/label) and the last known custom rows, so
//              the Search page still works when the server is down;
//   * file:    export/import JSON (see exportSources/importSources).
import { create } from "zustand";
import {
  BUILTIN_PROVIDERS,
  classifyUrl,
  inspectUrl,
  type BuiltinProviderId,
  type ProviderCapabilities,
} from "@/lib/providers";
import { buildProviderContext } from "@/lib/providers/appContext";
import { createCustomSource, deleteCustomSource, listCustomSources, updateCustomSource } from "@/api/lab";

const STORE_KEY = "ghrdp:searchSources";

export type SourceKind = "builtin" | "custom";

export interface SourceEntry {
  id: string;
  kind: SourceKind;
  label: string;
  url: string;
  providerId?: BuiltinProviderId;
  nameKey?: string;
  notes?: string;
  enabled: boolean;
  /** Server-derived host (custom sources only). */
  hostname?: string;
  /** Present for built-ins; custom entries get theirs from a live detection. */
  capabilities?: ProviderCapabilities;
  /** Where the row lives: the server registry, the local mirror, or both. */
  persisted: "server" | "local" | "both";
  /** Free-form last test result, shown in the manager. */
  lastTest?: { at: string; ok: boolean; detail: string };
}

export interface SourceExportFile {
  format: "ghrdp.search-sources";
  version: 1;
  exportedAt: string;
  sources: {
    id: string;
    kind: SourceKind;
    label: string;
    url: string;
    notes?: string;
    enabled: boolean;
    providerId?: BuiltinProviderId;
  }[];
}

interface PersistedShape {
  overrides: Record<string, { enabled?: boolean; label?: string; notes?: string }>;
  custom: { id: string; label: string; url: string; notes?: string; enabled: boolean; hostname?: string }[];
}

interface SourcesState {
  entries: SourceEntry[];
  loading: boolean;
  serverReachable: boolean;
  error: string | null;
  lastLoadedAt: string | null;
  refresh: () => Promise<void>;
  toggle: (id: string, enabled: boolean) => void;
  update: (id: string, patch: { label?: string; notes?: string; enabled?: boolean }) => Promise<{ ok: boolean; error?: string }>;
  add: (url: string, opts?: { label?: string; notes?: string }) => Promise<{ ok: boolean; error?: string; entry?: SourceEntry }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  test: (id: string) => Promise<{ ok: boolean; detail: string }>;
  exportSources: () => SourceExportFile;
  importSources: (json: string) => Promise<{ ok: boolean; imported: number; error?: string }>;
  enabledSpecs: () => { id: string; label: string; kind: "builtin" | "custom"; baseUrl?: string; notes?: string; providerId?: BuiltinProviderId; nameKey?: string }[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function readStore(): PersistedShape {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { overrides: {}, custom: [] };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    return { overrides: parsed.overrides || {}, custom: Array.isArray(parsed.custom) ? parsed.custom : [] };
  } catch {
    return { overrides: {}, custom: [] };
  }
}

function writeStore(s: PersistedShape): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* storage denied: the session still works, it just will not remember */
  }
}

function normaliseUrl(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return "https://" + raw.replace(/^\/+/, "");
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function slugFor(url: string): string {
  const host = hostnameOf(url) || "site";
  return host.replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
}

function builtinEntries(overrides: PersistedShape["overrides"]): SourceEntry[] {
  return BUILTIN_PROVIDERS.map((p) => {
    const ov = overrides[p.id] || {};
    return {
      id: p.id,
      kind: "builtin" as const,
      label: ov.label || p.label,
      url: p.homepage,
      providerId: p.id,
      nameKey: p.nameKey,
      notes: ov.notes,
      enabled: ov.enabled != null ? ov.enabled : p.defaultEnabled,
      hostname: hostnameOf(p.homepage),
      capabilities: p.capabilities,
      persisted: "local" as const,
    };
  });
}

function customEntries(custom: PersistedShape["custom"], overrides: PersistedShape["overrides"], fromServer: boolean): SourceEntry[] {
  return custom.map((c) => {
    const ov = overrides[c.id] || {};
    const cls = classifyUrl(c.url).providerId;
    const providerId = cls && cls !== "custom" ? (cls as BuiltinProviderId) : undefined;
    return {
      id: c.id,
      kind: "custom" as const,
      label: ov.label || c.label,
      url: c.url,
      providerId,
      notes: ov.notes ?? c.notes,
      enabled: ov.enabled != null ? ov.enabled : c.enabled !== false,
      hostname: c.hostname || hostnameOf(c.url),
      capabilities: undefined,
      persisted: fromServer ? "both" : "local",
    };
  });
}

export const useSourcesStore = create<SourcesState>((set, get) => ({
  entries: builtinEntries({}),
  loading: false,
  serverReachable: false,
  error: null,
  lastLoadedAt: null,

  refresh: async () => {
    set({ loading: true });
    const persisted = readStore();
    const builtins = builtinEntries(persisted.overrides);
    let custom = persisted.custom;
    let serverReachable = false;
    let error: string | null = null;
    try {
      const res = await listCustomSources();
      if (res.ok) {
        serverReachable = true;
        const rows = res.data.map((r) => ({
          id: r.id,
          label: String(r.name ?? r.id),
          url: String(r.baseUrl ?? ""),
          notes: (r as unknown as { notes?: string }).notes,
          enabled: (r as unknown as { enabled?: boolean }).enabled !== false,
          hostname: (r as unknown as { hostname?: string }).hostname,
        }));
        // The server is authoritative for WHICH sources exist; local-only rows
        // are appended so an import is never silently lost.
        const serverIds = new Set(rows.map((r) => r.id));
        custom = [...rows, ...custom.filter((c) => !serverIds.has(c.id))];
        writeStore({ overrides: persisted.overrides, custom });
      } else {
        error = res.error.messageKey;
      }
    } catch {
      error = "unreachable";
    }
    set({
      entries: [...builtins, ...customEntries(custom, persisted.overrides, serverReachable)],
      loading: false,
      serverReachable,
      error,
      lastLoadedAt: nowIso(),
    });
  },

  toggle: (id, enabled) => {
    const persisted = readStore();
    persisted.overrides[id] = { ...(persisted.overrides[id] || {}), enabled };
    writeStore(persisted);
    set({ entries: get().entries.map((e) => (e.id === id ? { ...e, enabled } : e)) });
    // A server-backed custom row keeps its state across a reload on ANY browser,
    // so the toggle is written through as well. The local mirror is already
    // updated above, so a failed write is reported without undoing the click.
    const entry = get().entries.find((e) => e.id === id);
    if (entry && entry.kind === "custom" && entry.persisted !== "local") {
      void updateCustomSource(id, { enabled }).then((res) => {
        if (!res.ok) set({ error: res.error?.messageKey ?? "unreachable" });
      });
    }
  },

  update: async (id, patch) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return { ok: false, error: "unknown source" };
    const persisted = readStore();
    persisted.overrides[id] = { ...(persisted.overrides[id] || {}), ...patch };
    writeStore(persisted);
    const next = { ...entry, ...patch } as SourceEntry;
    set({ entries: get().entries.map((e) => (e.id === id ? next : e)) });
    if (entry.kind === "custom" && entry.persisted !== "local") {
      // Name/notes/enabled live on the server row too, so a reload keeps them.
      // PATCH by id (not POST-upsert by hostname) so editing a row can never
      // create a second one or re-run the add-time host probe.
      const res = await updateCustomSource(id, {
        ...(patch.label != null ? { name: patch.label } : {}),
        ...(patch.notes != null ? { notes: patch.notes } : {}),
        ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
      });
      if (!res.ok) return { ok: false, error: res.error?.messageKey ?? "unreachable" };
    }
    return { ok: true };
  },

  add: async (url, opts) => {
    const normalized = normaliseUrl(url);
    if (!/^https:\/\//i.test(normalized)) return { ok: false, error: "https-required" };
    const label = (opts?.label || "").trim() || hostnameOf(normalized).replace(/^www\./, "") || "site";
    const persisted = readStore();
    const existing = get().entries.find((e) => e.kind === "custom" && hostnameOf(e.url) === hostnameOf(normalized) && e.url === normalized);
    const id = existing?.id || slugFor(normalized);
    const row = { id, label, url: normalized, notes: opts?.notes, enabled: true, hostname: hostnameOf(normalized) };
    // Local mirror FIRST: the operator's click must survive even if the server
    // is unreachable, and the row is marked persisted:"local" in that case.
    persisted.custom = [...persisted.custom.filter((c) => c.id !== id), row];
    writeStore(persisted);
    set({ entries: [...builtinEntries(persisted.overrides), ...customEntries(readStore().custom, persisted.overrides, get().serverReachable)] });

    const res = await createCustomSource(label, normalized, { notes: opts?.notes });
    if (res.ok) {
      const serverRow = res.data;
      const stored = readStore();
      stored.custom = [
        ...stored.custom.filter((c) => c.id !== id && c.hostname !== hostnameOf(normalized)),
        { id: serverRow.id, label: String(serverRow.name ?? label), url: String(serverRow.baseUrl ?? normalized), notes: opts?.notes, enabled: true, hostname: String(serverRow.hostname ?? hostnameOf(normalized)) },
      ];
      writeStore(stored);
      set({ serverReachable: true, entries: [...builtinEntries(stored.overrides), ...customEntries(stored.custom, stored.overrides, true)] });
      return { ok: true, entry: get().entries.find((e) => e.id === serverRow.id) };
    }
    set({ error: res.error?.messageKey ?? "unreachable" });
    return { ok: false, error: res.error?.messageKey ?? "unreachable", entry: get().entries.find((e) => e.id === id) };
  },

  remove: async (id) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return { ok: false, error: "unknown source" };
    const persisted = readStore();
    persisted.custom = persisted.custom.filter((c) => c.id !== id);
    delete persisted.overrides[id];
    writeStore(persisted);
    set({ entries: [...builtinEntries(persisted.overrides), ...customEntries(persisted.custom, persisted.overrides, get().serverReachable)] });
    if (entry.kind === "custom" && entry.persisted !== "local") {
      const res = await deleteCustomSource(id);
      if (!res.ok) return { ok: false, error: res.error.messageKey };
    }
    return { ok: true };
  },

  test: async (id) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return { ok: false, detail: "unknown source" };
    try {
      const ctx = buildProviderContext();
      const outcome = await inspectUrl(entry.url, ctx, entry.kind === "custom" ? entry.id : undefined);
      const detail = outcome.addable
        ? `${outcome.kind}: ${outcome.title}${outcome.sections.length ? ` · ${outcome.sections.length} section(s)` : ""}`
        : outcome.notAddableReason || "readable, but not addable as a searchable source";
      const lastTest = { at: nowIso(), ok: outcome.addable, detail };
      set({ entries: get().entries.map((e) => (e.id === id ? { ...e, lastTest, capabilities: outcome.capabilities } : e)) });
      return { ok: outcome.addable, detail };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      set({ entries: get().entries.map((en) => (en.id === id ? { ...en, lastTest: { at: nowIso(), ok: false, detail } } : en)) });
      return { ok: false, detail };
    }
  },

  exportSources: () => ({
    format: "ghrdp.search-sources",
    version: 1,
    exportedAt: nowIso(),
    sources: get().entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label,
      url: e.url,
      notes: e.notes,
      enabled: e.enabled,
      providerId: e.providerId,
    })),
  }),

  importSources: async (json) => {
    let parsed: SourceExportFile;
    try {
      parsed = JSON.parse(json) as SourceExportFile;
    } catch {
      return { ok: false, imported: 0, error: "invalid JSON" };
    }
    if (!parsed || parsed.format !== "ghrdp.search-sources" || !Array.isArray(parsed.sources)) {
      return { ok: false, imported: 0, error: "not a source export file" };
    }
    const persisted = readStore();
    let imported = 0;
    for (const s of parsed.sources) {
      if (!s || typeof s.url !== "string") continue;
      persisted.overrides[s.id] = { enabled: s.enabled !== false, label: s.label, notes: s.notes };
      if (s.kind === "custom") {
        const url = normaliseUrl(s.url);
        if (!/^https:\/\//i.test(url)) continue;
        const row = { id: s.id, label: s.label || hostnameOf(url), url, notes: s.notes, enabled: s.enabled !== false, hostname: hostnameOf(url) };
        persisted.custom = [...persisted.custom.filter((c) => c.id !== s.id), row];
        if (get().serverReachable) {
          await createCustomSource(row.label, row.url, { notes: row.notes, enabled: row.enabled });
        }
      }
      imported += 1;
    }
    writeStore(persisted);
    set({ entries: [...builtinEntries(persisted.overrides), ...customEntries(persisted.custom, persisted.overrides, get().serverReachable)] });
    return { ok: true, imported };
  },

  enabledSpecs: () =>
    get()
      .entries.filter((e) => e.enabled)
      .map((e) => ({
        id: e.id,
        label: e.label,
        kind: e.kind,
        baseUrl: e.url,
        notes: e.notes,
        providerId: e.providerId,
        nameKey: e.nameKey,
      })),
}));

/** Non-reactive snapshot for the search lane (it must not subscribe). */
export function enabledSourceSpecs(): ReturnType<SourcesState["enabledSpecs"]> {
  return useSourcesStore.getState().enabledSpecs();
}

export function resetSourcesStore(): void {
  useSourcesStore.setState({ entries: builtinEntries({}), loading: false, serverReachable: false, error: null, lastLoadedAt: null });
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export { hostnameOf, normaliseUrl };
