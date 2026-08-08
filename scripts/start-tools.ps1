# ============================================================================
# start-tools.ps1 - Boot the internal tool stack on canonical ports
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
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads .ps1 without a UTF-8
# BOM as ANSI, so box-drawing / unicode chars corrupt the parser.
# ============================================================================

param(
  [string]$ToolList = "",          # comma-separated slugs to start (default: all)
  [string]$Skip = "",           # comma-separated slugs to skip
  [switch]$CheckOnly,           # only health-check, don't start
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logDir = Join-Path $repoRoot "data\server-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# slug -> { cmd, args, cwd, port, health }
$TOOLS = @{
  "agent-browser" = @{ cmd = "npx";      args = @("next", "dev", "-p", "3700");           cwd = "agents\AgentBrowser-main"; port = 3700; health = "/api/health" }
  "mutly"         = @{ cmd = "npm";      args = @("run", "dev");                           cwd = "agents\Mutly-Daemon-Agent"; port = 4000; health = "/api/health" }
  "opencode"      = @{ cmd = "opencode"; args = @("serve", "--port", "4096");              cwd = "."; port = 4096; health = "/" }
  "reporank"      = @{ cmd = "pnpm";     args = @("dev:local");                            cwd = "agents\reporank"; port = 3200; health = "/api/health" }
  "grader"        = @{ cmd = "npm";      args = @("run", "dev");                           cwd = "agents\Grader-main"; port = 3201; health = "/api/health" }
  "codegang"      = @{ cmd = "npx";      args = @("next", "dev", "--webpack", "-p", "3204"); cwd = "agents\Codegang"; port = 3204; health = "/api" }
  "deterministic-brain" = @{ cmd = "python"; args = @("main.py", "--serve"); cwd = "agents\deterministic-brain"; port = 3210; health = "/health" }
  # Graphify - codebase knowledge graph MCP server (PyPI: graphifyy). Needs the
  # graph built first: `graphify . --code-only --no-viz` + `cluster-only`.
  # Launched via scripts/serve-graphify.py which adds a GET /health route (the
  # MCP /mcp endpoint only accepts POST; GET /mcp is the SSE handshake and 406s
  # by spec). --json-response + --stateless for plain-JSON MCP clients.
  "graphify"      = @{ cmd = "python";   args = @("scripts\serve-graphify.py", "graphify-out\graph.json", "--transport", "http", "--port", "3203", "--host", "127.0.0.1", "--json-response", "--stateless"); cwd = "."; port = 3203; health = "/health" }
  "claw-protect"  = @{ cmd = "npm";      args = @("run", "dev");                           cwd = "agents\Claw-Protect-main"; port = 3300; health = "/health" }
  "vibeserve"     = @{ cmd = "python";   args = @("-m", "vibeserve");                      cwd = "agents\VibeServe-main"; port = 3600; health = "/health" }
  "big-homie"     = @{ cmd = "uvicorn";  args = @("big_homie_web:app", "--port", "3500");  cwd = "agents\AgentBrowser-main\Big-Homie-main"; port = 3500; health = "/health" }
  "litellm"       = @{ cmd = "litellm";  args = @("--config", "litellm.yaml", "--port", "4100"); cwd = "."; port = 4100; health = "/health" }
  # Ecosystem data/research services
  # BookBridge - self-hosts HTTP on 8777 via main.py (bookbridge.server).
  "bookbridge"    = @{ cmd = "python";   args = @("main.py");                                cwd = "agents\BookBridge--main"; port = 8777; health = "/health" }
  # Hemp-OS / HempForge live in the Uplift repo root (sibling of Draymond-Orchestrator).
  # Hemp-OS is a Node/tsx app (server.ts) — needs `npm install` before first run.
  "hemp-os"       = @{ cmd = "npm";      args = @("run", "dev");                           cwd = "..\potential\Hemp-OS-main"; port = 3100; health = "/health" }
  "hempforge"     = @{ cmd = "npm";      args = @("run", "dev");                           cwd = "..\potential\HempForge-main"; port = 3110; health = "/api/health" }
  # Kaggle rides on the deterministic-brain (already started above); its health
  # endpoint is /kaggle/status on 3210. Requires KAGGLE_USERNAME + KAGGLE_KEY.
}

$want = @()
if ($ToolList -ne "") { $want = $ToolList -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ } }
$skipSet = @{}
if ($Skip -ne "") {
  foreach ($s in ($Skip -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })) { $skipSet[$s] = $true }
}
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
    if (-not $Quiet) { Write-Host "  WARN  $slug - working dir not found: $work (skipping)" }
    return
  }
  $stdout = Join-Path $logDir "$slug.out.log"
  $stderr = Join-Path $logDir "$slug.err.log"
  $env:PORT = "$($def.port)"
  $env:API_PORT = "$($def.port)"   # deterministic-brain reads API_PORT
  if ($slug -eq "mutly") { $env:MUTLY_WS_PORT = "24679" }  # avoid clashing with the Uplift Justice WS gateway on 24678

  # Resolve the real executable. .ps1 shims (npm/npx/pnpm/opencode from
  # AppData/Roaming/npm) are NOT valid Win32 applications for Start-Process, so
  # we call their .cmd sibling through cmd.exe /c. Real exes run directly.
  $cmd = $def.cmd
  $resolved = Get-Command $cmd -ErrorAction SilentlyContinue
  $args = $def.args
  $exe = $cmd
  if ($resolved -and $resolved.Source -match '\.ps1$') {
    $cmdPath = $resolved.Source
    $cmdSibling = [System.IO.Path]::ChangeExtension($cmdPath, ".cmd")
    if (Test-Path $cmdSibling) {
      $exe = "cmd.exe"
      # Build: cmd.exe /c ""<cmdSibling>" <quoted args>"
      $quoted = @()
      foreach ($a in $args) { if ($a -match '\s') { $quoted += "`"$a`"" } else { $quoted += $a } }
      $args = @("/c", "`"$cmdSibling`" " + ($quoted -join " "))
    } else {
      # No .cmd sibling — run via powershell -File.
      $exe = "powershell.exe"
      $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $cmdPath) + $args
    }
  }

  $p = Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $work `
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
  if (-not $Quiet) { Write-Host "Waiting for services to come up..." }
  Start-Sleep -Seconds 8
}

# Health check
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
