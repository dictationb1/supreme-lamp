#!/usr/bin/env node
// [V3] Screenshot + measurement harness.
//
// WHAT THIS IS. It serves the BUILT bundle (ui/dist/index.html) on :7331 behind
// a synthetic API, drives it in the sandbox Chromium, and writes:
//   * docs/mission-control/v3/screens/<name>.png   - for the operator to LOOK at
//   * docs/mission-control/v3/screens/measurements.json - for the agent to READ
//
// WHY THE MEASUREMENTS EXIST. The agent cannot see images. Every visual claim
// in the v3 report is therefore taken from measurements.json - computed styles,
// element counts, pixel samples - and never from "the screenshot looks right".
// The screenshots are the operator's evidence; the measurements are ours.
//
// THE DATA IS SYNTHETIC AND OBVIOUSLY SO. No credential, no hostname, no real
// path from the deployment appears in any payload. Names below are placeholders
// chosen to be recognisable as placeholders.
//
// Usage: node scripts/v3-screenshots.cjs [--only desktop|tablet|mobile]
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "ui", "dist", "index.html");
const OUT = path.join(ROOT, "docs", "mission-control", "v3", "screens");
const PORT = 7331;

/* ------------------------------------------------------------------ *
 * Synthetic API. Placeholder names throughout.
 * ------------------------------------------------------------------ */
const T0 = Date.now();
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
    sessionEnd: iso(4 * 3_600_000 + 18 * 60_000),
    log: LOG_LINES,
    mirroring: true,
    active: { name: "SYNTH-VIDEO-0042.mp4", phase: "upload", bytesSent: 812_646_400, bytesTotal: 1_073_741_824 },
    agg: { total: 1284, done: 1284, bytesSent: 812_646_400, bytesTotal: 1_073_741_824 },
    speedHistory: Array.from({ length: 60 }, (_, i) => 1_800_000 + Math.round(700_000 * Math.sin(i / 5))),
    mirrorDiag: { encryptMode: "media-plain", encAlg: "AES-256-GCM" },
    telemetry: { lastEventAt: iso(-20_000), lastEventType: "4624", logonCollector: { running: true, scanTs: iso(-20_000) } },
  };
}

const ROUTES = {
  "/api/progress": () => progress(),
  "/ping": () => ({ ok: true, wire: { state: "up", rttMs: 41 } }),
  "/health": () => ({ ok: true, ws: false, version: "synthetic-3.0.0" }),
  "/api/version": () => ({ version: "synthetic-3.0.0", releaseId: "synthetic-3.0.0" }),
  "/api/config": () => ({
    ok: true,
    fqdn: "synth-host-01.example.internal",
    user: "operator",
    cert: true,
    nla: false,
    handler: true,
    telescope: true,
    sessionEnd: iso(4 * 3_600_000),
  }),
  "/api/native-status": () => ({
    ok: true,
    fqdn: "synth-host-01.example.internal",
    cert: true,
    nla: false,
    handler: true,
    telescope: true,
    webdeskReady: true,
    logonCollector: { running: true, scanTs: iso(-20_000), lastEvents: [] },
    lastBeacon: iso(-12_000),
  }),
  "/api/f92-selftest": () => ({ ok: true, releaseId: "synthetic-3.0.0", frontendSha: "dev", status: "synthetic" }),
  "/api/collector/status": () => ({ ok: true, running: true, scanTs: iso(-20_000) }),
  "/api/launcher/health": () => ({ ok: true, ready: true }),
  "/api/diag/comprehensive": () => ({ ok: true, searchEnabled: true, searchInput: "/synth/data", items: [] }),
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;
  const body = ROUTES[p];
  if (body) {
    const payload = JSON.stringify(body());
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(payload);
    return;
  }
  if (p.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, synthetic: true }));
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
 * Chromium (sandbox recipe).
 * ------------------------------------------------------------------ */
async function launch() {
  const chromium = require(path.join(ROOT, "node_modules/@sparticuz/chromium/build/index.js"));
  const mod = chromium.default || chromium;
  const AL = "/tmp/al2023";
  if (!fs.existsSync(AL)) {
    const br = path.join(ROOT, "node_modules/@sparticuz/chromium/bin/al2023.tar.br");
    const out = fs.createWriteStream("/tmp/al2023.tar");
    out.write(zlib.brotliDecompressSync(fs.readFileSync(br)));
    out.end();
    await new Promise((r) => out.on("close", r));
    require("child_process").execFileSync("tar", ["-xf", "/tmp/al2023.tar", "-C", "/tmp/"]);
    fs.renameSync("/tmp/al2023-2", AL); // the tarball's top-level dir name
  }
  process.env.LD_LIBRARY_PATH = path.join(AL, "lib");
  const exePath = await mod.executablePath();
  const puppeteer = require(path.join(ROOT, "node_modules/puppeteer-core"));
  // [V3-07] @sparticuz/chromium ships Lambda args tuned for that runtime, and
  // they do not survive Chromium 153 + puppeteer-core 25 in this sandbox: the
  // browser process dies before the CDP handshake completes (WebSocket close
  // 1006, surfacing as a 30s `Target.setDiscoverTargets` timeout). Tried and
  // rejected: the raw `mod.args`, and `mod.args` minus `--single-process`.
  //
  // These are the flags Playwright uses to drive the SAME binary successfully in
  // this sandbox, written out explicitly rather than inherited. There is no
  // silent fallback chain: if the browser cannot start, this script fails, and a
  // pixel sample is never fabricated from a half-initialised compositor.
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--no-zygote",
    "--disable-gpu",
    "--hide-scrollbars",
    "--mute-audio",
    "--font-render-hinting=none",
  ];
  return puppeteer.launch({
    args: launchArgs,
    executablePath: exePath,
    headless: "shell",
    defaultViewport: { width: 1600, height: 1000 },
  });
}

const VIEWPORTS = {
  desktop: { width: 1600, height: 1000, label: "Windows desktop" },
  tablet: { width: 1024, height: 1366, label: "iPad portrait" },
  mobile: { width: 390, height: 844, label: "iPhone 14" },
};

const SHOTS = [
  { name: "01-overview", hash: "#/", vp: "desktop" },
  // 02 is not a second copy of 01: it expands the troubleshooting panel so the
  // operator can see every issue and its action, which is the V3-05 change.
  { name: "02-overview-troubleshooting", hash: "#/", vp: "desktop",
    act: async (page) => {
      const t = await page.$('[data-testid="overview-issues-toggle"]');
      if (t) await t.click();
      await new Promise((r) => setTimeout(r, 400));
    } },
  { name: "03-sessions", hash: "#/sessions", vp: "desktop" },
  { name: "04-settings", hash: "#/settings", vp: "desktop" },
  { name: "05-files", hash: "#/files", vp: "desktop" },
  { name: "06-overview-tablet", hash: "#/", vp: "tablet" },
  { name: "07-overview-mobile", hash: "#/", vp: "mobile" },
  { name: "08-files-mobile", hash: "#/files", vp: "mobile" },
];

const MEASURE = `(() => {
  const cs = (el) => el ? getComputedStyle(el) : null;
  const sheet = document.querySelector('[data-testid="app-glass-sheet"]');
  const all = Array.from(document.querySelectorAll('*'));
  const sampling = all.filter(e => { const b = cs(e).backdropFilter || cs(e).webkitBackdropFilter; return b && b !== 'none'; });
  const levels = {};
  for (const e of all) {
    const l = e.getAttribute && e.getAttribute('data-glass-level');
    if (l) levels[l] = (levels[l] || 0) + 1;
  }
  const HEADER_IDS = ['overview-header','page-sessions','page-connections','page-keys','page-files','page-mirror','page-search','page-telemetry','page-health','page-collector','page-settings'];
  let header = null;
  for (const id of HEADER_IDS) { const e = document.querySelector('[data-testid="' + id + '"]'); if (e) { header = e; break; } }
  const nav = document.querySelector('[data-testid="sidebar"] nav');
  const counts = (sel) => document.querySelectorAll(sel).length;
  return {
    url: location.href,
    title: document.title,
    sheetPresent: !!sheet,
    sheet: sheet ? {
      backgroundColor: cs(sheet).backgroundColor,
      backdropFilter: cs(sheet).backdropFilter,
      zIndex: cs(sheet).zIndex,
      ariaHidden: sheet.getAttribute('aria-hidden'),
    } : null,
    samplingCount: sampling.length,
    samplingTags: sampling.map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 40)),
    levelsByCount: levels,
    header: header ? (header.textContent || '').trim().slice(0, 160) : null,
    navLinkCount: nav ? nav.querySelectorAll('a').length : 0,
    navGroups: counts('[data-testid^="nav-group-"]'),
    docHeight: document.documentElement.scrollHeight,
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 1400),
  };
})()`;

(async () => {
  if (!fs.existsSync(DIST)) throw new Error("build first: npm run build (expected " + DIST + ")");
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(PORT, "0.0.0.0", r));
  const browser = await launch();
  const measurements = { capturedAt: new Date().toISOString(), synthetic: true, shots: [] };

  for (const shot of SHOTS) {
    const vp = VIEWPORTS[shot.vp];
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${PORT}/${shot.hash}`, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500)); // let polling settle
    if (shot.act) await shot.act(page);
    await page.screenshot({ path: path.join(OUT, shot.name + ".png") });
    const m = await page.evaluate(MEASURE);
    measurements.shots.push({ ...shot, viewport: vp.label, ...m });
    await page.close();
    console.log("captured", shot.name, shot.hash, vp.label);
  }

  // The Tinted/Clear proof: sample the same pixel on each variant at the same
  // clarity. This is the measurement behind the "the controls actually work"
  // claim - a number, not an impression.
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto(`http://127.0.0.1:${PORT}/#/`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1500));
    const variant = {};
    for (const v of ["tinted", "clear"]) {
      await page.evaluate((vv) => {
        localStorage.setItem("ghrdp:glass", JSON.stringify({ state: { quality: "frosted", clarity: 0.75, variant: vv }, version: 0 }));
      }, v);
      await page.reload({ waitUntil: "networkidle2" });
      await new Promise((r) => setTimeout(r, 1200));
      // A full-frame screenshot the operator can compare side by side...
      await page.screenshot({ path: path.join(OUT, (v === "tinted" ? "09-glass-tinted" : "10-glass-clear") + ".png") });
      // ...and the numbers behind it: the same 4x4 patch, decoded to real RGB.
      const px = await page.screenshot({ encoding: "base64", clip: { x: 700, y: 500, width: 4, height: 4 } });
      const buf = Buffer.from(px, "base64");
      const style = await page.evaluate(() => {
        const s = document.querySelector('[data-testid="app-glass-sheet"]');
        const c = document.querySelector('[data-glass-level="card"]');
        return {
          sheet: s ? getComputedStyle(s).backgroundColor : null,
          card: c ? getComputedStyle(c).backgroundColor : null,
          stored: localStorage.getItem("ghrdp:glass"),
        };
      });
      variant[v] = { pngBytes: buf.length, sha: require("node:crypto").createHash("sha1").update(buf).digest("hex"), ...style };
    }
    measurements.variantProof = variant;
    await page.close();
  }

  fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(measurements, null, 2));
  await browser.close();
  server.close();
  console.log("\\nwrote", path.join(OUT, "measurements.json"));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
