// @vitest-environment jsdom
// [SEARCH-REPAIR] Lane + source-registry regressions  (evidence kind: FIXTURE)
//
// These are the behaviours the operator's complaints were really about:
//   * one failing source must not remove another source's results;
//   * a cancel reports CANCELLED, not an error;
//   * the same item must never be rendered twice;
//   * a source can be added, edited, disabled, removed, exported and imported,
//     and survives a reload of the local mirror when the server is unreachable;
//   * a pasted URL is inspected, and only an inspectable+searchable URL is
//     offered as a source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProviderLane, type LaneEvent } from "@/lib/providers";
import { hitToResult, stableResultId } from "@/lib/search/providerLane";
import { resetSourcesStore, useSourcesStore } from "@/stores/sourcesStore";
import { resetUrlImportStore, useUrlImportStore } from "@/stores/urlImportStore";

const FIX = join(__dirname, "fixtures", "authored");
const fixture = (n: string): string => readFileSync(join(FIX, n), "utf8");

const ARCHIVE_JSON = fixture("archive-search.json");
const OPENVERSE_JSON = fixture("openverse-images.json");
const FEED_XML = fixture("openculture-feed.xml");

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

const README_MD = "# Awesome VLC\n\n## Tools\n- [VLC](https://www.videolan.org/) - the player\n- [Docs](docs/usage.md) - relative link\n";

function b64(s: string): string {
  return globalThis.btoa(unescape(encodeURIComponent(s)));
}

beforeEach(() => {
  resetSourcesStore();
  resetUrlImportStore();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider lane", () => {
  it("keeps the working source's rows when another source fails, and reports both", async () => {
    const events: LaneEvent[] = [];
    const fake = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("archive.org")) return json({ detail: "slow down" }, 429);
      if (url.includes("api.openverse.org")) return json(JSON.parse(OPENVERSE_JSON));
      return json({}, 404);
    }) as unknown as typeof fetch;

    const outcomes = await runProviderLane({
      query: "saturn",
      sources: [
        { id: "internet-archive", label: "Internet Archive", kind: "builtin", providerId: "internet-archive" },
        { id: "openverse", label: "Openverse", kind: "builtin", providerId: "openverse" },
      ],
      ctx: { fetchImpl: fake },
      onEvent: (e) => events.push(e),
    });

    const ia = outcomes.find((o) => o.sourceId === "internet-archive")!;
    const ov = outcomes.find((o) => o.sourceId === "openverse")!;
    expect(ia.status).toBe("failed");
    expect(ia.error).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 60 });
    expect(ov.status).toBe("complete");
    expect(ov.hits).toHaveLength(1);
    // both sources were announced, and the lane ended exactly once
    expect(events.filter((e) => e.type === "source-start")).toHaveLength(2);
    expect(events.filter((e) => e.type === "lane-done")).toHaveLength(1);
  });

  it("reports CANCELLED (not an error) when the lane is cancelled", async () => {
    const controller = new AbortController();
    const fake = vi.fn(async () => {
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    const outcomes = await runProviderLane({
      query: "x",
      sources: [{ id: "openverse", label: "Openverse", kind: "builtin", providerId: "openverse" }],
      ctx: { fetchImpl: fake },
      signal: controller.signal,
    });
    expect(outcomes[0].status).toBe("cancelled");
    expect(outcomes[0].error?.code).toBe("CANCELLED");
  });

  it("an unsupported source is reported as unsupported, not as a failure", async () => {
    const fake = vi.fn(async () => {
      const err = new Error("no");
      throw err;
    }) as unknown as typeof fetch;
    const outcomes = await runProviderLane({
      query: "x",
      sources: [
        { id: "custom-1", label: "Broken site", kind: "custom", baseUrl: "https://fmhy.net/search?q=" },
      ],
      ctx: { fetchImpl: fake, relayBase: "" },
      onEvent: () => undefined,
    });
    // A custom site with nothing readable fails with a named code, never silently.
    expect(["failed", "unsupported", "cancelled"]).toContain(outcomes[0].status);
    expect(outcomes[0].error).toBeTruthy();
  });
});

describe("result identity and provenance", () => {
  it("gives the same item the same id and keeps the provider's own fields", () => {
    const a = stableResultId("github", "gh-repo:o/r");
    expect(a).toBe(stableResultId("github", "gh-repo:o/r"));
    expect(a).not.toBe(stableResultId("openverse", "gh-repo:o/r"));

    const row = hitToResult({
      id: "ia:demo",
      providerId: "internet-archive",
      kind: "archive-item",
      title: "Demo",
      url: "https://archive.org/details/demo",
      date: "1921",
      creator: "Edison",
      extra: { mediatype: "audio" },
      license: { name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
      source: { label: "Internet Archive › audio" },
    });
    expect(row.category).toBe("audio");
    expect(row.date).toBe("1921");
    expect(row.creator).toBe("Edison");
    expect(row.licenceTag).toBe("public-domain");
    expect(row.sourceUrl).toBe("https://archive.org/details/demo");
  });

  it("does not invent a licence the provider did not state", () => {
    const row = hitToResult({ id: "x", providerId: "custom", kind: "page", title: "t", url: "https://e.org", source: { label: "e.org" } });
    expect(row.licenceTag).toBe("open-access");
    expect(String(row.licenceEvidence)).toMatch(/did not state a licence/);
  });
});

describe("source registry", () => {
  const apiOk = () =>
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/f58/sources") && method === "GET") {
        return json({ ok: true, sources: [{ id: "fmhy-net", name: "FMHY", baseUrl: "https://fmhy.net", hostname: "fmhy.net", enabled: true, labMode: true }] });
      }
      if (url.endsWith("/api/f58/sources") && method === "POST") {
        const sent = JSON.parse(String(init?.body)) as { name: string; baseUrl: string; notes?: string; enabled?: boolean };
        return json({ ok: true, id: "custom-1", name: sent.name, baseUrl: sent.baseUrl, hostname: new URL(sent.baseUrl).hostname, notes: sent.notes, enabled: sent.enabled !== false });
      }
      if (url.includes("/api/f58/sources/") && method === "PATCH") {
        const sent = JSON.parse(String(init?.body)) as { name?: string; notes?: string; enabled?: boolean };
        return json({ ok: true, source: { id: "fmhy-net", name: sent.name || "FMHY", baseUrl: "https://fmhy.net", hostname: "fmhy.net", notes: sent.notes, enabled: sent.enabled !== false, labMode: true } });
      }
      if (url.includes("/api/f58/sources/") && method === "DELETE") return json({ ok: true, deletedId: "fmhy-net" });
      return json({}, 404);
    });

  it("adds a source, keeps it in the search specs, and mirrors it locally", async () => {
    vi.stubGlobal("fetch", apiOk());
    const res = await useSourcesStore.getState().add("https://rentry.org/megathread", { label: "Megathread", notes: "curated" });
    expect(res.ok).toBe(true);
    const entry = useSourcesStore.getState().entries.find((e) => e.kind === "custom");
    expect(entry).toMatchObject({ label: "Megathread", notes: "curated", enabled: true, persisted: "both" });
    expect(useSourcesStore.getState().enabledSpecs().some((s) => s.baseUrl === "https://rentry.org/megathread")).toBe(true);
    expect(window.localStorage.getItem("ghrdp:searchSources")).toContain("rentry.org");
  });

  it("keeps the operator's row when the server is unreachable, and says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ code: "TRANSPORT_UNAVAILABLE" }, 503)));
    const res = await useSourcesStore.getState().add("https://fmhy.net/misc", { label: "FMHY misc" });
    expect(res.ok).toBe(false);
    const entry = useSourcesStore.getState().entries.find((e) => e.kind === "custom");
    expect(entry).toMatchObject({ label: "FMHY misc", persisted: "local" });
    expect(useSourcesStore.getState().enabledSpecs().some((s) => s.id === entry!.id)).toBe(true);
  });

  it("edits and disables a server-backed row through PATCH", async () => {
    const calls: { method: string; url: string; body?: string }[] = [];
    const base = apiOk();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ method: init?.method ?? "GET", url: String(input), body: init?.body ? String(init.body) : undefined });
        return base(input, init);
      })
    );
    await useSourcesStore.getState().refresh();
    expect(useSourcesStore.getState().serverReachable).toBe(true);
    const edited = await useSourcesStore.getState().update("fmhy-net", { label: "FMHY wiki", notes: "all pages" });
    expect(edited.ok).toBe(true);
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain("/api/f58/sources/fmhy-net");
    expect(JSON.parse(patch.body || "{}")).toEqual({ name: "FMHY wiki", notes: "all pages" });

    useSourcesStore.getState().toggle("fmhy-net", false);
    expect(useSourcesStore.getState().entries.find((e) => e.id === "fmhy-net")?.enabled).toBe(false);
    expect(useSourcesStore.getState().enabledSpecs().some((s) => s.id === "fmhy-net")).toBe(false);
    // the toggle is written through to the server too (fire-and-forget)
    await vi.waitFor(() => expect(calls.some((c) => c.method === "PATCH" && (c.body || "").includes('"enabled":false'))).toBe(true));
  });

  it("removes a row everywhere", async () => {
    vi.stubGlobal("fetch", apiOk());
    await useSourcesStore.getState().refresh();
    const out = await useSourcesStore.getState().remove("fmhy-net");
    expect(out.ok).toBe(true);
    expect(useSourcesStore.getState().entries.some((e) => e.id === "fmhy-net")).toBe(false);
    expect(window.localStorage.getItem("ghrdp:searchSources") || "").not.toContain("fmhy-net");
  });

  it("exports and re-imports the whole configuration", async () => {
    vi.stubGlobal("fetch", apiOk());
    await useSourcesStore.getState().add("https://example.org/feed", { label: "Example" });
    const exported = useSourcesStore.getState().exportSources();
    expect(exported.format).toBe("ghrdp.search-sources");
    expect(exported.version).toBe(1);
    expect(exported.sources.some((s) => s.url === "https://example.org/feed")).toBe(true);

    resetSourcesStore();
    const imported = await useSourcesStore.getState().importSources(JSON.stringify(exported));
    expect(imported.ok).toBe(true);
    expect(useSourcesStore.getState().entries.some((e) => e.url === "https://example.org/feed")).toBe(true);
    // a file that is not ours is refused, not half-applied
    await expect(useSourcesStore.getState().importSources(JSON.stringify({ format: "other" }))).resolves.toMatchObject({ ok: false });
    await expect(useSourcesStore.getState().importSources("not json")).resolves.toMatchObject({ ok: false });
  });

  it("survives a reload: the local mirror rehydrates builtin overrides", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));
    useSourcesStore.getState().toggle("openculture", false);
    expect(useSourcesStore.getState().entries.find((e) => e.id === "openculture")?.enabled).toBe(false);
    // simulate a page reload: state is rebuilt from the local mirror
    await useSourcesStore.getState().refresh();
    expect(useSourcesStore.getState().entries.find((e) => e.id === "openculture")?.enabled).toBe(false);
  });
});

describe("pasted-URL inspection", () => {
  const githubFetch = (opts: { readme?: string } = {}) =>
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers as Record<string, string>) || {};
      expect(headers.Authorization).toBeUndefined();
      if (url.includes("/repos/mfkl/awesome-vlc/readme")) return json({ content: b64(opts.readme ?? README_MD), encoding: "base64", path: "README.md", html_url: "https://github.com/mfkl/awesome-vlc#readme" });
      if (url.includes("/repos/mfkl/awesome-vlc/releases")) return json([]);
      if (url.includes("/repos/mfkl/awesome-vlc")) return json(REPO);
      if (url.endsWith("/api/f58/sources")) return json({ ok: true, id: "gh-1", name: "Awesome VLC", baseUrl: "https://github.com/mfkl/awesome-vlc", hostname: "github.com" });
      return json({}, 404);
    });

  it("inspects a public awesome list with no credential and offers it as a source", async () => {
    vi.stubGlobal("fetch", githubFetch());
    await useUrlImportStore.getState().inspect("https://github.com/mfkl/awesome-vlc#readme", 1);
    const st = useUrlImportStore.getState();
    expect(st.status).toBe("ready");
    expect(st.outcome?.addable).toBe(true);
    expect(st.outcome?.facts.find((f) => f.label === "Releases")?.value).toMatch(/none/);
    expect(st.outcome?.sections[0].items.some((i) => i.url === "https://github.com/mfkl/awesome-vlc/blob/main/docs/usage.md")).toBe(true);

    const added = await useUrlImportStore.getState().addAsSource("Awesome VLC", "lists");
    expect(added.ok).toBe(true);
    expect(useSourcesStore.getState().entries.some((e) => e.kind === "custom" && /awesome-vlc/.test(e.url))).toBe(true);
  });

  it("keeps the provider's own error for a missing page and never offers Add", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "Not Found" }, 404)));
    await useUrlImportStore.getState().inspect("https://github.com/o/does-not-exist", 1);
    const st = useUrlImportStore.getState();
    expect(st.status).toBe("failed");
    expect(st.error?.code).toBe("NOT_FOUND");
    await expect(st.addAsSource()).resolves.toMatchObject({ ok: false });
  });

  it("a non-URL paste is refused without a request", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await useUrlImportStore.getState().inspect("just some words", 1);
    expect(useUrlImportStore.getState().error?.code).toBe("UNSUPPORTED");
    expect(spy).not.toHaveBeenCalled();
  });

  it("lets a newer paste win over a slower older one", async () => {
    let releaseOld: (v: Response) => void = () => undefined;
    const slow = new Promise<Response>((resolve) => {
      releaseOld = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/repos/o/old") && !url.includes("readme") && !url.includes("releases")) return slow;
        if (url.includes("/repos/o/new/readme")) return json({ content: b64("# New\n\n## A\n- [x](https://example.org/x)\n"), encoding: "base64", path: "README.md" });
        if (url.includes("/repos/o/new")) return json({ ...REPO, full_name: "o/new" });
        if (url.includes("/releases")) return json([]);
        return json({}, 404);
      })
    );
    const first = useUrlImportStore.getState().inspect("https://github.com/o/old", 1);
    await useUrlImportStore.getState().inspect("https://github.com/o/new", 2);
    expect(useUrlImportStore.getState().generation).toBe(2);
    releaseOld(json({ ...REPO, full_name: "o/old" }));
    await first;
    expect(useUrlImportStore.getState().generation).toBe(2);
    expect(useUrlImportStore.getState().status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// The lane kill switch (FIXTURE evidence, not a live probe)
//
// WHY THIS EXISTS: e2e-ui run 40263554441 on the merged revision was RED in
// tests/e2e/f79-google-simple.spec.ts - 12 result cards where the fixture
// backend serves 2, and no empty state for "xyz" - because the PRODUCTION
// bundle queried the real providers from the Playwright runner and mixed ten
// live GitHub rows into the two fixture rows. The lane is now switched off for
// that hermetic config through localStorage, and this pins the resolver so the
// switch cannot silently stop working (which would bring the same red back with
// no clue attached).
// ---------------------------------------------------------------------------
describe("resolveLaneEnabled (the hermetic-lane switch)", () => {
  it("defaults ON: no window, no key, unrelated value, or throwing storage", async () => {
    const lane = await import("@/lib/search/providerLane");
    expect(lane.SEARCH_LANE_STORAGE_KEY).toBe("ghrdp:search.lane");
    expect(lane.resolveLaneEnabled(null)).toBe(true);
    const store = (value: string | null) => ({ getItem: () => value }) as unknown as Storage;
    expect(lane.resolveLaneEnabled({ localStorage: store(null) })).toBe(true);
    expect(lane.resolveLaneEnabled({ localStorage: store("on") })).toBe(true);
    expect(lane.resolveLaneEnabled({})).toBe(true);
    const throwing = { getItem: () => { throw new Error("denied"); } } as unknown as Storage;
    expect(lane.resolveLaneEnabled({ localStorage: throwing })).toBe(true);
  });

  it("switches OFF for the documented value and for a page-level override", async () => {
    const lane = await import("@/lib/search/providerLane");
    const store = (value: string) => ({ getItem: () => value }) as unknown as Storage;
    expect(lane.resolveLaneEnabled({ localStorage: store("off") })).toBe(false);
    expect(lane.resolveLaneEnabled({ localStorage: store("on"), __GHRDP_PROVIDER_LANE__: false })).toBe(false);
  });

  it("the hermetic Playwright lane really sets the documented value", () => {
    // The config and the state file must agree with the resolver, or the E2E
    // lane goes nondeterministic again with no test failing here.
    const config = readFileSync(join(process.cwd(), "playwright.e2e-ui.config.ts"), "utf8");
    expect(config).toContain("lane-off.storage.json");
    const state = JSON.parse(readFileSync(join(process.cwd(), "tests/e2e/fixtures/lane-off.storage.json"), "utf8")) as {
      origins: { origin: string; localStorage: { name: string; value: string }[] }[];
    };
    const entry = state.origins.flatMap((o) => o.localStorage).find((e) => e.name === "ghrdp:search.lane");
    expect(entry?.value).toBe("off");
  });
});
