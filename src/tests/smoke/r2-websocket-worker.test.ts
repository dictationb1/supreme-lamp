// [LAB-R2] WebSocket accept-loop starvation invariants - EXECUTED against the
// shipped payloads/ghrdp-server.ps1, not a mocked copy. On the unpatched base a
// single GET /ws runs Invoke-F99WebSocketUpgrade INLINE on the one accept
// thread, so one open socket starves every HTTP endpoint for up to
// F99WsMaxLifetimeSec (1800s). These assertions fail on that base and pass only
// after the LAB-R2 repair moves the long-lived pump onto a bounded worker
// runspace while leaving ordinary HTTP inline.
//
// Static by necessity: this Linux CI lane has no PowerShell interpreter. The
// timing CONSEQUENCE (a /health round-trip while several /ws sockets are held
// open, the 503 at capacity, close/reconnect/idle behaviour and process
// cleanup) is measured for real on the Windows client VM by
// scripts/candidate/real-backend.js in the lab repository. This test pins the
// source structure that produces it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = readFileSync("payloads/ghrdp-server.ps1", "utf8");

// The /ws branch lives inside Invoke-ClientRequest. Isolate it so the assertions
// below describe the request path rather than some unrelated occurrence.
const wsBranchStart = server.indexOf("if ($path -eq '/ws')");
const wsBranchEnd = server.indexOf("$credsAllowed = Test-CredsAllowed", wsBranchStart);
const wsBranch = server.slice(wsBranchStart, wsBranchEnd);

// The accept loop drain (the single-threaded place that used to pin on /ws).
const acceptLoopIdx = server.indexOf("while (((Get-Date) - $start) -lt $limit)");

describe("LAB-R2 WebSocket worker pool (accept-loop starvation repair)", () => {
  it("no longer pumps the WebSocket inline on the accept thread", () => {
    expect(wsBranchStart).toBeGreaterThan(0);
    // The request path must DISPATCH to the worker pool instead of awaiting the
    // long-lived Invoke-F99WebSocketUpgrade loop inline.
    expect(wsBranch).toContain("Invoke-R2DispatchWebSocket");
    expect(wsBranch).not.toMatch(/Invoke-F99WebSocketUpgrade/);
    // It returns immediately so the accept loop keeps draining.
    expect(wsBranch).toMatch(/\breturn\b/);
  });

  it("creates a bounded runspace pool whose size equals the admission limit", () => {
    expect(server).toMatch(/CreateRunspacePool\(/);
    expect(server).toMatch(/SetMaxRunspaces\(\[int\]\$script:R2WsMaxClients\)/);
    // The limit is tunable but clamped to a finite, sane range.
    expect(server).toMatch(/GHRDP_WS_MAX_CLIENTS/);
    expect(server).toMatch(/\[Math\]::Max\(4,\s*\[Math\]::Min\(64/);
  });

  it("uses a non-blocking bounded admission semaphore and a predictable 503 at capacity", () => {
    expect(server).toMatch(/New-Object System\.Threading\.SemaphoreSlim/);
    // Wait(0) must never park the accept thread; excess connections fail fast.
    expect(server).toMatch(/\$script:R2WsGate\.Wait\(0\)/);
    expect(wsBranch).not.toContain("Wait(0)"); // admission lives in the dispatcher
    expect(server).toMatch(/Code 503/);
    expect(server).toMatch(/websocket capacity exhausted; retry/);
  });

  it("runs the pump in a worker that re-establishes only the small WS dependency surface", () => {
    // The worker here-string re-declares the F99 tunables at its own script
    // scope and never reaches the accept runspace's mutable ticket/cache state.
    expect(server).toMatch(/\$script:R2WsWorker\s*=\s*@'/);
    expect(server).toContain("$script:F99WsMaxLifetimeSec   = [int]$Ctx.WsMaxLifetimeSec");
    expect(server).toContain("Invoke-F99WebSocketUpgrade -Client $Ctx.Client");
    // Capacity is released in finally AFTER the socket is closed, on every path.
    const workerStart = server.indexOf("$script:R2WsWorker = @'");
    const workerEnd = server.indexOf("'@", workerStart);
    const worker = server.slice(workerStart, workerEnd);
    expect(worker).toMatch(/finally\s*\{/);
    expect(worker).toMatch(/\$Ctx\.Gate\.Release\(\)/);
    expect(worker).toMatch(/\$Ctx\.Client\.Close\(\)/);
    // The worker must NOT touch the single-use ticket store or credential ledger.
    expect(worker).not.toMatch(/RdpTokens/);
    expect(worker).not.toMatch(/DashTokenRevoked/);
  });

  it("serializes every audit writer (inline + worker) on one shared lock", () => {
    expect(server).toMatch(/\$script:ClientAuditLock\s*=\s*New-Object object/);
    // Both the inline function and the worker-local function enter the same lock.
    const lockEnters = server.match(/\[System\.Threading\.Monitor\]::Enter\(\$script:ClientAuditLock\)/g) || [];
    expect(lockEnters.length).toBeGreaterThanOrEqual(2);
  });

  it("reaps finished worker handles inside the accept loop and disposes everything at shutdown", () => {
    expect(acceptLoopIdx).toBeGreaterThan(0);
    const loopBody = server.slice(acceptLoopIdx);
    expect(loopBody).toContain("Invoke-R2ReapWebSocketWorkers");
    expect(server).toContain("function Stop-R2WebSocketPool");
    // Shutdown closes live sockets, then closes and disposes pool + semaphore.
    const shutdownIdx = server.indexOf("function Stop-R2WebSocketPool");
    const shutdown = server.slice(shutdownIdx, shutdownIdx + 1400);
    expect(shutdown).toMatch(/\$r2Rec\.Client\.Close\(\)/);
    expect(shutdown).toMatch(/R2WsPool\.Close\(\)/);
    expect(shutdown).toMatch(/R2WsPool\.Dispose\(\)/);
    expect(shutdown).toMatch(/R2WsGate\.Dispose\(\)/);
    // And it is actually invoked after the listener stops.
    expect(server).toMatch(/\$listener\.Stop\(\)[\s\S]{0,200}Stop-R2WebSocketPool/);
  });

  it("exposes bounded env tunables without changing production defaults", () => {
    // Defaults remain 20/90/1800; the overrides are clamped and only take effect
    // when an environment variable is present, so an unconfigured host is identical.
    expect(server).toMatch(/\$script:F99WsPingIntervalSec = 20/);
    expect(server).toMatch(/\$script:F99WsIdleTimeoutSec = 90/);
    expect(server).toMatch(/\$script:F99WsMaxLifetimeSec = 1800/);
    expect(server).toMatch(/GHRDP_WS_IDLE_TIMEOUT_SEC/);
    expect(server).toMatch(/\[Math\]::Max\(5,\s*\[Math\]::Min\(300/);
    expect(server).toMatch(/GHRDP_WS_MAX_LIFETIME_SEC/);
  });

  it("keeps a bounded, truthful pool-unavailable path (no inline pump, retry window, 503)", () => {
    // [LAB-R2 0004] The 0001-0003 fallback called Invoke-F99WebSocketUpgrade
    // INLINE on the accept thread when the pool could not be created, which
    // recreates exactly the R2 starvation defect (one /ws blocks all HTTP
    // until the pump exits). The dispatch path must contain NO inline pump
    // call; a pool-unavailable /ws gets one bounded re-init attempt per
    // clamped retry window and then an immediate truthful 503, so ordinary
    // HTTP is never parked and the degraded state is visible, not silent.
    const dispatchStart = server.indexOf("function Invoke-R2DispatchWebSocket");
    expect(dispatchStart).toBeGreaterThan(0);
    const dispatchEnd = server.indexOf("function ", dispatchStart + 10);
    const dispatchBody = server.slice(dispatchStart, dispatchEnd > 0 ? dispatchEnd : undefined);
    // No CALL to the pump (the invocation form used everywhere else in this
    // file is `Invoke-F99WebSocketUpgrade -Client ...`); naming it inside a
    // comment that documents why it must NOT run inline is fine.
    expect(dispatchBody).not.toMatch(/Invoke-F99WebSocketUpgrade\s+-Client/);
    expect(dispatchBody).toMatch(/Initialize-R2WsPool/);
    expect(dispatchBody).toMatch(/R2WsPoolRetryAtUtc/);
    expect(dispatchBody).toMatch(/Code 503/);
    expect(dispatchBody).toContain("websocket worker pool unavailable; retry");
  });

  it("retries pool initialization on a clamped window and records the init error", () => {
    // The init is a function so a transient failure can be retried once per
    // window instead of pinning the degraded state for the process lifetime.
    expect(server).toMatch(/function Initialize-R2WsPool/);
    expect(server).toMatch(/GHRDP_WS_POOL_RETRY_SEC/);
    expect(server).toMatch(/\[Math\]::Max\(5, \[Math\]::Min\(300, \[int\]\$env:GHRDP_WS_POOL_RETRY_SEC\)\)/);
    expect(server).toMatch(/R2WsPoolInitError/);
    // A successful init clears the error; a failed one sets the retry deadline.
    expect(server).toMatch(/R2WsPoolRetryAtUtc = \(Get-Date\)\.ToUniversalTime\(\)\.AddSeconds/);
  });

  it("transfers socket ownership so the request finally does not close a dispatched /ws", () => {
    // Measured on the client VM (run 40082655039): Invoke-ClientRequest's outer
    // finally disposed the stream and closed the client on every return, so an
    // async-dispatched /ws was torn down before the worker sent 101 (ECONNRESET).
    // A dispatched connection must suppress that cleanup; the worker finally owns it.
    expect(server).toMatch(/\$r2Dispatched\s*=\s*\$false/);
    const wsBranch2 = server.slice(wsBranchStart, wsBranchEnd);
    expect(wsBranch2).toMatch(/\$r2Dispatched\s*=\s*\$true/);
    expect(server).toMatch(/if\s*\(\s*-not\s*\$r2Dispatched\s*\)\s*\{[\s\S]{0,160}?Dispose\(\)/);
  });

  it("detects a dropped peer promptly with a non-blocking Socket.Poll so worker slots are reclaimed", () => {
    // Run 40084261133 drained the gate (count=0/avail=0) with only a few sockets
    // held: without reading on an empty stream, EOF was only noticed at the idle
    // timeout. Poll(SelectRead)+Available==0 signals EOF/reset within one loop tick.
    expect(server).toMatch(/\$Client\.Client\.Poll\(0,\s*\[System\.Net\.Sockets\.SelectMode\]::SelectRead\)/);
    expect(server).toMatch(/Poll\(0[\s\S]{0,120}Available\s*-eq\s*0[\s\S]{0,80}1006/);
  });

  it("advertises the upgrade flag from the single live /health route (no shadowing duplicate)", () => {
    // Run 40086011776: an earlier F45-R readiness /health block returned first
    // and carried no ws field, so the browser's probeHealth always set
    // wsAvailable=false and rendered "No /ws endpoint" while the RFC6455 upgrade
    // was live. The F99 block lower in the chain that did include the flag was
    // unreachable. Pin one route, and that it advertises the feature flag.
    const healthRoutes = server.match(/if \(\$path -eq '\/health'\)/g) || [];
    expect(healthRoutes.length).toBe(1);
    const healthStart = server.indexOf("if ($path -eq '/health')");
    const healthBlock = server.slice(healthStart, healthStart + 2400);
    // [LAB-R2 0004] The flag is pool-aware: while the worker pool cannot be
    // created, /ws answers 503, so /health must not advertise ws=true. The
    // degraded reason is reported alongside so a UI can distinguish "no /ws
    // support" from "ws degraded: worker pool unavailable".
    expect(healthBlock).toMatch(
      /ws\s*=\s*\$\(if \(\$script:R2WsPoolAvailable\) \{ \[bool\]\$script:F96WsUpgradeSupported \} else \{ \$false \}\)/,
    );
    expect(healthBlock).toMatch(/wsReason\s*=\s*\$\(if \(\$script:R2WsPoolAvailable\) \{ \$null \} else \{ 'websocket worker pool unavailable' \}\)/);
  });

  it("constructs the worker PowerShell in a PS 5.1-compatible way (no 1-arg Create overload)", () => {
    // Measured on the Windows client VM (run 40081193119): the [powershell] type
    // accelerator in Windows PowerShell 5.1 throws MethodException
    // "Cannot find an overload for Create and the argument count 1" for
    // [powershell]::Create($pool). The supported form is parameterless Create()
    // plus the settable RunspacePool property, which binds on PS 5.1 and PS 7.
    expect(server).toMatch(/\$r2Ps\s*=\s*\[powershell\]::Create\(\)/);
    expect(server).toMatch(/\$r2Ps\.RunspacePool\s*=\s*\$script:R2WsPool/);
    expect(server).not.toMatch(/\[powershell\]::Create\(\s*\$script:R2WsPool\s*\)/);
  });
});
