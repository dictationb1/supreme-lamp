import * as DiagApi from "@/api/diag";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { DiagBundleCard } from "@/components/domain/DiagBundleCard";

const installFetch = (mockResponder: () => any) => {
  const calls: any[] = [];
  window.fetch = vi.fn().mockImplementation(async (url, init) => {
    calls.push({ url, init });
    const res = mockResponder();
    return {
      ok: res.ok !== false,
      status: res.status || 200,
      json: async () => res.body,
    };
  });
  return calls;
};

describe("Troubleshooting Bounded Retry and Export Decoupling", () => {
  beforeEach(() => {
    useSessionStore.setState({
      compBundle: null,
      compBundleStatus: 'idle',
      compBundleError: '',
      compBundleLastFetched: 0
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchCompBundle prevents request storms on rapid clicks", async () => {
    let count = 0;
    vi.spyOn(DiagApi, 'fetchComprehensiveDiag').mockImplementation(async () => {
      count++;
      return { ok: true, bundle: { _test: "test" } } as any;
    });

    const promise1 = useSessionStore.getState().fetchCompBundle();
    const promise2 = useSessionStore.getState().fetchCompBundle();
    const promise3 = useSessionStore.getState().fetchCompBundle();

    await Promise.all([promise1, promise2, promise3]);

    expect(count).toBe(1);
    expect(useSessionStore.getState().compBundleStatus).toBe('idle');
  });
});
