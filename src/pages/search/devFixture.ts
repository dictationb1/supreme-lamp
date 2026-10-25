// [F56-c v3] DEV fixture rows (§3). The 5-minute lab must VISIBLY progress even
// before F56-d's real transport exists: in dev mode only, when the live adapters
// settle empty, the rows in ./fixture.json stream one-by-one into the Results
// grid through the same normalized ingest path live partials will use.
//
// [search-prod-honesty-2026-10-25] This module is now DATA ONLY and is reached
// exclusively through `await import("./search/devFixture")` inside
// `if (import.meta.env.DEV)` in Search.tsx. Nothing in production imports it, so
// the sample rows are not present in the shipped bundle at all (verify with
// `npm run build && grep -c fx-snap-01 ui/dist/index.html` -> 0).
//
// `isDevMode` / `shouldStreamDevFixture` / `DEV_FIXTURE_TICK_MS` moved to
// `@/lib/devMode` and `@/lib/domain/devSearchFixture`; they are re-exported here
// for the existing tests that import them from this path.
import type { SearchResult } from "@/api/search";
import fixture from "./fixture.json";

export { isDevMode } from "@/lib/devMode";
export { DEV_FIXTURE_TICK_MS, shouldStreamDevFixture } from "@/lib/domain/devSearchFixture";

export const DEV_FIXTURE_ROWS: SearchResult[] = fixture as unknown as SearchResult[];
