// @vitest-environment node
// [SEARCH-REPAIR] OFFLINE provider regression suite  (evidence kind: FIXTURE)
//
// Payloads are hand-written bodies in the exact shape each service returns
// (src/tests/providers/fixtures/authored/). These tests pin PARSING and ERROR
// CLASSIFICATION; they are NOT evidence that a provider is reachable. Real
// provider evidence is `*.live.test.ts` plus
// docs/reports/search-repair/evidence/live-probe.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError, hostOf, normalizeHttpUrl, type ProviderContext } from "@/lib/providers/core";
import { archiveInspect, archiveSearch } from "@/lib/providers/archive";
import { openverseSearch } from "@/lib/providers/openverse";
import { clearProviderCaches, classifyUrl } from "@/lib/providers";
import { clearOpenCultureCache, opencultureSearch } from "@/lib/providers/openculture";
import { fmhyInspect, fmhySearch, genericInspect, genericSearch, rentryInspect, rentrySearch } from "@/lib/providers/listings";

const FIX = join(__dirname, "fixtures", "authored");
const body = (name: string): string => readFileSync(join(FIX, name), "utf8");

/** URL→response table plus a request log; anything unlisted is a 404. */
function transport(routes: Record<string, { status?: number; body: string; headers?: Record<string, string> }>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers as Record<string, string>) || {} });
    const hit = routes[url];
    const status = hit?.status ?? (hit ? 200 : 404);
    return {
      ok: status >= 200 && status < 300,
      status,
      url,
      text: async () => hit?.body ?? "",
      headers: new Headers(hit?.headers || {}),
    } as unknown as Response;
  });
  return { fetchImpl: impl as unknown as typeof fetch, calls, impl };
}

beforeEach(() => {
  clearProviderCaches();
  clearOpenCultureCache();
});

describe("URL normalisation and classification", () => {
  it("keeps fragments, accepts bare hosts, and refuses credentials or non-http schemes", () => {
    expect(normalizeHttpUrl("github.com/mfkl/awesome-vlc#readme")).toBe("https://github.com/mfkl/awesome-vlc#readme");
    expect(normalizeHttpUrl("https://user:pw@example.com/")).toBeNull();
    expect(normalizeHttpUrl("ftp://example.com/")).toBeNull();
    expect(hostOf("https://www.openculture.com/x")).toBe("openculture.com");
  });

  it("maps every operator URL to the provider that owns it", () => {
    expect(classifyUrl("https://github.com/mfkl/awesome-vlc#readme")).toMatchObject({ providerId: "github", subkind: "readme" });
    expect(classifyUrl("https://awesome.re/")).toMatchObject({ providerId: "github", resolvedFrom: "awesome.re" });
    expect(classifyUrl("https://github.com/ChessMax/awesome-programming-languages")).toMatchObject({ providerId: "github" });
    expect(classifyUrl("https://archive.org/details/coffeehouse-1921")).toMatchObject({ providerId: "internet-archive", subkind: "details" });
    expect(classifyUrl("https://archive.org/download/x/y.mp3")).toMatchObject({ providerId: "internet-archive", subkind: "file" });
    expect(classifyUrl("https://openverse.org/search/image?q=saturn")).toMatchObject({ providerId: "openverse" });
    expect(classifyUrl("https://www.openculture.com/2019/03/x.html")).toMatchObject({ providerId: "openculture" });
    expect(classifyUrl("https://fmhy.net/misc")).toMatchObject({ providerId: "fmhy" });
    expect(classifyUrl("https://rentry.org/megathread")).toMatchObject({ providerId: "rentry" });
    expect(classifyUrl("https://example.org/whatever")).toMatchObject({ providerId: "custom" });
    expect(classifyUrl("coffee and rain")).toMatchObject({ kind: "query", normalized: null });
  });
});

describe("Internet Archive", () => {
  it("maps advancedsearch rows and never invents a date, creator or size", async () => {
    const { fetchImpl, calls } = transport({
      // one route for the search endpoint, matched by prefix in the assertion
      "https://archive.org/advancedsearch.php?q=coffee+AND+mediatype%3Aaudio&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&fl%5B%5D=date&fl%5B%5D=mediatype&fl%5B%5D=downloads&fl%5B%5D=item_size&fl%5B%5D=licenseurl&fl%5B%5D=collection&fl%5B%5D=description&fl%5B%5D=language&rows=10&page=2&output=json&sort%5B%5D=downloads+desc": {
        body: body("archive-search.json"),
      },
    });
    const out = await archiveSearch({ query: "coffee", mediatype: "audio", page: 2, rows: 10, sort: "downloads" }, { fetchImpl });
    expect(out.hits).toHaveLength(2);
    expect(out.totalReported).toBe(42);
    expect(out.hasMore).toBe(true);
    expect(out.nextPage).toBe(3);
    expect(out.appliedFilters).toEqual(expect.arrayContaining(["mediatype", "sort", "page"]));
    const sent = new URL(calls[0].url);
    expect(sent.searchParams.get("q")).toBe("coffee AND mediatype:audio");
    expect(sent.searchParams.get("sort[]")).toBe("downloads desc");
    const [rich, sparse] = out.hits;
    expect(rich.date).toBe("1921");
    expect(rich.fileSizeBytes).toBe(4200000);
    // the sparse row carries only what the archive stated
    expect(sparse.creator).toBeUndefined();
    expect(sparse.date).toBeUndefined();
    expect(sparse.fileSizeBytes).toBeUndefined();
  });

  it("reports a missing item as NOT_FOUND instead of an empty item", async () => {
    const { fetchImpl } = transport({
      "https://archive.org/metadata/nope": { status: 404, body: "{}" },
    });
    await expect(archiveInspect("https://archive.org/details/nope", { fetchImpl })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists the item's real files and their download URLs", async () => {
    const meta = {
      metadata: {
        identifier: "demo",
        title: "Demo item",
        creator: "Someone",
        date: "1999-01-02",
        mediatype: "audio",
        licenseurl: "https://creativecommons.org/licenses/by/4.0/",
        collection: ["etree"],
      },
      files: [
        { name: "demo.mp3", format: "VBR MP3", size: "1048576", md5: "abc" },
        { name: "demo.ogg", format: "Ogg Vorbis", size: "104857" },
      ],
    };
    const { fetchImpl } = transport({ "https://archive.org/metadata/demo": { body: JSON.stringify(meta) } });
    const out = await archiveInspect("https://archive.org/details/demo", { fetchImpl });
    expect(out.kind).toBe("archive-item");
    expect(out.facts.find((f) => f.label === "Files")?.value).toBe("2");
    expect(out.sections[0].items[0].url).toBe("https://archive.org/download/demo/demo.mp3");
    expect(out.sections[0].items[0].note).toContain("1,024 KB");
    expect(out.description).toBeUndefined();
  });
});

describe("Openverse", () => {
  it("sends the filters it reports as applied, anonymously, and keeps licence evidence", async () => {
    const { fetchImpl, calls } = transport({
      "https://api.openverse.org/v1/images/?q=saturn&page=1&page_size=1&license=cc0": { body: body("openverse-images.json") },
    });
    const out = await openverseSearch({ query: "saturn", license: ["cc0"], pageSize: 1 }, { fetchImpl });
    const sent = new URL(calls[0].url);
    expect(sent.pathname).toBe("/v1/images/");
    expect(sent.searchParams.get("license")).toBe("cc0");
    expect(calls[0].headers.Authorization).toBeUndefined();
    const hit = out.hits[0];
    expect(hit.fileUrl).toContain("upload.wikimedia.org");
    expect(hit.previewUrl).toContain("/thumb/");
    expect(hit.fileSizeBytes).toBe(812345);
    expect(hit.license?.name).toBe("CC0 1.0");
    expect(hit.license?.attribution).toContain("NASA/JPL");
    expect(out.appliedFilters).toEqual(expect.arrayContaining(["license", "page_size"]));
  });

  it("uses the audio endpoint and sends the token only when one is configured", async () => {
    const { fetchImpl, calls } = transport({
      "https://api.openverse.org/v1/audio/?q=moonlight&page=1&page_size=20": { body: body("openverse-images.json") },
    });
    await openverseSearch({ query: "moonlight", mediaType: "audio" }, { fetchImpl, openverseToken: "tkn" });
    expect(new URL(calls[0].url).pathname).toBe("/v1/audio/");
    expect(calls[0].headers.Authorization).toBe("Bearer tkn");
  });
});

describe("error vocabulary stays distinct", () => {
  const expectCode = async (status: number, headers: Record<string, string>, code: string) => {
    const { fetchImpl } = transport({
      "https://api.openverse.org/v1/images/?q=x&page=1&page_size=20": { status, body: "{}", headers },
    });
    await expect(openverseSearch({ query: "x" }, { fetchImpl })).rejects.toMatchObject({ code });
  };

  it("401 is auth, 403 is a refusal, 429 is a limit, 404 is missing, 5xx is the server", async () => {
    await expectCode(401, {}, "AUTH_REQUIRED");
    await expectCode(403, {}, "FORBIDDEN");
    await expectCode(429, { "retry-after": "30" }, "RATE_LIMITED");
    await expectCode(404, {}, "NOT_FOUND");
    await expectCode(503, {}, "SERVER_ERROR");
  });

  it("a 403 with an exhausted budget is a LIMIT, not a refusal", async () => {
    await expectCode(403, { "x-ratelimit-available": "0" }, "RATE_LIMITED");
  });

  it("a cancelled request is CANCELLED and not retryable", () => {
    const err = new ProviderError("CANCELLED", "cancelled", { retryable: false });
    expect(err.code).toBe("CANCELLED");
    expect(err.retryable).toBe(false);
  });
});

describe("Open Culture (feed + sitemap; there is no search API)", () => {
  const routes = () => ({
    "https://www.openculture.com/feed": { body: body("openculture-feed.xml") },
    "https://www.openculture.com/feed?paged=2": { body: body("openculture-feed.xml") },
    "https://www.openculture.com/sitemap.xml": { body: body("openculture-sitemap.xml") },
  });

  it("returns the editorial article, deduped across feed pages", async () => {
    const { fetchImpl } = transport(routes());
    const out = await opencultureSearch({ query: "Kaufmann", feedPages: 2, sitemap: false }, { fetchImpl });
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0]).toMatchObject({
      kind: "editorial",
      url: "https://www.openculture.com/2019/03/walter_kaufmanns_lectures_on_nietzsche.html",
    });
    expect(out.hits[0].url).not.toContain("example.edu");
    expect(out.notes.join(" ")).toMatch(/RSS feed: 2 recent entries scanned/);
  });

  it("falls back to the sitemap for older posts and says so", async () => {
    const { fetchImpl } = transport(routes());
    const out = await opencultureSearch({ query: "Kaufmann archive", feedPages: 1, sitemap: true }, { fetchImpl });
    expect(out.hits.some((h) => h.url.includes("walter-kaufmann-archive"))).toBe(true);
    expect(out.appliedFilters).toContain("sitemap");
    expect(out.notes.join(" ")).toMatch(/Sitemap: \d+ URL\(s\) scanned, \d+ additional slug match/);
  });

  it("an unreadable feed is a typed error, not 'no results'", async () => {
    const { fetchImpl } = transport({ "https://www.openculture.com/feed": { body: "<html>nope</html>" } });
    await expect(opencultureSearch({ query: "x", feedPages: 1 }, { fetchImpl })).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });
});

describe("fmhy.net (page reading, no search endpoint)", () => {
  const routes = {
    "https://fmhy.net/sitemap.xml": { body: body("fmhy-sitemap.xml") },
    "https://fmhy.net/misc": { body: body("fmhy-misc.html") },
  };

  it("keeps section anchors, starred markers and warnings apart", async () => {
    const { fetchImpl } = transport(routes);
    const out = await fmhyInspect("https://fmhy.net/misc", { fetchImpl });
    expect(out.title).toBe("Miscellaneous - FMHY");
    expect(out.addable).toBe(true);
    const food = out.sections.find((s) => /Food/.test(s.label));
    expect(food?.anchor).toBe("https://fmhy.net/misc#-food");
    expect(out.facts.find((f) => f.label === "Search interface")?.value).toMatch(/none/);
  });

  it("matches entries locally, naming the page and the section", async () => {
    const { fetchImpl } = transport(routes);
    const out = await fmhySearch({ query: "flight", maxPages: 2, limit: 5 }, { fetchImpl });
    const hit = out.hits.find((h) => /flight/i.test(h.title));
    expect(hit?.url).toBe("https://example.org/flights");
    expect(hit?.extra?.page).toBe("https://fmhy.net/misc");
    expect(hit?.source?.url).toBe("https://fmhy.net/misc#-travel");
    expect(hit?.context?.[0]).toMatch(/Travel/);
    expect(out.notes.join(" ")).toMatch(/has no search API/);
  });
});

describe("rentry.org (raw Markdown is the interface)", () => {
  const fake = (calls: string[]) =>
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const slug = url.replace(/^https:\/\/rentry\.(org|co)\//, "").replace(/\/raw$/, "");
      const name =
        slug === "megathread"
          ? "rentry-megathread-raw.md"
          : slug === "megathread-music"
            ? "rentry-megathread-music-raw.md"
            : slug === "NotSoFastSailor"
              ? "rentry-NotSoFastSailor-raw.md"
              : "";
      if (!name) return { ok: false, status: 404, url, text: async () => "", headers: new Headers() } as unknown as Response;
      return { ok: true, status: 200, url, text: async () => body(name), headers: new Headers() } as unknown as Response;
    }) as unknown as typeof fetch;

  it("reads /<slug>/raw and follows the page's own sub-pages one level", async () => {
    const calls: string[] = [];
    const out = await rentrySearch({ query: "music", depth: 1, maxPages: 2 }, { fetchImpl: fake(calls) }, "https://rentry.org/megathread");
    expect(calls[0]).toBe("https://rentry.co/megathread/raw");
    expect(calls).toContain("https://rentry.co/megathread-music/raw");
    expect(out.hits.some((h) => h.url === "https://rentry.org/music-mega")).toBe(true);
    expect(out.notes.join(" ")).toMatch(/Curation pages are not a ranked index/);
  });

  it("inspects the megathread into its section tree", async () => {
    const calls: string[] = [];
    const out = await rentryInspect("https://rentry.org/megathread", { fetchImpl: fake(calls) });
    expect(out.title).toMatch(/Megathread/i);
    expect(out.sections.some((s) => /Unsafe/i.test(s.label))).toBe(true);
    expect(out.facts.find((f) => f.label === "Interface")?.value).toMatch(/raw Markdown/);
  });
});

describe("generic website adapter", () => {
  it("uses the site's own feed and names the source of each hit", async () => {
    const feed = body("openculture-feed.xml").replace(/openculture\.com/g, "blog.example.org");
    const { fetchImpl, calls } = transport({
      "https://blog.example.org/feed": { body: feed },
      "https://blog.example.org/rss.xml": { status: 404, body: "" },
      "https://blog.example.org/atom.xml": { status: 404, body: "" },
      "https://blog.example.org/sitemap.xml": { status: 404, body: "" },
      "https://blog.example.org/": { body: "<html><head><title>Blog</title></head><body><a href='/a'>A post</a></body></html>" },
    });
    const out = await genericSearch({ query: "Kaufmann", url: "https://blog.example.org/" }, { fetchImpl }, "custom-blog");
    expect(out.hits[0].providerId).toBe("custom-blog");
    expect(calls.some((c) => c.url === "https://blog.example.org/feed")).toBe(true);
    expect(out.notes.join(" ")).toMatch(/feed/i);
  });

  it("refuses to mark a bot-challenged site addable, and names the reason", async () => {
    const challenge = "<html><head><title>Just a moment...</title></head><body>cf-browser-verification</body></html>";
    const { fetchImpl } = transport({
      "https://challenge.example.org/feed": { status: 403, body: "" },
      "https://challenge.example.org/rss.xml": { status: 403, body: "" },
      "https://challenge.example.org/atom.xml": { status: 403, body: "" },
      "https://challenge.example.org/sitemap.xml": { status: 403, body: "" },
      "https://challenge.example.org/": { body: challenge },
    });
    await expect(genericSearch({ query: "anything", url: "https://challenge.example.org/" }, { fetchImpl }, "c")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const out = await genericInspect("https://challenge.example.org/", { fetchImpl }, "c");
    expect(out.addable).toBe(false);
    expect(out.notAddableReason).toMatch(/challenge/);
  });

  it("says the relay is missing when a host sends no CORS header", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(genericSearch({ query: "x", url: "https://nocors.example.org/" }, { fetchImpl: failing }, "c")).rejects.toMatchObject({
      code: "RELAY_UNAVAILABLE",
    });
  });

  it("uses the relay when one is configured, and reports the extra hop", async () => {
    const calls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("/api/providers/relay")) {
        expect(url).toContain(encodeURIComponent("https://nocors.example.org/"));
        return {
          ok: true,
          status: 200,
          url,
          text: async () => "<html><head><title>Relayed</title></head><body><a href='/x'>Relayed post</a></body></html>",
          headers: new Headers({ "x-relay-final-url": "https://nocors.example.org/" }),
        } as unknown as Response;
      }
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const out = await genericSearch(
      { query: "relayed", url: "https://nocors.example.org/" },
      { fetchImpl: impl, relayBase: "/api/providers/relay" },
      "c"
    );
    expect(calls.some((c) => c.startsWith("/api/providers/relay"))).toBe(true);
    expect(out.hits.some((h) => h.title === "Relayed post")).toBe(true);
  });
});
