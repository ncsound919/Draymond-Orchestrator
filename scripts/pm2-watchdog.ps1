# ============================================================================
# PM2 WATCHDOG - keeps the fleet supervisor alive
# ============================================================================
# Root-cause fix for the 2026-08-20..25 outage: the pm2 daemon died silently
# and nothing revived it, so every scheduler job, repair loop, and monitor was
# dark for days while believing itself healthy.
#
# Registered as a Windows Scheduled Task (every 5 min). Logic:
#   1. `pm2 jlist` returns [] or fails  -> daemon dead/empty -> `pm2 resurrect`
#   2. Key primary apps not online      -> start them from their configs
#   3. Every action is appended to data/logs/pm2-watchdog.log
# ============================================================================

$ErrorActionPreference = "SilentlyContinue"
$log = "C:\Users\User\Downloads\Uplift\Draymond-Orchestrator\data\logs\pm2-watchdog.log"

function Log($msg) {
    $line = "{0} {1}" -f (Get-Date -Format s), $msg
    Add-Content -LiteralPath $log -Value $line
    # rotate at 5MB
    if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        Move-Item -LiteralPath $log -Destination "$log.$stamp" -Force
    }
}

function Get-Jlist {
    try {
        $out = & pm2 jlist 2>$null
        if ($null -eq $out -or @($out).Count -eq 0) { return @() }
        return ($out -join "" | ConvertFrom-Json)
    } catch { return @() }
}

$apps = Get-Jlist

# 1. Daemon dead or empty -> resurrect saved fleet.
if (@($apps).Count -eq 0) {
    Log "DAEMON DEAD/EMPTY - resurrecting"
    & pm2 resurrect 2>&1 | Out-Null
    Start-Sleep -Seconds 10
    $apps = Get-Jlist
    Log ("resurrect complete, apps online: " + @($apps).Count)
}

if (@($apps).Count -eq 0) {
    Log "still empty after resurrect - giving up until next cycle"
    exit 1
}

# 2. Primary tier must be online; restart any that are not.
$primaries = @("draymond", "keywire", "dsh-harness", "litellm", "deterministic-brain")
$repaired = @()
foreach ($p in $primaries) {
    $app = $apps | Where-Object { $_.name -eq $p }
    if ($null -eq $app) {
        Log "primary '$p' missing from process list"
        $repaired += $p
    } elseif ($app.pm2_env.status -ne "online") {
        Log "primary '$p' status=$($app.pm2_env.status) - restarting"
        & pm2 restart $p 2>&1 | Out-Null
        $repaired += "$p(restart)"
    }
}
if ($repaired.Count -gt 0) {
    Start-Sleep -Seconds 15
    # GUARD (2026-08-25 outage): never persist a degraded fleet over the last
    # known-good dump. This morning an empty-list save destroyed the only
    # restore point while the daemon was crash-looping.
    $appsAfterRepair = Get-Jlist
    $dump = "$env:USERPROFILE\.pm2\dump.pm2"
    if (@($appsAfterRepair).Count -ge 5 -or -not (Test-Path $dump)) {
        Copy-Item -LiteralPath $dump -Destination "$dump.pre-save.bak" -Force -ErrorAction SilentlyContinue
        & pm2 save 2>&1 | Out-Null
        Log "pm2 save OK (apps=$(@($appsAfterRepair).Count))"
    } else {
        Log ("SKIPPED pm2 save - fleet degraded (apps=$(@($appsAfterRepair).Count) < 5); dump preserved")
    }
    Log ("repair actions: " + ($repaired -join ", "))
}

exit 0
