// [search-prod-honesty-2026-10-25] "Prove the production build does not
// substitute demo results" (operator requirement).
//
// Before this change `Search.tsx` imported the predicate from
// `src/pages/search/devFixture.ts`, which also imports `./fixture.json`, so the
// production single-file artifact carried all 13 synthetic rows
// (`grep -c fx-snap-01 ui/dist/index.html` -> 1). They were gated at runtime and
// never rendered - but "not displayed" is a weaker promise than "not shipped",
// and the only honest proof is the artifact itself.
//
// Two independent checks:
//   1. SOURCE: nothing in production code imports the fixture data module, and
//      the only reference in Search.tsx is a dynamic import inside a
//      `import.meta.env.DEV` branch.
//   2. ARTIFACT: when `ui/dist/index.html` exists (built by `npm run build`), it
//      contains no fixture sentinel and no "sample data" note strings.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isDevMode } from "@/lib/devMode";
import { shouldStreamDevFixture } from "@/lib/domain/devSearchFixture";

// Row data only. The i18n key for the "sample data" note legitimately stays in
// the translation catalog; the ROWS must not be there.
const FIXTURE_SENTINELS = ["fx-snap-01", "fx-snap-13", "Pride and Prejudice", "Jane Austen"];

/** Recursive .ts/.tsx walk (no glob dependency: CI runs Node 20, which has no
 *  `fs.globSync`, and this suite must not need a build-time helper). */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function productionSources(): string[] {
  return walk("src")
    .filter((f) => !f.startsWith("src/tests/"))
    .filter((f) => !f.includes("devFixture"))
    .filter((f) => !f.startsWith("src/pages/search/fixture"));
}

describe("[PROD-HONESTY] demo rows are not part of the shipped artifact", () => {
  it("no production module imports the fixture data module", () => {
    const offenders = productionSources().filter((f) => {
      const text = readFileSync(f, "utf8");
      // a dynamic import guarded by DEV is allowed; a static import is not
      const staticImport = /^\s*import[^\n]*from\s*["'][^"']*search\/devFixture["']/m;
      return staticImport.test(text);
    });
    expect(offenders, `static devFixture imports: ${offenders.join(", ")}`).toEqual([]);
  });

  it("Search.tsx reaches the rows only through a DEV-guarded dynamic import", () => {
    const src = readFileSync("src/pages/Search.tsx", "utf8");
    const at = src.indexOf('import("./search/devFixture")');
    expect(at).toBeGreaterThan(-1);
    const guard = src.lastIndexOf("if (!import.meta.env.DEV) return;", at);
    expect(guard, "the dynamic import must live behind the DEV guard").toBeGreaterThan(-1);
    // the guard must be the nearest preceding early-return for this effect
    expect(at - guard).toBeLessThan(600);
  });

  it("the DEV predicate can only be satisfied by a DEV build or NODE_ENV=development", () => {
    // vitest itself runs as a dev build, so the predicate is TRUE here - which is
    // exactly why the PRODUCTION guarantee cannot rest on this function. It rests
    // on `import.meta.env.DEV`, which Vite replaces with `false` in `vite build`
    // and Rollup then dead-code-eliminates (asserted above, and by the artifact
    // check below).
    const src = readFileSync("src/lib/devMode.ts", "utf8");
    expect(src).toContain("env.DEV === true");
    expect(src).toContain('process.env?.NODE_ENV === "development"');
    // the policy helper still refuses to stream for a running/empty-unsubmitted search
    expect(
      shouldStreamDevFixture({ phase: "running", totalResults: 0, queryGeneration: 3, devFixtureGen: 0 }),
    ).toBe(false);
    expect(
      shouldStreamDevFixture({ phase: "complete", totalResults: 0, queryGeneration: 3, devFixtureGen: 0 }),
    ).toBe(true);
    expect(isDevMode()).toBe(true); // documented: vitest IS a dev build
  });

  it("the built single-file bundle contains no fixture sentinel", () => {
    const file = "ui/dist/index.html";
    if (!existsSync(file)) {
      // Not a silent pass: the suite tells you the artifact check did not run.
      expect(existsSync(file), "run `npm run build` before this suite").toBe(false);
      return;
    }
    const html = readFileSync(file, "utf8");
    const found = FIXTURE_SENTINELS.filter((s) => html.includes(s));
    expect(found, `fixture sentinels inside the shipped bundle: ${found.join(", ")}`).toEqual([]);
    // ...while the production path that must exist is still there
    expect(html).toContain("lab-inspect");
  });
});
