// [RDP-HANDLER] gesture preservation and prompt guidance regression.
// The 40112159644 capability run showed PRODUCTION_HANDLER_NOT_OBSERVED:
// ticket 200 but no fresh handler beacon, with the native screenshot showing
// the Chrome "Open ghrdp-rdp-launcher?" prompt still visible. Root cause was
// twofold: (1) the POST /api/rdp-token is async, so the final
// window.location.href was no longer in the user-gesture window and Chrome
// required an extra prompt click without telling the dashboard; (2) the
// dashboard said "protocol dispatched - mstsc should open" even while the
// prompt was waiting, which is misleading. The repair:
//  - launchProto keeps the dashboard page (hidden iframe) instead of navigating away,
//  - fireAutoLogin preserves transient activation via a synchronous window.open
//    placeholder before the ticket fetch and falls back to the iframe,
//  - the note explicitly names the browser prompt and the beacon wait, and after
//    8s without a beacon tells the operator to click Open.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const api = readFileSync("src/lib/api.ts", "utf8");
const store = readFileSync("src/stores/sessionStore.ts", "utf8");

describe("RDP handler gesture + prompt honesty", () => {
  it("launchProto keeps the dashboard (iframe) and does not navigate away unconditionally", () => {
    // Must create a hidden iframe and not use location.href as the only path.
    expect(api).toMatch(/document\.createElement\(['"]iframe['"]\)/);
    expect(api).toMatch(/iframe\.src\s*=\s*url/);
    // The old contract was "top-level navigation (U1), never an iframe" - that comment must be gone or qualified.
    expect(api).not.toMatch(/never an iframe/);
    // Still has a fallback for browsers that ignore iframe protocol.
    expect(api).toMatch(/window\.location\.href/);
  });

  it("fireAutoLogin preserves transient activation via synchronous placeholder", () => {
    // Must open a placeholder window BEFORE the ticket fetch.
    const idxOpen = store.indexOf("window.open('', '_blank')");
    const idxTicket = store.indexOf("await postRdpToken()");
    expect(idxOpen).toBeGreaterThan(0);
    expect(idxTicket).toBeGreaterThan(idxOpen);
    // Must navigate the placeholder after the ticket, with a fallback.
    expect(store).toMatch(/protoWin\.location\.href\s*=\s*ghrdpUrl/);
    expect(store).toMatch(/if \(!winNavOk\)/);
  });

  it("fireAutoLogin arms beacon watch before dispatch and names the browser prompt", () => {
    // armHelloWatch must be before the dispatch, not after, so a fast beacon is not missed.
    const fireStart = store.indexOf("fireAutoLogin: async");
    const slice = store.slice(fireStart, fireStart + 5000);
    const idxArm = slice.indexOf("get().armHelloWatch()");
    const idxLaunch = slice.indexOf("ghrdpRdpUrl");
    expect(idxArm).toBeGreaterThan(0);
    expect(idxLaunch).toBeGreaterThan(0);
    expect(idxArm).toBeLessThan(idxLaunch);
    expect(store).toContain("Open ghrdp-rdp-launcher");
    expect(store).toContain("Waiting for handler beacon");
    expect(store).toContain("No handler beacon yet");
    expect(store).toContain("8 s");
  });

  it("fireFixReconnect also preserves gesture (the recovery path)", () => {
    // fireFixReconnect implementation is the second occurrence; ensure the store
    // globally contains the gesture logic for that path.
    expect(store).toMatch(/fireFixReconnect[\s\S]{0,800}window\.open/);
    expect(store).toMatch(/recredUrl/);
    expect(store).toMatch(/protoWin\.location\.href/);
  });
});
