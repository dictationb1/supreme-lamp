param(
    [string]$Root = 'C:\ghrdp',
    [string]$TsExe = 'C:\Program Files\Tailscale\tailscale.exe',
    [int]$ServeTimeoutSec = 60,
    [int]$StatusTimeoutSec = 15,
    [int]$FunnelTimeoutSec = 60,
    [string]$ApiToken = '',
    [switch]$SkipOptionalFunnel
)
$ErrorActionPreference = 'Continue'

function Invoke-BoundedCommand {
    param([string]$FilePath, [string[]]$ArgumentList, [int]$TimeoutSec, [string]$Name)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host ("[" + $Name + "] Starting: " + $FilePath + " " + ($ArgumentList -join ' '))
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = $FilePath
    $pinfo.Arguments = ($ArgumentList -join ' ')
    $pinfo.UseShellExecute = $false
    $pinfo.RedirectStandardOutput = $true
    $pinfo.RedirectStandardError = $true
    $pinfo.CreateNoWindow = $true

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $pinfo
    $p.Start() | Out-Null

    $outBuilder = New-Object System.Text.StringBuilder
    $errBuilder = New-Object System.Text.StringBuilder
    $outAction = { if ($EventArgs.Data) { $outBuilder.AppendLine($EventArgs.Data) | Out-Null } }
    $errAction = { if ($EventArgs.Data) { $errBuilder.AppendLine($EventArgs.Data) | Out-Null } }
    Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action $outAction | Out-Null
    Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -Action $errAction | Out-Null
    $p.BeginOutputReadLine()
    $p.BeginErrorReadLine()

    $killed = $false
    while (-not $p.HasExited) {
        if ($sw.Elapsed.TotalSeconds -gt $TimeoutSec) {
            Write-Host ("::warning::[" + $Name + "] TIMEOUT after " + $TimeoutSec + "s. Killing process tree.")
            try {
                $descendants = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $p.Id }
                foreach ($child in $descendants) {
                    try { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
                }
                $p.Kill()
            } catch { }
            $killed = $true
            break
        }
        Start-Sleep -Milliseconds 100
    }

    $exitCode = -1
    if (-not $killed) {
        $p.WaitForExit()
        $exitCode = $p.ExitCode
    }

    return @{ ok = ($exitCode -eq 0); exitCode = $exitCode; killed = $killed; stdout = $outBuilder.ToString(); stderr = $errBuilder.ToString() }
}

$serveOk = $false
$serveUrl = ''

foreach ($argSet in @(@('serve', '--bg', 'http://127.0.0.1:7331'), @('serve', '--bg', '7331'))) {
    $res = Invoke-BoundedCommand -FilePath $TsExe -ArgumentList $argSet -TimeoutSec $ServeTimeoutSec -Name "serve"
    Write-Host ('[serve] tailscale serve {0} -> status {1} {2}' -f ($argSet -join ' '), $res.exitCode, $res.stdout)
    if ($res.ok) { $serveOk = $true; break }
}

if ($serveOk) {
    $res = Invoke-BoundedCommand -FilePath $TsExe -ArgumentList @('serve', 'status') -TimeoutSec $StatusTimeoutSec -Name "status"
    $m = [regex]::Match($res.stdout, 'https://[A-Za-z0-9.\-]+\.ts\.net')
    if ($m.Success) { $serveUrl = $m.Value }
} else {
    Write-Host '[serve] tailscale serve did not succeed (dashboard still reachable at http://<ts-ip>:7331 over the tailnet)'
}

$funnelOk = $false
$funnelUrl = ''

if ($serveOk -and $ApiToken -and -not $SkipOptionalFunnel) {
    foreach ($argSet in @(@('funnel', '--bg', '7331'), @('funnel', '--bg', 'http://127.0.0.1:7331'))) {
        $res = Invoke-BoundedCommand -FilePath $TsExe -ArgumentList $argSet -TimeoutSec $FunnelTimeoutSec -Name "funnel"
        Write-Host ('[funnel] tailscale funnel {0} -> status {1} {2}' -f ($argSet -join ' '), $res.exitCode, $res.stdout)
        if ($res.ok) { $funnelOk = $true; break }
    }
}

if ($funnelOk) {
    if ($serveUrl) { $funnelUrl = $serveUrl }
    Write-Host ('[funnel] public funnel active: ' + $funnelUrl)
} else {
    Write-Host '[funnel] Funnel not enabled or failed (optional). Tailnet Serve already works with ZERO secrets.'
}

@{ serveOk=$serveOk; serveUrl=$serveUrl; funnelOk=$funnelOk; funnelUrl=$funnelUrl } | ConvertTo-Json -Compress
