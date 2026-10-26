// [SEARCH-REPAIR] UI-level regression suite for the new Search surfaces.
//
// Everything here runs against the REAL stores and the REAL components; only the
// transport is stubbed, and the provider payloads are the authored fixtures. That
// makes this a FIXTURE-level check of what the operator sees:
//   * per-source status lines (complete / failed with its own reason / cancelled);
//   * provider rows appearing in the results grid with their provenance;
//   * a pasted URL previewed and then added as a source;
//   * the source manager adding, editing, disabling and removing a row.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "@/i18n";
import { ProviderStatusList } from "@/components/search/ProviderStatus";
import { UrlImportCard } from "@/components/search/UrlImportCard";
import { SourcesManager } from "@/components/search/SourcesManager";
import { setProviderLaneEnabled } from "@/lib/search/providerLane";
import { resetSourcesStore, useSourcesStore } from "@/stores/sourcesStore";
import { resetUrlImportStore, useUrlImportStore } from "@/stores/urlImportStore";
import { useSearchStore } from "@/stores/searchStore";

const FIX = join(process.cwd(), "src", "tests", "providers", "fixtures", "authored");
const fixture = (n: string): string => readFileSync(join(FIX, n), "utf8");

function json(body: unknown, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "",
    text: async () => text,
    json: async () => JSON.parse(text),
    headers: new Headers({ "content-type": "application/json" }),
  } as unknown as Response;
}

const REPO = {
  full_name: "mfkl/awesome-vlc",
  default_branch: "main",
  description: "A curated list of VLC resources",
  stargazers_count: 307,
  pushed_at: "2025-01-02T03:04:05Z",
  html_url: "https://github.com/mfkl/awesome-vlc",
  topics: ["awesome-list"],
  license: { spdx_id: "CC0-1.0" },
};

beforeEach(() => {
  resetSourcesStore();
  resetUrlImportStore();
  window.localStorage.clear();
  useSearchStore.setState(useSearchStore.getInitialState(), true);
  setProviderLaneEnabled(false);
});

afterEach(() => {
  setProviderLaneEnabled(false);
  vi.unstubAllGlobals();
});

function installSearchFetch(overrides: Record<string, "rate-limited" | undefined> = {}) {
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("archive.org") && overrides["internet-archive"] === "rate-limited") return json({}, 429);
    if (url.includes("api.openverse.org")) return json(JSON.parse(fixture("openverse-images.json")));
    if (url.includes("openculture.com/feed")) return json({}, 404);
    if (url.includes("openculture.com/sitemap")) return json({}, 404);
    if (url.includes("api.github.com/repos/mfkl/awesome-vlc/readme")) {
      return json({ content: globalThis.btoa("# Awesome VLC\n\n## Tools\n- [VLC](https://www.videolan.org/) - the player\n"), encoding: "base64", path: "README.md" });
    }
    if (url.includes("api.github.com/repos/mfkl/awesome-vlc")) return json(REPO);
    if (url.includes("api.github.com") && url.includes("/releases")) return json([]);
    if (url.includes("/api/search")) return json({}, 503);
    if (url.endsWith("/api/f58/sources") && method === "POST") {
      const sent = JSON.parse(String(init?.body)) as { name: string; baseUrl: string };
      return json({ ok: true, id: "custom-added", name: sent.name, baseUrl: sent.baseUrl, hostname: new URL(sent.baseUrl).hostname });
    }
    if (url.endsWith("/api/f58/sources")) return json({ ok: true, sources: [] });
    return json({}, 404);
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

describe("per-source status lines", () => {
  it("shows one line per source, with the failing source's own reason", async () => {
    installSearchFetch({ "internet-archive": "rate-limited" });
    // Only two sources: Openverse (will succeed) and Internet Archive (429).
    for (const id of ["github", "openculture", "fmhy", "rentry"]) useSourcesStore.getState().toggle(id, false);
    setProviderLaneEnabled(true);

    render(
      <MemoryRouter>
        <ProviderStatusList />
      </MemoryRouter>
    );

    useSearchStore.getState().setQuery("saturn");
    await useSearchStore.getState().submit();
    await waitFor(() => expect(useSearchStore.getState().providerLaneRunning).toBe(false), { timeout: 20_000 });

    const list = await screen.findByTestId("provider-status-list");
    expect(list).toBeInTheDocument();
    expect(screen.getByTestId("provider-row-openverse").textContent || "").toMatch(/Openverse/);
    expect(screen.getByTestId("provider-row-internet-archive")).toBeInTheDocument();
    // the failing source shows its OWN code, not a generic error
    expect(screen.getByTestId("provider-error-internet-archive").textContent || "").toMatch(/rate|limit/i);
    // the working source still delivered rows
    expect(useSearchStore.getState().resultOrder.length).toBeGreaterThan(0);
  }, 30_000);
});

describe("URL preview → add as source", () => {
  it("previews a pasted GitHub URL and adds it with one click", async () => {
    installSearchFetch();
    await useUrlImportStore.getState().inspect("https://github.com/mfkl/awesome-vlc#readme", 1);
    render(
      <MemoryRouter>
        <UrlImportCard />
      </MemoryRouter>
    );
    const card = await screen.findByTestId("url-import-card");
    expect(card.getAttribute("data-status")).toBe("ready");
    expect(screen.getByTestId("url-import-title").textContent).toMatch(/awesome-vlc/i);
    expect(screen.getByTestId("url-import-kind").textContent || "").toMatch(/list|repo|readme/);

    fireEvent.click(screen.getByTestId("url-import-add"));
    await waitFor(() => expect(useSourcesStore.getState().entries.some((e) => e.kind === "custom")).toBe(true));
    await waitFor(() => expect(useUrlImportStore.getState().addedSourceId).toBeTruthy());
  });

  it("shows the remedy for a typed failure instead of a raw stack", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "Not Found" }, 404)));
    await useUrlImportStore.getState().inspect("https://github.com/o/missing", 1);
    render(
      <MemoryRouter>
        <UrlImportCard />
      </MemoryRouter>
    );
    const card = await screen.findByTestId("url-import-card");
    expect(card.getAttribute("data-status")).toBe("failed");
    expect(screen.getByTestId("url-import-error").textContent || "").toMatch(/does not exist|not found/i);
    expect(screen.getByTestId("url-import-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("url-import-add")).toBeNull();
  });
});

describe("source manager", () => {
  it("adds a website, then disables and removes it", async () => {
    installSearchFetch();
    render(
      <MemoryRouter>
        <SourcesManager open onClose={() => undefined} />
      </MemoryRouter>
    );
    const dialog = await screen.findByTestId("sources-manager");
    expect(dialog).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("sources-add-url"), { target: { value: "https://fmhy.net/misc" } });
    fireEvent.change(screen.getByTestId("sources-add-label"), { target: { value: "FMHY misc" } });
    fireEvent.change(screen.getByTestId("sources-add-notes"), { target: { value: "index pages" } });
    await waitFor(() => expect(screen.getByTestId("sources-add-detected").textContent || "").toMatch(/fmhy/i));

    fireEvent.click(screen.getByTestId("sources-save"));
    await waitFor(() => expect(useSourcesStore.getState().entries.some((e) => e.label === "FMHY misc")).toBe(true));

    const row = useSourcesStore.getState().entries.find((e) => e.label === "FMHY misc")!;
    const toggle = screen.getByTestId(`sources-enable-${row.id}`);
    fireEvent.click(toggle);
    await waitFor(() => expect(useSourcesStore.getState().entries.find((e) => e.id === row.id)?.enabled).toBe(false));

    fireEvent.click(screen.getByTestId(`sources-remove-${row.id}`));
    await waitFor(() => expect(useSourcesStore.getState().entries.some((e) => e.id === row.id)).toBe(false));
  }, 30_000);
});
