# State / data-source map

One row per fact the connection surface may display. The point of the table is
that **no page computes its own incompatible verdict**: every row names the one
producer, the transport, the store field, and the derivation that consumes it.

| Fact | Produced by | Transport | Store field | Derived into | Never inferred from |
|---|---|---|---|---|---|
| Dashboard HTTP reachability | `useDashboardPolling` `/api/progress` | HTTP poll | `telemetry.progressLost` | `issues.reachability` | WebSocket state |
| WebSocket capability | `/health` → `{ok, ws, wsReason}` | HTTP | `telemetry.wsAvailability` (`pending/supported/unsupported/pool-unavailable/unauthorized/unknown`) | `issues.ws-*` | `wsLive` alone |
| WebSocket session | browser `WebSocket` + ladder | WS | `wsLive`, `wsDead`, `wsAttempts`, `wsLastDisconnectAt` | `issues.ws-dead` / `ws-idle` | `/health.ws` |
| Server clock | `/api/progress.serverTs` | HTTP | `telemetry.clockOffsetMs`, `serverClockKnown` | `useConnectionVerdict.nowMs` | browser `Date.now()` when the server clock is known |
| Run identity | `/api/progress.runStartedAt` | HTTP | `telemetry.runStartedAtMs` | `historical` check | logon event time |
| Intended account | `config.rdpUser` | `/api/config` | `session.user` | `expectedUser` | the event's `TargetUserName` |
| Intended target | `config.rdpIp/fqdn` | `/api/config` | `session.fqdn` | gate checks | ping |
| Launcher beacon | `POST /api/handler-hello` | HTTP | `session.helloWatchSeen/ArmedAt` | `launched` / `requested` | — (a beacon is NOT a logon) |
| Logon/authentication verdict | server-side F28 collector (`Get-WinEvent` 4624/4625) | `/api/native-status.rdpListener.authLast` | `session.native.rdpListener.authLast` | `deriveConnectionState` | workflow keep-alive, UI counters |
| — event identity | `EventRecordID` | as above (`recordId`) | `authLast.recordId` | `Issue.incidentKey` | render time |
| — event time | `TimeCreated` | `authLast.eventTs` | `Verdict.eventAtMs` → `Issue.occurredAtMs` | incident age | `serverNowMs` |
| — account | `TargetUserName` + `config.rdpUser` | `authLast.targetUser/expectedUser/userMatched` | `CorrelationState` | foreign-event exclusion | machine-wide newest event |
| — source | `IpAddress`, **tailnet only**, else a class | `authLast.source/sourceMatch` | `CorrelationState` | `foreignSource` | raw public/private address |
| — failure reason | `Status`/`SubStatus` | `authLast.status/sub/subMeaning` | `Verdict.failureClass` | issue wording + severity | a fixed "wrong password" string |
| — remote proof | `LogonType` 10 + `remote{}` block | `authLast.logonType/remoteInteractive/remote` | `Verdict` `connected` vs `console` | `connected` | type 2/11 alone |
| — session liveness | `quser.exe` | `authLast.session{active,name,state,logonTs}` | survives a newer 4625 | `connected` + notice | a 4624 alone |
| — collector liveness | state-file mtime + uptime | `authLast.scanTs`, `logonCollector` | `collectorDead` | `unknown`, `issues.collector-dead` | "no events" |
| Web Desktop availability | `native.webdeskUrl` + manual toggle | `/api/native-status` | `session.native.webdeskUrl` | Web Desktop card | RDP verdict |
| Viewing mode (manual) | operator toggle | local | `viewing-mode-toggle` | label only | machine observation |

## The single verdict path

```
Get-WinEvent(4624,4625)            OS / Security log
   └─ Get-RdpLogonEventFields      extract: id, recordId, timeUtc, status, subStatus,
                                   logonType, targetUserName, source(class)
   └─ Get-RdpLogonAuthLast         correlate by normalized account (+ source when
                                   comparable) → result/sub/status/eventTs/recordId/
                                   correlation/excluded*/remoteInteractive/remote{}
   └─ Update-RdpLogonAuthLast      + quser session{} + scanTs + probeError → rdp-logon.json
   └─ GET /api/native-status       rdpListener.authLast (+ logonCollector liveness)
   └─ sessionStore.native          unchanged on a failed poll (nativeLost labels it)
   └─ useConnectionVerdict         field mapping ONLY, no logic
   └─ deriveConnectionState        ONE state + freshness + correlation + notices
   ├─ OverviewHeader Chip          state label + tone
   ├─ PrimaryActions evidence      evidence string verbatim
   ├─ deriveIssues                 issues dated by event, severity by evidence quality
   ├─ incidents.reconcile          ledger: firstObserved / lastObserved / resolved
   └─ TroubleshootSummary          rows + ack (never resolve)
```

## Clock policy

* Collector evidence is compared against **`telemetry.serverNow()`** once the
  server has published `serverTs` (`serverClockKnown`). Before that, the browser
  clock is used and the scan stamp is usually absent anyway, which degrades to
  `undated`.
* The event time is always displayed **verbatim** in the evidence string; the
  age label is computed from `occurredAtMs`, never from render time.
* Bounds: a scan dated more than `MAX_CLOCK_SKEW_MS` (5 min) in the future is
  `undated`; the server drops events stamped more than 120 s in the future.
