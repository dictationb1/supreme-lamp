// [REPO-IDENTITY-2026-10-25] Product-visible links must point at the repository
// this application is deployed from (`dictationb1/supreme-lamp`).
//
// The operator's screenshot shows a 404 whose URL still carried the OLD owner.
// These tests make the identity a single, tested value and prove that no product
// source re-introduces a hard-coded owner, and that every documentation path the
// app links to actually exists in the checkout (a 404 is worse than no link).
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_REPO_SLUG,
  DOC_LINKS,
  actionsUrl,
  commitsApiUrl,
  dirUrl,
  docUrl,
  fileUrl,
  issuesUrl,
  repoSlug,
  repoUrl,
  secretsUrl,
} from "@/lib/repoIdentity";
import { ACTIONS_URL, SECRETS_URL } from "@/lib/domain/native";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("[REPO-IDENTITY] one identity, validated", () => {
  it("defaults to the deployed repository", () => {
    expect(DEFAULT_REPO_SLUG).toBe("dictationb1/supreme-lamp");
    expect(repoSlug()).toBe("dictationb1/supreme-lamp");
    expect(repoUrl()).toBe("https://github.com/dictationb1/supreme-lamp");
  });

  it("builds every product link from that slug", () => {
    expect(actionsUrl()).toBe("https://github.com/dictationb1/supreme-lamp/actions");
    expect(actionsUrl("main.yml")).toBe("https://github.com/dictationb1/supreme-lamp/actions/workflows/main.yml");
    expect(secretsUrl()).toBe("https://github.com/dictationb1/supreme-lamp/settings/secrets/actions");
    expect(issuesUrl("#73")).toBe("https://github.com/dictationb1/supreme-lamp/issues/73");
    expect(issuesUrl(undefined)).toBe("https://github.com/dictationb1/supreme-lamp/issues");
    expect(commitsApiUrl()).toBe("https://api.github.com/repos/dictationb1/supreme-lamp/commits/main");
    expect(fileUrl("docs/a b.md")).toBe("https://github.com/dictationb1/supreme-lamp/blob/main/docs/a%20b.md");
    expect(dirUrl("docs")).toBe("https://github.com/dictationb1/supreme-lamp/tree/main/docs");
  });

  it("the exported help constants follow the same identity", () => {
    expect(SECRETS_URL).toBe(secretsUrl());
    expect(ACTIONS_URL).toBe(actionsUrl());
  });

  it("every product source file is free of the stale owner", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (file.includes("/tests/")) continue;
      // Comments may NAME the old owner (this repair documents it); what matters
      // is that no code, href or fetch target uses it.
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (text.includes("dekarita/supreme-lamp")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("product code does not hard-code github.com repository URLs outside the identity module", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (file.includes("/tests/") || file.endsWith("src/lib/repoIdentity.ts")) continue;
      const text = readFileSync(file, "utf8");
      // github.com/<owner>/<repo> style repository URLs (fixtures in tests are exempt).
      if (/https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/(blob|tree|actions|issues|settings|pull|releases)/.test(text)) offenders.push(file);
      if (/api\.github\.com\/repos\/[A-Za-z0-9-]+\//.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("[REPO-IDENTITY] linked documentation exists in the checkout", () => {
  it("every DOC_LINKS path resolves to a real file", () => {
    for (const [key, path] of Object.entries(DOC_LINKS)) {
      expect(existsSync(path), key + " -> " + path + " must exist in the repository").toBe(true);
      // ...and the URL the app renders points at that exact path.
      expect(docUrl(key as keyof typeof DOC_LINKS)).toContain("/" + path);
    }
  });
});
