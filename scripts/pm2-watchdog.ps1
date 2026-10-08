# ============================================================================
# PM2 WATCHDOG - keeps the fleet supervisor + always-on core alive
# ============================================================================
# Root-cause fix for the 2026-08-20..25 outage (daemon died silently). Extended
# 2026-09-12 to the public-facing services, and 2026-09-28 to the full always-on
# core defined in ecosystem/fleet-policy.json (ADR-0007, RUN LEAN):
#   draymond, deterministic-brain, keywire, truth-chain, truth-chain-web,
#   dev-brain, litellm, openhub, ecosystem-sampler (+ cloudflared edge).
# On-demand apps are deliberately NOT watched — they are meant to be down.
#
# Registered as a Windows Scheduled Task (UpliftPM2Watchdog). Logic:
#   1. `pm2 jlist` empty/failed  -> daemon dead -> `pm2 resurrect` (restores dump)
#   2. Any WATCHED core app has pid 0 -> `pm2 resurrect`
#   Every action is appended to data/logs/pm2-watchdog.log.
#
# Dump-awareness: only apps present in the saved dump are watched, so a core
# app that was never `pm2 save`d cannot false-trigger a resurrect every cycle.
# A core app missing from the dump is logged as drift so the operator can save.
#
# Deliberately does NOT `pm2 save` (a degraded save would destroy the last
# known-good dump).
# ============================================================================

$ErrorActionPreference = "SilentlyContinue"
$log = "C:\Users\User\Downloads\Uplift\Draymond-Orchestrator\data\logs\pm2-watchdog.log"
$dump = "$env:USERPROFILE\.pm2\dump.pm2"

# Canonical always-on core (ecosystem/fleet-policy.json). Keep in sync there.
$core = @(
    "draymond", "deterministic-brain",
    "keywire", "truth-chain", "truth-chain-web",
    "dev-brain", "litellm",
    "openhub", "ecosystem-sampler",
    "cloudflared"
)

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

# Resolve which core apps are actually enrolled in the saved dump. Watching an
# app pm2 will not resurrect just produces a no-op resurrect + log spam.
$dumpNames = @()
if (Test-Path $dump) {
    try {
        $dumpNames = @((Get-Content -LiteralPath $dump -Raw | ConvertFrom-Json) | ForEach-Object { $_.name })
    } catch { $dumpNames = @() }
}

$watch = @()
if ($dumpNames.Count -gt 0) {
    $watch = @($core | Where-Object { $dumpNames -contains $_ })
    $missing = @($core | Where-Object { $dumpNames -notcontains $_ })
    if ($missing.Count -gt 0) {
        Log ("core not in dump (run 'pm2 save' once online): " + ($missing -join ", "))
    }
} else {
    # Dump unreadable — preserve the legacy behaviour rather than watch nothing.
    $watch = @("keywire", "cloudflared")
    Log "dump unreadable/absent - falling back to legacy watch list"
}

# 1. Daemon dead / empty?
$raw = ((& pm2 jlist 2>$null) -join "").Trim()
if ($raw -eq "" -or $raw -eq "[]") { [void](Resurrect "daemon dead/empty") }

# 2. Watched core apps online?
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
