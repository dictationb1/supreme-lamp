// [SEARCH-REPAIR] GitHub provider: repositories, README/awesome lists, list
// entries, and releases - WITHOUT ever asking a public repository for a password.
//
// The defects this replaces:
//   * a curated list was queried as if its content were RELEASES, so
//     sindresorhus/awesome and ChessMax/awesome-programming-languages answered
//     "no results" (their content is a README, and `releases` is legitimately
//     empty - verified live: the releases endpoint returns `[]`);
//   * any GitHub failure surfaced as a credential prompt, so a public README
//     looked private;
//   * `awesome.re` was treated as a hostname-mismatch error instead of its real
//     canonical target (github.com/sindresorhus/awesome).
//
// Verified live on 2026-10-26 with an Origin header: api.github.com answers
// `access-control-allow-origin: *`, so the API is usable straight from the
// browser; github.com HTML and raw.githubusercontent.com are NOT, and this
// adapter therefore never needs them (README bytes come back base64 through the
// API). See docs/reports/search-repair/evidence/live-probe.json.
import { ProviderError, getJson, getResource, qs, type ProviderContext } from "./core";
import { dedupeLinks, matchesQuery, parseMarkdownSections, scoreMatch, truncate, type MarkdownLink } from "./text";
import type { InspectOutcome, ProviderCapabilities, ProviderHit, SearchOutcome } from "./types";

const API = "https://api.github.com";

/** Hosts whose content is really a GitHub repository's README. `awesome.re` is
 *  the one the operator reported: it is a redirect front door, not a content
 *  host, so resolving it here is the CORRECT canonical path (and it is why an
 *  "off-host redirect" is never the right answer for it). */
export const GITHUB_ALIASES: Record<string, string> = {
  "awesome.re": "sindresorhus/awesome",
  "www.awesome.re": "sindresorhus/awesome",
};

export interface GithubRef {
  owner: string;
  repo: string;
  /** Branch/tag/sha when the URL pinned one. */
  ref?: string;
  /** Path inside the repository (tree/blob URLs). */
  path?: string;
  kind: "repo" | "readme" | "file" | "releases" | "raw";
  /** The URL as given, for provenance. */
  rawUrl: string;
  /** Set when an alias was resolved. */
  resolvedFrom?: string;
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function parseGithubUrl(input: string): GithubRef | null {
  let u: URL;
  try {
    u = new URL(String(input || "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (host === "raw.githubusercontent.com" && segs.length >= 3) {
    return { owner: segs[0], repo: segs[1], ref: segs[2], path: segs.slice(3).join("/"), kind: "raw", rawUrl: u.toString() };
  }
  if (host === "api.github.com") {
    // https://api.github.com/repos/{o}/{r}[/...]
    if (segs[0] === "repos" && segs.length >= 3) {
      const tail = segs[3] || "";
      const kind = tail === "releases" ? "releases" : tail === "readme" ? "readme" : "repo";
      return { owner: segs[1], repo: segs[2], kind, rawUrl: u.toString() };
    }
    return null;
  }
  if (host === "github.com" || host === "www.github.com") {
    if (segs.length < 2) return null;
    const [owner, repo, third, ref, ...rest] = segs;
    if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null;
    const hash = (u.hash || "").toLowerCase();
    if (third === "releases") return { owner, repo, kind: "releases", rawUrl: u.toString() };
    if (third === "tree" && ref) {
      const kind = rest.length === 0 ? "repo" : "file";
      return { owner, repo, ref, path: rest.join("/"), kind, rawUrl: u.toString() };
    }
    if (third === "blob" && ref) return { owner, repo, ref, path: rest.join("/"), kind: "file", rawUrl: u.toString() };
    if (!third && (hash === "#readme" || hash === "#readme-ov-file" || hash === "" || u.search === "")) {
      return { owner, repo, kind: third || hash.includes("readme") ? "readme" : "repo", rawUrl: u.toString() };
    }
    return { owner, repo, kind: "repo", rawUrl: u.toString() };
  }
  if (GITHUB_ALIASES[host]) {
    const [owner, repo] = GITHUB_ALIASES[host].split("/");
    return { owner, repo, kind: "readme", rawUrl: u.toString(), resolvedFrom: host };
  }
  return null;
}

function ghHeaders(ctx: ProviderContext, accept = "application/vnd.github+json"): Record<string, string> {
  const h: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // OPTIONAL. Public content NEVER needs this: the token only raises the
  // anonymous rate limit (60/h per IP) and reaches private repositories the
  // operator explicitly configured.
  if (ctx.githubToken) h.Authorization = `Bearer ${ctx.githubToken}`;
  return h;
}

async function ghGet<T>(path: string, ctx: ProviderContext): Promise<T> {
  try {
    const { data } = await getJson<T>(`${API}${path}`, ctx, { headers: ghHeaders(ctx) });
    return data;
  } catch (e) {
    if (e instanceof ProviderError && e.code === "NOT_FOUND") {
      throw new ProviderError(
        "NOT_FOUND",
        "GitHub reports this repository/page does not exist, or it is private. Public repositories and READMEs need no credentials.",
        { status: 404, url: `${API}${path}`, retryable: false }
      );
    }
    throw e;
  }
}

export interface GithubRepo {
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  html_url: string;
  default_branch: string;
  stars: number;
  topics?: string[];
  license?: { spdx_id?: string | null; name?: string | null; url?: string | null } | null;
  pushed_at?: string | null;
  archived?: boolean;
  homepage?: string | null;
  fork?: boolean;
  has_downloads?: boolean;
  size?: number;
  open_issues?: number;
}

export async function getRepo(owner: string, repo: string, ctx: ProviderContext): Promise<GithubRepo> {
  const raw = await ghGet<Record<string, unknown>>(`/repos/${owner}/${repo}`, ctx);
  const lic = raw.license as { spdx_id?: string; name?: string; url?: string } | null;
  return {
    full_name: String(raw.full_name ?? `${owner}/${repo}`),
    name: String(raw.name ?? repo),
    owner: String((raw.owner as { login?: string } | undefined)?.login ?? owner),
    description: (raw.description as string | null) ?? null,
    html_url: String(raw.html_url ?? `https://github.com/${owner}/${repo}`),
    default_branch: String(raw.default_branch ?? "main"),
    stars: Number(raw.stargazers_count ?? 0),
    topics: Array.isArray(raw.topics) ? (raw.topics as string[]) : undefined,
    license: lic ? { spdx_id: lic.spdx_id ?? null, name: lic.name ?? null, url: lic.url ?? null } : null,
    pushed_at: (raw.pushed_at as string | null) ?? null,
    archived: Boolean(raw.archived),
    homepage: (raw.homepage as string | null) ?? null,
    fork: Boolean(raw.fork),
    has_downloads: Boolean(raw.has_downloads),
    size: typeof raw.size === "number" ? raw.size : undefined,
    open_issues: typeof raw.open_issues_count === "number" ? raw.open_issues_count : undefined,
  };
}

export interface ReadmeDoc {
  text: string;
  path: string;
  htmlUrl: string;
  bytes: number;
}

function decodeBase64(b64: string): string {
  const clean = b64.replace(/\s+/g, "");
  if (typeof atob === "function") {
    try {
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      /* fall through to the Buffer path (node tests) */
    }
  }
  const buf = (globalThis as unknown as { Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } } }).Buffer;
  if (buf) return buf.from(clean, "base64").toString("utf-8");
  return "";
}

export async function getReadme(owner: string, repo: string, ctx: ProviderContext, ref?: string): Promise<ReadmeDoc | null> {
  const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  let raw: Record<string, unknown>;
  try {
    raw = await ghGet<Record<string, unknown>>(`/repos/${owner}/${repo}/readme${suffix}`, ctx);
  } catch (e) {
    if (e instanceof ProviderError && e.code === "NOT_FOUND") return null; // no README is valid
    throw e;
  }
  const encoding = String(raw.encoding ?? "");
  const content = String(raw.content ?? "");
  let text: string;
  if (encoding === "base64" && content) text = decodeBase64(content);
  else if (encoding === "none" && typeof raw.download_url === "string") {
    // Extremely large files answer `encoding: none`; the download host has no
    // CORS, so this is the one place a relay is genuinely required.
    const res = await getResource(String(raw.download_url), ctx, { transport: "auto" });
    text = res.text;
  } else text = "";
  if (!text.trim()) return null;
  return {
    text,
    path: String(raw.path ?? "README.md"),
    htmlUrl: String(raw.html_url ?? `https://github.com/${owner}/${repo}#readme`),
    bytes: Number(raw.size ?? text.length),
  };
}

export interface ReleaseInfo {
  count: number;
  latest?: { tag: string; name: string; url: string; publishedAt?: string; assets: { name: string; sizeBytes: number; url: string }[] };
}

/** A repository whose content is its README legitimately has ZERO releases.
 *  Empty is a VALID answer here, and the caller must render it as such. */
export async function listReleases(owner: string, repo: string, ctx: ProviderContext): Promise<ReleaseInfo> {
  const arr = await ghGet<Record<string, unknown>[]>(`/repos/${owner}/${repo}/releases?per_page=5`, ctx);
  if (!Array.isArray(arr) || arr.length === 0) return { count: 0 };
  const first = arr[0];
  const assets = Array.isArray(first.assets)
    ? (first.assets as Record<string, unknown>[]).map((a) => ({
        name: String(a.name ?? ""),
        sizeBytes: Number(a.size ?? 0),
        url: String(a.browser_download_url ?? ""),
      }))
    : [];
  return {
    count: arr.length,
    latest: {
      tag: String(first.tag_name ?? ""),
      name: String(first.name ?? first.tag_name ?? ""),
      url: String(first.html_url ?? `https://github.com/${owner}/${repo}/releases`),
      publishedAt: (first.published_at as string | undefined) ?? undefined,
      assets,
    },
  };
}

export interface GithubSearchItem {
  full_name: string;
  description: string | null;
  html_url: string;
  stars: number;
  topics?: string[];
  pushed_at?: string;
  default_branch?: string;
  license?: { spdx_id?: string | null } | null;
}

export async function searchRepos(query: string, ctx: ProviderContext, limit = 10): Promise<{ items: GithubSearchItem[]; total: number }> {
  const path = `/search/repositories?${qs({ q: query, per_page: Math.min(30, limit), sort: "stars", order: "desc" })}`;
  const data = await ghGet<{ total_count?: number; items?: Record<string, unknown>[] }>(path, ctx);
  const items = (data.items ?? []).map((r) => ({
    full_name: String(r.full_name ?? ""),
    description: (r.description as string | null) ?? null,
    html_url: String(r.html_url ?? ""),
    stars: Number(r.stargazers_count ?? 0),
    topics: Array.isArray(r.topics) ? (r.topics as string[]) : undefined,
    pushed_at: (r.pushed_at as string | undefined) ?? undefined,
    default_branch: (r.default_branch as string | undefined) ?? undefined,
    license: (r.license as { spdx_id?: string | null } | null) ?? null,
  }));
  return { items, total: Number(data.total_count ?? items.length) };
}

export const GITHUB_CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  inspect: "supported",
  filters: ["language", "topic", "minimumStars", "sort", "listMode"],
  pagination: "partial",
  itemDetails: "supported",
  downloads: "supported",
  preview: "unsupported",
  attribution: "supported",
  nestedLists: "supported",
  notes: [
    "Public repositories and READMEs are read with the GitHub REST API and need no credentials.",
    "A token is OPTIONAL: it raises the 60 requests/hour anonymous limit and reaches private repositories only if you add one.",
    "'No releases' is a valid answer for a list repository - its content is the README, not a release.",
    "awesome.re resolves to github.com/sindresorhus/awesome, its documented canonical target.",
    "Release assets are listed only when the repository actually publishes releases.",
  ],
};

function licenseFromRepo(repo: GithubRepo): ProviderHit["license"] | undefined {
  if (!repo.license) return undefined;
  const spdx = (repo.license.spdx_id || "").toUpperCase();
  if (!spdx || spdx === "NOASSERTION") return undefined;
  return {
    tag: spdx.includes("CC") ? "creative-commons" : spdx.includes("GPL") || spdx.includes("MIT") || spdx.includes("APACHE") || spdx.includes("BSD") || spdx.includes("MPL") ? "open-access" : "open-access",
    name: repo.license.name ?? spdx,
    url: repo.license.url ?? undefined,
    attribution: `${repo.full_name} - ${repo.license.name ?? spdx}`,
  };
}

function repoHit(repo: GithubRepo, providerId: string): ProviderHit {
  return {
    id: `repo:${repo.full_name.toLowerCase()}`,
    providerId,
    kind: "repository",
    title: repo.full_name,
    description: repo.description ?? undefined,
    creator: repo.owner,
    date: repo.pushed_at ?? undefined,
    url: repo.html_url,
    license: licenseFromRepo(repo),
    source: { label: `GitHub repository ${repo.full_name}`, url: repo.html_url },
    extra: {
      stars: repo.stars,
      defaultBranch: repo.default_branch,
      ...(repo.topics && repo.topics.length ? { topics: repo.topics.slice(0, 8).join(", ") } : {}),
      ...(repo.archived ? { archived: true } : {}),
    },
    provenance: "live",
  };
}

function listEntryHit(link: MarkdownLink, repo: GithubRepo, providerId: string, listRef: MarkdownLink[]): ProviderHit {
  const sameTargets = listRef.filter((l) => l.url === link.url).length;
  return {
    id: `entry:${repo.full_name.toLowerCase()}:${link.url}`,
    providerId,
    kind: "list-entry",
    title: link.title,
    description: link.description,
    date: repo.pushed_at ?? undefined,
    url: link.url,
    source: {
      label: `README of ${repo.full_name}${link.section.length ? ` › ${link.section.join(" › ")}` : ""}`,
      url: `${repo.html_url}#readme`,
    },
    context: link.section,
    extra: {
      list: repo.full_name,
      ...(link.section.length ? { category: link.section.join(" › ") } : {}),
      ...(sameTargets > 1 ? { mentionedTimes: sameTargets } : {}),
    },
    provenance: "live",
  };
}

/** Which READMEs to mine for a query: repositories GitHub already ranks for it
 *  that look like curated lists. Bounded on purpose - the crawl is incremental
 *  and cancellable, and the bound is reported to the caller. */
async function candidateLists(query: string, ctx: ProviderContext, limit: number, maxLists: number): Promise<GithubSearchItem[]> {
  const { items } = await searchRepos(`${query} awesome in:name,description,readme`, ctx, limit);
  const scored = items
    .map((it) => {
      const name = it.full_name.toLowerCase();
      let score = 0;
      if (/awesome/.test(name)) score += 30;
      if ((it.topics || []).some((t) => /awesome|list|curated/.test(t))) score += 15;
      if (/list|collection|curated/.test(it.description || "")) score += 8;
      score += Math.min(20, Math.log10(Math.max(1, it.stars)) * 6);
      return { it, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, maxLists).map((s) => s.it);
}

async function readList(repo: GithubSearchItem, ctx: ProviderContext): Promise<MarkdownLink[]> {
  const readme = await getReadme(repo.full_name.split("/")[0], repo.full_name.split("/")[1], ctx, repo.default_branch);
  if (!readme) return [];
  const base = `${repo.html_url}/blob/${repo.default_branch}/`;
  const sections = parseMarkdownSections(readme.text, base);
  const all: MarkdownLink[] = [];
  for (const s of sections) all.push(...s.links);
  return dedupeLinks(all.filter((l) => !l.url.startsWith(repo.html_url)));
}

export async function githubSearch(
  req: { query: string; limit?: number; maxLists?: number; signal?: AbortSignal },
  ctx: ProviderContext,
  providerId = "github"
): Promise<SearchOutcome> {
  const started = Date.now();
  const limit = req.limit ?? 20;
  const maxLists = req.maxLists ?? 3;
  const query = String(req.query || "").trim();
  const hits: ProviderHit[] = [];
  const notes: string[] = [];
  const appliedFilters: string[] = [];

  // A pasted URL is not a search: hand it to inspect (the caller does that) but
  // still answer with the repository so the lane never returns nothing.
  const ref = parseGithubUrl(query);
  if (ref) {
    const repo = await getRepo(ref.owner, ref.repo, ctx);
    hits.push(repoHit(repo, providerId));
    const links = await readList(
      { full_name: repo.full_name, description: repo.description, html_url: repo.html_url, stars: repo.stars, default_branch: repo.default_branch },
      ctx
    );
    for (const l of links.slice(0, limit)) {
      hits.push(listEntryHit(l, repo, providerId, links));
    }
    notes.push(`Inspected ${repo.full_name} directly (URL input, not a search).`);
    return {
      hits,
      hasMore: links.length > limit,
      appliedFilters,
      ignoredFilters: [],
      notes,
      tookMs: Date.now() - started,
    };
  }

  const repoLimit = Math.max(5, Math.min(15, Math.floor(limit / 2)));
  const { items, total } = await searchRepos(query, ctx, repoLimit);
  appliedFilters.push("sort=stars", "repoSearch");
  const listCandidates = await candidateLists(query, ctx, 12, maxLists);

  const seenRepos = new Set<string>();
  for (const it of [...listCandidates, ...items]) {
    const key = it.full_name.toLowerCase();
    if (seenRepos.has(key) || seenRepos.size >= maxLists + repoLimit) continue;
    seenRepos.add(key);
    const repo: GithubRepo = {
      full_name: it.full_name,
      name: it.full_name.split("/")[1] || it.full_name,
      owner: it.full_name.split("/")[0] || "",
      description: it.description,
      html_url: it.html_url,
      default_branch: it.default_branch || "main",
      stars: it.stars,
      topics: it.topics,
      license: it.license ? { spdx_id: it.license.spdx_id ?? null, name: null, url: null } : null,
      pushed_at: it.pushed_at ?? null,
    };
    hits.push(repoHit(repo, providerId));
  }

  // Mine the curated lists: incremental, cancellable, observable.
  let mined = 0;
  for (const cand of listCandidates) {
    if (ctx.signal?.aborted) break;
    if (hits.length >= limit) break;
    mined += 1;
    ctx.onProgress?.({ providerId, stage: "list", message: `Reading ${cand.full_name}`, done: mined, total: listCandidates.length });
    let links: MarkdownLink[] = [];
    try {
      links = await readList(cand, ctx);
    } catch (e) {
      if (e instanceof ProviderError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) {
        notes.push(`${cand.full_name}: README unavailable (${e.code}).`);
        continue;
      }
      throw e;
    }
    const repo = {
      full_name: cand.full_name,
      name: cand.full_name.split("/")[1] || cand.full_name,
      owner: cand.full_name.split("/")[0] || "",
      description: cand.description,
      html_url: cand.html_url,
      default_branch: cand.default_branch || "main",
      stars: cand.stars,
      topics: cand.topics,
      license: cand.license ? { spdx_id: cand.license.spdx_id ?? null, name: null, url: null } : null,
      pushed_at: cand.pushed_at ?? null,
    } as GithubRepo;
    const matches = links
      .filter((l) => matchesQuery(`${l.title} ${l.description ?? ""} ${l.section.join(" ")}`, query))
      .map((l) => ({ link: l, score: scoreMatch(l.title, `${l.description ?? ""} ${l.section.join(" ")}`, query) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(3, Math.floor(limit / 2)));
    for (const { link } of matches) hits.push(listEntryHit(link, repo, providerId, links));
    if (matches.length) notes.push(`${cand.full_name}: ${matches.length} of ${links.length} listed resources match.`);
  }
  if (listCandidates.length) {
    notes.push(`Mined ${mined} curated list README(s) of ${listCandidates.length} candidate(s).`);
  }

  return {
    hits,
    totalReported: total,
    hasMore: hits.length >= limit,
    appliedFilters,
    ignoredFilters: [],
    notes,
    tookMs: Date.now() - started,
  };
}

export async function githubInspect(url: string, ctx: ProviderContext, providerId = "github"): Promise<InspectOutcome> {
  const started = Date.now();
  const ref = parseGithubUrl(url);
  if (!ref) {
    throw new ProviderError("UNSUPPORTED", "That is not a GitHub repository, README or release URL.", { url, retryable: false });
  }
  const repo = await getRepo(ref.owner, ref.repo, ctx);
  const facts: InspectOutcome["facts"] = [
    { label: "Repository", value: repo.full_name },
    { label: "Default branch", value: repo.default_branch },
    { label: "Stars", value: String(repo.stars) },
  ];
  if (repo.license?.spdx_id) facts.push({ label: "Licence", value: repo.license.spdx_id });
  if (repo.pushed_at) facts.push({ label: "Last push", value: repo.pushed_at.slice(0, 10) });
  if (repo.archived) facts.push({ label: "Archived", value: "yes" });
  if (ref.resolvedFrom) facts.push({ label: "Resolved from", value: `${ref.resolvedFrom} → ${repo.html_url}` });

  const sections: InspectOutcome["sections"] = [];
  let readme = null as Awaited<ReturnType<typeof getReadme>>;
  try {
    readme = await getReadme(ref.owner, ref.repo, ctx, ref.ref);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    facts.push({ label: "README", value: `unavailable (${e.code})` });
  }
  if (readme) {
    facts.push({ label: "README", value: `${readme.path} · ${Math.round(readme.bytes / 1024)} KB` });
    const parsed = parseMarkdownSections(readme.text, `${repo.html_url}/blob/${ref.ref || repo.default_branch}/`);
    let total = 0;
    for (const sec of parsed) {
      const links = dedupeLinks(sec.links);
      total += links.length;
      if (!links.length) continue;
      sections.push({
        key: sec.title || "root",
        label: sec.title || "Top of README",
        items: links.slice(0, 200).map((l) => ({
          title: l.title,
          url: l.url,
          description: l.description,
          meta: truncate(l.section.join(" › "), 80) || undefined,
        })),
      });
    }
    facts.push({ label: "Listed resources", value: String(total) });
    facts.push({ label: "Categories", value: String(sections.length) });
  }

  // Releases are reported HONESTLY: a list repo has none, and that is not error.
  try {
    const rel = await listReleases(ref.owner, ref.repo, ctx);
    facts.push({ label: "Releases", value: rel.count === 0 ? "none (valid empty)" : `${rel.count} recent` });
    if (rel.latest) {
      facts.push({ label: "Latest release", value: rel.latest.tag || "(untagged)" });
      const assets = rel.latest.assets.filter((a) => a.name);
      if (assets.length) {
        sections.push({
          key: "releases",
          label: "Release assets",
          items: assets.map((a) => ({ title: a.name, url: a.url, meta: `${Math.round(a.sizeBytes / 1024)} KB` })),
        });
      }
    }
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    facts.push({ label: "Releases", value: `unavailable (${e.code})` });
  }

  return {
    providerId,
    kind: ref.kind === "readme" ? "readme" : ref.kind,
    canonicalUrl: repo.html_url,
    title: repo.full_name,
    description: repo.description ?? undefined,
    date: repo.pushed_at ?? undefined,
    creator: repo.owner,
    license: licenseFromRepo(repo),
    sections,
    facts,
    addable: ref.kind !== "file" && ref.kind !== "raw",
    notAddableReason: ref.kind === "file" || ref.kind === "raw" ? "A single file is not a searchable source; add the repository instead." : undefined,
    capabilities: GITHUB_CAPABILITIES,
    tookMs: Date.now() - started,
  };
}
