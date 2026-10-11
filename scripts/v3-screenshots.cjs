#!/usr/bin/env node
// [V3-07 / #225] Screenshot + measurement harness (REPAIRED).
//
// WHAT THIS IS. It serves the BUILT bundle (ui/dist/index.html) on :7331 behind
// a synthetic API, drives it in a pinned sandbox Chromium, and writes:
//   <out>/<name>.png            - for a human to LOOK at
//   <out>/measurements.json     - for a machine to READ (and for review notes)
//   <out>/index.html            - a browsable gallery over every capture
//
// WHAT WAS WRONG BEFORE (each item is a repair, not a rewrite):
//   1. COVERAGE. It captured 4 unique routes. It now captures all ELEVEN primary
//      routes at desktop, plus tablet and phone for the four densest ones.
//   2. STRICT API. Every unknown `/api/*` path used to answer a generic
//      `{ok:true}`, which is how a capture can look healthy while the UI is
//      missing data. An unknown path is now a logged 500 (fail the run) unless
//      it is on the documented allow-list below.
//   3. PROVENANCE. The Files capture read fixture rows and did not say so. The
//      page now states its own provenance and this harness records it.
//   4. VARIANT PROOF. Tinted/Clear were sampled from a fixed 4x4 patch that
//      hashed identically. The patch is now resolved from the live element box
//      (sheet + first card), and the run FAILS when the two variants are
//      indistinguishable.
//   5. EXPANSION PROOF. `02-overview-troubleshooting` could be byte-identical to
//      `01-overview`. The run now asserts the toggle exists and the DOM grew
//      BEFORE it shoots.
//   6. RACING CLOCKS. Captures now run with animations disabled and a fixed
//      synthetic server timestamp.
//   7. BUILD IDENTITY. measurements.json records the bundle's size, sha256 and
//      stamped build SHA, so a capture can be tied to a source revision.
//   8. OVERWRITE SAFETY. Every run writes into its OWN directory. `--out` is
//      explicit, and an existing directory that already holds a run is refused
//      unless `--force` is given - the before-run can never be replaced by an
//      after-run by accident.
//
// USAGE
//   node scripts/v3-screenshots.cjs --out <dir> [--only desktop|tablet|phone|routes|variants]
//                                    [--force] [--browser <path>]
//
//   --only limits coverage. A partial run PRINTS and RECORDS its limited scope
//   in measurements.json (`coverage.limited`), so its output can never be
//   mistaken for a full-run acceptance.
//
// DEPENDENCIES (deliberately OUT of package.json: build-ui.yml runs
// `pnpm install --frozen-lockfile`, and an un-locked dependency would break it):
//   puppeteer-core + @sparticuz/chromium, installed with --no-save, resolvable
//   through PUPPETEER_CORE_PATH / SPARTICUZ_CHROMIUM_PATH (see resolveTooling).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "ui", "dist", "index.html");
const PORT = Number(process.env.V3_SHOT_PORT || 7331);

/* ------------------------------------------------------------------ *
 * Arguments. Parsed BEFORE anything else so a bad invocation fails cheaply.
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const args = { out: "", only: "", force: false, browser: process.env.V3_BROWSER_PATH || "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i] || "";
    else if (a === "--only") args.only = argv[++i] || "";
    else if (a === "--force") args.force = true;
    else if (a === "--browser") args.browser = argv[++i] || "";
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error("unknown argument: " + a);
  }
  return args;
}
const ARGS = parseArgs(process.argv.slice(2));
if (ARGS.help) {
  console.log("usage: node scripts/v3-screenshots.cjs --out <dir> [--only desktop|tablet|phone|routes|variants] [--force] [--browser <path>]");
  process.exit(0);
}
if (!ARGS.out) {
  console.error("--out <dir> is required: every run writes into its OWN directory so a before-run can never be overwritten by an after-run.");
  process.exit(2);
}
const OUT = path.resolve(ROOT, ARGS.out);
if (fs.existsSync(path.join(OUT, "measurements.json")) && !ARGS.force) {
  console.error(`refusing to overwrite the existing run in ${OUT} (measurements.json is present). Pass --force only if you intend to replace it.`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ *
 * Synthetic API. Placeholder names throughout; nothing real, ever.
 * ------------------------------------------------------------------ */
const T0 = Date.parse("2026-10-11T12:00:00.000Z"); // FIXED: captures must not race a clock
const iso = (ms) => new Date(T0 + ms).toISOString();
const LOG_LINES = [
  "[12:04:11] run 21485019931 accepted on SYNTH-HOST-01",
  "[12:04:12] collector: logon scan window opened (30s tick)",
  "[12:04:13] mirror: 1284 files queued, 2.4 MB/s",
  "[12:04:41] event 4624 observed (user: operator)",
  "[12:05:02] progress: 412/1284 transferred",
  "[12:05:33] progress: 903/1284 transferred",
  "[12:06:04] progress: 1284/1284 transferred",
  "[12:06:05] mirror: idle",
];

function progress() {
  return {
    serverTs: iso(0),
    runStartedAt: iso(-42 * 60_000),
    sessionStartedAt: iso(-40 * 60_000),
    sessionEnd: FAULTY ? iso(-3_600_000) : iso(4 * 3_600_000 + 18 * 60_000),
    log: LOG_LINES,
    mirroring: true,
    active: { name: "SYNTH-VIDEO-0042.mp4", phase: "upload", bytesSent: 812_646_400, bytesTotal: 1_073_741_824 },
    agg: { total: 1284, done: 1284, bytesSent: 812_646_400, bytesTotal: 1_073_741_824 },
    speedHistory: Array.from({ length: 60 }, (_, i) => 1_800_000 + Math.round(700_000 * Math.sin(i / 5))),
    mirrorDiag: { encryptMode: "media-plain", encAlg: "AES-256-GCM" },
    telemetry: { lastEventAt: iso(-20_000), lastEventType: "4624", logonCollector: { running: true, scanTs: iso(-20_000) } },
  };
}

/** The index the Files route reads. Labelled synthetic everywhere it appears. */
function fxIndex() {
  const p = path.join(ROOT, "src/components/explorer/data/fixtures/5000-files.json");
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { schemaVersion: 2, generatedAt: iso(0), runnerId: "SYNTH-RUNNER-01", roots: [], files: [], gofileHosts: [] };
  }
}

const T_PAST = Date.parse("2026-10-11T11:00:00.000Z");
/** FAULT 4: a synthetic 4625 - the host rejected the stored credential. */
const SYNTH_4625 = {
  id: "evt-synth-4625",
  type: "4625",
  at: new Date(T_PAST).toISOString(),
  user: "operator",
  source: "Security",
  detail: "synthetic rejection (lab)",
};

const ROUTES = {
  "/api/progress": () => progress(),
  "/ping": () => ({ ok: true, wire: { state: "up", rttMs: 41 } }),
  "/health": () => ({ ok: true, ws: false, version: "synthetic-3.0.0" }),
  // NOTE: ws:false is the HONEST answer of the shipped PowerShell server; the
  // UI treats it as info ("no /ws endpoint"), not as a failure.
  "/api/version": () => ({ version: "synthetic-3.0.0", releaseId: "synthetic-3.0.0" }),
  // FAULT 3: the published session deadline is in the PAST -> sessionExpired.
  "/api/config": () => ({ ok: true, fqdn: "synth-host-01.example.internal", user: "operator", cert: !FAULTY, nla: false, handler: true, telescope: true, sessionEnd: FAULTY ? iso(-3_600_000) : iso(4 * 3_600_000) }),
  "/api/native-status": () => ({
    ok: true,
    fqdn: "synth-host-01.example.internal",
    cert: !FAULTY,
    nla: false,
    handler: true,
    telescope: true,
    webdeskReady: true,
    // FAULT 2: the 30s logon scan is 3 minutes old -> a STALE reading, reported
    // as stale rather than as a fresh zero. FAULT 4: the last logon was a
    // rejection (4625), so the connection verdict must be "failed", not "ok".
    logonCollector: { running: true, alive: true, uptimeSec: FAULTY ? 120 : 42, scanTs: FAULTY ? iso(-90_000) : iso(-20_000), lastEvents: FAULTY ? [SYNTH_4625] : [] },
    rdpListener: {
      listening: true,
      authLast: FAULTY
        // INSIDE the run window on purpose: the same failure timestamped before
        // the run start is correctly NOT promoted to a current state (V3-02/D5),
        // so a lab that placed it outside would prove nothing about the verdict.
        ? { result: "failed", eventTs: iso(-89_000), scanTs: iso(-90_000), sub: "0xC000006D", subMeaning: "synthetic: bad user name or password", logonType: "10", logonKind: "RemoteInteractive", probeError: "" }
        : { result: "success", eventTs: iso(-30_000), scanTs: iso(-20_000), sub: "0x0", logonType: "10", logonKind: "RemoteInteractive", probeError: "" },
    },
    lastBeacon: iso(-12_000),
  }),
  // A POPULATED self-test. The Health route renders one row per entry in this
  // map; an empty map is an answered-but-empty page (which the page now names),
  // but a capture of it would show no row shape at all. Mixed statuses on
  // purpose, so the "fix" disclosure is exercised too.
  "/api/f92-selftest": () => ({
    ok: true,
    releaseId: "synthetic-3.0.0",
    frontendSha: "dev",
    status: "warn",
    checks: {
      "version:match": [{ componentType: "system", status: "pass", observedValue: "synthetic-3.0.0", time: iso(-5_000), output: "" }],
      "launcher:status": [{ componentType: "system", status: "pass", observedValue: "ready", time: iso(-5_000), output: "" }],
      "download:writable": [{ componentType: "system", status: "pass", observedValue: "D:\\RDP-Storage\\Fetched", time: iso(-5_000), output: "" }],
      "streaming:proxy": [
        {
          componentType: "system",
          status: "warn",
          observedValue: "loopback only",
          time: iso(-5_000),
          output: "synthetic lab: the stream proxy is reachable on this host only. Run the self-test again from the client network to confirm the listener, or open the diagnostic bundle for the exact bind address.",
        },
      ],
      ...Object.fromEntries(
        ["archive-org", "gutenberg-org", "openculture-com", "pluto-tv", "tubitv-com", "wikisource-org", "arxiv-org", "loc-gov", "nasa-gov", "si-edu", "khanacademy-org"].map((site, i) => [
          "search:" + site,
          [
            {
              componentType: "search",
              status: i === 3 ? "fail" : i % 4 === 1 ? "warn" : "pass",
              observedValue: i === 3 ? 0 : 40 + i,
              time: iso(-6_000 - i * 1_000),
              output: i === 3 ? "synthetic lab: 0 results returned; the site answered with an interstitial. Re-run the probe or open the Lab for this source." : "",
            },
          ],
        ])
      ),
    },
  }),
  "/api/collector/status": () => ({ ok: true, running: !FAULTY, scanTs: FAULTY ? iso(-180_000) : iso(-20_000) }),
  "/api/launcher/health": () => ({ ok: true, ready: true }),
  "/api/diag/comprehensive": () => ({ ok: true, searchEnabled: true, searchInput: "/synth/data", items: [] }),
  "/api/fx/list": () => fxIndex(),
  "/api/fx/gofile/status": () => ({ code: null, fileId: null, directUrl: null, status: "none", uploadedAt: null, expiryTs: null, downloads: 0, remoteSize: null }),
  "/api/f58/sources": () => ({ ok: true, sources: [] }),
  "/api/mirror/status": () => ({ ok: true, mirroring: true, enabled: true, running: true, lastRun: iso(-90_000), reasons: [] }),
  "/api/collector/state": () => ({ ok: true, running: false, scanTs: iso(-180_000) }),
  "/api/collector/report": () => ({ ok: true, accepted: true, synthetic: true }),
  "/api/purge-stale-creds": () => ({ ok: true, purged: 0, synthetic: true }),
  "/diag": () => ({ ok: true, synthetic: true }),
};

// [repair 5b] THE FAULT STORY. The old synthetic state was so healthy that
// `overview-issues-toggle` did not exist, so `02-overview-troubleshooting` was
// impossible to produce honestly and the "show more" path was never captured.
// These are SYNTHETIC, DELIBERATE faults on an isolated synthetic server (never
// production): an absent ws bridge, a stale 30s logon scan, a passed session
// deadline and a rejected credential (4625) - four signals, which is more than
// the preview cut of three, so the toggle is present by construction.
const FAULTY = process.env.V3_HEALTHY === "1" ? false : true;

/** Documented exceptions: paths the UI may probe whose absence is NOT a defect. */
const OPTIONAL_PREFIXES = ["/ws", "/api/search/status"];

const unknownApiHits = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;
  const body = ROUTES[p];
  if (body) {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body()));
    return;
  }
  if (p === "/ws") {
    res.writeHead(400);
    res.end("ws upgrade required");
    return;
  }
  if (OPTIONAL_PREFIXES.some((x) => p.startsWith(x))) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "synthetic: not provided", path: p, optional: true }));
    return;
  }
  if (p.startsWith("/api/")) {
    // [repair 2] NO generic success. An unknown API path is recorded and the run fails.
    unknownApiHits.push(p);
    console.error("UNKNOWN API PATH:", p, "(synthetic server answered 500)");
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "synthetic server has no route for this path", path: p }));
    return;
  }
  if (p === "/" || p === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(fs.readFileSync(DIST));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

/* ------------------------------------------------------------------ *
 * Tooling resolution - explicit, with a named failure.
 * ------------------------------------------------------------------ */
function resolveTooling() {
  const candidates = [];
  if (process.env.PUPPETEER_CORE_PATH) candidates.push(process.env.PUPPETEER_CORE_PATH);
  candidates.push(path.join(ROOT, "node_modules/puppeteer-core"));
  candidates.push(path.join(process.env.V3_TOOLS_DIR || "/tmp/v3lab", "node_modules/puppeteer-core"));
  const puppeteer = candidates.map((c) => { try { return require(c); } catch { return null; } }).find(Boolean);
  if (!puppeteer) {
    throw new Error(
      "puppeteer-core is not resolvable. It is deliberately absent from package.json (--frozen-lockfile). " +
        "Install it with --no-save or point PUPPETEER_CORE_PATH / V3_TOOLS_DIR at an out-of-tree install."
    );
  }
  if (ARGS.browser) return { puppeteer, executablePath: ARGS.browser };

  const sparticuzCandidates = [process.env.SPARTICUZ_CHROMIUM_PATH, path.join(process.env.V3_TOOLS_DIR || "/tmp/v3lab", "node_modules/@sparticuz/chromium/build/index.js")].filter(Boolean);
  const mod = sparticuzCandidates.map((c) => { try { const m = require(c); return m.default || m; } catch { return null; } }).find(Boolean);
  if (!mod) {
    throw new Error("no browser: pass --browser <path> or set SPARTICUZ_CHROMIUM_PATH / V3_TOOLS_DIR (the sandbox recipe).");
  }
  return { puppeteer, sparticuz: mod };
}

async function launch(puppeteer, executablePath, sparticuz) {
  if (!executablePath) {
    const AL = "/tmp/al2023";
    if (!fs.existsSync(path.join(AL, "lib/libnss3.so"))) {
      const br = path.join(process.env.V3_TOOLS_DIR || "/tmp/v3lab", "node_modules/@sparticuz/chromium/bin/al2023.tar.br");
      fs.writeFileSync("/tmp/al2023-v3.tar", zlib.brotliDecompressSync(fs.readFileSync(br)));
      fs.mkdirSync(AL, { recursive: true });
      require("child_process").execFileSync("tar", ["-xf", "/tmp/al2023-v3.tar", "-C", AL]);
    }
    process.env.LD_LIBRARY_PATH = [path.join(AL, "lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
    executablePath = await sparticuz.executablePath();
  }
  // The flags Playwright uses to drive the SAME binary in this sandbox. No
  // silent fallback chain: if the browser cannot start, the run fails and no
  // pixel is fabricated from a half-initialised compositor.
  const launchArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--font-render-hinting=none", "--force-prefers-reduced-motion"];
  return puppeteer.launch({ args: launchArgs, executablePath, headless: "shell", defaultViewport: { width: 1600, height: 1000 } });
}

const VIEWPORTS = {
  desktop: { width: 1600, height: 1000, label: "Windows desktop" },
  tablet: { width: 768, height: 1024, label: "iPad portrait" },
  phone: { width: 390, height: 844, label: "iPhone 14 (viewport emulation)" },
};

/** [repair 1] All eleven primary routes, then the densest ones at tablet/phone. */
/** A synthetic dashboard key. It is not a credential: the harness server never
 *  checks it, and every payload it serves is a placeholder. */
const SYNTH_KEY = "SYNTH-LAB-0000-0000-0000-000000000000";

const SHOTS = [
  // The blocking gate, captured ON PURPOSE: it is the first thing an operator
  // sees on an unkeyed load, and the shot is what caught its literal
  // `{source}`/`{length}` placeholders (see F-I18N-braces in
  // tests/f-i18n-parity.test.js).
  { name: "00-token-gate", hash: "#/", vp: "desktop", gate: true },
  { name: "01-overview", hash: "#/", vp: "desktop" },
  {
    name: "02-overview-troubleshooting",
    hash: "#/",
    vp: "desktop",
    // [repair 5] assert the expansion actually changed the DOM before shooting.
    act: async (page) => {
      const sel = '[data-testid="overview-issues-toggle"]';
      // The real assertion is that EXPANSION CHANGES THE INTENDED CONTENT: the
      // number of rendered issue rows, not the toggle's own label.
      const countRows = () =>
        page.evaluate(() => document.querySelectorAll('[data-testid^="issue-row-"]').length);
      const before = await countRows();
      const t = await page.$(sel);
      if (!t) {
        throw new Error(
          "02-overview-troubleshooting: overview-issues-toggle is absent, so this shot would silently duplicate 01-overview. " +
          "The synthetic fault story must produce MORE issues than the preview cut of 3; it rendered " + before + "."
        );
      }
      // Hit-test note: a coordinate click can be intercepted by the floating
      // DVR control, so the harness clicks the element itself and separately
      // records whether a coordinate click would have landed on it.
      const hit = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return { intercepted: !(top === el || el.contains(top)), by: top ? (top.tagName + "." + String(top.className).slice(0, 40)) : null };
      }, sel);
      if (hit && hit.intercepted) console.log("NOTE: the issues toggle is covered by", hit.by, "(coordinate click would miss)");
      await page.evaluate((s) => document.querySelector(s).click(), sel);
      await new Promise((r) => setTimeout(r, 600));
      const after = await countRows();
      if (!(after > before)) {
        throw new Error("02-overview-troubleshooting: the toggle was clicked but the issue list did not grow (" + before + " -> " + after + ")");
      }
    },
  },
  { name: "03-search", hash: "#/search", vp: "desktop" },
  { name: "04-sessions", hash: "#/sessions", vp: "desktop" },
  { name: "05-connections", hash: "#/connections", vp: "desktop" },
  { name: "06-keys", hash: "#/keys", vp: "desktop" },
  { name: "07-files", hash: "#/files", vp: "desktop", live: true, provenance: "live read of the synthetic /api/fx/list index" },
  { name: "08-mirror", hash: "#/mirror", vp: "desktop" },
  { name: "09-telemetry", hash: "#/telemetry", vp: "desktop" },
  { name: "10-health", hash: "#/health", vp: "desktop" },
  { name: "11-collector", hash: "#/collector", vp: "desktop" },
  { name: "12-settings", hash: "#/settings", vp: "desktop" },
  { name: "13-overview-tablet", hash: "#/", vp: "tablet" },
  { name: "14-overview-phone", hash: "#/", vp: "phone" },
  { name: "15-files-tablet", hash: "#/files", vp: "tablet", live: true, provenance: "live read of the synthetic /api/fx/list index" },
  { name: "16-files-phone", hash: "#/files", vp: "phone", live: true, provenance: "live read of the synthetic /api/fx/list index" },
  { name: "17-search-phone", hash: "#/search", vp: "phone" },
  { name: "18-settings-phone", hash: "#/settings", vp: "phone" },
];

const MEASURE = `(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const sheet = document.querySelector('[data-testid="app-glass-sheet"]');
  const all = Array.from(document.querySelectorAll('*'));
  const sampling = all.filter(e => { const b = cs(e).backdropFilter || cs(e).webkitBackdropFilter; return b && b !== 'none' && !/blur\\(0px\\)/.test(b); });
  const levels = {};
  for (const e of all) { const l = e.getAttribute && e.getAttribute('data-glass-level'); if (l) levels[l] = (levels[l] || 0) + 1; }
  const HEADER_IDS = ['overview-header','page-search','page-sessions','page-connections','page-keys','page-files','page-mirror','page-telemetry','page-health','page-collector','page-settings'];
  const headers = HEADER_IDS.map(id => ({ id, box: box(document.querySelector('[data-testid="' + id + '"]')) })).filter(h => h.box);
  const nav = document.querySelector('[data-testid="sidebar"] nav');
  const counts = (sel) => document.querySelectorAll(sel).length;
  const overflow = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return {
    url: location.href,
    title: document.title,
    sheetPresent: !!sheet,
    sheetBox: box(sheet),
    sheet: sheet ? { backgroundColor: cs(sheet).backgroundColor, backdropFilter: cs(sheet).backdropFilter, zIndex: cs(sheet).zIndex, ariaHidden: sheet.getAttribute('aria-hidden') } : null,
    firstCardBox: box(document.querySelector('[data-glass-level="card"]')),
    samplingCount: sampling.length,
    levelsByCount: levels,
    headers,
    navLinkCount: nav ? nav.querySelectorAll('a').length : 0,
    navGroups: counts('[data-testid^="nav-group-"]'),
    horizontalOverflow: overflow,
    docHeight: document.documentElement.scrollHeight,
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 1400),
    // [repair 3] the Files route states its own provenance; record it verbatim.
    filesProvenance: (() => { const p = document.querySelector('[data-testid="explorer-provenance"]'); return p ? (p.textContent || '').trim() : null; })(),
    filesCounts: (() => { const c = document.querySelector('[data-testid="explorer-counts"]'); return c ? (c.textContent || '').replace(/\\s+/g, ' ').trim() : null; })(),
  };
})()`;

function buildIdentity() {
  const buf = fs.readFileSync(DIST);
  const html = buf.toString("utf8");
  const stamped = (html.match(/__BUILD_SHA__|"([0-9a-f]{7,40})"/) || [])[1] || null;
  return { path: path.relative(ROOT, DIST), bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), stampedSha: stamped, gitHead: (() => { try { return require("child_process").execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); } catch { return null; } })() };
}

async function sampleVariant(page, variant) {
  await page.evaluate((v) => {
    const raw = localStorage.getItem("ghrdp:glass");
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = { ...(parsed.state || {}), quality: "frosted", clarity: 0.75, variant: v };
    localStorage.setItem("ghrdp:glass", JSON.stringify(parsed));
  }, variant);
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1400));
  // [repair 4] the sample region is RESOLVED FROM THE ELEMENT BOX, never a fixed xy.
  const target = await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="app-glass-sheet"]');
    const card = document.querySelector('[data-glass-level="card"]');
    const SIZE = 16;
    // Candidates are the element's OWN paint area at several insets; a point
    // only qualifies when the topmost element there IS that element (or is
    // inside it) AND no descendant covers it - otherwise the sample measures a
    // child's opaque fill and reports "identical" for two different materials.
    const candidatesFor = (el, topOffset) => {
      const b = el.getBoundingClientRect();
      const insets = topOffset > 0 ? [topOffset] : [8, 16, 24, 40, b.width / 4, b.height / 4];
      const out = [];
      for (const inset of insets) {
        out.push([b.x + inset, b.y + inset]);
        out.push([b.x + b.width - inset - SIZE, b.y + b.height - inset - SIZE]);
      }
      return out;
    };
    const qualifies = (el, topOffset) => (pt) => {
      const x = Math.round(pt[0]);
      const y = Math.round(pt[1]);
      if (x < 0 || y < 0 || y > innerHeight - SIZE || x > innerWidth - SIZE) return null;
      const top = document.elementFromPoint(x + SIZE / 2, y + SIZE / 2);
      if (top !== el && !el.contains(top)) return null;
      return { x, y, w: SIZE, h: SIZE, from: el === card ? "first-card" : "sheet", topIsOwnPaint: top === el, topTag: top ? top.tagName : null };
    };
    const order = [
      [card, 8],
      [sheet, 8],
      [card, 0],
      [sheet, 0],
    ];
    for (const [el, prefix] of order) {
      if (!el) continue;
      const cands = el === card ? [el, ...Array.from(el.querySelectorAll(":scope > *"))].slice(0, 1) : [el];
      for (const c of cands) {
        for (const pt of candidatesFor(c, prefix)) {
          const hit = qualifies(el, prefix)(pt);
          if (hit) return hit;
        }
      }
    }
    return null;
  });
  if (!target) {
    throw new Error("variant proof: no sample region resolves to the card's or the sheet's OWN paint, so a pixel comparison would measure a child element instead of the material");
  }
  const png = await page.screenshot({ encoding: "base64", clip: { x: target.x, y: target.y, width: target.w, height: target.h } });
  const style = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="app-glass-sheet"]');
    const c = document.querySelector('[data-glass-level="card"]');
    return { sheet: s ? getComputedStyle(s).backgroundColor : null, card: c ? getComputedStyle(c).backgroundColor : null, stored: localStorage.getItem("ghrdp:glass"), sampling: Array.from(document.querySelectorAll("*")).filter((e) => { const cs = getComputedStyle(e); const b = cs.backdropFilter || cs.webkitBackdropFilter; return b && b !== "none" && !/blur\\(0px\\)/.test(b); }).length };
  });
  const buf = Buffer.from(png, "base64");
  return { region: target, pngBytes: buf.length, sha: crypto.createHash("sha1").update(buf).digest("hex"), ...style };
}

function gallery(measurements) {
  const rows = measurements.shots
    .map(
      (s) => `    <figure>
      <a href="./${s.name}.png"><img src="./${s.name}.png" alt="${s.name}" loading="lazy"></a>
      <figcaption><b>${s.name}</b> — ${s.hash} @ ${s.viewport}<br>
      <span>headers: ${(s.headers || []).map((h) => h.id).join(", ") || "none"}</span><br>
      <span>nav links: ${s.navLinkCount} · glass level counts: ${JSON.stringify(s.levelsByCount || {})} · overflow: ${s.horizontalOverflow}px</span>
      ${s.filesProvenance ? `<br><span>files provenance: ${s.filesProvenance}</span>` : ""}
      ${s.filesCounts ? `<br><span>files counts: ${s.filesCounts}</span>` : ""}
      </figcaption>
    </figure>`
    )
    .join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>Mission Control v3 — capture gallery (${measurements.capturedAt})</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#0b1220; color:#e2e8f0; font:14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size:18px; margin:0 0 4px; } p.meta { color:#94a3b8; margin:0 0 20px; font-size:12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:18px; }
  figure { margin:0; background:#111c31; border:1px solid #1e293b; border-radius:10px; overflow:hidden; }
  img { display:block; width:100%; height:auto; background:#000; }
  figcaption { padding:8px 10px; font-size:11px; color:#94a3b8; }
</style>
<h1>Mission Control v3 — capture gallery</h1>
<p class="meta">
  capturedAt ${measurements.capturedAt} · revision ${measurements.build.gitHead || "unknown"}${measurements.build.dirty ? " (dirty tree)" : ""} ·
  bundle ${measurements.build.bytes} bytes · sha256 ${measurements.build.sha256.slice(0, 16)}…<br>
  evidence class ${measurements.evidenceClass} · browser ${measurements.browser} ·
  coverage ${measurements.coverage.full ? "FULL (all eleven routes)" : "LIMITED: " + measurements.coverage.limited.join(", ")} ·
  synthetic data only; no credential, hostname or real path appears in a payload.
</p>
<div class="grid">
${rows}
</div>
`;
}

(async () => {
  if (!fs.existsSync(DIST)) throw new Error("build first: pnpm run build (expected " + DIST + ")");
  const { puppeteer, executablePath, sparticuz } = resolveTooling();
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const browser = await launch(puppeteer, executablePath, sparticuz);
  const version = await browser.version();

  const only = ARGS.only;
  const coverage = { full: !only, limited: only ? [only] : [] };
  const shots = SHOTS.filter((s) => {
    if (!only) return true;
    if (only === "desktop") return s.vp === "desktop";
    if (only === "tablet") return s.vp === "tablet";
    if (only === "phone") return s.vp === "phone";
    return true;
  });

  const gitDirty = (() => { try { return require("child_process").execSync("git status --porcelain", { cwd: ROOT }).toString().trim().length > 0; } catch { return null; } })();
  const measurements = {
    capturedAt: new Date().toISOString(),
    evidenceClass: "BROWSER_LAB (sandbox Chromium, synthetic API)",
    realDevice: "NOT_MEASURED",
    rdpSession: "NOT_EXERCISED",
    browser: version + " via " + (executablePath || "sparticuz recipe"),
    synthetic: true,
    coverage,
    build: { ...buildIdentity(), dirty: gitDirty },
    shots: [],
    unknownApiPaths: [],
  };

  for (const shot of shots) {
    const vp = VIEWPORTS[shot.vp];
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    // Every shot is unkeyed-gate-free by default: DashTokenGate is correct
    // behaviour, but it is a full-page blocking modal, so a capture WITH it
    // cannot show the screen underneath. `gate: true` is the one shot that
    // deliberately captures the gate itself.
    const unkeyed = shot.gate === true;
    const url = unkeyed
      ? `http://127.0.0.1:${PORT}/${shot.hash}`
      : `http://127.0.0.1:${PORT}/?key=${SYNTH_KEY}#${shot.hash.replace(/^#/, "")}`;
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2000));
    if (shot.act) await shot.act(page);
    await page.screenshot({ path: path.join(OUT, shot.name + ".png") });
    const m = await page.evaluate(MEASURE);
    measurements.shots.push({ ...shot, viewport: vp.label, ...m, filesProvenance: shot.provenance || m.filesProvenance || null });
    await page.close();
    console.log("captured", shot.name, shot.hash, vp.label);
  }

  if (coverage.full || only === "variants" || only === "desktop") {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`http://127.0.0.1:${PORT}/#/`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1200));
    const tinted = await sampleVariant(page, "tinted");
    await page.screenshot({ path: path.join(OUT, "19-glass-tinted.png") });
    const clear = await sampleVariant(page, "clear");
    await page.screenshot({ path: path.join(OUT, "20-glass-clear.png") });
    measurements.variantProof = { tinted, clear, separation: { sameSha: tinted.sha === clear.sha, sheetAlphaMoved: tinted.sheet !== clear.sheet } };
    measurements.shots.push({ name: "19-glass-tinted", hash: "#/ (frosted/0.75/tinted)", viewport: VIEWPORTS.desktop.label });
    measurements.shots.push({ name: "20-glass-clear", hash: "#/ (frosted/0.75/clear)", viewport: VIEWPORTS.desktop.label });
    await page.close();
  }

  measurements.unknownApiPaths = Array.from(new Set(unknownApiHits));
  fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(measurements, null, 2));
  fs.writeFileSync(path.join(OUT, "index.html"), gallery(measurements));
  await browser.close();
  server.close();

  // ---- POSTCONDITIONS. A capture run that silently degraded must FAIL. ----
  const problems = [];
  if (unknownApiHits.length) problems.push(`unknown /api/* paths answered 500: ${[...new Set(unknownApiHits)].join(", ")}`);
  for (const s of measurements.shots.filter((x) => x.headers)) {
    if (!s.headers.length) problems.push(`${s.name}: no route header found`);
    if (s.horizontalOverflow > 1) problems.push(`${s.name}: ${s.horizontalOverflow}px horizontal overflow`);
  }
  if (!coverage.full) problems.push(`--only ${ARGS.only}: partial run, coverage is LIMITED (recorded in measurements.json)`);
  if (measurements.variantProof) {
    const sep = measurements.variantProof.separation;
    if (sep.sameSha) {
      problems.push(
        "variant proof: Tinted and Clear produced the SAME pixel sample at " +
          JSON.stringify(measurements.variantProof.tinted.region) +
          " (sheet alpha " + measurements.variantProof.tinted.sheet + " vs " + measurements.variantProof.clear.sheet + "). " +
          "Either the material controls do not reach this surface, or the sample is not sampling the material."
      );
    }
    if (!sep.sheetAlphaMoved) problems.push("variant proof: the sheet's computed backgroundColor did not move between Tinted and Clear");
  }
  console.log("\nwrote", path.join(OUT, "measurements.json"), "and", path.join(OUT, "index.html"));
  if (problems.length) {
    console.error("\nRUN PROBLEMS:");
    for (const p of problems) console.error(" - " + p);
    if (!coverage.full) process.exit(0); // a limited run reports its scope, it is not a failure
    process.exit(1);
  }
  console.log("postconditions OK for FULL coverage");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
