// [LAB-R1] Server startup/readiness invariants - EXECUTED against the shipped
// payloads/ghrdp-server.ps1, not a mocked copy. On the unpatched base the
// synchronous startup scans sit BEFORE the accept loop, so a TCP connect and
// the LISTENING marker can exist while /health cannot answer. These three
// assertions fail on that base and pass only after the LAB-R1 repair:
//   1. no synchronous event-log scanner runs before the accept loop,
//   2. HTTP readiness is published from inside the running accept loop,
//   3. at most one inline tick scan can run per iteration.
// Static by necessity: this Linux CI lane has no PowerShell interpreter. The
// timing CONSEQUENCE (connect -> first /health) is measured for real on the
// Windows client VM by scripts/candidate/real-backend.js; this test pins the
// source structure that produces it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = readFileSync("payloads/ghrdp-server.ps1", "utf8");
// The ACCEPT LOOP is the outer time-bounded while; the inner
// `while ($listener.Pending())` only drains already-queued connections. The
// readiness stamp is emitted at the very top of the outer loop (before the
// drain), so the correct boundary is the outer loop header.
const acceptLoopIdx = server.indexOf("while (((Get-Date) - $start) -lt $limit)");

const STARTUP_SCANNERS = [
  "Update-RdpLogonAuthLast",
  "Update-RdpConnLog",
  "Update-RdpListenerTelescope",
];

describe("LAB-R1 backend startup readiness", () => {
  it("has a single TCP accept loop so the boundary index is meaningful", () => {
    expect(acceptLoopIdx).toBeGreaterThan(0);
    // The scanner *function definitions* live above the loop; only their
    // synchronous INVOCATIONS before the loop are forbidden. Count invocations
    // (a call that pipes to Out-Null), not the definitions.
    const preLoop = server.slice(0, acceptLoopIdx);
    const synchronousCallsBeforeLoop = STARTUP_SCANNERS.filter((name) =>
      new RegExp(`try \\{ ${name}[^\\n]*\\| Out-Null`, "m").test(preLoop)
    );
    expect(synchronousCallsBeforeLoop).toEqual([]);
  });

  it("publishes HTTP readiness from inside the running accept loop", () => {
    expect(server).toContain("server-ready.txt");
    const readyWrite = server.indexOf("$script:ServerReadyStamped = $true");
    expect(readyWrite).toBeGreaterThan(acceptLoopIdx); // written inside the loop
  });

  it("runs at most one inline tick scan per accept-loop iteration", () => {
    // The one-per-iteration guard uses an if / elseif / elseif chain over the
    // due flags so coincident tick timers cannot stack two Get-WinEvent scans
    // into a single blocking stretch on the accept thread.
    expect(server).toMatch(/\$dueLogon\s*=/);
    expect(server).toMatch(/\} elseif \(\$dueConn\)/);
    expect(server).toMatch(/\} elseif \(\$dueTel\)/);
  });
});
