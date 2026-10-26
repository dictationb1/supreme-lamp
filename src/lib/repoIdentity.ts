// [REPO-IDENTITY-2026-10-25] ONE source of truth for every product-visible
// repository link.
//
// WHAT WAS WRONG. Six shipped surfaces hard-coded `github.com/dekarita/supreme-lamp`
// while the deployed repository is `dictationb1/supreme-lamp`:
//   * src/pages/Search.tsx                       - the "learn more" documentation link
//   * src/lib/domain/native.ts (SECRETS_URL/ACTIONS_URL)
//   * src/components/domain/DashTokenGate.tsx    - "get a key from the run log"
//   * src/components/domain/F92VersionGate.tsx   - "re-dispatch main.yml"
//   * src/components/domain/WebDesktopCard.tsx   - the commit-drift probe
//   * src/pages/Collector.tsx                    - related-issue links
// The operator's screenshot shows the consequence: a 404 page whose URL still
// carried the old owner. Each of those surfaces gets its link from here now.
//
// TRUST MODEL (deliberate):
//   * the identity is BUILD configuration (`VITE_GHRDP_REPO`, baked by vite), with
//     a compiled-in default of the deployed repository;
//   * it is NEVER taken from a URL query parameter, a hash, localStorage or any
//     other value the page visitor controls - a link target must not be
//     attacker-selectable;
//   * a malformed configured value falls back to the default instead of producing
//     a broken link.
export const DEFAULT_REPO_SLUG = "dictationb1/supreme-lamp";

const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** Build-time configuration, read once. `import.meta.env` is absent in tests. */
function configuredSlug(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return String(env?.VITE_GHRDP_REPO || "").trim();
  } catch {
    return "";
  }
}

/** `owner/name`, validated. Never operator-controlled. */
export function repoSlug(): string {
  const cfg = configuredSlug();
  if (cfg && SLUG_RE.test(cfg) && !cfg.includes("..")) return cfg;
  return DEFAULT_REPO_SLUG;
}

export function repoUrl(): string {
  return "https://github.com/" + repoSlug();
}

/** A file/blob link. `ref` defaults to the default branch the app deploys from. */
export function fileUrl(path: string, ref = "main"): string {
  const clean = String(path || "").replace(/^\/+/, "");
  return repoUrl() + "/blob/" + encodeURIComponent(ref) + "/" + clean.split("/").map(encodeURIComponent).join("/");
}

/** A directory link (GitHub uses the same /tree/ shape for folders). */
export function dirUrl(path: string, ref = "main"): string {
  const clean = String(path || "").replace(/^\/+/, "");
  return repoUrl() + "/tree/" + encodeURIComponent(ref) + "/" + clean.split("/").map(encodeURIComponent).join("/");
}

export function actionsUrl(workflow?: string): string {
  const wf = String(workflow || "").trim();
  if (!wf) return repoUrl() + "/actions";
  return repoUrl() + "/actions/workflows/" + encodeURIComponent(wf);
}

/** Settings routes require an authenticated owner session; anonymous visitors get
 *  GitHub's login page, NOT a 404. Callers should label them accordingly. */
export function secretsUrl(): string {
  return repoUrl() + "/settings/secrets/actions";
}

export function issuesUrl(issueNumber?: string | number): string {
  const n = String(issueNumber ?? "").replace(/[^0-9]/g, "");
  return n ? repoUrl() + "/issues/" + n : repoUrl() + "/issues";
}

/** The public API endpoint used by the build-drift probe. */
export function commitsApiUrl(branch = "main"): string {
  return "https://api.github.com/repos/" + repoSlug() + "/commits/" + encodeURIComponent(branch);
}

/** Documentation files this application links to. Kept as a list so a test can
 *  prove each one EXISTS in the checkout (a 404 is worse than no link). */
export const DOC_LINKS = {
  projectContext: "PROJECT-CONTEXT-v2-CANONICAL.md",
  readme: "README.md",
  nextRunGuide: "NEXT-RUN-GUIDE-si.md",
  missionControl: "docs/mission-control/GHRDP-DELIVERY-TRACKER.md",
  // [SEARCH-REPAIR] the durable report for the search/source work, so every
  // "how it works" link points at a file that exists in THIS repository.
  searchRepair: "docs/reports/search-repair/README.md",
} as const;

export type DocLinkKey = keyof typeof DOC_LINKS;

export function docUrl(key: DocLinkKey): string {
  return fileUrl(DOC_LINKS[key]);
}
