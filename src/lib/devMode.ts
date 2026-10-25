// [search-prod-honesty-2026-10-25] Where DEV is decided.
//
// This used to live in `src/pages/search/devFixture.ts`, which also imports the
// 13-row fixture JSON. Because `Search.tsx` and `FileExplorer.tsx` imported the
// predicate from that module, the production single-file build inlined every
// sample row (proven: `grep -c fx-snap-01 ui/dist/index.html` was 1). They were
// gated at runtime and never rendered, but a demo payload has no business inside
// a shipped artifact - "not displayed" is weaker than "not present".
//
// The predicate now lives in its own data-free module, and the fixture rows are
// only reachable through a dynamic import inside `if (import.meta.env.DEV)`,
// which the production build eliminates statically.
export function isDevMode(): boolean {
  const env = import.meta.env as { DEV?: boolean; MODE?: string };
  if (env.DEV === true || env.MODE === "development") return true;
  try {
    return typeof process !== "undefined" && process.env?.NODE_ENV === "development";
  } catch {
    return false;
  }
}
