#!/usr/bin/env node
// [R2 §P3 / #214] Contrast gate.
//
// WHY THIS EXISTS. The light-theme tertiary token measured 4.344:1 on
// --color-bg-surface-raised and survived three review rounds because every
// audit only checked it against the white card surface, where it passes
// (4.759:1). A hand-checked number is not a gate. This script reads the token
// VALUES OUT OF src/styles/tokens.css and recomputes the ratios, so a token
// edit that drops a ratio below its bar fails the build instead of shipping.
//
// WHAT IT ENFORCES.
//   * --color-text-tertiary / -secondary / -mono / -primary meet WCAG 1.4.3
//     (4.5:1) as NORMAL TEXT on every surface token of the same theme.
//   * --color-accent and --color-danger meet 4.5:1 as text on every surface.
//   * --color-warning meets 4.5:1 as TEXT (it is used as text at 63+ call
//     sites) AND 3:1 as a non-text control (WCAG 1.4.11).
//   * --color-warning-accent is DECORATION ONLY: `text-warning-accent` must not
//     appear anywhere in src/. That is the text-versus-control classification
//     #214 asked for, made structural rather than a comment.
//
// Math is WCAG 2.x relative luminance. This is a token-level check; browser-
// rendered evidence (composited glass, gradients) is a separate lab step and is
// not claimed here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8");

function blockFor(selector) {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error("selector not found in tokens.css: " + selector);
  const open = css.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, j);
    }
  }
  throw new Error("unbalanced braces for " + selector);
}

const LIGHT = blockFor(":root");
const DARK = blockFor('html[data-theme="dark"]');

function token(block, name) {
  const m = block.match(new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{3,8})"));
  return m ? m[1] : null;
}

function hexToRgb(h) {
  let s = h.replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function luminance(h) {
  const [r, g, b] = hexToRgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["color-bg-surface", "color-bg-base", "color-bg-surface-raised", "color-bg-surface-sunken"];
/** foreground token -> the WCAG bar it must clear, as normal text. */
const TEXT_TOKENS = [
  ["color-text-primary", 4.5],
  ["color-text-secondary", 4.5],
  ["color-text-tertiary", 4.5],
  ["color-text-mono", 4.5],
  ["color-accent", 4.5],
  ["color-danger", 4.5],
  // warning is used as TEXT at 63+ sites (Chip tone="warning", #f94.autoLoginBlocked,
  // DiagnosticsDrawer verdicts), so it must clear the text bar, not only 3:1.
  ["color-warning", 4.5],
  ["color-success", 4.5],
];

const themes = [
  ["light", LIGHT],
  ["dark", DARK],
];

let failures = 0;
const rows = [];

for (const [theme, block] of themes) {
  const bgs = SURFACES.map((s) => [s, token(block, s)]).filter(([, v]) => v);
  for (const [fgName, bar] of TEXT_TOKENS) {
    const fg = token(block, fgName);
    if (!fg) {
      // The dark block legitimately omits tokens it inherits from :root.
      continue;
    }
    let worst = Infinity;
    let worstBg = "";
    for (const [bgName, bg] of bgs) {
      const r = ratio(fg, bg);
      if (r < worst) {
        worst = r;
        worstBg = bgName;
      }
    }
    const ok = worst >= bar;
    if (!ok) failures++;
    rows.push(
      `${ok ? "pass" : "FAIL"}  ${theme.padEnd(5)} ${fgName.padEnd(24)} ${fg}  min ${worst.toFixed(3)}:1 on ${worstBg}  (bar ${bar})`
    );
  }
  // warning as a NON-TEXT control (WCAG 1.4.11, 3:1) on the theme's base.
  const w = token(block, "color-warning");
  const base = token(block, "color-bg-base");
  if (w && base) {
    const r = ratio(w, base);
    const ok = r >= 3;
    if (!ok) failures++;
    rows.push(`${ok ? "pass" : "FAIL"}  ${theme.padEnd(5)} ${"color-warning (control)".padEnd(24)} ${w}  ${r.toFixed(3)}:1 on color-bg-base  (bar 3)`);
  }
  // The decoration alias must exist on BOTH themes so no dark-only fallback is
  // needed by a component that references it.
  const wa = token(block, "color-warning-accent");
  if (!wa && theme === "light") {
    failures++;
    rows.push("FAIL  light color-warning-accent is missing - the decoration alias must exist on both themes");
  }
}

// --- classification gate: the decoration alias must never be text -------------
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(tsx|ts)$/.test(e) && !/\/tests\//.test(p)) {
      out.push(p);
    }
  }
  return out;
}
const offenders = [];
for (const f of walk(join(ROOT, "src"))) {
  const src = readFileSync(f, "utf8");
  if (/text-warning-accent/.test(src)) offenders.push(f);
  if (/color:\s*var\(--color-warning-accent\)/.test(src)) offenders.push(f);
}
if (offenders.length) {
  failures++;
  rows.push("FAIL  --color-warning-accent is decoration-only but is used as text in: " + offenders.join(", "));
}

console.log(rows.join("\n"));
console.log("\n" + (failures === 0 ? "OK: all contrast checks passed." : `${failures} contrast check(s) FAILED.`));
process.exit(failures === 0 ? 0 : 1);
