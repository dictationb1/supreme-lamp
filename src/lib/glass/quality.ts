// [V3-01 / #213 §4 + §6 / #214] Visual-quality resolution and the v3 material
// model.
//
// WHAT THIS FILE OWNS. The decision "what presentation does this browser get
// right now?" and the numbers every glass surface paints with. Pixels live in
// src/styles/tokens.css and src/styles/globals.css; elements live in
// src/components/primitives/GlassContainer.tsx.
//
// SOURCE-DERIVED FACTS (Flutter, SpotiFLAC-Mobile @ a434e66f, MIT). Adapted,
// not copied — a Flutter sigma is not a CSS px:
//   * three levels: flat (opaque) / frosted (one backdrop blur) / liquid
//     (shader, REJECTED here — CSS has no Impeller lens);
//   * nested glass never samples the backdrop again
//     ("child controls paint on this surface");
//   * clarity is ONE 0..1 value, default 0.75, clamped, and QUANTIZED — the
//     reference rebuilds its filter only on a step change, never per frame;
//   * below a threshold the blur is OFF even when clarity is non-zero;
//   * tint is paint, not a saturation filter.
//
// ---------------------------------------------------------------------------
// WHAT v3 CHANGED AND WHY (defect D1, measured in the shipped source).
//
// The old model gave every paint-only ("nested") surface a FLAT FILL FLOOR of
// 0.86. At the default clarity, frosted/tinted computed 0.79 and frosted/clear
// computed 0.6625 — and both were raised to 0.86, i.e. to the SAME PIXEL.
// Because the only backdrop-sampling element in the app was the sticky TopBar,
// the Tinted/Clear control changed ~56px of chrome and nothing else. The
// shipped ledger (docs/mission-control/R2-DESIGN-TOKENS.md rows 74-80) records
// all four nested rows at 0.8600 — the defect was documented, not noticed.
//
// A floor is the wrong tool: it clamps away the very difference the control
// exists to express. v3 replaces it with LEVELS AND ADDITIVE DELTAS.
//
//   * ONE shared sampling surface per region (`sheet`) carries the
//     Tinted/Clear and clarity difference.
//   * Every other level adds a CONSTANT delta on top of the sheet's fill, so
//     the difference SURVIVES into the content instead of being flattened.
//   * `overlay` keeps a real floor, because page content genuinely scrolls
//     behind an overlay and a low fill would bleed text through it. Nothing
//     scrolls behind the sheet — its backdrop is the fixed decorative field.
// ---------------------------------------------------------------------------

export type GlassQuality = "auto" | "opaque" | "frosted" | "clear";
export type GlassVariant = "tinted" | "clear";

/**
 * Where a surface sits in the material stack. This is a RENDERING concept.
 * It is deliberately NOT called `role`, so the HTML/ARIA role attribute stays
 * free for real semantics.
 */
export type GlassLevel = "sheet" | "overlap" | "card" | "row" | "overlay";

/**
 * How the element relates to a sampling ancestor.
 * Kept for compatibility with pre-v3 call sites; `level` is what decides the
 * paint. `surface="nested"` forces paint-only regardless of level.
 */
export type GlassSurface = "backdrop" | "nested";

/** The five clarity steps. Continuous sliders are rejected: every intermediate
 *  value would rebuild a backdrop filter while the operator drags. */
export const CLARITY_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;
export const DEFAULT_CLARITY = 0.75;
export const DEFAULT_QUALITY: GlassQuality = "auto";
export const DEFAULT_VARIANT: GlassVariant = "tinted";

/** Below this clarity the blur is off even though the fill is still tinted
 *  (the reference's "frosted 0.5" threshold). */
export const BLUR_THRESHOLD = 0.5;

/** The levels, in stack order (outermost first). */
export const GLASS_LEVELS: readonly GlassLevel[] = ["sheet", "overlap", "card", "row", "overlay"];

/** The only levels allowed to own a `backdrop-filter`. */
export const SAMPLING_LEVELS: readonly GlassLevel[] = ["sheet", "overlay"];

/** Backdrop blur per level and quality, in CSS px. PROPOSED — a Flutter sigma
 *  is not a px, so these are this repo's hypotheses, measured in the browser
 *  lab and published in DESIGN-SYSTEM.md §3.3. */
export const LEVEL_BLUR_PX: Record<
  GlassLevel,
  Record<Exclude<GlassQuality, "auto">, number>
> = {
  sheet: { opaque: 0, frosted: 22, clear: 14 },
  // Paint-only. The value is 0 by construction, not by convention: CSS also
  // refuses to blur a nested surface (see globals.css).
  overlap: { opaque: 0, frosted: 0, clear: 0 },
  card: { opaque: 0, frosted: 0, clear: 0 },
  row: { opaque: 0, frosted: 0, clear: 0 },
  // A transient overlay sits over scrolling content, so it samples too.
  overlay: { opaque: 0, frosted: 18, clear: 12 },
};

/**
 * Fill alpha at clarity = 1 for the SHEET level, per (quality, variant).
 * Clarity interpolates 1.0 (clarity 0, fully opaque) -> this value (clarity 1).
 * PROPOSED, then measured in the browser lab.
 *
 * Every other level is this value PLUS its LEVEL_FILL_DELTA, clamped to 1.
 */
export const QUALITY_FILL_ALPHA: Record<
  Exclude<GlassQuality, "auto">,
  Record<GlassVariant, number>
> = {
  opaque: { tinted: 1, clear: 1 },
  frosted: { tinted: 0.66, clear: 0.48 },
  clear: { tinted: 0.5, clear: 0.32 },
};

/**
 * Additive fill per level, applied on top of the sheet's fill.
 *
 * ADDITIVE, never a floor — this is the whole fix. A floor clamps the
 * Tinted/Clear difference away; a delta preserves it at every level, so a card
 * in Clear is visibly more transparent than the same card in Tinted.
 */
export const LEVEL_FILL_DELTA: Record<GlassLevel, number> = {
  sheet: 0,
  overlap: 0.12,
  card: 0.08,
  row: 0.14,
  overlay: 0.3,
};

/**
 * The one legitimate floor: an overlay has page content scrolling behind it,
 * so its fill may not drop below this no matter how transparent the operator
 * asks for. Content levels have no floor by design.
 */
export const OVERLAY_FILL_FLOOR = 0.88;

/** Border alpha per quality (opaque uses the solid contrast-tested token). */
export const QUALITY_BORDER_ALPHA: Record<Exclude<GlassQuality, "auto">, number> = {
  opaque: 0,
  frosted: 0.26,
  clear: 0.34,
};

/** Nested levels carry a quieter edge than the sheet. */
export const LEVEL_BORDER_SCALE: Record<GlassLevel, number> = {
  sheet: 1,
  overlap: 0.85,
  card: 0.7,
  row: 0.6,
  overlay: 1,
};

/** Top inner highlight — the glass edge that keeps a plate from reading flat. */
export const QUALITY_HIGHLIGHT_ALPHA: Record<Exclude<GlassQuality, "auto">, number> = {
  opaque: 0,
  frosted: 0.1,
  clear: 0.16,
};

/** Backdrop saturation. Clear shows more of the field, so it is richer. */
export const QUALITY_SATURATE: Record<Exclude<GlassQuality, "auto">, number> = {
  opaque: 1,
  frosted: 1.06,
  clear: 1.22,
};

/** Minimum Tinted-vs-Clear separation, per clarity step. Clarity 0 is opaque
 *  by definition, so it is excluded — there is nothing to separate. */
export const MIN_VARIANT_SEPARATION: Record<number, number> = {
  // 0.03 is the true minimum: at clarity 0.25 the `row` delta pushes the
  // tinted variant into saturation (1.0) while the clear variant lands on
  // 0.97. Published rather than rounded up, because a bar that only the
  // author's favourite combination can clear is not a bar.
  0.25: 0.03,
  0.5: 0.09,
  0.75: 0.13,
  1: 0.18,
};
/** A level whose both variants clamp to (nearly) 1 is saturated by design. */
export const SATURATED_FILL = 0.98;

export function clampClarity(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_CLARITY;
  return Math.min(1, Math.max(0, v));
}

/**
 * Snap to the nearest step. The reference quantizes for exactly this reason:
 * a continuous slider would rebuild the filter on every animation frame.
 */
export function quantizeClarity(n: number): number {
  const v = clampClarity(n);
  let best: number = CLARITY_STEPS[0];
  let bestD = Math.abs(v - best);
  for (const s of CLARITY_STEPS) {
    const d = Math.abs(v - s);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export function isClarityStep(n: number): boolean {
  return CLARITY_STEPS.includes(clampClarity(n) as (typeof CLARITY_STEPS)[number]);
}

/** Memoized: this is read on every GlassContainer render. */
let supportsCache: boolean | null = null;
export function supportsBackdropFilter(): boolean {
  if (supportsCache !== null) return supportsCache;
  if (typeof window === "undefined" || typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    // jsdom: no backdrop-filter, and no way to ask. Assume opaque (the safe
    // readable answer) — tests assert the opaque fallback, never a blur.
    supportsCache = false;
    return supportsCache;
  }
  try {
    supportsCache =
      CSS.supports("backdrop-filter", "blur(4px)") ||
      CSS.supports("-webkit-backdrop-filter", "blur(4px)");
  } catch {
    supportsCache = false;
  }
  return supportsCache;
}

/** Test seam: jsdom and the lab need to force both branches. */
export function __setSupportsBackdropFilter(v: boolean | null): void {
  supportsCache = v;
}

function mediaMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function prefersReducedTransparency(): boolean {
  return mediaMatches("(prefers-reduced-transparency: reduce)");
}

export function prefersForcedColors(): boolean {
  return mediaMatches("(forced-colors: active)");
}

export interface QualityEnv {
  supports?: boolean;
  reducedTransparency?: boolean;
  forcedColors?: boolean;
  /** Set by the performance watchdog after a measured frame-time failure. */
  perfForcedOpaque?: boolean;
}

export function currentQualityEnv(): QualityEnv {
  return {
    supports: supportsBackdropFilter(),
    reducedTransparency: prefersReducedTransparency(),
    forcedColors: prefersForcedColors(),
    perfForcedOpaque: isPerfFallbackActive(),
  };
}

/**
 * Resolve the requested quality into the one that actually paints.
 *
 * Precedence (highest first) — matches #213 §8 and the operator's instruction
 * to preserve existing accessibility preferences:
 *   1. forced-colors / high contrast
 *   2. prefers-reduced-transparency: reduce
 *   3. measured performance failure (one-way latch, see watchdog below)
 *   4. backdrop-filter unsupported (older WebViews)
 *   5. the operator's explicit opaque choice
 *   6. the operator's explicit frosted / clear choice
 *   7. auto -> frosted on an eligible browser (the product default)
 */
export function resolveQuality(
  requested: GlassQuality,
  env: QualityEnv = currentQualityEnv()
): Exclude<GlassQuality, "auto"> {
  if (env.forcedColors) return "opaque";
  if (env.reducedTransparency) return "opaque";
  if (env.perfForcedOpaque) return "opaque";
  if (env.supports === false) return "opaque";
  if (requested === "opaque") return "opaque";
  if (requested === "frosted") return "frosted";
  if (requested === "clear") return "clear";
  return "frosted"; // auto
}

export interface GlassPaint {
  quality: Exclude<GlassQuality, "auto">;
  level: GlassLevel;
  /** CSS px. 0 means "no backdrop-filter is applied at all". */
  blurPx: number;
  /** 0..1 alpha for `rgb(var(--glass-tint-rgb) / a)`. */
  fillAlpha: number;
  /** 0..1 border alpha; 0 means "use the solid border token". */
  borderAlpha: number;
  /** 0..1 top inner highlight alpha. 0 on `row` and in opaque mode. */
  highlightAlpha: number;
  /** Backdrop saturation multiplier. */
  saturate: number;
  /** True only when this element is allowed to own a backdrop filter. */
  samples: boolean;
}

/**
 * The fill one level paints with, before the transparent/opaque clamp.
 * Exported so the contrast gate and the tests assert the SAME numbers the
 * component paints, rather than a copy of them.
 */
export function materialFillAlpha(
  level: GlassLevel,
  quality: Exclude<GlassQuality, "auto">,
  variant: GlassVariant,
  clarity: number
): number {
  const c = clampClarity(clarity);
  const table = QUALITY_FILL_ALPHA[quality][variant];
  const sheetFill = 1 - (1 - table) * c;
  const fill = Math.min(1, sheetFill + LEVEL_FILL_DELTA[level]);
  return Math.round(fill * 10000) / 10000;
}

/**
 * How far apart Tinted and Clear are at one level. This is the number the old
 * flat floor drove to ZERO on every content surface; v3 pins it per clarity
 * step in MIN_VARIANT_SEPARATION.
 */
export function variantSeparation(
  level: GlassLevel,
  quality: Exclude<GlassQuality, "auto">,
  clarity: number
): number {
  if (quality === "opaque") return 0;
  const t = materialFillAlpha(level, quality, "tinted", clarity);
  const c = materialFillAlpha(level, quality, "clear", clarity);
  return Math.round((t - c) * 10000) / 10000;
}

/**
 * The numbers one element paints with.
 *
 * `surface === "nested"` (or a non-sampling level) never samples: it paints on
 * the parent's already-frosted surface — the reference's "child controls paint
 * on this surface".
 */
export function glassPaint(opts: {
  level?: GlassLevel;
  requested?: GlassQuality;
  variant?: GlassVariant;
  surface?: GlassSurface;
  clarity?: number;
  env?: QualityEnv;
}): GlassPaint {
  const level = opts.level ?? "card";
  const requested = opts.requested ?? DEFAULT_QUALITY;
  const variant = opts.variant ?? DEFAULT_VARIANT;
  const surface = opts.surface ?? "backdrop";
  const clarity = clampClarity(opts.clarity ?? DEFAULT_CLARITY);
  const env = opts.env ?? currentQualityEnv();
  const quality = resolveQuality(requested, env);

  if (quality === "opaque") {
    return {
      quality,
      level,
      blurPx: 0,
      fillAlpha: 1,
      borderAlpha: 0,
      highlightAlpha: 0,
      saturate: 1,
      samples: false,
    };
  }

  const canSample = SAMPLING_LEVELS.includes(level) && surface !== "nested";
  const blurPx = clarity > BLUR_THRESHOLD ? LEVEL_BLUR_PX[level][quality] : 0;

  let fillAlpha = materialFillAlpha(level, quality, variant, clarity);
  let borderAlpha = QUALITY_BORDER_ALPHA[quality] * (0.6 + 0.4 * clarity) * LEVEL_BORDER_SCALE[level];

  // The one real floor, and it applies even when the overlay is forced
  // paint-only: page content scrolls behind it either way.
  if (level === "overlay") {
    fillAlpha = Math.min(1, Math.max(fillAlpha, OVERLAY_FILL_FLOOR));
  }

  if (!canSample) {
    // Paint-only: no blur, ever. The fill comes from the sheet above it, so
    // nothing behind can bleed through — that is what replaces the old floor.
    if (blurPx === 0) borderAlpha = Math.max(borderAlpha, QUALITY_BORDER_ALPHA[quality] * 0.6 * LEVEL_BORDER_SCALE[level]);
  }

  return {
    quality,
    level,
    blurPx: canSample ? blurPx : 0,
    fillAlpha: Math.round(fillAlpha * 10000) / 10000,
    borderAlpha: Math.round(borderAlpha * 10000) / 10000,
    highlightAlpha:
      level === "row" || level === "sheet"
        ? 0
        : Math.round(QUALITY_HIGHLIGHT_ALPHA[quality] * 10000) / 10000,
    saturate: QUALITY_SATURATE[quality],
    samples: canSample && blurPx > 0,
  };
}

/* ------------------------------------------------------------------ *
 * Performance watchdog (#213 §8: "demonstrated performance problems
 * select the redesigned opaque mode").
 *
 * ONE-WAY LATCH, never a loop: once it trips, the app stays opaque for the
 * rest of the session. That is the whole point — a single slow frame must not
 * produce an unstable quality-toggle loop, and an automatic switch BACK to
 * frosted would let the next slow frame re-trip it forever.
 * ------------------------------------------------------------------ */

let perfFallback = false;
/** Why it tripped. IN MEMORY ONLY, deliberately: the latch's job is "the rest
 *  of this page load", so it must not outlive the tab. */
let perfFallbackWhy = "";

/**
 * Set by the React bridge so tripping the latch actually re-renders the app.
 */
let envChangeListener: (() => void) | null = null;
export function setEnvChangeListener(fn: (() => void) | null): void {
  envChangeListener = fn;
}

export function isPerfFallbackActive(): boolean {
  return perfFallback;
}

export function tripPerfFallback(reason: string): void {
  if (perfFallback) return;
  perfFallback = true;
  perfFallbackWhy = reason;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-glass-perf", "opaque");
  }
  // Publish to React, or the operator would keep looking at a frosted shell
  // the code has already decided to make solid.
  if (envChangeListener) envChangeListener();
}

export function perfFallbackReason(): string {
  return perfFallbackWhy;
}
