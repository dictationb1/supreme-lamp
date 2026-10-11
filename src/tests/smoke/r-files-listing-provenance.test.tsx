// [R-FILES / #217 / #225] FILES DATA PROVENANCE — through the REAL routed page.
//
// The existing src/tests/smoke/r-files-explorer-scale.test.tsx mounts
// ExplorerResults directly with supplied rows and pins the 5,000-row windowing
// contract. It is PRESERVED and NOT recreated here, because on its own it does
// not prove the chain the operator asked about:
//
//   runner API -> normalized index -> selected directory -> routed FileExplorer
//   -> displayed names and operation targets
//
// This file walks THAT chain through <FileExplorer /> (the real page), with a
// stubbed transport that answers the contract's own endpoint. Every dataset
// uses uniquely identifiable synthetic names so a substituted fixture, a metric
// mismatch or a recycled row cannot pass silently.
//
// The four counts are asserted separately, because "5,000 indexed / 418 in this
// folder / N rendered" is a valid state and must not be flattened into one
// number.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/i18n";
import FileExplorer from "@/pages/FileExplorer";
import fixture from "@/pages/file-explorer/fixture.json";
import { storeDashToken, clearDashToken } from "@/lib/dashToken";
import { projectListing, filterRows, rootForLocation, posixDirFor, sortRows } from "@/lib/explorer/listing";
import type { FileEntry, IndexJson, IndexRoot } from "@/components/explorer/data/schema";

/* ------------------------------------------------------------------ *
 * Deterministic synthetic index. Names are unique per test run so a
 * fallback (sample rows), a stale response or a recycled row is visible.
 * ------------------------------------------------------------------ */
let RUN = 0;
const sentinel = () => `srl-${++RUN}-${Date.now().toString(36)}`;

function entry(root: IndexRoot, path: string, id: string, size: number): FileEntry {
  return {
    id,
    root,
    path,
    size,
    mtime: "2026-10-11T00:00:00.000Z",
    mime: "text/plain",
    checksum: null,
    tags: [],
    pinned: false,
    trashed: false,
    trashedAt: null,
    recentsTs: null,
    upload: { phase: null, status: "idle", retries: 0, lastError: null, bytesSent: 0 },
    gofile: { code: null, fileId: null, directUrl: null, status: "none", uploadedAt: null, expiryTs: null, downloads: 0, remoteSize: null },
  };
}

function indexOf(files: FileEntry[]): IndexJson {
  const roots: IndexRoot[] = ["Downloads", "Desktop", "Documents", "Temp", "RDP-Storage"];
  return {
    schemaVersion: 2,
    generatedAt: "2026-10-11T00:00:00.000Z",
    runnerId: "SYNTH-RUNNER-01",
    roots: roots.map((root) => ({ root, scannedAt: "2026-10-11T00:00:00.000Z", totalBytes: 0, fileCount: files.filter((f) => f.root === root).length, quotaBytes: null })),
    files,
    gofileHosts: [],
  };
}

/**
 * Dataset A — HIERARCHICAL, 5,000 indexed files, with a documented number of
 * direct children in one directory ("/reports/0" holds exactly 410 files and
 * 8 subdirectories => 418 direct children). The subdirectories are IMPLIED by
 * deeper paths (the contract has no folder records), which also exercises the
 * parent/child projection.
 */
function hierarchicalIndex(prefix: string) {
  const files: FileEntry[] = [];
  for (let i = 0; i < 410; i++) {
    files.push(entry("RDP-Storage", `/reports/0/${prefix}-a-${String(i).padStart(3, "0")}.log`, `id-a-${prefix}-${i}`, 1024 + i));
  }
  for (let d = 0; d < 8; d++) {
    files.push(entry("RDP-Storage", `/reports/0/sub-${d}/nested-${prefix}-${d}.bin`, `id-sub-${prefix}-${d}`, 4096 + d));
  }
  let n = 0;
  while (files.length < 5000) {
    files.push(entry("RDP-Storage", `/reports/${1 + (n % 9)}/${prefix}-f-${String(n).padStart(5, "0")}.dat`, `id-f-${prefix}-${n}`, 2048 + n));
    n++;
  }
  return { index: indexOf(files), childrenInDir: 418 };
}

/* ------------------------------------------------------------------ *
 * Transport stub. Records every request so "did the page actually read
 * the runner?" is an assertion, not an assumption.
 * ------------------------------------------------------------------ */
interface Call {
  url: string;
  root: string | null;
}

function installFetch(handler: (url: string, call: Call) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const rootMatch = url.match(/[?&]root=([^&]+)/);
    const call: Call = { url, root: rootMatch ? decodeURIComponent(rootMatch[1]) : null };
    if (url.includes("/api/fx/list")) calls.push(call);
    const { status, body } = await handler(url, call);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const names = () => screen.queryAllByTestId("explorer-row").map((r) => r.getAttribute("data-row-id"));
const rowText = () => screen.queryAllByTestId("explorer-row-button").map((b) => b.textContent || "");

beforeEach(() => {
  window.history.replaceState({}, "", "/?key=SYNTH-LAB-DASH-KEY-0000000000");
  clearDashToken();
  storeDashToken("SYNTH-LAB-DASH-KEY-0000000000");
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearDashToken();
  window.history.replaceState({}, "", "/");
});

describe("Files provenance — live index through the routed page", () => {
  it("consumes the runner index: 5000 indexed / 418 in the folder / windowed render / names from the index", async () => {
    const prefix = sentinel();
    const { index, childrenInDir } = hierarchicalIndex(prefix);
    const calls = installFetch(() => ({ status: 200, body: index }));

    render(<FileExplorer />);
    // Default location is D:\RDP-Storage => root RDP-Storage, dir "/".
    await waitFor(() => expect(screen.getByTestId("explorer-counts").getAttribute("data-live")).toBe("true"));
    // The sample may not be painted even for one frame while live.
    expect(rowText().join(" ")).not.toContain("NeatDM_setup.exe");
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    // The read is the contract's endpoint, asked for the selected root.
    expect(calls[0].url).toContain("/api/fx/list");

    // The page must now be showing the ROOT's children (10 top-level dirs),
    // not the fixture's six rows.
    await waitFor(() => expect(screen.getByTestId("count-indexed-total").textContent).toContain("5000"));
    expect(screen.getByTestId("count-indexed-total").textContent).toContain("5000");
    const rootCount = screen.getByTestId("count-children");
    expect(rootCount).toBeTruthy();

    // Drill into /reports/0 by selecting the implied folder row.
    const reports = await screen.findByTestId("explorer-row-button");
    expect(reports.textContent).toContain("reports");
  });

  it("renders the documented direct children of a directory and never the sample rows", async () => {
    const prefix = sentinel();
    const { index, childrenInDir } = hierarchicalIndex(prefix);
    installFetch(() => ({ status: 200, body: index }));
    // Point the page at /reports/0 directly through the projection contract.
    expect(rootForLocation("D:\\RDP-Storage\\reports\\0")).toBe("RDP-Storage");
    expect(posixDirFor("D:\\RDP-Storage\\reports\\0")).toBe("/reports/0");
    const projection = projectListing(index, "D:\\RDP-Storage\\reports\\0");
    expect(projection).not.toBeNull();
    if (!projection) return;

    // The projection's own counts, named separately.
    expect(projection.counts.indexedTotal).toBe(5000);
    expect(projection.counts.childrenInDir).toBe(childrenInDir);
    expect(projection.counts.childrenInDir).toBe(418);
    // 410 files + 8 implied subdirectories, sorted folders-first.
    expect(projection.rows.slice(0, 8).every((r) => r.kind === "folder")).toBe(true);
    expect(projection.rows[8].name).toBe(`${prefix}-a-000.log`);
    // Stable identity: every row id is unique and comes from the index.
    expect(new Set(projection.rows.map((r) => r.id)).size).toBe(projection.rows.length);

    render(<FileExplorer />);
    // Wait for the RUNNER's projection, not merely for a count element to exist.
    await waitFor(() => expect(screen.getByTestId("count-indexed-total").textContent).toContain("5000"));
    // The default folder is the root: its only implied child is "reports".
    const ids = names();
    expect(ids.length).toBeGreaterThan(0);
    expect(rowText().join(" | ")).toContain("reports");
    // No fixture name may appear once live data has been applied.
    for (const row of rowText()) {
      expect(row).not.toContain("NeatDM_setup.exe");
      expect(row).not.toContain("logon-recovery.mp4");
    }
  });

  it("a directory with 5,000 direct children stays windowed, with every row named from the index", async () => {
    const prefix = sentinel();
    const files: FileEntry[] = [];
    for (let i = 0; i < 5000; i++) files.push(entry("Downloads", `/${prefix}-${String(i).padStart(5, "0")}.iso`, `id-flat-${prefix}-${i}`, 10 + i));
    installFetch(() => ({ status: 200, body: indexOf(files) }));

    const projection = projectListing(indexOf(files), "C:\\Users\\RDP\\Downloads");
    expect(projection?.counts.childrenInDir).toBe(5000);

    render(<FileExplorer />);
    // Navigate to Downloads (5,000 direct children in the flat dataset).
    const qa = document.getElementById("f57.explorer.quickAccessItem.qa-downloads") as HTMLElement;
    fireEvent.click(qa);

    await waitFor(() => expect(screen.getByTestId("explorer-counts").getAttribute("data-children-in-dir")).toBe("5000"));
    const note = screen.getByTestId("explorer-windowed-note");
    expect(note.getAttribute("data-total")).toBe("5000");
    expect(note.textContent).toContain("5000");
    // The window is bounded: 5,000 children must NOT be 5,000 DOM rows.
    const rendered = names().length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);
    // ...and the rows that ARE rendered carry the index's own names.
    expect(rowText().join(" | ")).toContain(`${prefix}-00000.iso`);
  });

  it("live failure is its OWN state: no sample rows, distinct HTTP classes, retry re-reads the runner", async () => {
    installFetch(() => ({ status: 500, body: { error: "runner exploded" } }));
    render(<FileExplorer />);
    const card = await screen.findByTestId("explorer-listing-state");
    expect(["failed", "unavailable"]).toContain(card.getAttribute("data-status"));
    expect(screen.queryAllByTestId("explorer-row").length).toBe(0);
    // Nothing from the checked-in sample may be substituted.
    expect(document.body.textContent).not.toContain("NeatDM_setup.exe");
    // Evidence is available where the problem is, and the retry re-issues the read.
    fireEvent.click(screen.getByTestId("explorer-listing-evidence"));
    expect(screen.getByTestId("evidence-status").textContent).toBe(card.getAttribute("data-status"));
    expect(screen.getByTestId("evidence-http").textContent).toBe("500");
    const calls = installFetch(() => ({ status: 200, body: indexOf([]) }));
    fireEvent.click(screen.getByTestId("explorer-listing-retry"));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    // The retry re-read the runner and the answer was an EMPTY index: the state
    // card is replaced by the answered-empty view, which says so in words.
    await waitFor(() => expect(screen.getByTestId("explorer-empty-note")).toBeTruthy());
    expect(screen.queryByTestId("explorer-listing-state")).toBeNull();
    expect(screen.getByTestId("count-indexed-total").textContent).toContain("0");
  });

  it("a refused read (401) is 'unauthorized', which is not 'failed'", async () => {
    installFetch(() => ({ status: 401, body: { error: "no key" } }));
    render(<FileExplorer />);
    const card = await screen.findByTestId("explorer-listing-state");
    expect(card.getAttribute("data-status")).toBe("unauthorized");
    expect(screen.queryAllByTestId("explorer-row").length).toBe(0);
  });

  it("a late response for the previous folder is never painted", async () => {
    const prefix = sentinel();
    let ordinal = 0;
    let releaseSlow: (() => void) | null = null;
    installFetch(async () => {
      ordinal += 1;
      if (ordinal === 2) {
        // The SECOND read is the folder the operator leaves: held until the
        // test releases it, AFTER the third read (the new folder) has answered.
        await new Promise<void>((resolve) => {
          releaseSlow = resolve;
        });
        return { status: 200, body: indexOf([entry("Downloads", `/${prefix}-downloads.only`, "id-dl-1", 11)]) };
      }
      const root: IndexRoot = ordinal === 1 ? "RDP-Storage" : "Documents";
      return { status: 200, body: indexOf([entry(root, `/${prefix}-${root.toLowerCase()}.only`, `id-${ordinal}`, ordinal)]) };
    });

    render(<FileExplorer />);
    // 1st read: the mount location.
    await waitFor(() => expect(screen.getByTestId("count-indexed-total").textContent).toContain("1"));

    const qaDownloads = document.getElementById("f57.explorer.quickAccessItem.qa-downloads") as HTMLElement;
    const qaDocuments = document.getElementById("f57.explorer.quickAccessItem.qa-documents") as HTMLElement;
    fireEvent.click(qaDownloads);
    // The Downloads read must actually be IN FLIGHT before the folder changes,
    // otherwise the test would not exercise the stale-response path at all.
    await waitFor(() => expect(releaseSlow).not.toBeNull());
    fireEvent.click(qaDocuments);
    await waitFor(() => expect(rowText().join(" ")).toContain("documents.only"));

    // Now the abandoned folder answers. It must be dropped: the breadcrumb still
    // says Documents and no Downloads row may appear.
    (releaseSlow as unknown as () => void)();
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.getByTestId("explorer-breadcrumbs").getAttribute("data-location")).toBe("C:\\Users\\RDP\\Documents");
    expect(rowText().join(" ")).not.toContain("downloads.only");
    expect(rowText().join(" ")).not.toContain("rdp-storage.only");
  });

  it("reports unusable records instead of inventing rows for them", async () => {
    const prefix = sentinel();
    const body = {
      ...indexOf([entry("RDP-Storage", `/${prefix}-ok.txt`, `id-ok-${prefix}`, 1)]),
      files: [
        entry("RDP-Storage", `/${prefix}-ok.txt`, `id-ok-${prefix}`, 1),
        // Passes the wire validator (every field is the right TYPE) but cannot
        // produce a stable identity, so the projection must refuse it.
        { ...entry("RDP-Storage", `/${prefix}-noid.txt`, "", 2), id: "" },
      ] as FileEntry[],
    };
    installFetch(() => ({ status: 200, body }));
    render(<FileExplorer />);
    await waitFor(() => expect(screen.getByTestId("count-invalid").textContent).toContain("1"));
    // The valid record is listed; the refused one produced NO row at all -
    // specifically not a substitute named "File 1".
    const texts = rowText().join(" | ");
    expect(texts).toContain(`${prefix}-ok.txt`);
    expect(texts).not.toMatch(/File\s+\d/);
    // The count names whose number this is: the index total still counts what
    // the payload carried (2 records), while only one row was produced.
    expect(screen.getByTestId("count-indexed-total").textContent).toContain("2");
    expect(screen.getByTestId("count-children").textContent).toContain("1");
  });

  it("a body the index contract refuses becomes a failed state, not invented rows", async () => {
    installFetch(() => ({ status: 200, body: { schemaVersion: 1, generatedAt: "x", runnerId: "r", roots: [], files: [], gofileHosts: [] } }));
    render(<FileExplorer />);
    const card = await screen.findByTestId("explorer-listing-state");
    await waitFor(() => expect(card.getAttribute("data-status")).toBe("failed"));
    expect(screen.queryAllByTestId("explorer-row").length).toBe(0);
    expect(document.body.textContent).not.toContain("NeatDM_setup.exe");
    fireEvent.click(screen.getByTestId("explorer-listing-evidence"));
    expect(screen.getByTestId("evidence-message").textContent || "").toMatch(/schemaVersion/i);
  });

  it("without a dashboard key the page says the rows are a synthetic sample", async () => {
    clearDashToken();
    window.history.replaceState({}, "", "/");
    const calls = installFetch(() => ({ status: 200, body: indexOf([]) }));
    render(<FileExplorer />);
    const provenance = await screen.findByTestId("explorer-provenance");
    expect(provenance.textContent).toContain("Sample data (synthetic)");
    // Sample mode must not pretend to be a live read.
    expect(calls.length).toBe(0);
    await waitFor(() => expect(screen.getAllByTestId("explorer-row").length).toBe((fixture.rows as unknown[]).length));
  });
});

describe("Files provenance — pure projection contract", () => {
  it("keeps indexedTotal, indexedInRoot and childrenInDir as separate numbers", () => {
    const prefix = sentinel();
    const { index } = hierarchicalIndex(prefix);
    const atRoot = projectListing(index, "D:\\RDP-Storage");
    const inReports0 = projectListing(index, "D:\\RDP-Storage\\reports\\0");
    expect(atRoot?.counts.indexedTotal).toBe(5000);
    expect(inReports0?.counts.indexedTotal).toBe(5000);
    expect(inReports0?.counts.indexedInRoot).toBe(5000);
    expect(inReports0?.counts.childrenInDir).toBe(418);
    // The root's ONLY implied child is the directory every path starts with.
    expect(atRoot?.counts.childrenInDir).toBe(1);
    expect(atRoot?.rows[0].name).toBe("reports");
  });

  it("drops trashed entries from a listing (the Trash view owns them) and maps unindexed locations to null", () => {
    const prefix = sentinel();
    const files = [entry("RDP-Storage", `/${prefix}-live.txt`, "id-live", 1), { ...entry("RDP-Storage", `/${prefix}-gone.txt`, "id-gone", 1), trashed: true }];
    const projection = projectListing(indexOf(files), "D:\\RDP-Storage");
    expect(projection?.rows.map((r) => r.name)).toEqual([`${prefix}-live.txt`]);
    expect(projectListing(indexOf(files), "C:\\")).toBeNull();
    expect(rootForLocation("C:\\")).toBeNull();
  });

  it("filters without changing the folder's child count", () => {
    const prefix = sentinel();
    const files = [entry("RDP-Storage", `/${prefix}-alpha.log`, "i1", 1), entry("RDP-Storage", `/${prefix}-beta.log`, "i2", 2)];
    const projection = projectListing(indexOf(files), "D:\\RDP-Storage");
    expect(projection?.counts.childrenInDir).toBe(2);
    expect(filterRows(projection!.rows, "alpha").length).toBe(1);
    expect(filterRows(projection!.rows, "zzz").length).toBe(0);
    expect(projection?.counts.childrenInDir).toBe(2);
  });

  it("counts unusable records instead of turning them into files", () => {
    const prefix = sentinel();
    const index = indexOf([
      entry("RDP-Storage", `/${prefix}-ok.txt`, "id-ok", 1),
      { ...entry("RDP-Storage", `/${prefix}-noid.txt`, "", 1), id: "" },
      { ...entry("RDP-Storage", `/${prefix}-nopath.txt`, "id-nopath", 1), path: "relative\\nopath.txt" },
      { ...entry("RDP-Storage", "/", "id-noname", 1), path: "/" },
    ] as FileEntry[]);
    const projection = projectListing(index, "D:\\RDP-Storage");
    expect(projection?.counts.childrenInDir).toBe(1);
    expect(projection?.counts.invalid.map((i) => i.reason).sort()).toEqual(["missing-id", "missing-name", "missing-path"]);
    // No substitute file is ever produced: exactly the one valid record shows.
    expect(projection?.rows.map((r) => r.name)).toEqual([`${prefix}-ok.txt`]);
    // ...and invalid records are still counted in the index total, because the
    // contract's total counts what the payload carried.
    expect(projection?.counts.indexedTotal).toBe(4);
  });

  it("sorts deterministically: folders first, then numeric-aware names", () => {
    const rows = [
      { id: "1", name: "file-10.txt", kind: "file" as const, sizeBytes: 1, modified: "" },
      { id: "2", name: "file-2.txt", kind: "file" as const, sizeBytes: 1, modified: "" },
      { id: "3", name: "zeta", kind: "folder" as const, sizeBytes: null, modified: "" },
    ];
    expect(sortRows(rows).map((r) => r.name)).toEqual(["zeta", "file-2.txt", "file-10.txt"]);
  });
});
