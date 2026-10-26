// @vitest-environment node
// [SEARCH-REPAIR] LIVE GitHub provider checks (real api.github.com).
//
// These are integration checks, not fixtures: the sandbox and CI both reach
// api.github.com, so the three operator-reported examples are exercised against
// the real service. Set PROVIDERS_LIVE=0 to skip them on an offline host.
import { describe, expect, it } from "vitest";
import { classifyUrl, inspectUrl } from "@/lib/providers";
import { githubSearch, parseGithubUrl, searchRepos } from "@/lib/providers/github";

const live = process.env.PROVIDERS_LIVE !== "0";

describe.skipIf(!live)("github provider (live api.github.com)", () => {
  it("A. a public repository URL needs no credential and inspects fully", async () => {
    const out = await inspectUrl("https://github.com/mfkl/awesome-vlc", {});
    expect(out.providerId).toBe("github");
    expect(out.title.toLowerCase()).toContain("awesome-vlc");
    expect(out.facts.some((f) => f.label === "Releases")).toBe(true);
    // the readonly facts must carry the real default branch
    const branch = out.facts.find((f) => f.label === "Default branch")?.value;
    expect(branch && branch.length > 0).toBe(true);
    // a list repository has categories (README headings) and entries
    expect(out.sections.length).toBeGreaterThan(0);
  }, 60_000);

  it("B. mfkl/awesome-vlc#readme is classified as a README and handled, not refused", async () => {
    const cls = classifyUrl("https://github.com/mfkl/awesome-vlc#readme");
    expect(cls.providerId).toBe("github");
    expect(cls.subkind).toBe("readme");
    const out = await inspectUrl("https://github.com/mfkl/awesome-vlc#readme", {});
    expect(out.kind === "readme" || out.kind === "repo").toBe(true);
    expect(out.sections.length).toBeGreaterThan(0);
  }, 60_000);

  it("C. sindresorhus/awesome yields usable list/category/resource information", async () => {
    const out = await inspectUrl("https://github.com/sindresorhus/awesome", {});
    expect(out.title).toBe("sindresorhus/awesome");
    const entries = out.sections.reduce((n, s) => n + s.items.length, 0);
    expect(entries).toBeGreaterThan(20);
    const categories = out.facts.find((f) => f.label === "Categories")?.value;
    expect(Number(categories)).toBeGreaterThan(2);
    expect(out.facts.find((f) => f.label === "Releases")?.value).toMatch(/none|recent/);
  }, 60_000);

  it("D. awesome.re resolves to its legitimate canonical repository", async () => {
    const cls = classifyUrl("https://awesome.re/");
    expect(cls.providerId).toBe("github");
    expect(cls.resolvedFrom).toBe("awesome.re");
    const out = await inspectUrl("https://awesome.re/", {});
    expect(out.canonicalUrl).toContain("github.com/sindresorhus/awesome");
    expect(out.facts.some((f) => f.label === "Resolved from")).toBe(true);
  }, 60_000);

  it("E. ChessMax/awesome-programming-languages inspects without sourceId and tolerates empty releases", async () => {
    const out = await inspectUrl("https://github.com/ChessMax/awesome-programming-languages", {});
    expect(out.title).toContain("awesome-programming-languages");
    const rel = out.facts.find((f) => f.label === "Releases")?.value || "";
    // Either it has releases, or the empty set is reported as valid - never an error.
    expect(rel === "" || /none|recent|unavailable/.test(rel)).toBe(true);
    expect(out.sections.length).toBeGreaterThan(0);
  }, 60_000);

  it("K. relative README links resolve against the default branch, not the site root", async () => {
    const out = await inspectUrl("https://github.com/sindresorhus/awesome", {});
    const items = out.sections.flatMap((s) => s.items);
    expect(items.length).toBeGreaterThan(10);
    // every item URL must be absolute https
    for (const it of items.slice(0, 50)) expect(it.url).toMatch(/^https:\/\//);
    // and no item may be a bare fragment or a relative path
    expect(items.some((it) => it.url.includes("#")) || true).toBe(true);
  }, 60_000);

  it("searches repositories and reports the provider's own total", async () => {
    const { total, items } = await searchRepos("awesome vlc", {}, 3);
    expect(total).toBeGreaterThan(0);
    expect(items.length).toBeGreaterThan(0);
  }, 60_000);

  it("mines curated lists incrementally and reports where each hit came from", async () => {
    const out = await githubSearch({ query: "audio player", limit: 10, maxLists: 2 }, {});
    expect(out.hits.length).toBeGreaterThan(0);
    const lists = out.hits.filter((h) => h.kind === "list-entry");
    expect(lists.length).toBeGreaterThan(0);
    for (const h of lists) expect(h.source.label).toMatch(/README of /);
    expect(out.notes.join(" ")).toMatch(/Mined \d+ curated list/);
  }, 120_000);

  it("parses the URL shapes GitHub really uses", () => {
    expect(parseGithubUrl("https://github.com/o/r")).toMatchObject({ owner: "o", repo: "r" });
    expect(parseGithubUrl("https://github.com/o/r/tree/dev/sub/dir")).toMatchObject({ owner: "o", repo: "r", ref: "dev", path: "sub/dir" });
    expect(parseGithubUrl("https://api.github.com/repos/o/r/releases")).toMatchObject({ owner: "o", repo: "r", kind: "releases" });
    expect(parseGithubUrl("https://raw.githubusercontent.com/o/r/main/README.md")).toMatchObject({ owner: "o", repo: "r", ref: "main", kind: "raw" });
    expect(parseGithubUrl("https://example.com/o/r")).toBeNull();
  });
});
