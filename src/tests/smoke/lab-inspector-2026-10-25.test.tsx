// [LAB-INSPECT-2026-10-25] UI evidence for the repaired deep-inspector states.
//
// The operator's screenshots showed (A) a stored source failing with
// HOSTNAME_MISMATCH and (B) a result deep-inspection rendering one generic error.
// The server-side repair is covered by lab-inspect-endpoint.test.ts; this suite
// renders the SHIPPED inspector and proves the visible states:
//   * a fetched-but-empty page is NOT the same screen as a failed fetch;
//   * a fetch with links but no query matches says so, instead of an empty list;
//   * an error renders its actionable code + the refused host;
//   * the source provenance (redirected-from host) and the result kind are named;
//   * re-rendering does not inspect twice (one POST per target+query).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import "@/i18n";
import { LabInspector } from "@/pages/search/LabInspector";

const inspectResultUrl = vi.fn();
const inspectSource = vi.fn();
vi.mock("@/api/lab", async (orig) => {
  const actual = await orig<typeof import("@/api/lab")>();
  return {
    ...actual,
    inspectResultUrl: (...a: unknown[]) => inspectResultUrl(...a),
    inspectSource: (...a: unknown[]) => inspectSource(...a),
  };
});

const RESULT = { title: "ChessMax/awesome-programming-languages", sourceUrl: "https://github.com/ChessMax/awesome-programming-languages", adapterKey: "adapter.github" };

function renderResult(query = "Programming Languages") {
  return render(
    <MemoryRouter>
      <LabInspector result={RESULT} query={query} />
    </MemoryRouter>,
  );
}

const DATA = {
  hostname: "github.com",
  finalHostname: "github.com",
  redirectChain: ["awesome.re"],
  resultKind: "repository",
  title: "ChessMax/awesome-programming-languages",
  fetchedAt: "2026-10-25T14:00:00Z",
  linkCount: 3,
  matchCount: 1,
  links: [
    { text: "README.md", href: "https://github.com/ChessMax/awesome-programming-languages/blob/main/README.md", matches: true },
    { text: "Issues", href: "https://github.com/ChessMax/awesome-programming-languages/issues", matches: false },
    { text: "Actions", href: "https://github.com/ChessMax/awesome-programming-languages/actions", matches: false },
  ],
};

beforeEach(() => {
  inspectResultUrl.mockReset();
  inspectSource.mockReset();
});

describe("[LAB-INSPECT UI] result mode", () => {
  it("inspects the result's own URL exactly once and renders the rows", async () => {
    inspectResultUrl.mockResolvedValue({ ok: true, data: DATA });
    renderResult();
    await waitFor(() => expect(screen.getByTestId("lab-link-list")).toBeTruthy());
    expect(inspectResultUrl).toHaveBeenCalledTimes(1);
    expect(inspectResultUrl).toHaveBeenCalledWith(RESULT.sourceUrl, "Programming Languages");
    expect(screen.getAllByTestId("lab-link-row").length).toBe(1); // matches-first default
  });

  it("names the result kind and the redirect provenance", async () => {
    inspectResultUrl.mockResolvedValue({ ok: true, data: { ...DATA, hostname: "awesome.re", finalHostname: "github.com" } });
    renderResult();
    await waitFor(() => expect(screen.getByTestId("lab-result-kind")).toBeTruthy());
    expect(screen.getByTestId("lab-result-kind").getAttribute("data-kind")).toBe("repository");
    expect(screen.getByTestId("lab-provenance").getAttribute("data-final-host")).toBe("github.com");
  });

  it("a fetched page with no query matches says so instead of showing an empty list", async () => {
    inspectResultUrl.mockResolvedValue({ ok: true, data: { ...DATA, matchCount: 0, links: DATA.links.map((l) => ({ ...l, matches: false })) } });
    renderResult();
    const empty = await screen.findByTestId("lab-empty");
    expect(empty.getAttribute("data-empty-kind")).toBe("no-matches");
    expect(empty.textContent).toContain("Programming Languages");
  });

  it("a fetched page with ZERO links is distinguished from a failed fetch", async () => {
    inspectResultUrl.mockResolvedValue({ ok: true, data: { ...DATA, links: [], linkCount: 0, matchCount: 0 } });
    renderResult();
    const empty = await screen.findByTestId("lab-empty");
    expect(empty.getAttribute("data-empty-kind")).toBe("no-links");
    expect(screen.queryByTestId("lab-error")).toBeNull();
  });

  it("an error shows the actionable code and the refused host, never just a shrug", async () => {
    inspectResultUrl.mockResolvedValue({
      ok: false,
      error: { code: "HOSTNAME_MISMATCH", messageKey: "lab.hostnameMismatchRedirect", details: { offHost: "evil.example" } },
    });
    renderResult();
    const err = await screen.findByTestId("lab-error");
    expect(err.getAttribute("data-code")).toBe("HOSTNAME_MISMATCH");
    expect(err.getAttribute("data-off-host")).toBe("evil.example");
    expect(screen.getByTestId("lab-error-message").textContent).not.toMatch(/something went wrong/i);
    expect(screen.getByTestId("lab-error-code").textContent).toContain("HOSTNAME_MISMATCH");
  });

  it("Refetch is an explicit, single re-inspection", async () => {
    inspectResultUrl.mockResolvedValue({ ok: true, data: DATA });
    renderResult();
    await waitFor(() => expect(screen.getByTestId("lab-link-list")).toBeTruthy());
    await userEvent.click(screen.getByTestId("lab-refetch"));
    await waitFor(() => expect(inspectResultUrl).toHaveBeenCalledTimes(2));
  });
});

describe("[LAB-INSPECT UI] stored-source mode", () => {
  const SOURCE = {
    id: "awesome-re",
    name: "awesome.re",
    baseUrl: "https://awesome.re",
    hostname: "awesome.re",
    labMode: true,
    category: "software",
    allowedDomains: ["awesome.re"],
    enableState: "permanent",
    addedAt: "2026-10-20T00:00:00Z",
  };

  it("sends the sourceId (never a URL) and renders the served host when it redirected", async () => {
    inspectSource.mockResolvedValue({
      ok: true,
      data: {
        ...DATA,
        hostname: "awesome.re",
        finalHostname: "github.com",
        source: "homepage",
        sourceDisplay: "Homepage",
        linkCount: 1,
        matchCount: 1,
        links: [{ text: "Programming Languages", href: "https://github.com/sindresorhus/awesome#programming-languages", matches: true }],
      },
    });
    render(
      <MemoryRouter>
        <LabInspector source={SOURCE as never} query="Programming Languages" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("lab-link-list")).toBeTruthy());
    expect(inspectSource).toHaveBeenCalledWith("awesome-re", "Programming Languages");
    expect(inspectResultUrl).not.toHaveBeenCalled();
    expect(screen.getByTestId("lab-provenance").textContent).toContain("github.com");
  });

  it("the old HOSTNAME_MISMATCH generic failure is gone: the reason is named", async () => {
    inspectSource.mockResolvedValue({
      ok: false,
      error: { code: "HOSTNAME_MISMATCH", messageKey: "lab.hostnameMismatchRedirect", details: { offHost: "unknown.example" } },
    });
    render(
      <MemoryRouter>
        <LabInspector source={SOURCE as never} query="Programming Languages" />
      </MemoryRouter>,
    );
    const err = await screen.findByTestId("lab-error");
    expect(err.getAttribute("data-off-host")).toBe("unknown.example");
  });
});
