// [search-prod-honesty-2026-10-25] DEV-only streaming policy, kept free of data
// so that production code can ask "may I stream samples?" without dragging the
// sample rows into the bundle.
import { isDevMode } from "@/lib/devMode";

/** One row streams in per tick so progressive states are visible. */
export const DEV_FIXTURE_TICK_MS = 250;

/** Should the DEV fixture stream start for this settled search? Only after a
 *  real submit (queryGeneration > 0), only when the live fan-out produced
 *  nothing, and only once per generation (devFixtureGen latch in the UI store). */
export function shouldStreamDevFixture(s: {
  phase: string;
  totalResults: number;
  queryGeneration: number;
  devFixtureGen: number;
}): boolean {
  if (!isDevMode()) return false;
  // [F69 §1.3] "failed" included: when POST /api/search is absent (404/network),
  // searchStore.submit() settles on phase "failed" and the dev stream must still fire.
  if (s.phase !== "complete" && s.phase !== "empty" && s.phase !== "failed") return false;
  if (s.totalResults > 0 || s.queryGeneration === 0) return false;
  return s.devFixtureGen !== s.queryGeneration;
}
