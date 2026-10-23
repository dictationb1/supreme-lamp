# tests/p001-p002-identity.ps1  [P001 / P001B / P002] RUNTIME proof.
#
# The Node pins in tests/p001-p002-ticket-and-version-identity.test.js read the
# shipped bytes; this file EXECUTES them. It extracts the shipped functions from
# payloads/ghrdp-server.ps1 with the PowerShell AST (the tests/f27-windows.ps1
# convention) and drives the REAL Invoke-ClientRequest with synthetic socket
# peers, a temp Root and fixture config - no listener, no tailnet, no credential.
#
# What it proves (each case is a claim the application has to keep):
#   P001  /api/rdp-token authorizes the credential written AFTER the process
#         started (the workflow writes dash-token.txt post-boot), refuses
#         anonymous / forged / superseded values, keeps the constant-time
#         compare and the 403 tailnet-source restriction after the gate.
#   P001B /api/purge-stale-creds shares that policy and still returns the
#         copy-only contract (it never deletes anything itself).
#   P002  /api/version + /api/ping answer the DEPLOYED identity (config.json
#         buildSha), keep sha7 consistent, fall through a malformed value and
#         answer `dev` only when no valid identity exists.
#
# Rotation-state matrix covered: written-after-boot, rotation under a running
# process, file=new+config=old, config=new+file=old, both sources unavailable,
# empty file, malformed file, a superseded boot snapshot that must stay dead,
# and the supported static/bootstrap case (file removed, nothing rotated).
#
# A "baseline arm" runs the PRE-PATCH comparison for each core case, so the test
# can only pass if it would have failed against the old gate.
#
# Token values are never printed: only lengths and sha256[0:8].
# Run:  pwsh -File tests/p001-p002-identity.ps1   (CI: launch-gates windows-native)
param([string]$RepoRoot = '')
$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) { $RepoRoot = Split-Path $PSScriptRoot -Parent }
$serverPath = Join-Path $RepoRoot 'payloads/ghrdp-server.ps1'

$script:Pass = 0
$script:Fail = 0
$script:Failures = @()
function Ok([string]$Name) { $script:Pass++; Write-Host ('  ok   ' + $Name) }
function Bad([string]$Name, [string]$Detail) {
    $script:Fail++
    $flat = ([string]$Detail).Replace("`r", ' ').Replace("`n", ' | ')
    $script:Failures += ($Name + ' :: ' + $flat)
    Write-Host ('FAIL ' + $Name + ' :: ' + $flat)
}
function Check([string]$Name, $Cond, [string]$Detail = '') { if ($Cond) { Ok $Name } else { Bad $Name ($Detail + ' (condition false)') } }
function CheckEq([string]$Name, $Expected, $Actual) {
    if ([string]$Expected -eq [string]$Actual) { Ok $Name } else { Bad $Name ('expected [' + [string]$Expected + '] got [' + [string]$Actual + ']') }
}
function Tag([string]$Value) {
    # never print a token: length + short hash only
    if (-not $Value) { return 'empty' }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $b = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes([string]$Value)) } finally { $sha.Dispose() }
    return ('len=' + ([string]$Value).Length + ' sha8=' + ([BitConverter]::ToString($b)).Replace('-', '').Substring(0, 8).ToLower())
}
function Import-Functions([string]$Text, [string[]]$Names) {
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($Text, [ref]$tokens, [ref]$errors)
    if ($errors -and $errors.Count -gt 0) { throw ('PowerShell syntax: ' + $errors[0].Message) }
    foreach ($name in $Names) {
        $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
        if (-not $fn) { throw ('function missing from the shipped server: ' + $name) }
        $definition = $fn.Extent.Text -replace '^function\s+([\w-]+)', 'function script:$1'
        . ([scriptblock]::Create($definition))
    }
}

# --- fixture state -----------------------------------------------------------
$script:Root = Join-Path ([IO.Path]::GetTempPath()) ('p001-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $script:Root -Force
$script:NoBom = New-Object System.Text.UTF8Encoding($false)
$script:CfgPath = Join-Path $script:Root 'config.json'
$script:RdpTokens = @{}
$script:TicketAudit = [ordered]@{ issued = 0; redeemed = 0; rejected = 0 }
$script:HandlerChain = @()
$script:ClientAuditLog = Join-Path $script:Root 'client-audit.log'
$script:F99DashTokenTelemetry = New-Object System.Collections.ArrayList
$script:F30PurgeCommand = 'PURGE-COMMAND-FIXTURE (copy only, never executed)'
$envNames = @('GHRDP_BUILD_SHA', 'GITHUB_SHA')
$savedEnv = @{}
foreach ($n in $envNames) { $savedEnv[$n] = [Environment]::GetEnvironmentVariable($n) }

$TOKEN_FILE = Join-Path $script:Root 'dash-token.txt'
$SCRIPT_BUILD_SHA = '978a8375ee77b392ce11694ccee7722fd6ca4f71'

function Write-Stage {
    # mirrors main.yml "Stage files + write config.json": config.json FIRST,
    # dash-token.txt LAST, both from the same value.
    param([string]$Token, [string]$BuildSha = $SCRIPT_BUILD_SHA, [string]$DnsName = 'p001-fixture.example.ts.net')
    $cfg = [ordered]@{ dnsName = $DnsName; rdpUser = 'fixture-user'; rdpPass = 'fixture-pass-not-a-secret'; hostKind = 'ephemeral' }
    if ($Token) { $cfg['dashToken'] = $Token }
    if ($BuildSha) { $cfg['buildSha'] = $BuildSha }
    [IO.File]::WriteAllText($script:CfgPath, ($cfg | ConvertTo-Json), $script:NoBom)
    if ($Token) { [IO.File]::WriteAllText($TOKEN_FILE, $Token, $script:NoBom) }
}
function Write-ConfigOnly {
    param([string]$DashToken = '', [string]$BuildSha = $SCRIPT_BUILD_SHA)
    $cfg = [ordered]@{ dnsName = 'p001-fixture.example.ts.net'; rdpUser = 'fixture-user'; rdpPass = 'fixture-pass-not-a-secret'; hostKind = 'ephemeral' }
    if ($DashToken) { $cfg['dashToken'] = $DashToken }
    if ($BuildSha) { $cfg['buildSha'] = $BuildSha }
    [IO.File]::WriteAllText($script:CfgPath, ($cfg | ConvertTo-Json), $script:NoBom)
}
function Write-TokenFile { param([string]$Text) [IO.File]::WriteAllText($TOKEN_FILE, $Text, $script:NoBom) }
function Reset-Ledger {
    # simulates a process restart: the boot snapshot is what dash-token.txt held
    # when the listener came up (empty in the production ordering).
    param([string]$BootSnapshot = '')
    $script:DashTokenCurrent = [string]$BootSnapshot
    $script:DashTokenRevoked = @{}
    $script:BootSnapshot = [string]$BootSnapshot
}
function Request-P {
    # synthetic peer, raw HTTP/1.1 over a memory stream (tests/f27-windows.ps1)
    param([string]$Path, [string]$Method = 'GET', [string]$Source = '100.64.0.7', [string]$Auth = '', [string]$Body = '')
    $authLine = ''
    if ($Auth -ne '') { $authLine = "Authorization: $Auth`r`n" }
    $raw = "$Method $Path HTTP/1.1`r`nHost: fixture.ts.net`r`n$authLine" + "Content-Type: application/json`r`nContent-Length: $([Text.Encoding]::UTF8.GetByteCount($Body))`r`n`r`n$Body"
    $inputBytes = [Text.Encoding]::UTF8.GetBytes($raw)
    $mem = New-Object IO.MemoryStream
    $mem.Write($inputBytes, 0, $inputBytes.Length)
    $mem.Position = 0
    $client = [pscustomobject]@{ Stream = $mem; Client = [pscustomobject]@{ RemoteEndPoint = [pscustomobject]@{ Address = [Net.IPAddress]::Parse($Source) } } }
    $client | Add-Member ScriptMethod GetStream { return $this.Stream }
    $client | Add-Member ScriptMethod Close { }
    Invoke-ClientRequest -Client $client -Token $script:BootSnapshot
    $all = $mem.ToArray()
    $response = [Text.Encoding]::UTF8.GetString($all, $inputBytes.Length, $all.Length - $inputBytes.Length)
    $m = [regex]::Match($response, '^HTTP/1.1 (\d+)')
    if (-not $m.Success) { throw ('route produced no HTTP response for ' + $Path) }
    return [pscustomobject]@{ Code = [int]$m.Groups[1].Value; Body = (($response -split "`r`n`r`n", 2)[1]) }
}
function Get-OldGateCode {
    # BASELINE ARM: the PRE-PATCH comparison, verbatim in behaviour - snapshot
    # only, equal length, byte compare. It returns the status the old route
    # would have answered for that credential.
    param([string]$Auth, [string]$Snapshot)
    if (-not $Snapshot) { return 401 }
    $expected = [Text.Encoding]::UTF8.GetBytes('Bearer ' + $Snapshot)
    $received = [Text.Encoding]::UTF8.GetBytes([string]$Auth)
    if ($received.Length -ne $expected.Length) { return 401 }
    if (-not (Test-TicketBearer $received $expected)) { return 401 }
    return 403   # gate passed; the synthetic tailnet peer is not a real tailnet
}

try {
    # =========================================================================
    # import the SHIPPED code
    # =========================================================================
    $source = [IO.File]::ReadAllText($serverPath)
    Import-Functions $source @(
        'Read-JsonFile', 'Test-GhrdpShaIdentity', 'Get-GhrdpBuildIdentity',
        'Get-RequestParts', 'Test-IsLoopbackAddr', 'Test-ClientAllowed', 'Test-CredsAllowed',
        'Test-TicketBearer', 'Test-TicketSource', 'Write-TicketAudit', 'Write-ClientAudit', 'Use-RdpTicket',
        'Read-ClientRequest', 'Send-ClientResponse', 'ConvertTo-JsonBytes',
        'Test-GhrdpDashTokenShape', 'Get-GhrdpStrictDashTokenCandidates',
        'Get-F99DashTokenHash', 'Add-F99TokenTelemetry', 'Get-TailnetIp', 'Invoke-ClientRequest'
    )
    Write-Host '[P001/P002] shipped server functions imported from the real payload'

    # =========================================================================
    # P001 - credential written AFTER the process started
    # =========================================================================
    $tokA = 'a' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 8)
    Reset-Ledger -BootSnapshot ''            # task kicked before staging: no token yet
    Write-ConfigOnly -DashToken ''           # nothing on disk yet
    Remove-Item -LiteralPath $TOKEN_FILE -Force -ErrorAction SilentlyContinue
    $pre = Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokA)
    CheckEq 'P001 pre-staging: a credential nothing on disk carries is refused (401)' 401 $pre.Code
    Write-Stage -Token $tokA                  # main.yml writes config.json then dash-token.txt
    $mint = Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokA)
    CheckEq ('P001 written-after-boot: current credential mints (200) [' + (Tag $tokA) + ']') 200 $mint.Code
    $mintJson = $null
    try { $mintJson = $mint.Body | ConvertFrom-Json } catch { }
    Check 'P001 mint contract: rid is 32 lowercase hex' ($mintJson -and ([string]$mintJson.rid -match '^[0-9a-f]{32}$'))
    CheckEq 'P001 mint contract: ttl is 60' 60 ([string]$mintJson.ttl)
    CheckEq 'P001 BASELINE ARM: the old boot-snapshot gate refused that same credential (401)' 401 (Get-OldGateCode ('Bearer ' + $tokA) '')
    CheckEq 'P001 anonymous is refused (401)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth '').Code
    CheckEq 'P001 empty bearer is refused (401)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth 'Bearer ').Code
    CheckEq 'P001 forged bearer of equal length is refused (401)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokA.Substring(0, $tokA.Length - 1) + 'X')).Code
    CheckEq 'P001 current credential over loopback passes the gate then hits the tailnet restriction (403)' 403 (Request-P -Path '/api/rdp-token' -Method 'POST' -Source '127.0.0.1' -Auth ('Bearer ' + $tokA)).Code
    CheckEq 'P001 authorization precedes the network restriction (anonymous loopback is 401, not 403)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Source '127.0.0.1' -Auth '').Code

    # =========================================================================
    # P001 - rotation while the SAME process keeps running
    # =========================================================================
    $tokB = 'b' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 8)
    Write-Stage -Token $tokB
    CheckEq ('P001 rotation: the new credential mints (200) [' + (Tag $tokB) + ']') 200 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokB)).Code
    CheckEq 'P001 rotation: the superseded credential is refused (401)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokA)).Code
    CheckEq 'P001 BASELINE ARM: the old gate would still mint the superseded credential (403)' 403 (Get-OldGateCode ('Bearer ' + $tokA) $tokA)

    # token file = new, config.json = old (a stale config write)
    $tokC = 'c' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 8)
    Write-ConfigOnly -DashToken $tokB
    Write-TokenFile -Text $tokC
    CheckEq 'P001 file=new/config=old: the file credential mints (200)' 200 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokC)).Code
    CheckEq 'P001 file=new/config=old: the stale config credential is refused (401)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokB)).Code

    # config.json = new, dash-token.txt = old: the file is authoritative, so the
    # config-only value is NOT authority while the file is readable
    $tokD = 'd' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $cfgOnlyTok = 'e' + [guid]::NewGuid().ToString('N')
    Write-Stage -Token $tokD
    Write-ConfigOnly -DashToken $cfgOnlyTok
    CheckEq 'P001 config=new/file=old: the file credential stays current (200)' 200 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokD)).Code
    CheckEq 'P001 config=new/file=old: a config-only value is not authority while the file is readable (401)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $cfgOnlyTok)).Code

    # =========================================================================
    # P001 - unreadable / empty / malformed sources and no resurrection
    # =========================================================================
    Remove-Item -LiteralPath $TOKEN_FILE -Force
    Write-ConfigOnly -DashToken $tokD            # config still carries the current value
    CheckEq 'P001 token file missing: the established current credential still mints (200)' 200 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokD)).Code
    Write-TokenFile -Text ''
    CheckEq 'P001 token file empty: the established current credential still mints (200)' 200 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokD)).Code
    Write-TokenFile -Text ("  " + [char]1 + "not-a-token`r`n")
    CheckEq 'P001 token file malformed: the established current credential still mints (200)' 200 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokD)).Code
    # remove EVERY source: the superseded values must stay dead
    Remove-Item -LiteralPath $TOKEN_FILE -Force -ErrorAction SilentlyContinue
    Write-ConfigOnly -DashToken ''
    CheckEq 'P001 all sources gone: the last established credential still mints (200)' 200 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokD)).Code
    CheckEq 'P001 all sources gone: the boot snapshot is NOT resurrected (401)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokA)).Code
    CheckEq 'P001 all sources gone: a superseded value is NOT resurrected (401)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokB)).Code
    CheckEq 'P001 all sources gone: no fail-open for anonymous (401)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth '').Code

    # =========================================================================
    # P001 - supported static/bootstrap case (intentionally kept)
    # =========================================================================
    $tokStatic = 'f' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 8)
    Reset-Ledger -BootSnapshot $tokStatic        # process came up WITH the file present
    Write-ConfigOnly -DashToken ''
    Remove-Item -LiteralPath $TOKEN_FILE -Force -ErrorAction SilentlyContinue
    CheckEq 'P001 static deployment: the boot credential is the current credential (200)' 200 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokStatic)).Code
    Write-TokenFile -Text $tokStatic
    $tokStatic2 = 'g' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 8)
    Write-Stage -Token $tokStatic2
    CheckEq 'P001 static deployment rotated: the new credential mints (200)' 200 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokStatic2)).Code
    Remove-Item -LiteralPath $TOKEN_FILE -Force -ErrorAction SilentlyContinue
    Write-ConfigOnly -DashToken ''
    CheckEq 'P001 static deployment rotated: the original boot credential is dead (401)' 401 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokStatic)).Code
    CheckEq 'P001 static deployment rotated: the new credential survives file loss (200)' 200 (Request-P -Path '/api/rdp-token' -Method 'POST' -Auth ('Bearer ' + $tokStatic2)).Code

    # =========================================================================
    # P001B - the purge route shares the policy and keeps its copy-only contract
    # =========================================================================
    $tokP = 'p' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 8)
    Reset-Ledger -BootSnapshot $tokA
    Write-Stage -Token $tokP
    $purge = Request-P -Path '/api/purge-stale-creds' -Source '100.64.0.7' -Auth ('Bearer ' + $tokP)
    CheckEq 'P001B current credential is accepted (200)' 200 $purge.Code
    $purgeJson = $null
    try { $purgeJson = $purge.Body | ConvertFrom-Json } catch { }
    Check 'P001B contract: olderThanDays = 7' ($purgeJson -and ([int]$purgeJson.olderThanDays -eq 7))
    Check 'P001B contract: target is a TERMSRV/ entry' ($purgeJson -and ([string]$purgeJson.target -eq 'TERMSRV/p001-fixture.example.ts.net'))
    Check 'P001B contract: the command is returned, not executed' ($purgeJson -and ([string]$purgeJson.command -eq $script:F30PurgeCommand))
    $leakPattern = 'fixture-pass-not-a-secret|' + [regex]::Escape($tokP)
    Check 'P001B contract: no credential value in the body' ($purgeJson -and -not ($purge.Body -match $leakPattern))
    CheckEq 'P001B superseded credential is refused (401)' 401 (Request-P -Path '/api/purge-stale-creds' -Auth ('Bearer ' + $tokA)).Code
    CheckEq 'P001B anonymous is refused (401)' 401 (Request-P -Path '/api/purge-stale-creds' -Auth '').Code
    CheckEq 'P001B forged is refused (401)' 401 (Request-P -Path '/api/purge-stale-creds' -Auth ('Bearer ' + $tokP.Substring(0, $tokP.Length - 1) + 'Z')).Code
    CheckEq 'P001B BASELINE ARM: the old gate refused the current credential while the snapshot was stale (401)' 401 (Get-OldGateCode ('Bearer ' + $tokP) $tokA)
    $purge2 = Request-P -Path '/api/purge-stale-creds' -Auth ('Bearer ' + $tokP)
    Check 'P001B repeated authorized GET is still 200 (no side effect, no one-shot)' ($purge2.Code -eq 200)

    # =========================================================================
    # P002 - version identity precedence, sha7, malformed values, dev
    # =========================================================================
    function Get-VersionBody { $r = Request-P -Path '/api/version' -Source '127.0.0.1'; if ($r.Code -ne 200) { throw ('/api/version answered ' + $r.Code) }; return ($r.Body | ConvertFrom-Json) }

    [Environment]::SetEnvironmentVariable('GHRDP_BUILD_SHA', $null)
    [Environment]::SetEnvironmentVariable('GITHUB_SHA', $null)
    Write-Stage -Token 'p001-version-fixture-token-0001' -BuildSha $SCRIPT_BUILD_SHA
    $v = Get-VersionBody
    CheckEq 'P002 deployed identity: sha is config.json buildSha' $SCRIPT_BUILD_SHA ([string]$v.sha)
    CheckEq 'P002 deployed identity: sha7 is the first 7 characters' $SCRIPT_BUILD_SHA.Substring(0, 7) ([string]$v.sha7)
    CheckEq 'P002 deployed identity: the source is reported as config.buildSha' 'config.buildSha' ([string]$v.shaSource)
    $ping = (Request-P -Path '/api/ping' -Source '127.0.0.1').Body | ConvertFrom-Json
    CheckEq 'P002 /api/ping commit agrees with /api/version' ([string]$v.sha) ([string]$ping.commit)

    $conflict = '1111111111111111111111111111111111111111'
    [Environment]::SetEnvironmentVariable('GHRDP_BUILD_SHA', $conflict)
    $v = Get-VersionBody
    CheckEq 'P002 conflicting execution identity cannot override the deployed identity' $SCRIPT_BUILD_SHA ([string]$v.sha)
    [Environment]::SetEnvironmentVariable('GHRDP_BUILD_SHA', $null)

    Write-Stage -Token 'p001-version-fixture-token-0001' -BuildSha ''
    [Environment]::SetEnvironmentVariable('GHRDP_BUILD_SHA', $conflict)
    $v = Get-VersionBody
    CheckEq 'P002 no deployed identity: the execution identity is reported' $conflict ([string]$v.sha)
    CheckEq 'P002 no deployed identity: the source names the environment' 'env.GHRDP_BUILD_SHA' ([string]$v.shaSource)
    [Environment]::SetEnvironmentVariable('GHRDP_BUILD_SHA', $null)
    [Environment]::SetEnvironmentVariable('GITHUB_SHA', $conflict)
    $v = Get-VersionBody
    CheckEq 'P002 no deployed identity: GITHUB_SHA is honoured second' $conflict ([string]$v.sha)
    [Environment]::SetEnvironmentVariable('GITHUB_SHA', $null)

    Write-Stage -Token 'p001-version-fixture-token-0001' -BuildSha 'not-a-sha-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    $v = Get-VersionBody
    CheckEq 'P002 malformed buildSha is never reported (dev)' 'dev' ([string]$v.sha)
    CheckEq 'P002 malformed buildSha keeps sha7 = dev' 'dev' ([string]$v.sha7)

    Write-Stage -Token 'p001-version-fixture-token-0001' -BuildSha ''
    Remove-Item -LiteralPath $script:CfgPath -Force
    $v = Get-VersionBody
    CheckEq 'P002 no config and no environment: dev' 'dev' ([string]$v.sha)
    CheckEq 'P002 no identity: the source is none' 'none' ([string]$v.shaSource)
    Check 'P002 the feature flags still ship' ($v.features.autoHttps -and $v.features.downloadToRdp -and $v.features.mirrorLauncher)

    Write-Host ''
    Write-Host ('[P001/P002] runtime: ' + $script:Pass + ' passed, ' + $script:Fail + ' failed')
    if ($script:Fail -gt 0) {
        Write-Host '::error::P001/P002 runtime matrix failed:'
        foreach ($f in $script:Failures) { Write-Host ('  - ' + $f) }
        exit 1
    }
    Write-Host 'P001/P002 PASS: current-token authorization, revocation, no-resurrection, purge contract and deployed identity'
    exit 0
} catch {
    Write-Host ('::error::P001/P002 runtime harness error: ' + $_.Exception.Message)
    Write-Host ([string]$_.ScriptStackTrace)
    exit 2
} finally {
    foreach ($n in $envNames) { [Environment]::SetEnvironmentVariable($n, $savedEnv[$n]) }
    try { Remove-Item -LiteralPath $script:Root -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}
