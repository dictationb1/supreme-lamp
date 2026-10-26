// [SEARCH-REPAIR] GitHub provider: repositories, READMEs and curated lists.
//
// The defects this file repairs (all observed on the real API):
//   * a pasted repo URL was treated as a RELEASES source, so a curated list
//     (`sindresorhus/awesome`, `ChessMax/awesome-programming-languages`) was
//     reported as "no releases" instead of as a list. Releases are now ONE fact
//     among many, and an empty release list is a normal, stated value.
//   * `#readme` fragments and `awesome.re` aliases were refused or treated as
//     hostname mismatches. Both are resolved here before any request is made.
//   * public content asked for a credential. Anonymous api.github.com calls
//     (60 req/h per IP) are the default; a token only raises the ceiling.
//   * relative links in a README (`./contributing.md`, `docs/x.md`) were emitted
//     verbatim, so a nested list produced broken URLs. They resolve against the
//     repository's DEFAULT BRANCH, which is why the branch is read first.
import { ProviderError, getJson, type ProviderContext } from "./core";
import { cleanHeading, parseMarkdownSections, scoreMatch, truncate, type MarkdownSection } from "./text";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome, SectionItem } from "./types";

const API = "https://api.github.com";

/** `awesome.re` is the marketing front door for sindresorhus/awesome. It is a
 *  legitimate alias, not a hostname mismatch. */
export const GITHUB_ALIASES: Record<string, string> = {
  "awesome.re": "sindresorhus/awesome",
  "github.com/awesome-selfhosted": "awesome-selfhosted/awesome-selfhosted",
};

export interface GithubRef {
  owner: string;
  repo: string;
  kind: "repo" | "readme" | "list" | "releases" | "issues" | "tree" | "blob" | "search" | "raw" | "api";
  ref?: string;
  path?: string;
  /** Set when the input was a known alias rather than a github.com URL. */
  resolvedFrom?: string;
}

const RESERVED = new Set(["orgs", "settings", "topics", "explore", "marketplace", "sponsors", "features", "about", "login", "collections", "events"]);

/** Classify every GitHub URL shape the operator actually pastes. */
export function parseGithubUrl(input: string): GithubRef | null {
  let u: URL;
  try {
    u = new URL(String(input || "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/^\/+|\/+$/g, "");
  const frag = u.hash.replace(/^#/, "").toLowerCase();

  if (host === "awesome.re") {
    const alias = GITHUB_ALIASES["awesome.re"];
    const [owner, repo] = alias.split("/");
    return { owner, repo, kind: "list", resolvedFrom: "awesome.re" };
  }

  if (host === "raw.githubusercontent.com") {
    const [owner, repo, ref, ...rest] = path.split("/");
    if (!owner || !repo || !ref) return null;
    return { owner, repo, kind: "raw", ref, path: rest.join("/") || undefined };
  }

  if (host === "api.github.com") {
    const segs = path.split("/");
    if (segs[0] === "repos" && segs[1] && segs[2]) {
      const tail = segs[3];
      if (tail === "readme") return { owner: segs[1], repo: segs[2], kind: "readme" };
      if (tail === "releases") return { owner: segs[1], repo: segs[2], kind: "releases" };
      return { owner: segs[1], repo: segs[2], kind: "api" };
    }
    if (segs[0] === "search") return { owner: "", repo: "", kind: "search" };
    return null;
  }

  if (host !== "github.com") return null;

  const segs = path.split("/").filter(Boolean);
  if (!segs.length) return null;
  if (RESERVED.has(segs[0].toLowerCase())) return null;
  const [owner, repo, third, ...rest] = segs;
  if (!repo) return { owner, repo: "", kind: "repo" };
  if (third === "releases") return { owner, repo, kind: "releases" };
  if (third === "issues" || third === "pulls") return { owner, repo, kind: "issues" };
  if (third === "tree") return { owner, repo, kind: "tree", ref: rest[0], path: rest.slice(1).join("/") || undefined };
  if (third === "blob") return { owner, repo, kind: "blob", ref: rest[0], path: rest.slice(1).join("/") || undefined };
  if (frag === "readme" || frag.startsWith("readme")) return { owner, repo, kind: "readme" };
  if (
    /(^|[-_/])awesome([-_/]|$)/i.test(repo) ||
    (third === "" && frag === "") === false
  ) {
    // A repository whose NAME says it is a curated list is a list even before
    // the README is read; the README then confirms it.
    if (/(^|[-_/])awesome([-_/]|$)/i.test(repo)) return { owner, repo, kind: "list" };
  }
  return { owner, repo, kind: "repo" };
}

function headers(ctx: ProviderContext): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // OPTIONAL: public reads work anonymously. A token only raises the limit.
  if (ctx.githubToken) h.Authorization = `Bearer ${ctx.githubToken}`;
  return h;
}

export interface GithubRepo {
  fullName: string;
  defaultBranch: string;
  description?: string;
  stars: number;
  forks?: number;
  license?: string;
  pushedAt?: string;
  createdAt?: string;
  archived?: boolean;
  htmlUrl: string;
  topics: string[];
  homepage?: string;
  openIssues?: number;
  sizeKb?: number;
  language?: string;
}

interface ApiRepo {
  full_name?: string;
  default_branch?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  pushed_at?: string;
  created_at?: string;
  archived?: boolean;
  html_url?: string;
  topics?: string[];
  homepage?: string | null;
  open_issues_count?: number;
  size?: number;
  language?: string | null;
  license?: { spdx_id?: string; name?: string } | null;
}

export async function getRepo(owner: string, repo: string, ctx: ProviderContext): Promise<GithubRepo> {
  const { data } = await getJson<ApiRepo>(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, ctx, {
    headers: headers(ctx),
  });
  if (!data || !data.full_name) {
    throw new ProviderError("PARSE_ERROR", "GitHub answered, but not with repository data.", { url: `${API}/repos/${owner}/${repo}` });
  }
  return {
    fullName: data.full_name,
    defaultBranch: String(data.default_branch || "main"),
    description: data.description || undefined,
    stars: Number(data.stargazers_count ?? 0),
    forks: data.forks_count != null ? Number(data.forks_count) : undefined,
    license: data.license?.spdx_id && data.license.spdx_id !== "NOASSERTION" ? data.license.spdx_id : data.license?.name,
    pushedAt: data.pushed_at,
    createdAt: data.created_at,
    archived: Boolean(data.archived),
    htmlUrl: String(data.html_url || `https://github.com/${data.full_name}`),
    topics: Array.isArray(data.topics) ? data.topics : [],
    homepage: data.homepage || undefined,
    openIssues: data.open_issues_count,
    sizeKb: data.size,
    language: data.language || undefined,
  };
}

function decodeBase64(b64: string): string {
  const clean = String(b64 || "").replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }
  // Node (tests) fallback without depending on the Buffer type.
  const g = globalThis as unknown as { Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } } };
  if (g.Buffer) return g.Buffer.from(clean, "base64").toString("utf8");
  throw new ProviderError("PARSE_ERROR", "This environment cannot decode base64.", {});
}

export interface ReadmeDoc {
  text: string;
  path: string;
  ref: string;
  /** URL a human can open to read the same document. */
  htmlUrl: string;
  /** Where a RELATIVE link in this README resolves to. */
  baseUrl: string;
  truncated: boolean;
}

interface ApiReadme {
  content?: string;
  encoding?: string;
  path?: string;
  html_url?: string;
  name?: string;
}

/** Read the repository's README through the API (CORS `*`, no HTML scraping). */
export async function getReadme(owner: string, repo: string, defaultBranch: string, ctx: ProviderContext): Promise<ReadmeDoc | null> {
  try {
    const { data } = await getJson<ApiReadme>(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`, ctx, {
      headers: headers(ctx),
    });
    if (!data || !data.content || data.encoding !== "base64") {
      throw new ProviderError("PARSE_ERROR", "The README could not be decoded.", {
        url: `${API}/repos/${owner}/${repo}/readme`,
      });
    }
    const text = decodeBase64(data.content);
    const path = String(data.path || "README.md");
    return {
      text,
      path,
      ref: defaultBranch,
      htmlUrl: String(data.html_url || `https://github.com/${owner}/${repo}#readme`),
      baseUrl: `https://github.com/${owner}/${repo}/blob/${defaultBranch}/${path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : ""}`,
      truncated: text.length > 1_000_000,
    };
  } catch (e) {
    // A repository with NO readme is a real, reportable state (204/404), not an
    // error that should block the rest of the inspection.
    if (e instanceof ProviderError && (e.code === "NOT_FOUND" || e.status === 404)) return null;
    throw e;
  }
}

export interface ReleaseInfo {
  /** null = the provider did not answer; [] = answered with no releases. */
  tags: { tag: string; name?: string; publishedAt?: string; prerelease: boolean }[] | null;
  latest?: string;
  url?: string;
}

export async function listReleases(owner: string, repo: string, ctx: ProviderContext): Promise<ReleaseInfo> {
  try {
    const { data } = await getJson<{ tag_name?: string; name?: string; published_at?: string; prerelease?: boolean; html_url?: string }[]>(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=5`,
      ctx,
      { headers: headers(ctx) }
    );
    const rows = Array.isArray(data) ? data : [];
    return {
      tags: rows.map((r) => ({ tag: String(r.tag_name || ""), name: r.name, publishedAt: r.published_at, prerelease: Boolean(r.prerelease) })),
      latest: rows[0]?.tag_name,
      url: rows[0]?.html_url,
    };
  } catch (e) {
    if (e instanceof ProviderError && e.code === "RATE_LIMITED") return { tags: null };
    if (e instanceof ProviderError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) return { tags: null };
    throw e;
  }
}

export interface GithubSearchItem {
  fullName: string;
  description?: string;
  stars: number;
  language?: string;
  pushedAt?: string;
  url: string;
  archived: boolean;
  topics: string[];
}

/** Repository search: the provider's own ranking, with the provider's total. */
export async function searchRepos(query: string, ctx: ProviderContext, perPage = 10): Promise<{ items: GithubSearchItem[]; total: number }> {
  const q = String(query || "").trim();
  if (!q) throw new ProviderError("UNSUPPORTED", "An empty query cannot be searched.", { retryable: false });
  const url = `${API}/search/repositories?q=${encodeURIComponent(q)}&per_page=${Math.max(1, Math.min(50, perPage))}&sort=stars&order=desc`;
  const { data } = await getJson<{ total_count?: number; items?: (ApiRepo & { name?: string })[] }>(url, ctx, { headers: headers(ctx) });
  const items = (data.items || []).map((r) => ({
    fullName: String(r.full_name || ""),
    description: r.description || undefined,
    stars: Number(r.stargazers_count ?? 0),
    language: r.language || undefined,
    pushedAt: r.pushed_at,
    url: String(r.html_url || `https://github.com/${r.full_name}`),
    archived: Boolean(r.archived),
    topics: Array.isArray(r.topics) ? r.topics : [],
  }));
  return { items: items.filter((i) => i.fullName), total: Number(data.total_count ?? items.length) };
}

export const GITHUB_CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  pagination: "partial",
  filters: ["sort", "listMode"],
  itemDetail: "supported",
  files: "partial",
  preview: "unsupported",
  license: "supported",
  notes: [
    "Public repositories, READMEs and curated lists are read through api.github.com, which allows browser calls and needs NO credential (60 requests/hour per address; a token only raises that).",
    "Releases are one fact among many. A curated list normally has none, and 'none' is a real answer - never an error and never a reason to refuse the URL.",
    "A README's relative links resolve against the repository's default branch, read from the API before the README, so `docs/x.md` becomes a working URL.",
    "Nested discovery is incremental and cancellable: the first lists are read, hits are reported as they arrive, and a cancel stops further reads.",
    "github.com HTML pages do not allow browser reads; they are never required, because the API returns the same data.",
  ],
};

function repoFacts(repo: GithubRepo): { label: string; value: string; fromProvider: boolean }[] {
  return [
    { label: "Repository", value: repo.fullName, fromProvider: true },
    { label: "Default branch", value: repo.defaultBranch, fromProvider: true },
    { label: "Stars", value: repo.stars.toLocaleString(), fromProvider: true },
    ...(repo.language ? [{ label: "Language", value: repo.language, fromProvider: true }] : []),
    ...(repo.license ? [{ label: "Licence", value: repo.license, fromProvider: true }] : []),
    ...(repo.pushedAt ? [{ label: "Last push", value: repo.pushedAt.slice(0, 10), fromProvider: true }] : []),
    ...(repo.homepage ? [{ label: "Homepage", value: repo.homepage, fromProvider: true }] : []),
    ...(repo.archived ? [{ label: "Archived", value: "yes - read-only repository", fromProvider: true }] : []),
  ];
}

function sectionsFromMarkdown(md: string, baseUrl: string, repoFullName: string, limit = 40): { sections: InspectOutcome["sections"]; items: number; categories: number } {
  const parsed = parseMarkdownSections(md, baseUrl);
  const sections: InspectOutcome["sections"] = [];
  let items = 0;
  let categories = 0;
  for (const s of parsed) {
    if (!s.links.length) continue;
    categories += 1;
    if (sections.length >= limit) break;
    const sectionItems: SectionItem[] = s.links.slice(0, 60).map((l) => ({
      title: l.title || l.url,
      url: l.url,
      note: l.description,
    }));
    items += sectionItems.length;
    sections.push({
      key: `readme-${categories}`,
      label: cleanHeading(s.title) || `Section ${categories}`,
      items: sectionItems,
      anchor: `${repoFullName} › ${cleanHeading(s.title) || `Section ${categories}`}`,
    });
  }
  return { sections, items, categories };
}

function listEntryHits(md: string, baseUrl: string, repoFullName: string, query: string, limit: number): ProviderHit[] {
  const parsed: MarkdownSection[] = parseMarkdownSections(md, baseUrl);
  const hits: ProviderHit[] = [];
  for (const s of parsed) {
    if (!s.links.length) continue;
    const section = cleanHeading(s.title);
    for (const l of s.links) {
      if (hits.length >= limit) return hits;
      if (!scoreMatch(`${l.title} ${section}`, `${l.description ?? ""}`, query)) continue;
      hits.push({
        id: `gh-list:${repoFullName}:${l.url}`,
        providerId: "github",
        kind: "list-entry",
        title: l.title || l.url,
        url: l.url,
        description: l.description ? truncate(l.description, 240) : undefined,
        source: { label: `README of ${repoFullName}${section ? ` › ${section}` : ""}`, url: `https://github.com/${repoFullName}#readme` },
        context: section ? [section] : [],
        extra: { origin: "curated-list", list: repoFullName },
      });
    }
  }
  return hits;
}

export interface GithubSearchOptions {
  query: string;
  limit?: number;
  /** Curated lists to mine after the repository search (bounded, incremental). */
  maxLists?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, label: string) => void;
}

/** Search: repositories by the provider's own index, then entries inside the
 *  most relevant curated lists. Each hit says which list it came from. */
export async function githubSearch(o: GithubSearchOptions, ctx: ProviderContext): Promise<SearchOutcome> {
  const started = Date.now();
  const limit = Math.max(1, Math.min(50, o.limit ?? 20));
  const notes: string[] = [];
  const { items, total } = await searchRepos(o.query, ctx, 10);
  const repoHits: ProviderHit[] = items.map((r) => ({
    id: `gh-repo:${r.fullName}`,
    providerId: "github",
    kind: "repo",
    title: r.fullName,
    url: r.url,
    description: r.description ? truncate(r.description, 260) : undefined,
    date: r.pushedAt ? r.pushedAt.slice(0, 10) : undefined,
    source: { label: "GitHub repository search", url: `https://github.com/search?q=${encodeURIComponent(o.query)}&type=repositories` },
    extra: {
      stars: r.stars,
      ...(r.language ? { language: r.language } : {}),
      ...(r.archived ? { archived: true } : {}),
    },
  }));
  notes.push(`${total.toLocaleString()} repositories match "${o.query}" (GitHub's own total).`);

  // Mine the curated lists among the top results: that is where the actual
  // resources live, and it is what the operator asked for.
  const isListName = (r: GithubSearchItem) => /(^|[-_/])awesome([-_/]|$)|(^|[-_/])lists?($|[-_/])/i.test(r.fullName.split("/")[1] || "");
  let listPool = items.filter(isListName);
  if (!listPool.length && !/\bawesome\b/i.test(o.query)) {
    // A curated list is often titled "awesome <topic>", so when the first page of
    // results has none, ask the provider for that exact phrase ONCE. This is a
    // real GitHub query, reported in the notes - never a guessed repository.
    try {
      const extra = await searchRepos(`${o.query} awesome`, ctx, 5);
      listPool = extra.items.filter(isListName);
      notes.push(`No curated list in the first results; searched "${o.query} awesome" and found ${listPool.length}.`);
    } catch (e) {
      notes.push(`The follow-up list search failed (${(e as ProviderError).code}).`);
    }
  }
  const lists = listPool.slice(0, Math.max(0, Math.min(3, o.maxLists ?? 1)));
  let mined = 0;
  // Entries from curated lists are the resources the operator is looking for, so
  // they get their own budget instead of competing with the repository list (a
  // plain repository search alone would use the whole limit and mine nothing).
  const entryBudget = Math.max(3, Math.floor(limit / 2));
  const entryHits: ProviderHit[] = [];
  for (const [i, list] of lists.entries()) {
    if (ctx.signal?.aborted) break;
    if (entryHits.length >= entryBudget) break;
    o.onProgress?.(i + 1, lists.length, list.fullName);
    const [owner, repo] = list.fullName.split("/");
    try {
      const repoInfo = await getRepo(owner, repo, ctx);
      const readme = await getReadme(owner, repo, repoInfo.defaultBranch, ctx);
      if (!readme) continue;
      const found = listEntryHits(readme.text, readme.baseUrl, repoInfo.fullName, o.query, entryBudget - entryHits.length);
      entryHits.push(...found);
      mined += 1;
      notes.push(`${repoInfo.fullName}: ${found.length} matching entr(ies) in its README.`);
    } catch (e) {
      notes.push(`${list.fullName}: list could not be read (${(e as ProviderError).code}).`);
    }
  }
  if (mined) notes.push(`Mined ${mined} curated list(s) incrementally; each entry names its list.`);
  const merged = [...entryHits, ...repoHits].slice(0, limit);

  return {
    hits: merged,
    totalReported: total,
    hasMore: total > items.length,
    appliedFilters: ["sort"],
    ignoredFilters: [],
    notes,
    tookMs: Date.now() - started,
  };
}

/** Inspect a repository, a README, or a curated list. */
export async function githubInspect(url: string, ctx: ProviderContext): Promise<InspectOutcome> {
  const started = Date.now();
  const ref = parseGithubUrl(url);
  if (!ref || !ref.owner || !ref.repo) {
    throw new ProviderError("UNSUPPORTED", "That GitHub URL does not address a repository, README or list.", { url, retryable: false });
  }
  const repo = await getRepo(ref.owner, ref.repo, ctx);
  const [readme, releases] = await Promise.all([
    getReadme(ref.owner, ref.repo, repo.defaultBranch, ctx),
    listReleases(ref.owner, ref.repo, ctx),
  ]);
  const facts = repoFacts(repo);
  const isList = ref.kind === "list" || /(^|[-_/])awesome([-_/]|$)/i.test(ref.repo) || (readme ? /curated list|awesome list/i.test(readme.text.slice(0, 4000)) : false);
  const markdown = readme ? sectionsFromMarkdown(readme.text, readme.baseUrl, repo.fullName) : { sections: [], items: 0, categories: 0 };

  facts.push({
    label: "Releases",
    value:
      releases.tags === null
        ? "unavailable (GitHub did not answer this request)"
        : releases.tags.length
          ? `${releases.tags.length} recent (latest ${releases.latest || releases.tags[0].tag})`
          : "none - this repository publishes no releases, which is normal for a curated list",
    fromProvider: releases.tags !== null,
  });
  facts.push({ label: "Categories", value: String(markdown.categories), fromProvider: true });
  facts.push({ label: "Listed resources", value: String(markdown.items), fromProvider: true });
  if (readme) facts.push({ label: "README", value: `${readme.path} @ ${readme.ref}`, fromProvider: true });
  if (ref.kind === "readme") facts.push({ label: "Requested view", value: "README (#readme)", fromProvider: false });
  if (ref.resolvedFrom) facts.push({ label: "Resolved from", value: `${ref.resolvedFrom} → github.com/${repo.fullName}`, fromProvider: false });

  const warnings: string[] = [];
  if (repo.archived) warnings.push("This repository is archived: its content is still readable, but it no longer changes.");

  return {
    providerId: "github",
    kind: isList ? "list" : ref.kind === "readme" ? "readme" : "repo",
    canonicalUrl: ref.kind === "readme" ? `${repo.htmlUrl}#readme` : repo.htmlUrl,
    title: repo.fullName,
    description: repo.description || (readme ? truncate(readme.text.replace(/[#*_>`]/g, " ").trim(), 240) : undefined),
    sections: markdown.sections,
    facts,
    addable: true,
    capabilities: GITHUB_CAPABILITIES,
    provenance: "live",
    tookMs: Date.now() - started,
  };
}
