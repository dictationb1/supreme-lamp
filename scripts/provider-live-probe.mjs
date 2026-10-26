#!/usr/bin/env node
// [SEARCH-REPAIR] Live provider probe + fixture recorder.
//
// The authoring sandbox can only reach github.com / npm / pypi, so the real
// answers from Open Culture, archive.org, Openverse, fmhy.net and rentry.org
// have to be captured where the internet is real (a GitHub runner, or the lab
// VM). This script:
//   1. performs the EXACT requests the shipped adapters make (including an
//      Origin header, so the reported `access-control-allow-origin` is the one
//      a browser would see - that decides direct-transport vs relay);
//   2. saves each response body under tests/providers/fixtures/live/ so the
//      offline regression suite parses REAL payloads, not hand-written ones;
//   3. writes docs/reports/search-repair/evidence/live-probe.json.
//
// Usage: node scripts/provider-live-probe.mjs [--out <json>] [--fixtures <dir>] [--no-fixtures]
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const UA = "SupremeLampProviderCheck/1.0 (+https://github.com/dictationb1/supreme-lamp)";
const ORIGIN = "https://ghrdp.example.test";
const OUT_DEFAULT = "docs/reports/search-repair/evidence/live-probe.json";
const FIX_DEFAULT = "tests/providers/fixtures/live";
const MAX_FIXTURE_BYTES = 400_000;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const outPath = arg("--out", OUT_DEFAULT);
const fixDir = arg("--fixtures", FIX_DEFAULT);
const writeFixtures = !process.argv.includes("--no-fixtures");

const TARGETS = [
  // --- required providers: the exact calls the adapters make --------------
  { id: "openculture.search", url: "https://www.openculture.com/?s=Walter+Kaufmann", kind: "html", expect: [/walter_kaufmanns_lectures\.html/] },
  { id: "openculture.feed", url: "https://www.openculture.com/feed", kind: "xml", expect: [/<item/i] },
  { id: "openculture.category", url: "https://www.openculture.com/free_online_courses", kind: "html", expect: [/free_online_courses|openculture/i] },
  { id: "archive.advancedsearch", url: "https://archive.org/advancedsearch.php?q=title%3A%22pride+and+prejudice%22+AND+mediatype%3Atexts&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&fl%5B%5D=downloads&rows=3&page=1&output=json", kind: "json", expect: [/"response"/, /"docs"/] },
  { id: "archive.scrape", url: "https://archive.org/services/search/v1/scrape?q=collection%3Alibrivoxaudio&fields=identifier,title&count=100&page=1", kind: "json", expect: [/items/] },
  { id: "openverse.images", url: "https://api.openverse.org/v1/images/?q=saturn&page_size=2", kind: "json", expect: [/"results"/] },
  { id: "openverse.audio", url: "https://api.openverse.org/v1/audio/?q=moonlight&page_size=2", kind: "json", expect: [/"results"/] },
  // --- the three regression examples --------------------------------------
  { id: "github.awesome-vlc.repo", url: "https://api.github.com/repos/mfkl/awesome-vlc", kind: "json", expect: [/"full_name"/] },
  { id: "github.awesome-vlc.readme", url: "https://api.github.com/repos/mfkl/awesome-vlc/readme", kind: "json", expect: [/"content"/] },
  { id: "github.sindresorhus-awesome", url: "https://api.github.com/repos/sindresorhus/awesome", kind: "json", expect: [/"default_branch"/] },
  { id: "github.sindresorhus-awesome.readme", url: "https://api.github.com/repos/sindresorhus/awesome/readme", kind: "json", expect: [/"content"/] },
  { id: "github.sindresorhus-awesome.releases", url: "https://api.github.com/repos/sindresorhus/awesome/releases?per_page=1", kind: "json", expect: [/\[\s*\]|"tag_name"/] },
  { id: "github.chessmax.repo", url: "https://api.github.com/repos/ChessMax/awesome-programming-languages", kind: "json", expect: [/"full_name"/] },
  { id: "github.chessmax.readme", url: "https://api.github.com/repos/ChessMax/awesome-programming-languages/readme", kind: "json", expect: [/"content"/] },
  { id: "github.search", url: "https://api.github.com/search/repositories?q=awesome+vlc&per_page=2", kind: "json", expect: [/total_count/] },
  { id: "awesome.re.canonical", url: "https://awesome.re/", kind: "html", expect: [/sindresorhus\/awesome|awesome/i] },
  { id: "github.public.html", url: "https://github.com/mfkl/awesome-vlc", kind: "html", expect: [/awesome-vlc/i] },
  // --- the operator's fresh additions -------------------------------------
  { id: "fmhy.misc", url: "https://fmhy.net/misc", kind: "html", expect: [/index|fmhy/i] },
  { id: "fmhy.sitemap", url: "https://fmhy.net/sitemap.xml", kind: "xml", expect: [/<loc>/i] },
  { id: "fmhy.search", url: "https://fmhy.net/search?q=coffee", kind: "html", expect: [/coffee|fmhy|search/i] },
  { id: "rentry.megathread", url: "https://rentry.org/megathread", kind: "html", expect: [/megathread|piracy/i] },
  { id: "rentry.megathread.raw", url: "https://rentry.org/megathread/raw", kind: "html", expect: [/\[|\/megathread/] },
  { id: "rentry.movies", url: "https://rentry.org/megathread-movies-and-tv", kind: "html", expect: [/movie|tv|rentry/i] },
];

function headerSubset(h) {
  const out = {};
  for (const k of ["content-type", "access-control-allow-origin", "access-control-allow-headers", "location", "retry-after", "x-ratelimit-remaining", "x-ratelimit-limit", "server"]) {
    const v = h.get(k);
    if (v != null) out[k] = v;
  }
  return out;
}

async function fetchOnce(url) {
  return fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": UA, Origin: ORIGIN, Accept: "*/*" },
    signal: AbortSignal.timeout(30_000),
  });
}

async function probe(t) {
  const started = Date.now();
  const rec = { id: t.id, url: t.url, kind: t.kind };
  try {
    const res = await fetchOnce(t.url);
    const body = await res.text();
    rec.status = res.status;
    rec.ok = res.ok;
    rec.finalUrl = res.url;
    rec.bytes = body.length;
    rec.headers = headerSubset(res.headers);
    rec.corsForBrowserOrigin = rec.headers["access-control-allow-origin"] === "*" || rec.headers["access-control-allow-origin"] === ORIGIN;
    rec.transport = rec.corsForBrowserOrigin ? "direct" : "relay-required";
    rec.expectMatched = t.expect.every((re) => re.test(body));
    rec.sample = body.slice(0, 200).replace(/\s+/g, " ");
    if (t.kind === "json") {
      try { rec.jsonKeys = Object.keys(JSON.parse(body)).slice(0, 12); } catch { rec.jsonParse = "failed"; }
    }
    if (writeFixtures) {
      const ext = t.kind === "json" ? "json" : t.kind === "xml" ? "xml" : "html";
      const file = `${fixDir}/${t.id.replace(/\./g, "-")}.${ext}`;
      await writeFile(file, body.slice(0, MAX_FIXTURE_BYTES), "utf8").catch(() => {});
      rec.fixture = file;
    }
    return { rec, body };
  } catch (e) {
    rec.error = String((e && e.name) || "Error") + ": " + String((e && e.message) || e).slice(0, 200);
    rec.ms = Date.now() - started;
    return { rec, body: "" };
  }
}

const results = [];
const bodies = {};
for (const t of TARGETS) {
  const { rec, body } = await probe(t);
  rec.ms = Date.now() - startedFallback(rec);
  results.push(rec);
  bodies[t.id] = body;
}

// archive.metadata needs a REAL identifier: derive it from the search we just
// ran, so the probe can never assert against an invented item id.
const iaBody = bodies["archive.advancedsearch"] || "";
let iaId = "";
try { iaId = JSON.parse(iaBody)?.response?.docs?.[0]?.identifier || ""; } catch {}
if (iaId) {
  const metaUrl = `https://archive.org/metadata/${encodeURIComponent(iaId)}`;
  const { rec, body } = await probe({ id: "archive.metadata", url: metaUrl, kind: "json", expect: [/"files"/] });
  rec.derivedFromIdentifier = iaId;
  results.push(rec);
  const dl = `https://archive.org/download/${encodeURIComponent(iaId)}/`;
  const dlp = await probe({ id: "archive.download-dir", url: dl, kind: "json", expect: [/files/] });
  dlp.rec.derivedFromIdentifier = iaId;
  results.push(dlp.rec);
} else {
  results.push({ id: "archive.metadata", url: "https://archive.org/metadata/<none>", skipped: "no identifier in advancedsearch response" });
}

function startedFallback(rec) { return rec.ms || 0; }

const report = {
  generatedAt: new Date().toISOString(),
  origin: ORIGIN,
  runner: {
    platform: process.platform,
    node: process.version,
    ci: process.env.GITHUB_ACTIONS === "true",
    workflowSha: process.env.GITHUB_SHA || "",
    workflowRun: process.env.GITHUB_RUN_ID || "",
  },
  summary: {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    expectMatched: results.filter((r) => r.expectMatched).length,
    direct: results.filter((r) => r.transport === "direct").length,
    relayRequired: results.filter((r) => r.transport === "relay-required").map((r) => r.id),
    failed: results.filter((r) => !r.ok).map((r) => r.id),
  },
  results,
};
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report.summary));
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "SKIP/FAIL"} ${r.id} ${r.status ?? ""} ${r.bytes ?? 0}B transport=${r.transport ?? "-"} ${r.expectMatched === false ? "EXPECT-MISMATCH" : ""} ${r.error || r.skipped || ""}`);
}
// Evidence, not a gate: a blocked provider must be visible, never fatal.
