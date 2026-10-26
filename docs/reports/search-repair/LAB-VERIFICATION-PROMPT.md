# Lab verification prompt (self-contained)

Paste this whole file into a fresh agent session that has a **Windows VM** with the
repository checked out at the revision under test. It assumes nothing about the
session that produced the change.

---

You are verifying a completed Search repair. Work on the branch
`arena/cd153e89-supreme-lamp` (or the merged revision named in `STATE.md`).
The authoring environment could not run Windows, PowerShell or a browser, so the
following checks are **unverified** and are your job. Do not mark any of them
passed without executing them.

## 0. Environment

```powershell
git fetch origin; git checkout <revision-under-test>
node --version           # >= 20
pwsh -NoProfile -Command '$PSVersionTable.PSVersion'
```

## 1. Static + deterministic (must be green before anything else)

```powershell
npx tsc -p tsconfig.build.json --noEmit
npm run test:providers                                   # fixtures only, live skipped
npx vitest run src/tests/smoke/search-repair-ui.test.tsx
npx vitest run                                           # full jsdom suite
npx vite build
```

Record the exact counts. A failure here is a real regression, not an
environment quirk.

## 2. Live providers (the part the authoring sandbox could not do)

```powershell
npm run test:providers:live
```

Expected: the GitHub suite (9), the store suite (2), and the provider live suites
for Open Culture, Internet Archive, Openverse, FMHY and rentry all pass. If a
provider fails, capture **its HTTP answer** (`NOT_FOUND` / `RATE_LIMITED` /
`FORBIDDEN` / `AUTH_REQUIRED` / `TIMEOUT` / `PARSE_ERROR`) — that code, not the
stack trace, is what the UI shows the operator.

Also run the reachability probe and diff it against the committed evidence:

```powershell
node scripts/provider-live-probe.mjs --out docs/reports/search-repair/evidence/live-probe.local.json --no-fixtures
```

## 3. PowerShell routes (never executed by the author)

```powershell
pwsh -NoProfile -Command {
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path payloads/ghrdp-server.ps1), [ref]$null, [ref]$errors) | Out-Null
  if ($errors) { $errors | ForEach-Object { $_.Message }; exit 1 } else { 'PARSE OK' }
}
```

Then start the server the way the launcher does and exercise the three routes with
the dash token from `~/.ghrdp/dash-token.txt`:

1. `POST /api/f58/sources` with `{name, baseUrl, notes:"index pages", enabled:true}`
   → 200, the returned `source` carries `notes` and `enabled`.
2. `PATCH /api/f58/sources/<id>` with `{notes:"renamed", enabled:false}`
   → 200, `source.notes`/`source.enabled` updated, and `GET /api/f58/sources`
   shows the same row after a **server restart**.
3. `PATCH` with `{notes: "x => y()"}` → 400 with `errors.notes`.
4. `GET /api/providers/relay?url=<https://github.com/sindresorhus/awesome>`
   → 200, body is the page, header `X-Relay-Final-Url` present.
5. `GET /api/providers/relay?url=<https://example.com/>` → 403 `RELAY_REFUSED`
   (host is not a built-in provider and not a stored source).
6. `GET /api/providers/relay?url=<http://github.com/>` → 400 `VALIDATION_ERROR`
   (https only). Repeat 11 times in a minute → 429 with `retryAfterSeconds`.

## 4. Browser scenarios (the acceptance list)

Serve the built bundle the way the server does, open the Search page in a normal
browser, and record a screenshot or the exact text for each:

| # | Do this | Expect |
|---|---|---|
| A | Paste `https://github.com/mfkl/awesome-vlc#readme`, press Enter | preview card: title, kind, default branch, "Releases: none", categories; **no** credential dialog |
| B | Click "Add as source", then search `vlc` | the new source appears in the per-source list and returns entries |
| C | Search `awesome vlc` | GitHub rows with real titles; each row's Details shows its README section |
| D | Search `saturn` | Openverse rows with licence + attribution |
| E | Search `coffee` | Internet Archive rows with item counts |
| F | Search `Kaufmann` | Open Culture editorial rows |
| G | Add `https://fmhy.net/misc`, search `food` | FMHY rows pointing at `fmhy.net/misc#-food` |
| H | Add `https://rentry.org/megathread`, search `music` | rentry rows naming the section |
| I | Disable one source, reload the page | it stays disabled; the search no longer queries it |
| J | Press Cancel during a search | sources show "cancelled", no error, no endless spinner |
| K | Stop the PowerShell server, repeat C | provider rows still appear and the search says "partial" |
| L | Enter a 404 URL and a bot-challenged URL | distinct messages ("does not exist" vs "bot challenge/relay required"), Add is not offered |
| M | Switch the UI to Sinhala and repeat A–C | no English leftovers in the new surfaces |

## 5. Persistence boundary

1. Add a source, restart the server, reload → the row is still there (server store).
2. Add a source with the server **down** → the row is kept locally and marked
   local-only, with the failure surfaced.
3. Export JSON, wipe the browser profile, import it → the same sources return.

## 6. Report

Write `docs/reports/search-repair/VM-RESULTS-<date>.md` containing, per row of §4
and per check of §1–§5: what you did, what happened, the evidence (text or
screenshot path), and PASS/FAIL/BLOCKED. Append the failures to
`docs/reports/search-repair/README.md` §7 rather than editing the claims there.
