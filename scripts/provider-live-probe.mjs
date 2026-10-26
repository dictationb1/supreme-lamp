#!/usr/bin/env node
// [SEARCH-REPAIR] Live provider reachability + CORS probe.
//
// WHY THIS EXISTS: the sandbox this repair was authored in can only reach
// github.com / npm / pypi. Open Culture, archive.org and Openverse are NOT
// reachable from there, so "does the adapter talk to the real service" can only
// be answered on a machine with real internet (a GitHub runner or the lab VM).
// This script performs the same probes those adapters make and writes a
// machine-readable report; the `search-provider-probe` workflow runs it and
// commits the report back, so the evidence is durable and diffable.
//
// Usage: node scripts/provider-live-probe.mjs [--out <path>]
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

const UA = "SupremeLampProviderCheck/1.0 (+https://github.com/dictationb1/supreme-lamp)";
const OUT_DEFAULT = "docs/reports/search-repair/evidence/live-probe.json";

const TARGETS = [
  // --- required providers, the exact calls the adapters make ---------------
  { id: "openculture.search", url: "https://www.openculture.com/?s=Walter+Kaufmann", kind: "html",
    expect: [/walter_kaufmanns_lectures\.html/] },
  { id: "openculture.feed", url: "https://www.openculture.com/feed", kind: "xml", expect: [/<item/i] },
  { id: "archive.advancedsearch", url: "https://archive.org/advancedsearch.php?q=title%3A%22pride+and+prejudice%22+AND+mediatype%3Atexts&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&rows=2&page=1&output=json", kind: "json", expect: [/"response"/] },
  { id: "archive.metadata", url: "https://archive.org/metadata/prideandprejudice_20200422", kind: "json", expect: [/"files"/] },
  { id: "openverse.images", url: "https://api.openverse.org/v1/images/?q=saturn&page_size=2", kind: "json", expect: [/"results"/] },
  { id: "openverse.audio", url: "https://api.openverse.org/v1/audio/?q=moonlight&page_size=2", kind: "json", expect: [/"results"/] },
  // --- the three regression examples --------------------------------------
  { id: "github.awesome-vlc.repo", url: "https://api.github.com/repos/mfkl/awesome-vlc", kind: "json", expect: [/"full_name"/] },
  { id: "github.awesome-vlc.readme", url: "https://api.github.com/repos/mfkl/awesome-vlc/readme", kind: "json", expect: [/"content"/] },
  { id: "github.sindresorhus-awesome", url: "https://api.github.com/repos/sindresorhus/awesome", kind: "json", expect: [/"default_branch"/] },
  { id: "github.sindresorhus-awesome.releases", url: "https://api.github.com/repos/sindresorhus/awesome/releases?per_page=1", kind: "json", expect: [/\[\s*\]|"tag_name"/] },
  { id: "github.chessmax.repo", url: "https://api.github.com/repos/ChessMax/awesome-programming-languages", kind: "json", expect: [/"full_name"/] },
  { id: "awesome.re.canonical", url: "https://awesome.re/", kind: "html", expect: [/sindresorhus\/awesome/i] },
  { id: "github.public.html", url: "https://github.com/mfkl/awesome-vlc", kind: "html", expect: [/awesome-vlc/i] },
  // --- the operator's fresh additions -------------------------------------
  { id: "fmhy.misc", url: "https://fmhy.net/misc", kind: "html", expect: [/index|fmhy/i] },
  { id: "rentry.megathread", url: "https://rentry.org/megathread", kind: "html", expect: [/megathread|piracy/i] },
];

function headerSubset(h) {
  const out = {};
  for (const k of ["content-type", "access-control-allow-origin", "location", "retry-after", "x-ratelimit-remaining", "x-ratelimit-limit", "server"]) {
    const v = h.get(k);
    if (v != null) out[k] = v;
  }
  return out;
}

async function probe(t) {
  const started = Date.now();
  const rec = { id: t.id, url: t.url, kind: t.kind };
  try {
    const res = await fetch(t.url, {
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: t.kind === "json" ? "application/json" : "*/*" },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    rec.status = res.status;
    rec.ok = res.ok;
    rec.finalUrl = res.url;
    rec.bytes = body.length;
    rec.headers = headerSubset(res.headers);
    rec.expectMatched = t.expect.every((re) => re.test(body));
    rec.sample = body.slice(0, 240).replace(/\s+/g, " ");
    if (t.kind === "json") {
      try { rec.jsonKeys = Object.keys(JSON.parse(body)).slice(0, 12); } catch { rec.jsonParse = "failed"; }
    }
  } catch (e) {
    rec.error = String((e && e.name) || "Error") + ": " + String((e && e.message) || e).slice(0, 200);
  }
  rec.ms = Date.now() - started;
  return rec;
}

const argOut = (() => { const i = process.argv.indexOf("--out"); return i > 0 ? process.argv[i + 1] : OUT_DEFAULT; })();

const results = [];
for (const t of TARGETS) results.push(await probe(t));

const report = {
  generatedAt: new Date().toISOString(),
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
    failed: results.filter((r) => !r.ok).map((r) => r.id),
  },
  results,
};

await mkdir(dirname(argOut), { recursive: true });
await writeFile(argOut, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(JSON.stringify(report.summary));
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id} ${r.status ?? ""} ${r.bytes ?? 0}B ${r.expectMatched === false ? "EXPECT-MISMATCH " : ""}${r.error || ""}`);
}
// The probe is evidence, not a gate: a blocked provider must not fail the job,
// it must be visible. Exit 0 always; the report carries the verdicts.
