// [R-FILES / #217] INDEX -> ROWS PROJECTION.
//
// WHY THIS MODULE EXISTS. Until this file, the routed File Explorer rendered
// `pages/file-explorer/fixture.json` (6 synthetic rows) and re-seeded the same
// fixture from its Refresh handler. The runner's real listing endpoint
// (`GET /api/fx/list`, documented in components/explorer/api/endpoints.ts) was
// implemented and typed but NOTHING in the page imported it, so:
//
//   * a real directory's children never reached the DOM;
//   * "Refresh" re-read a fixture, which reads as a successful live refresh;
//   * a listing failure had no state to render, because there was no request.
//
// This module owns the ONLY projection from the contract's `IndexJson` to the
// rows the explorer paints, so the four counts the operator can read are
// distinct and separately testable:
//
//   indexedTotal   - files in the index payload (`files.length`; the contract
//                    does not define a "visible" subset, so this is the count).
//   indexedInRoot  - files whose `root` equals the selected location's root.
//   childrenInDir  - immediate children of the selected directory: files whose
//                    POSIX parent === the selected POSIX dir, plus the
//                    directories implied by deeper paths.
//   displayed      - what the results list actually renders (a windowed slice;
//                    ExplorerResults owns that number, not this module).
//
// "5000 indexed / 418 in this folder / 14 rendered" is therefore a VALID state,
// not a contradiction, and each number keeps its own name in the UI.
//
// The projection is pure: no fetch, no store, no React. useListing.ts adds the
// request lifecycle; FileExplorer.tsx adds rendering.
import type { FileEntry, IndexJson, IndexRoot } from "@/components/explorer/data/schema";
import { INDEX_SCHEMA_VERSION } from "@/components/explorer/data/schema";
import type { FixtureRow } from "@/pages/file-explorer/ExplorerResults";

/**
 * Location -> index root. The tree's nodes are Windows paths (ExplorerTree
 * reads them from the fixture) and the index keys files by the SAME six roots
 * the watcher owns (lib/explorer/roots.ts). A location that maps to no root is
 * NOT silently shown as empty: `rootForLocation` returns null and the page
 * renders the "not indexed" state.
 */
const LOCATION_ROOTS: ReadonlyArray<{ prefix: string; root: IndexRoot }> = [
  { prefix: "D:\\RDP-Storage", root: "RDP-Storage" },
  { prefix: "C:\\Users\\RDP\\Downloads", root: "Downloads" },
  { prefix: "C:\\Users\\RDP\\Desktop", root: "Desktop" },
  { prefix: "C:\\Users\\RDP\\Documents", root: "Documents" },
  { prefix: "%TEMP%", root: "Temp" },
];

/** Trailing separators and case are irrelevant to the watcher's own comparison
 *  (lib/explorer/roots.ts#pathKey), so the mapping is case-insensitive too. */
function normaliseWindows(path: string): string {
  return String(path || "").trim().replace(/\//g, "\\").replace(/\\+$/, "");
}

export function rootForLocation(locationPath: string): IndexRoot | null {
  const p = normaliseWindows(locationPath).toLowerCase();
  if (!p) return null;
  for (const { prefix, root } of LOCATION_ROOTS) {
    const pre = normaliseWindows(prefix).toLowerCase();
    if (p === pre || p.startsWith(pre + "\\")) return root;
  }
  return null;
}

/**
 * The POSIX directory inside the root that the location points at, always with
 * a leading slash and no trailing slash ("/" for the root itself). Returns null
 * when the location is outside every indexed root.
 *
 * "D:\RDP-Storage"            -> "/"
 * "D:\RDP-Storage\reports\0"  -> "/reports/0"
 */
export function posixDirFor(locationPath: string): string | null {
  const root = rootForLocation(locationPath);
  if (!root) return null;
  const p = normaliseWindows(locationPath);
  const match = LOCATION_ROOTS.find((r) => normaliseWindows(r.prefix).toLowerCase() === normaliseWindows(p).toLowerCase().slice(0, normaliseWindows(r.prefix).length) && p.toLowerCase().startsWith(normaliseWindows(r.prefix).toLowerCase()) && r.root === root);
  if (!match) return null;
  const rest = p.slice(normaliseWindows(match.prefix).length).replace(/^\\+/, "").replace(/\\+$/, "");
  if (!rest) return "/";
  return "/" + rest.split("\\").filter(Boolean).join("/");
}

/** POSIX parent of a file path: "/a/b/c.txt" -> "/a/b"; "/c.txt" -> "/". */
export function posixParent(path: string): string {
  const p = String(path || "");
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "/";
  return p.slice(0, idx);
}

export function posixBase(path: string): string {
  const p = String(path || "");
  const idx = p.lastIndexOf("/");
  return idx < 0 ? p : p.slice(idx + 1);
}

export interface InvalidRecord {
  /** Which field failed validation. */
  reason: "missing-id" | "missing-path" | "missing-name";
  /** Whatever was present, for the diagnostic disclosure - never rendered as a file. */
  raw: unknown;
}

export interface ListingCounts {
  /** Every entry in the index payload (the contract's only "total"). */
  indexedTotal: number;
  /** Entries whose `root` is the selected location's root. */
  indexedInRoot: number;
  /** Immediate children of the selected directory (files + implied folders). */
  childrenInDir: number;
  /** Records the projection refused; surfaced in the diagnostic disclosure. */
  invalid: InvalidRecord[];
}

export interface ListingProjection {
  rows: FixtureRow[];
  counts: ListingCounts;
  root: IndexRoot;
  /** The POSIX directory inside `root` that produced `rows`. */
  dir: string;
  schemaVersion: number | null;
}

/** Folder rows sort before files; both sort by name, case-insensitively and
 *  with a stable numeric-aware tiebreak so "file-2" precedes "file-10". */
export function sortRows(rows: FixtureRow[]): FixtureRow[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...rows].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

/**
 * Case-insensitive substring filter over the visible name. Kept separate from
 * the projection so "childrenInDir" can never be mistaken for "matches".
 */
export function filterRows(rows: FixtureRow[], query: string): FixtureRow[] {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}

function isFolderEntry(entry: FileEntry): boolean {
  // The schema has no explicit kind: a trailing "/" is the contract's only
  // folder marker (see r-files-explorer-scale.test.tsx's own derivation).
  return String(entry.path || "").endsWith("/");
}

/**
 * Project one directory of an index into explorer rows.
 *
 * A record that cannot produce a stable identity or a displayable name is NOT
 * converted into a substitute file ("File 1"): it is collected in
 * `counts.invalid` and reported. That distinction is the whole point of this
 * module - a broken payload must look broken, not full.
 */
export function projectListing(index: IndexJson, locationPath: string): ListingProjection | null {
  const root = rootForLocation(locationPath);
  const dir = posixDirFor(locationPath);
  if (!root || dir === null) return null;

  const files = Array.isArray(index?.files) ? index.files : [];
  const invalid: InvalidRecord[] = [];
  const inRoot: FileEntry[] = [];

  for (const raw of files) {
    const entry = raw as FileEntry;
    const id = entry?.id;
    const path = entry?.path;
    if (typeof id !== "string" || !id) {
      invalid.push({ reason: "missing-id", raw: { path: entry?.path, root: entry?.root } });
      continue;
    }
    if (typeof path !== "string" || !path.startsWith("/")) {
      invalid.push({ reason: "missing-path", raw: { id, root: entry?.root } });
      continue;
    }
    if (!posixBase(path)) {
      invalid.push({ reason: "missing-name", raw: { id, path } });
      continue;
    }
    if (entry.root !== root) continue;
    if (entry.trashed === true) continue; // the Trash view owns trashed entries
    inRoot.push(entry);
  }

  const rows: FixtureRow[] = [];
  const folders = new Set<string>();
  for (const entry of inRoot) {
    const parent = posixParent(entry.path);
    if (parent === dir) {
      rows.push({
        id: entry.id,
        name: posixBase(entry.path),
        kind: isFolderEntry(entry) ? "folder" : "file",
        sizeBytes: isFolderEntry(entry) ? null : typeof entry.size === "number" ? entry.size : null,
        modified: String(entry.mtime || ""),
      });
      continue;
    }
    // A deeper path implies the immediate directory between `dir` and the file.
    if (parent.startsWith(dir === "/" ? "/" : dir + "/")) {
      const rest = parent.slice(dir === "/" ? 1 : dir.length + 1);
      const first = rest.split("/").filter(Boolean)[0];
      if (first) folders.add(first);
    }
  }
  for (const name of folders) {
    rows.push({
      id: `dir:${root}${dir === "/" ? "" : dir}/${name}`,
      name,
      kind: "folder",
      sizeBytes: null,
      modified: "",
    });
  }

  return {
    rows: sortRows(rows),
    counts: {
      indexedTotal: files.length,
      indexedInRoot: inRoot.length,
      childrenInDir: rows.length,
      invalid,
    },
    root,
    dir,
    schemaVersion: typeof (index as { schemaVersion?: number }).schemaVersion === "number" ? (index as { schemaVersion: number }).schemaVersion : null,
  };
}

/** The index schema this build understands (re-exported for the page's notice). */
export const EXPECTED_SCHEMA_VERSION = INDEX_SCHEMA_VERSION;
