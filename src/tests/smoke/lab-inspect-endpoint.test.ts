// [LAB-INSPECT-2026-10-25] Real HTTP tests for BOTH /api/lab/inspect modes.
//
// These drive the SHIPPED client (src/api/lab/index.ts) against a real http
// server, so they prove the request shape, the mode selection the server must
// implement, and the propagation of actionable error codes - not the presence of
// source text. The server-side PowerShell route is additionally pinned by the
// structural contract test at the bottom of this file (it cannot be executed on
// Linux; see docs/reports/2026-10-25-ui-launch-search-repair/ for that gap).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { actionableErrorKey, inspectResultUrl, inspectSource } from "@/api/lab";
import { clearDashToken, DASH_TOKEN_STORAGE_KEY } from "@/lib/dashToken";
import { vi } from "vitest";

interface Seen {
  method: string;
  url: string;
  dashToken: string;
  body: Record<string, unknown>;
  rawAuth: string;
}

const seen: Seen[] = [];
let server: Server;
let base = "";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += String(c)));
    req.on("end", () => resolve(data));
  });
}

/** The route under test, implemented to the repaired contract. */
async function handleInspect(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = {};
  }
  seen.push({
    method: req.method || "",
    url: req.url || "",
    dashToken: String(req.headers["x-dash-token"] || ""),
    body,
    rawAuth: String(req.headers.authorization || ""),
  });
  const json = (status: number, payload: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
  };

  // MODE SELECTION FIRST - this is the repaired contract.
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  if (!sourceId && !sourceUrl) return json(400, { code: "VALIDATION_ERROR", messageKey: "search.errors.validation", retryAfterSeconds: 0 });

  if (sourceId) {
    if (sourceId === "missing") return json(404, { code: "NOT_FOUND", messageKey: "lab.notFound", retryAfterSeconds: 0 });
    return json(200, {
      hostname: "archive.org",
      title: "Internet Archive",
      links: [{ text: "/details/a", href: "https://archive.org/details/a", matches: true }],
      fetchedAt: "2026-10-25T14:00:00Z",
      linkCount: 1,
      matchCount: 1,
      source: "sitemap.xml",
      sourceUrls: 1,
    });
  }

  // result-URL mode
  if (!sourceUrl.startsWith("https://")) return json(400, { code: "VALIDATION_ERROR", messageKey: "newSiteHttpsRequired" });
  if (sourceUrl.includes("refused-host")) {
    return json(403, {
      code: "HOSTNAME_MISMATCH",
      messageKey: "lab.hostnameMismatchRedirect",
      retryAfterSeconds: 0,
      details: { offHost: "evil.example", url: "https://evil.example/x" },
    });
  }
  if (sourceUrl.includes("rate-limited")) {
    return json(429, { code: "RATE_LIMITED", messageKey: "lab.rateLimited", retryAfterSeconds: 42 });
  }
  if (sourceUrl.includes("boom")) {
    res.writeHead(500);
    res.end("not json");
    return;
  }
  return json(200, {
    hostname: new URL(sourceUrl).host,
    finalHostname: "github.com",
    redirectChain: ["awesome.re"],
    resultKind: "repository",
    title: "ChessMax/awesome-programming-languages",
    links: [{ text: "README.md", href: "https://github.com/ChessMax/awesome-programming-languages/blob/main/README.md", matches: false }],
    fetchedAt: "2026-10-25T14:00:00Z",
    linkCount: 1,
    matchCount: 0,
  });
}

/** A real fetch built on node:http (the suite-wide stub always fails on purpose). */
function installRealFetch(): void {
  const real = (input: RequestInfo | URL, init?: RequestInit): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  }> =>
    new Promise((resolve, reject) => {
      const url = new URL(String(input));
      const req = httpRequest(
        { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: init?.method || "GET", headers: (init?.headers as Record<string, string>) || {} },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += String(c)));
          res.on("end", () => {
            const status = res.statusCode || 0;
            resolve({
              ok: status >= 200 && status < 300,
              status,
              json: async () => JSON.parse(data),
              text: async () => data,
            });
          });
        },
      );
      req.on("error", reject);
      if (init?.body) req.write(String(init.body));
      req.end();
    });
  vi.stubGlobal("fetch", real as unknown as typeof fetch);
}

beforeAll(async () => {
  installRealFetch();
  server = createServer((req, res) => {
    if ((req.url || "").startsWith("/api/lab/inspect")) {
      void handleInspect(req, res);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = "http://127.0.0.1:" + port;
  // apiBase() uses location.origin when the page is served on the API port.
  Object.defineProperty(window, "location", {
    value: { protocol: "http:", hostname: "127.0.0.1", port: "7331", host: "127.0.0.1:7331", origin: base, search: "", hash: "" },
    writable: true,
    configurable: true,
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen.length = 0;
  window.localStorage.clear();
  clearDashToken();
  window.localStorage.setItem(DASH_TOKEN_STORAGE_KEY, "dash-token-xyz");
});

describe("[LAB-INSPECT] stored-source mode", () => {
  it("sends sourceId only (never a URL) and the token in a header, not the URL", async () => {
    const res = await inspectSource("archive-org", "matter");
    expect(res.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toEqual({ sourceId: "archive-org", query: "matter" });
    expect(seen[0].url).not.toContain("key=");
    expect(seen[0].url).not.toContain("dash-token-xyz");
    expect(seen[0].dashToken).toBe("dash-token-xyz");
  });

  it("maps an unknown id to the not-found key instead of a generic error", async () => {
    const res = await inspectSource("missing", "");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.messageKey).toBe("lab.notFound");
  });
});

describe("[LAB-INSPECT] result-URL mode (the previously unreachable path)", () => {
  it("sends sourceUrl + query and Inspects the result's own URL", async () => {
    const url = "https://github.com/ChessMax/awesome-programming-languages";
    const res = await inspectResultUrl(url, "Programming Languages");
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toEqual({ sourceUrl: url, query: "Programming Languages" });
    expect(seen[0].body.sourceId).toBeUndefined();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.resultKind).toBe("repository");
      expect(res.data.finalHostname).toBe("github.com");
      expect(res.data.redirectChain).toEqual(["awesome.re"]);
      expect(res.data.links).toHaveLength(1);
      expect(res.data.matchCount).toBe(0);
    }
  });

  it("a refused off-site redirect keeps its code AND the off-host detail", async () => {
    const res = await inspectResultUrl("https://refused-host.example/page", "x");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("HOSTNAME_MISMATCH");
      expect(res.error.details?.offHost).toBe("evil.example");
      expect(res.error.messageKey).toBe("lab.hostnameMismatchRedirect");
    }
  });

  it("a rate limit carries the server's retry hint", async () => {
    const res = await inspectResultUrl("https://rate-limited.example/", "");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("RATE_LIMITED");
      expect(res.error.retryAfterSeconds).toBe(42);
    }
  });

  it("a 500 with a non-JSON body is a NAMED failure, not 'something went wrong'", async () => {
    const res = await inspectResultUrl("https://boom.example/", "");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("HTTP_500");
      expect(res.error.messageKey).not.toBe("search.errors.generic");
    }
  });

  it("rejects a non-https target before any request is made", async () => {
    const res = await inspectResultUrl("http://insecure.example/", "");
    expect(res.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("a dead server names the token gate when there is no token", async () => {
    clearDashToken();
    window.localStorage.clear();
    Object.defineProperty(window, "location", {
      value: { protocol: "http:", hostname: "127.0.0.1", port: "7331", host: "127.0.0.1:7331", origin: "http://127.0.0.1:9", search: "", hash: "" },
      writable: true,
      configurable: true,
    });
    const res = await inspectResultUrl("https://github.com/x/y", "");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.messageKey).toBe("addSite.authMissing");
  });
});

describe("[LAB-INSPECT] actionable error keys", () => {
  it("every code the route can emit maps to something specific", () => {
    for (const code of ["RATE_LIMITED", "HOSTNAME_MISMATCH", "REDIRECT_REFUSED", "NOT_FOUND", "SIZE_LIMIT", "TIMEOUT", "TRANSPORT_UNAVAILABLE", "FORBIDDEN"]) {
      expect(actionableErrorKey(code)).not.toBe("search.errors.generic");
    }
    expect(actionableErrorKey("SOMETHING_ELSE")).toBe("search.errors.generic");
  });
});

// ---------------------------------------------------------------------------
// The PowerShell route cannot run on this host (no Windows PowerShell 5.1, no
// pwsh). This pins the STRUCTURAL contract that the repair establishes, so the
// unreachable-result-mode regression cannot come back silently:
//   * the mode is selected before any mode-specific validation;
//   * there is exactly ONE fetch budget charge per inspection;
//   * there is exactly ONE pipeline (no duplicated fetch ladder);
//   * every pipeline fetch carries the per-source allowlist;
//   * the save probe records the cross-site redirect target.
// ---------------------------------------------------------------------------
describe("[LAB-INSPECT] server route structural contract", () => {
  const ps = readFileSync("payloads/ghrdp-server.ps1", "utf8");
  const start = ps.indexOf("if ($path -eq '/api/lab/inspect') {");
  const end = ps.indexOf("# /api/f58/sources or /api/lab/inspect with any other method.", start);
  const route = ps.slice(start, end);

  it("selects the mode BEFORE validating it (result mode is reachable)", () => {
    expect(start).toBeGreaterThan(0);
    expect(route).toContain("$f78Mode = 'result'");
    // The old early rejection must be gone...
    expect(route).not.toContain("if (-not $f78SourceId) {");
    // ...and mode selection must come before the stored-source 404/403 checks.
    const modeSel = route.indexOf("if ($f78SourceId) { $f78Mode = 'source' }");
    const sourceLookup = route.indexOf("if (-not $script:F78Sources.ContainsKey($f78SourceId)) {");
    expect(modeSel).toBeGreaterThan(-1);
    expect(sourceLookup).toBeGreaterThan(modeSel);
  });

  it("charges the fetch budget exactly once per inspection", () => {
    expect(route.match(/\$script:F78LabInspectRateLimiter\[\$f78RateKey\] = \$f78Hits/g) || []).toHaveLength(1);
  });

  it("runs ONE pipeline, not two", () => {
    // ONE sitemap/hint ladder (its header comment appears once) and ONE primary
    // page fetch. The phase marker itself may be re-set inside that single
    // pipeline when it falls back to the page fetch.
    expect(route.match(/SITEMAP-INDEX RECURSION \+ PER-SITE HINTS/g) || []).toHaveLength(1);
    expect(route.match(/\$f78Fetch = Invoke-F78SecureFetch/g) || []).toHaveLength(1);
    expect(route.match(/Invoke-F88SiteSearch -HostName/g) || []).toHaveLength(1);
  });

  it("passes the per-source allowlist to every pipeline fetch", () => {
    expect((route.match(/-AllowedHosts \$f78AllowedHosts/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  it("the hardened fetch refuses an off-host hop and reports the host it refused", () => {
    expect(ps).toContain("[string[]]$AllowedHosts = @()");
    expect(ps).toMatch(/code = 'HOSTNAME_MISMATCH'; httpStatus = 403; host = /);
  });

  it("the save probe records the cross-site redirect target as a per-source fact", () => {
    expect(ps).toContain("$f78RedirectHost = $f78FinalHost");
    expect(ps).toContain("redirectHostname = $f78RedirectHost");
    // ...and it is NOT added to the global host allowlist.
    expect(ps).not.toMatch(/\$script:F78AllowHosts\[\$f78RedirectHost\]/);
  });

  it("answers both modes with ONE error envelope shape", () => {
    expect(route).toContain("New-F78Error -Code");
    expect(route).toContain("$f78ErrPayload = [ordered]@{ code = [string]$f78Fetch.code; messageKey = $f78ErrKey; retryAfterSeconds = 0 }");
    expect(route).toContain("details");
  });
});
