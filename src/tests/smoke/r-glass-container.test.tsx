// [R-GLASS / #213 §6] Behaviour tests for GlassContainer.
//
// These test the NEW UI itself, not the presence of token names: every case
// below asserts the observable rendering decision (does this element own a
// backdrop filter? is the fill opaque? did the role survive?), which is what
// the compositor budget and the accessibility contract actually depend on.
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlassContainer, { GlassPortalScope } from "@/components/primitives/GlassContainer";
import {
  CLARITY_STEPS,
  DEFAULT_CLARITY,
  MIN_VARIANT_SEPARATION,
  OVERLAY_FILL_FLOOR,
  __setSupportsBackdropFilter,
  clampClarity,
  glassPaint,
  isClarityStep,
  materialFillAlpha,
  quantizeClarity,
  resolveQuality,
  variantSeparation,
  SATURATED_FILL,
} from "@/lib/glass/quality";

function cs(el: Element): CSSStyleDeclaration & Record<string, string> {
  return getComputedStyle(el) as CSSStyleDeclaration & Record<string, string>;
}

beforeEach(() => {
  __setSupportsBackdropFilter(true);
  // jsdom does not implement backdrop-filter, so the assertion is made on the
  // attribute the component derives (and the CSS keys off the same attribute).
});

afterEach(() => {
  __setSupportsBackdropFilter(null);
  vi.unstubAllGlobals();
});

describe("R-GLASS-a: clarity is bounded and quantized", () => {
  it("clamps out-of-range input and snaps to a declared step", () => {
    expect(clampClarity(-1)).toBe(0);
    expect(clampClarity(5)).toBe(1);
    expect(clampClarity(Number.NaN)).toBe(DEFAULT_CLARITY);
    for (const s of CLARITY_STEPS) expect(quantizeClarity(s)).toBe(s);
    // an in-between value lands ON a step, never between two
    expect(isClarityStep(quantizeClarity(0.37))).toBe(true);
    expect(quantizeClarity(0.37)).toBe(0.25);
    expect(quantizeClarity(0.9)).toBe(1);
    expect(quantizeClarity(0.1)).toBe(0);
  });

  it("zero clarity paints fully opaque with no blur", () => {
    const p = glassPaint({ requested: "frosted", variant: "tinted", surface: "backdrop", clarity: 0, env: { supports: true } });
    expect(p.fillAlpha).toBe(1);
    expect(p.blurPx).toBe(0);
    expect(p.samples).toBe(false);
  });

  it("blur stays off at or below the threshold even when the fill is tinted", () => {
    for (const clarity of [0, 0.25, 0.5]) {
      const p = glassPaint({ requested: "frosted", variant: "tinted", surface: "backdrop", clarity, env: { supports: true } });
      expect(p.blurPx).toBe(0);
      expect(p.samples).toBe(false);
      expect(p.fillAlpha).toBeLessThanOrEqual(1);
    }
    // [V3-01] the sheet's published blur (DESIGN-SYSTEM.md §3.3).
    expect(glassPaint({ level: "sheet", requested: "frosted", surface: "backdrop", clarity: 0.75, env: { supports: true } }).blurPx).toBe(22);
    expect(glassPaint({ level: "sheet", requested: "clear", surface: "backdrop", clarity: 0.75, env: { supports: true } }).blurPx).toBe(14);
    expect(glassPaint({ level: "overlay", requested: "frosted", surface: "backdrop", clarity: 0.75, env: { supports: true } }).blurPx).toBe(18);
  });

  it("a paint-only level never samples, and is FILL-ORDERED not floor-clamped", () => {
    // [V3-01 / D1] The old flat NESTED_FILL_FLOOR (0.86) raised every nested
    // surface to the same fill, which made the Tinted/Clear control a no-op
    // everywhere except the TopBar. The invariant is now the opposite: the
    // level adds a constant DELTA on top of the sheet, so the difference
    // survives - and every level above the sheet is more opaque than it.
    for (const level of ["overlap", "card", "row"] as const) {
      for (const quality of ["frosted", "clear"] as const) {
        for (const clarity of [0.25, 0.5, 0.75, 1] as const) {
          const sheet = materialFillAlpha("sheet", quality, "tinted", clarity);
          const fill = materialFillAlpha(level, quality, "tinted", clarity);
          expect(fill, `${level}/${quality}/${clarity}`).toBeGreaterThanOrEqual(sheet);
          expect(fill, `${level}/${quality}/${clarity}`).toBeLessThanOrEqual(1);
        }
      }
    }
    const p = glassPaint({ level: "card", requested: "frosted", variant: "clear", surface: "nested", clarity: 1, env: { supports: true } });
    expect(p.samples).toBe(false);
    expect(p.blurPx).toBe(0);
  });

  it("Tinted vs Clear is a real, measurable difference on CONTENT levels", () => {
    // The defect this file now guards: separation used to be exactly 0 on every
    // nested surface, at every clarity, in both qualities.
    for (const level of ["sheet", "overlap", "card", "row"] as const) {
      for (const quality of ["frosted", "clear"] as const) {
        for (const clarity of [0.25, 0.5, 0.75, 1] as const) {
          const sep = variantSeparation(level, quality, clarity);
          const tinted = materialFillAlpha(level, quality, "tinted", clarity);
          const clear = materialFillAlpha(level, quality, "clear", clarity);
          // At the lowest clarity steps the upper levels SATURATE: the level
          // delta pushes both variants past 1.0 and the clamp pins them there.
          // That is the intended "nearly opaque" end of the scale, not a
          // regression - but it must be an explicit, checked condition rather
          // than a separation that quietly reads 0.
          const saturated = tinted >= SATURATED_FILL && clear >= SATURATED_FILL;
          if (saturated) {
            // Saturation is only legitimate at the NEAR-OPAQUE end: if it ever
            // happened at clarity 0.5 or above, the material would be pinned
            // solid across the range the operator actually uses.
            expect(clarity, `${level}/${quality}/${clarity} saturated above 0.25`).toBe(0.25);
          } else {
            expect(sep, `${level}/${quality}/${clarity}`).toBeGreaterThan(0);
            expect(sep, `${level}/${quality}/${clarity}`).toBeGreaterThanOrEqual(MIN_VARIANT_SEPARATION[clarity]);
          }
        }
      }
      // clarity 0 is opaque BY DESIGN - there is nothing to separate
      expect(variantSeparation(level, "frosted", 0)).toBe(0);
      expect(variantSeparation(level, "opaque", 0.75)).toBe(0);
    }
  });

  it("only the overlay keeps a floor, because content scrolls behind it", () => {
    for (const quality of ["frosted", "clear"] as const) {
      const p = glassPaint({ level: "overlay", requested: quality, variant: "clear", surface: "backdrop", clarity: 1, env: { supports: true } });
      expect(p.fillAlpha).toBeGreaterThanOrEqual(OVERLAY_FILL_FLOOR);
    }
    // and a content level at the same settings is NOT floored
    const card = glassPaint({ level: "card", requested: "clear", variant: "clear", surface: "nested", clarity: 1, env: { supports: true } });
    expect(card.fillAlpha).toBeLessThan(OVERLAY_FILL_FLOOR);
  });
});

describe("R-GLASS-b: accessibility preferences win over the stored choice", () => {
  it("prefers-reduced-transparency resolves to opaque", () => {
    expect(resolveQuality("frosted", { supports: true, reducedTransparency: true })).toBe("opaque");
    expect(resolveQuality("auto", { supports: true, reducedTransparency: true })).toBe("opaque");
  });
  it("forced colors resolve to opaque", () => {
    expect(resolveQuality("frosted", { supports: true, forcedColors: true })).toBe("opaque");
  });
  it("an unsupported browser resolves to opaque", () => {
    expect(resolveQuality("frosted", { supports: false })).toBe("opaque");
    expect(resolveQuality("auto", { supports: false })).toBe("opaque");
  });
  it("the performance latch resolves to opaque", () => {
    expect(resolveQuality("frosted", { supports: true, perfForcedOpaque: true })).toBe("opaque");
  });
  it("auto resolves to frosted on an eligible browser", () => {
    expect(resolveQuality("auto", { supports: true })).toBe("frosted");
  });
  it("an explicit choice is honoured when nothing overrides it", () => {
    expect(resolveQuality("opaque", { supports: true })).toBe("opaque");
    expect(resolveQuality("frosted", { supports: true })).toBe("frosted");
    expect(resolveQuality("clear", { supports: true })).toBe("clear");
  });
});

describe("R-GLASS-c: the component renders the decision", () => {
  it("a backdrop surface samples and a nested one does not", () => {
    const { container } = render(
      <>
        <GlassContainer surface="backdrop" variant="tinted" data-testid="outer">
          <GlassContainer surface="backdrop" variant="tinted" data-testid="inner">
            nested
          </GlassContainer>
        </GlassContainer>
      </>
    );
    const outer = screen.getByTestId("outer");
    const inner = screen.getByTestId("inner");
    expect(outer.getAttribute("data-glass-samples")).toBe("1");
    // THE load-bearing assertion: a descendant of a sampling surface is forced
    // paint-only even though it ASKED for "backdrop". This is the CSS analogue
    // of the reference's `insideGlass` flag.
    expect(inner.getAttribute("data-glass-surface")).toBe("nested");
    expect(inner.getAttribute("data-glass-samples")).toBe("0");
  });

  it("a portaled overlay escapes the scope and may sample", () => {
    render(
      <GlassContainer surface="backdrop" data-testid="host">
        <GlassPortalScope>
          <GlassContainer surface="backdrop" escapeScope data-testid="portaled">
            overlay
          </GlassContainer>
        </GlassPortalScope>
      </GlassContainer>
    );
    expect(screen.getByTestId("portaled").getAttribute("data-glass-surface")).toBe("backdrop");
  });

  it("publishes the paint as CSS custom properties, not as opacity", () => {
    render(<GlassContainer surface="backdrop" variant="tinted" clarity={0.75} data-testid="g" />);
    const el = screen.getByTestId("g");
    const style = cs(el);
    expect(style.getPropertyValue("--glass-alpha")).not.toBe("");
    expect(Number(style.getPropertyValue("--glass-alpha"))).toBeGreaterThan(0);
    expect(Number(style.getPropertyValue("--glass-alpha"))).toBeLessThanOrEqual(1);
    // opacity on the container would fade its own text AND create a backdrop
    // root, so the component must never set it.
    expect(el.getAttribute("style") || "").not.toMatch(/opacity/);
    expect(style.opacity === "" || style.opacity === "1").toBe(true);
  });

  it("keeps `role` free for real ARIA semantics (surface is a separate prop)", () => {
    render(<GlassContainer as="nav" surface="nested" role="navigation" aria-label="Primary" data-testid="nav" />);
    const nav = screen.getByTestId("nav");
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("role")).toBe("navigation");
    // and "backdrop"/"nested" must never leak into role
    expect(nav.getAttribute("role")).not.toMatch(/backdrop|nested/);
  });

  it("forwards a ref and passes through element props", () => {
    const ref = createRef<HTMLElement>();
    render(<GlassContainer ref={ref} id="x1" data-foo="bar" data-testid="r" />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.id).toBe("x1");
    expect(ref.current?.getAttribute("data-foo")).toBe("bar");
  });

  it("renders the requested element via `as`", () => {
    render(<GlassContainer as="section" data-testid="sec" />);
    expect(screen.getByTestId("sec").tagName).toBe("SECTION");
  });
});
