// [V3-01 / REGRESSION] The Tinted/Clear preference must reach the whole workspace.
//
// WHY THIS FILE EXISTS, AND WHAT IT CAUGHT.
//
// The material model was fixed first: nested fill floors were replaced with
// levels and additive deltas, and DESIGN-SYSTEM.md recorded the numbers. The
// unit tests on `quality.ts` went green. And in the real browser, Tinted and
// Clear STILL produced identical cards.
//
// The measurement (scripts/v3-screenshots.cjs, then a direct probe) showed
// cards at `--glass-alpha: 0.825` in BOTH variants: individual components were
// passing `variant="tinted"` / `variant="clear"` straight into <GlassContainer>,
// which overrides `prefVariant` at
//   `const variant = variantProp ?? prefVariant;`
// So the operator's choice was honoured by the model and discarded by the
// wiring - the defect the operator reported ("the control changes ~56px of
// chrome and nothing else") survived its own fix, one layer up.
//
// This file is the guard against that class of regression. It fails the moment
// any production component pins a variant, because pinning is only legitimate
// in the lab (which exists to show fixed samples) and in tests (which exist to
// pin inputs).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);
/** The lab shows FIXED samples by design; tests pin inputs by design. */
const EXEMPT = /[/\\](lab|tests)[/\\]/;

describe("V3-01-e: no production component pins the glass variant", () => {
  it("finds the source tree", () => {
    // A guard that silently scans nothing is worse than no guard.
    expect(FILES.length, "src tree not found under " + SRC).toBeGreaterThan(200);
  });

  it("no production GlassContainer pins variant to a literal", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (EXEMPT.test(f)) continue;
      const src = readFileSync(f, "utf8");
      // Only the region of each JSX opening tag, so a prose mention of
      // `variant="tinted"` in a comment cannot fail the build.
      src.split("\n").forEach((line, i) => {
        if (!/<\/?[A-Z]/.test(line) && !/^\s*variant\s*=/.test(line)) return;
        if (/variant\s*=\s*"(tinted|clear)"/.test(line)) {
          offenders.push(`${f.replace(process.cwd(), ".")}:${i + 1}: ${line.trim().slice(0, 70)}`);
        }
      });
    }
    expect(
      offenders,
      "these components override the operator's Tinted/Clear choice - use a LEVEL to separate nested surfaces instead:\n  " +
        offenders.join("\n  ")
    ).toEqual([]);
  });

  it("no production component defaults the variant prop to a literal", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (EXEMPT.test(f)) continue;
      if (f.includes("stores" + require("node:path").sep + "prefsStore")) continue;
      const src = readFileSync(f, "utf8");
      // `variant = "tinted"` in a destructured props default silently pins every
      // call site that does not pass one - which is how Panel.tsx pinned Overview.
      src.split("\n").forEach((line, i) => {
        if (/^\s*variant\s*=\s*"(tinted|clear)"\s*,?\s*$/.test(line)) {
          offenders.push(`${f.replace(process.cwd(), ".")}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "a defaulted variant prop overrides the store for every call site that omits it:\n  " + offenders.join("\n  ")
    ).toEqual([]);
  });

  it("Data.tsx lets an omitted variant fall through to the store", () => {
    const s = readFileSync(join(SRC, "components/primitives/Data.tsx"), "utf8");
    expect(s).not.toMatch(/variant=\{variant\s*\|\|/);
  });
});

describe("V3-01-f: the levels express nesting, so variants do not have to", () => {
  it("a nested surface is separated by a LEVEL, not by a variant", () => {
    // WorkspaceGrid used `variant="clear"` on tiles inside a `variant="tinted"`
    // container purely to make them read as nested. Levels own that now: the
    // tile sits one step deeper (row) and both follow the preference.
    const s = readFileSync(join(SRC, "components/overview/WorkspaceGrid.tsx"), "utf8");
    expect(s).not.toMatch(/variant\s*=\s*"/);
    expect(s, "the workspace tile should be a deeper level, not a different variant").toMatch(/level="row"/);
    expect(s).toMatch(/level="card"/);
  });
});
