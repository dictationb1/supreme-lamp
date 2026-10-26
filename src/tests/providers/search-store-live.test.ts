// @vitest-environment jsdom
// [SEARCH-REPAIR] END-TO-END store test against a REAL provider  (kind: LIVE)
//
// The dashboard's own search route is unavailable here on purpose (it 404s, as it
// does on a machine without the PowerShell server): the client provider lane must
// still deliver real GitHub results, and the search must be reported as PARTIAL
// rather than failed. This is the "one source fails, the other's results stay"
// requirement exercised through the real store, not through a unit stub.
//
// Live because it calls api.github.com. `npm run test:providers` skips it;
// `npm run test:providers:live` runs it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSearchStore } from "@/stores/searchStore";
import { resetSourcesStore, useSourcesStore } from "@/stores/sourcesStore";
import { setProviderLaneEnabled } from "@/lib/search/providerLane";

const live = process.env.PROVIDERS_LIVE === "1";
const HAS_REAL_FETCH = typeof fetch === "function";

describe.skipIf(!live || !HAS_REAL_FETCH)("Search store + real GitHub provider", () => {
  beforeEach(() => {
    resetSourcesStore();
    window.localStorage.clear();
    // Only GitHub: the other defaults would add minutes of unrelated network.
    for (const id of ["internet-archive", "openverse", "openculture", "fmhy", "rentry"]) {
      useSourcesStore.getState().toggle(id, false);
    }
    setProviderLaneEnabled(true);
    useSearchStore.setState(useSearchStore.getInitialState(), true);
  });

  it("returns real GitHub rows and keeps them when the dashboard search route is unavailable", async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/search")) {
          return { ok: false, status: 404, url, text: async () => "{}", json: async () => ({}), headers: new Headers() } as unknown as Response;
        }
        return realFetch(input as RequestInfo, init);
      })
    );

    useSearchStore.getState().setQuery("awesome vlc");
    await useSearchStore.getState().submit();
    // let the provider lane finish (it is started in parallel with the server lane)
    await vi.waitFor(
      () => {
        expect(useSearchStore.getState().providerLaneRunning).toBe(false);
      },
      { timeout: 60_000, interval: 250 }
    );

    const st = useSearchStore.getState();
    expect(st.providerStates.github?.status).toBe("complete");
    expect(st.resultOrder.length).toBeGreaterThan(0);
    const first = st.results[st.resultOrder[0]];
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.sourceUrl).toMatch(/^https:\/\//);
    // the server lane failed, the provider lane did not: PARTIAL, not failed
    expect(st.phase).toBe("partial");
    setProviderLaneEnabled(false);
  }, 90_000);

  it("a pasted awesome-list URL is inspected and offered as a source, with no credential prompt", async () => {
    const { useUrlImportStore, resetUrlImportStore } = await import("@/stores/urlImportStore");
    resetUrlImportStore();
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => realFetch(input as RequestInfo, init)));
    await useUrlImportStore.getState().inspect("https://github.com/mfkl/awesome-vlc#readme", 1);
    const st = useUrlImportStore.getState();
    expect(st.status).toBe("ready");
    expect(st.outcome?.addable).toBe(true);
    expect(st.outcome?.sections.length).toBeGreaterThan(0);
    expect(st.error).toBeNull();
  }, 60_000);
});
