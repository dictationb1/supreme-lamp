// [SEARCH-REPAIR] Provider suite config: NODE environment, no jsdom setup.
//
// The provider engine is transport + parsing over real HTTP. Running it in jsdom
// would test jsdom's fetch shim instead of the network, so this suite runs in
// plain node (it is the same code the browser bundle ships) and includes both:
//   * fixture tests (deterministic, always run);
//   * `*-live.test.ts` integration tests that call the real providers and are
//     skipped with PROVIDERS_LIVE=0 on an offline host.
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globals: true,
    include: ["src/tests/providers/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    css: false,
  },
});
