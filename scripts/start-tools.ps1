# ============================================================================
# start-tools.ps1 — Boot the internal tool stack on canonical ports
# ============================================================================
# Canonical port allocation lives in src/lib/draymond/ports.ts. This script
# starts the definitive-stack tools on their assigned ports, waits for them to
# come up, and health-checks each one.
#
# Usage:
#   .\scripts\start-tools.ps1                          # start everything
#   .\scripts\start-tools.ps1 -Tools reporank,grader   # start a subset
#   .\scripts\start-tools.ps1 -CheckOnly               # just health-check
#   .\scripts\start-tools.ps1 -Skip agent-browser      # start all but one
# ============================================================================

param(
  [string]$Tools = "",          # comma-separated slugs to start (default: all)
  [string]$Skip = "",           # comma-separated slugs to skip
  [switch]$CheckOnly,           # only health-check, don't start
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logDir = Join-Path $repoRoot "data\server-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# slug → { cmd, args, cwd, port, health }
$TOOLS = @{
  "agent-browser" = @{ cmd = "npx";      args = @("next", "dev", "-p", "3700");           cwd = "agents\AgentBrowser-main"; port = 3700; health = "/api/health" }
  "mutly"         = @{ cmd = "npm";      args = @("run", "dev");                           cwd = "agents\Mutly-Daemon-Agent"; port = 4000; health = "/api/health" }
  "megacode"      = @{ cmd = "npm";      args = @("run", "start");                         cwd = "agents\Megacode-main"; port = 9744; health = "/health" }
  "reporank"      = @{ cmd = "pnpm";     args = @("dev:local");                            cwd = "agents\reporank"; port = 3200; health = "/api/health" }
  "grader"        = @{ cmd = "npm";      args = @("run", "dev");                           cwd = "agents\Grader-main"; port = 3201; health = "/api/health" }
  "vibe-reality"  = @{ cmd = "npm";      args = @("run", "dev");                           cwd = "agents\Vibe-Reality-main"; port = 3202; health = "/health" }
  "graphify"      = @{ cmd = "python";   args = @("-m", "graphify.serve", "graphify-out\graph.json", "--transport", "http", "--port", "3203"); cwd = "."; port = 3203; health = "/health" }
  "deterministic-brain" = @{ cmd = "python"; args = @("main.py", "--serve"); cwd = "agents\deterministic-brain"; port = 3210; health = "/health" }
  "claw-protect"  = @{ cmd = "npm";      args = @("run", "dev");                           cwd = "agents\Claw-Protect-main"; port = 3300; health = "/health" }
  "vibeserve"     = @{ cmd = "python";   args = @("-m", "vibeserve");                      cwd = "agents\VibeServe-main"; port = 3600; health = "/health" }
  "big-homie"     = @{ cmd = "uvicorn";  args = @("big_homie_web:app", "--port", "3500");  cwd = "agents\AgentBrowser-main\Big-Homie-main"; port = 3500; health = "/health" }
  "litellm"       = @{ cmd = "litellm";  args = @("--config", "litellm.yaml", "--port", "4100"); cwd = "."; port = 4100; health = "/health" }
}

$want = @()
if ($Tools -ne "") { $want = $Tools -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ } }
$skipSet = @{}
if ($Skip -ne "") { $skipSet = ($Skip -split "," | ForEach-Object { $_.Trim() }) | ForEach-Object { $skipSet[$_] = $true } }
$pids = @{}

function Test-Url($url, $timeoutMs = 1500) {
  try {
    $r = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
  } catch {
    try {
      $r2 = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
      return $r2.StatusCode -ge 200 -and $r2.StatusCode -lt 500
    } catch { return $false }
  }
}

function Start-One($slug, $def) {
  if ($CheckOnly) { return }
  if ($skipSet.ContainsKey($slug)) { if (-not $Quiet) { Write-Host "  skip  $slug" }; return }
  $work = Join-Path $repoRoot $def.cwd
  if (-not (Test-Path $work)) {
    if (-not $Quiet) { Write-Host "  WARN  $slug — working dir not found: $work (skipping)" }
    return
  }
  $stdout = Join-Path $logDir "$slug.out.log"
  $stderr = Join-Path $logDir "$slug.err.log"
  $env:PORT = "$($def.port)"
  $env:API_PORT = "$($def.port)"   # deterministic-brain reads API_PORT
  $p = Start-Process -FilePath $def.cmd -ArgumentList $def.args -WorkingDirectory $work `
        -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  $pids[$slug] = $p.Id
  if (-not $Quiet) { Write-Host "  start $slug  ->  http://localhost:$($def.port)  (pid $($p.Id))" }
}

if (-not $Quiet) { Write-Host "Starting internal tool stack on canonical ports ($repoRoot)" }
if (-not $CheckOnly) {
  $targets = if ($want.Count -gt 0) { $want } else { $TOOLS.Keys }
  foreach ($slug in $targets) {
    if ($TOOLS.ContainsKey($slug)) { Start-One $slug $TOOLS[$slug] }
    elseif (-not $Quiet) { Write-Host "  WARN  unknown tool slug: $slug" }
  }
  if (-not $Quiet) { Write-Host "Waiting for services to come up…" }
  Start-Sleep -Seconds 8
}

# ── Health check ─────────────────────────────────────────────────────────────
if (-not $Quiet) { Write-Host "`nHealth check:" }
$targets = if ($want.Count -gt 0) { $want } else { $TOOLS.Keys }
$ok = 0; $down = 0
foreach ($slug in $targets) {
  $def = $TOOLS[$slug]
  if (-not $def) { continue }
  $url = "http://localhost:$($def.port)$($def.health)"
  $up = Test-Url $url
  if ($up) { $ok++ } else { $down++ }
  if (-not $Quiet) { Write-Host ("  {0,-16} {1}  {2}" -f $slug, $(if ($up) { "UP  " } else { "DOWN" }), $url) }
}
if (-not $Quiet) {
  Write-Host "`n$ok up, $down down."
  if ($down -gt 0) { Write-Host "Check $logDir\*.err.log for failures." }
}
