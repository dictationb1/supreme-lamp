// [R-GLASS / #213 §8 → V3-01] The backdrop STACK: the decorative field plus the
// one shared glass sheet.
//
// PRIVACY: this is a CSS gradient field and nothing else. It must never become
// a screenshot of the operator's desktop, a file thumbnail or a DVR frame —
// every one of those can carry secrets (WP-13b). There is no <img>, no canvas
// capture and no network fetch in this component by design.
//
// [V3-01] WHY THE SHEET LIVES HERE. The sheet is the single steady-state
// backdrop filter of the whole application: fixed, aria-hidden,
// pointer-events-none, painted at z-index 1 between the field (z 0) and the
// shell content (z 2). Everything the operator reads is painted above it and
// composites against it for real — which is where the Tinted/Clear and clarity
// difference becomes visible. Putting it in the same component as the field
// makes that two-layer contract impossible to break from AppShell, and keeps
// AppShell's own mount list exactly as tests/m2-chrome-unfencing.test.js pins
// it (no new element to classify there).
//
// Opaque mode hides both (globals.css + the early return), so an operator who
// chooses solid surfaces pays nothing for either.
import GlassContainer from "@/components/primitives/GlassContainer";
import { useVisualQuality } from "@/lib/glass/useVisualQuality";

export function AppBackdrop() {
  const { resolved } = useVisualQuality();
  if (resolved === "opaque") return null;
  return (
    <>
      <div className="app-backdrop" aria-hidden="true" data-testid="app-backdrop" />
      <GlassContainer
        level="sheet"
        surface="backdrop"
        radius="none"
        className="app-glass-sheet"
        data-testid="app-glass-sheet"
        aria-hidden="true"
      />
    </>
  );
}

export default AppBackdrop;
