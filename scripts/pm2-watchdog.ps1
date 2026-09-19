# ============================================================================
# PM2 WATCHDOG - keeps the fleet supervisor + public services alive
# ============================================================================
# Root-cause fix for the 2026-08-20..25 outage (daemon died silently). Also
# extended 2026-09-12 to watch the public-facing services (bbtech-web-app,
# cloudflared) that 502 the live sites when pm2 loses them.
#
# Registered as a Windows Scheduled Task (UpliftPM2Watchdog). Logic:
#   1. `pm2 jlist` empty/failed  -> daemon dead -> `pm2 resurrect` (restores dump)
#   2. Any watched app has pid 0 -> `pm2 resurrect`
#   Every action is appended to data/logs/pm2-watchdog.log.
#
# Deliberately does NOT `pm2 save` (a degraded save would destroy the last
# known-good dump).
# ============================================================================

$ErrorActionPreference = "SilentlyContinue"
$log = "C:\Users\User\Downloads\Uplift\Draymond-Orchestrator\data\logs\pm2-watchdog.log"
$dump = "$env:USERPROFILE\.pm2\dump.pm2"

# Public/edge services that must never be dark, and which ARE in the saved
# dump (so `pm2 resurrect` can actually restore them). Do not add apps that
# are not in the dump — they would false-trigger a resurrect every cycle.
$watch = @("keywire", "cloudflared", "bbtech-web-app")

function Log($msg) {
    $line = "{0} {1}" -f (Get-Date -Format s), $msg
    Add-Content -LiteralPath $log -Value $line
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        Move-Item -LiteralPath $log -Destination "$log.$stamp" -Force
    }
}

function PidOf($name) {
    return (((& pm2 pid $name 2>$null) -join "") -replace "\s", "")
}

function Resurrect($why) {
    if (-not (Test-Path $dump)) { Log "no dump at $dump - cannot resurrect ($why)"; return $false }
    Log "resurrect ($why)"
    & pm2 resurrect 2>&1 | Out-Null
    Start-Sleep -Seconds 12
    return $true
}

# 1. Daemon dead / empty?
$raw = ((& pm2 jlist 2>$null) -join "").Trim()
if ($raw -eq "" -or $raw -eq "[]") { [void](Resurrect "daemon dead/empty") }

# 2. Watched apps online?
$down = @()
foreach ($app in $watch) {
    $p = PidOf $app
    if ($p -eq "" -or $p -eq "0") { $down += $app }
}
if ($down.Count -gt 0) {
    Log ("down: " + ($down -join ", "))
    [void](Resurrect ("down: " + ($down -join ",")))
    $still = @()
    foreach ($app in $down) {
        $p = PidOf $app
        if ($p -eq "" -or $p -eq "0") { $still += $app }
    }
    if ($still.Count -gt 0) { Log ("still down after resurrect: " + ($still -join ", ")) }
}

exit 0
