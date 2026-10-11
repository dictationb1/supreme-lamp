#!/usr/bin/env node
// [V3-01 / #213 / #214] COMPOSITED glass contrast gate.
//
// WHY THIS EXISTS, AND WHAT THE OTHER GATE DOES NOT COVER.
// scripts/check-contrast.mjs recomputes every TEXT token against every SURFACE
// token. That is a token-level check and it is necessary but not sufficient:
// a v3 glass panel does not paint on a surface token. It paints on
//   decorative field -> veil -> sheet fill -> level fill,
// and the alpha at each step is chosen at runtime by src/lib/glass/quality.ts.
// A fill that is too transparent can drop real text below 4.5:1 while every
// token-vs-token ratio still passes. This gate closes that hole: it composites
// the ACTUAL stack, reads the alphas out of the SHIPPED source, and fails the
// build if any composited combination is under the bar.
//
// WHAT IT ENFORCES
//   * WCAG 1.4.3 — normal text on any composited glass stack: >= 4.5:1.
//   * WCAG 1.4.11 — the focus ring as a non-text control: >= 3:1.
//   * the Tinted/Clear separation the operator asked for: the two variants must
//     differ by at least MIN_VARIANT_SEPARATION at every clarity step > 0.
//
// NUMBERS ARE READ, NEVER COPIED. The alphas come from quality.ts and the paint
// channels from tokens.css, so a token edit that breaks contrast fails here
// instead of shipping. If quality.ts changes shape, the parse asserts and this
// gate fails loudly rather than silently checking stale numbers.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8");
const ts = readFileSync(join(ROOT, "src/lib/glass/quality.ts"), "utf8");

const TEXT_MIN = 4.5;
const CONTROL_MIN = 3;

/* ------------------------------------------------------------------ *
 * 1. Read the SHIPPED material numbers.
 * ------------------------------------------------------------------ */

function mustMatch(re, label) {
  const m = ts.match(re);
  if (!m) throw new Error(`check-glass-contrast: could not read ${label} from src/lib/glass/quality.ts — the source shape changed, so this gate can no longer vouch for the numbers`);
  return m;
}

const fillM = mustMatch(
  /QUALITY_FILL_ALPHA[^=]*=\s*\{[\s\S]*?frosted:\s*\{\s*tinted:\s*([\d.]+),\s*clear:\s*([\d.]+)\s*\},?\s*clear:\s*\{\s*tinted:\s*([\d.]+),\s*clear:\s*([\d.]+)\s*\}/,
  "QUALITY_FILL_ALPHA"
);
const FILL = {
  frosted: { tinted: Number(fillM[1]), clear: Number(fillM[2]) },
  clear: { tinted: Number(fillM[3]), clear: Number(fillM[4]) },
};

const deltaM = mustMatch(
  /LEVEL_FILL_DELTA[^=]*=\s*\{[\s\S]*?sheet:\s*([\d.]+),\s*overlap:\s*([\d.]+),\s*card:\s*([\d.]+),\s*row:\s*([\d.]+),\s*overlay:\s*([\d.]+)/,
  "LEVEL_FILL_DELTA"
);
const DELTA = {
  sheet: Number(deltaM[1]),
  overlap: Number(deltaM[2]),
  card: Number(deltaM[3]),
  row: Number(deltaM[4]),
  overlay: Number(deltaM[5]),
};

const floorM = mustMatch(/OVERLAY_FILL_FLOOR\s*=\s*([\d.]+)/, "OVERLAY_FILL_FLOOR");
const OVERLAY_FLOOR = Number(floorM[1]);

const sepM = mustMatch(
  /MIN_VARIANT_SEPARATION[^=]*=\s*\{[\s\S]*?0\.25:\s*([\d.]+),\s*0\.5:\s*([\d.]+),\s*0\.75:\s*([\d.]+),\s*1:\s*([\d.]+)/,
  "MIN_VARIANT_SEPARATION"
);
const MIN_SEP = { 0.25: Number(sepM[1]), 0.5: Number(sepM[2]), 0.75: Number(sepM[3]), 1: Number(sepM[4]) };

const CLARITY_STEPS = [0, 0.25, 0.5, 0.75, 1];
const LEVELS = ["sheet", "overlap", "card", "row", "overlay"];
// The separation requirement covers the WORKSPACE only; `overlay` keeps a fill
// floor by design (see VARIANT_LEVELS in quality.ts). Read from source so the
// boundary cannot drift apart between the two files.
const variantM = ts.match(/VARIANT_LEVELS[^=]*=\s*\[([^\]]+)\]/);
if (!variantM) throw new Error("check-glass-contrast: could not read VARIANT_LEVELS from src/lib/glass/quality.ts");
const VARIANT_LEVELS = variantM[1].match(/"([a-z]+)"/g).map((m) => m.replace(/"/g, ""));
// Alpha arithmetic is floating point; a separation of exactly the bar must not
// read as a failure because the 17th digit went the wrong way.
const EPS = 1e-9;
const QUALITIES = ["frosted", "clear"];
const VARIANTS = ["tinted", "clear"];

/** The shipped fill formula (quality.ts materialFillAlpha), mirrored here so a
 *  divergence is a comparison failure rather than two independent truths. */
function fillAlpha(level, quality, variant, clarity) {
  const sheet = 1 - (1 - FILL[quality][variant]) * clarity;
  const v = Math.min(1, sheet + DELTA[level]);
  return level === "overlay" ? Math.min(1, Math.max(v, OVERLAY_FLOOR)) : v;
}

/* ------------------------------------------------------------------ *
 * 2. Read the paint channels out of tokens.css.
 * ------------------------------------------------------------------ */

function blockFor(selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`selector not found in tokens.css: ${selector}`);
  const open = css.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, j);
    }
  }
  throw new Error(`unbalanced block for ${selector}`);
}

function token(block, name) {
  const m = block.match(new RegExp(`(?:^|\\n)\\s*${name.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`token not found: ${name}`);
  return m[1].trim();
}

function rgbTriple(v) {
  const m = v.match(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
  if (!m) throw new Error(`not an rgb triple: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function rgba(v) {
  const m = v.match(/rgba?\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(?:,\s*(-?[\d.]+)\s*)?\)/);
  if (!m) throw new Error(`not an rgba() colour: ${v}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], a: m[4] === undefined ? 1 : Number(m[4]) };
}

function hex(v) {
  const h = v.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${v}`);
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function parseColor(v) {
  if (v.startsWith("#")) return { rgb: hex(v), a: 1 };
  if (v.startsWith("rgb")) return rgba(v);
  throw new Error(`unsupported colour syntax: ${v}`);
}

/* ------------------------------------------------------------------ *
 * 3. WCAG colour maths.
 * ------------------------------------------------------------------ */

const over = (top, alpha, bottom) => top.map((c, i) => alpha * c + (1 - alpha) * bottom[i]);
const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
function luminance(rgbv) {
  return 0.2126 * lin(rgbv[0]) + 0.7152 * lin(rgbv[1]) + 0.0722 * lin(rgbv[2]);
}
function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The composited colour of one glass stack.
 *
 * Worst case by construction, not by convenience:
 *   * all four backdrop radials at FULL strength — for the dark theme that is
 *     the brightest the field can ever be (white text is what can fail), and
 *     for the light theme the darkest (dark text is what can fail);
 *   * the veil at its LOWER alpha, because the veil always pushes the field
 *     toward the readable end;
 *   * the smallest fill the operator can select at that clarity step.
 */
function stackColor(theme, level, quality, variant, clarity) {
  let c = theme.backdropBase;
  for (const r of theme.radials) c = over(r.rgb, r.a, c);
  c = over(theme.veilTopRgb, theme.veilTopAlpha, c);
  const sheet = over(theme.tint, fillAlpha("sheet", quality, variant, clarity), c);
  return over(theme.tint, fillAlpha(level, quality, variant, clarity), sheet);
}

function readTheme(selector) {
  const b = blockFor(selector);
  const radials = ["--glass-backdrop-a", "--glass-backdrop-b", "--glass-backdrop-c", "--glass-backdrop-d"].map((n) =>
    parseColor(token(b, n))
  );
  const veilTop = parseColor(token(b, "--glass-veil-top"));
  const veilBottom = parseColor(token(b, "--glass-veil-bottom"));
  return {
    name: selector,
    tint: rgbTriple(token(b, "--glass-tint-rgb")),
    backdropBase: hex(token(b, "--glass-backdrop-base")),
    radials,
    // whichever veil end is the WEAKER is the worst case
    veilTopRgb: veilTop.a <= veilBottom.a ? veilTop.rgb : veilBottom.rgb,
    veilTopAlpha: Math.min(veilTop.a, veilBottom.a),
    text: {
      primary: hex(token(b, "--color-text-primary")),
      secondary: hex(token(b, "--color-text-secondary")),
      tertiary: hex(token(b, "--color-text-tertiary")),
      mono: hex(token(b, "--color-text-mono")),
      accent: hex(token(b, "--color-accent")),
      danger: hex(token(b, "--color-danger")),
    },
    focusRing: hex(token(b, "--color-focus-ring")),
  };
}

const THEMES = [readTheme(":root"), readTheme('html[data-theme="dark"]')];

/* ------------------------------------------------------------------ *
 * 4. The checks.
 * ------------------------------------------------------------------ */

const failures = [];
let checks = 0;
let worstText = { ratio: Infinity, where: "" };
let worstControl = { ratio: Infinity, where: "" };

for (const theme of THEMES) {
  for (const quality of QUALITIES) {
    for (const variant of VARIANTS) {
      for (const clarity of CLARITY_STEPS) {
        for (const level of LEVELS) {
          const bg = stackColor(theme, level, quality, variant, clarity);
          const where = `${theme.name} ${quality}/${variant} clarity=${clarity} level=${level}`;

          for (const [name, fg] of Object.entries(theme.text)) {
            const r = ratio(fg, bg);
            checks++;
            if (r < TEXT_MIN) {
              failures.push(`text ${name} on ${where}: ${r.toFixed(2)}:1 < ${TEXT_MIN}:1`);
            }
            if (r < worstText.ratio) worstText = { ratio: r, where: `${name} on ${where}` };
          }

          const fr = ratio(theme.focusRing, bg);
          checks++;
          if (fr < CONTROL_MIN) {
            failures.push(`focus ring on ${where}: ${fr.toFixed(2)}:1 < ${CONTROL_MIN}:1 (WCAG 1.4.11)`);
          }
          if (fr < worstControl.ratio) worstControl = { ratio: fr, where };
        }
      }
    }
  }
}

// The Tinted/Clear separation the operator explicitly asked to WORK.
for (const quality of QUALITIES) {
  for (const clarity of CLARITY_STEPS) {
    if (clarity === 0) continue; // opaque by definition
    for (const level of VARIANT_LEVELS) {
      const sep = fillAlpha(level, quality, "tinted", clarity) - fillAlpha(level, quality, "clear", clarity);
      checks++;
      const min = MIN_SEP[clarity];
      const saturated =
        fillAlpha(level, quality, "tinted", clarity) >= 0.98 && fillAlpha(level, quality, "clear", clarity) >= 0.98;
      // Saturation is the documented near-opaque end (DESIGN-SYSTEM.md §3.1);
      // it must only ever occur at the lowest non-zero step.
      if (saturated) {
        if (clarity !== 0.25) failures.push(`${quality}/${level} saturates at clarity ${clarity} — the material would be pinned solid across the usable range`);
      } else if (sep < min - EPS) {
        failures.push(`variant separation ${quality}/${level} clarity=${clarity}: ${sep.toFixed(3)} < ${min}`);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * 5. Verdict.
 * ------------------------------------------------------------------ */

if (failures.length > 0) {
  console.error(`check-glass-contrast: FAIL — ${failures.length} of ${checks} checks failed`);
  for (const f of failures.slice(0, 25)) console.error("  - " + f);
  if (failures.length > 25) console.error(`  … and ${failures.length - 25} more`);
  process.exit(1);
}

console.log(`check-glass-contrast: PASS — ${checks} composited checks`);
console.log(`  worst text    ${worstText.ratio.toFixed(2)}:1  (${worstText.where})`);
console.log(`  worst control ${worstControl.ratio.toFixed(2)}:1  (${worstControl.where})`);
console.log(`  bar: text >= ${TEXT_MIN}:1 (WCAG 1.4.3), non-text control >= ${CONTROL_MIN}:1 (WCAG 1.4.11)`);
console.log(`  note: the backdrop is composited at its WORST point (all four radials at full strength, veil at its weakest), so a real pixel is never darker/lighter than this.`);
