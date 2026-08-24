# start-litellm.ps1 - Boot LiteLLM proxy on 4100 with UTF-8 I/O and keys from .env.local.
# LiteLLM dies on Windows because its banner prints unicode to cp1252. Fixes that
# and loads the model keys (.env.local is not auto-loaded by litellm).
param([switch]$Foreground)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logDir = Join-Path $repoRoot "data\server-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Load .env.local into the process environment (do not clobber existing vars).
$envFile = Join-Path $repoRoot ".env.local"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $k, $v = $line -split "=", 2
      if ($k -and -not [Environment]::GetEnvironmentVariable($k)) {
        Set-Item -Path "Env:$k" -Value $v
      }
    }
  }
}

# Load the KeyWire-synced LLM pool keys (data/litellm.env, refreshed by
# scripts/sync-litellm-keys.ps1). Loaded AFTER .env.local so fresh vault values win.
$poolFile = Join-Path $repoRoot "data\litellm.env"
if (Test-Path $poolFile) {
  Get-Content $poolFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $k, $v = $line -split "=", 2
      if ($k -and $v) { Set-Item -Path "Env:$k" -Value $v }
    }
  }
} else {
  Write-Warning "data/litellm.env not found — free-account pool will be empty. Run scripts/sync-litellm-keys.ps1 first."
}

$env:PYTHONIOENCODING = "utf-8"
$env:PORT = "4100"

if ($Foreground) {
  litellm --config litellm.yaml --port 4100
  exit $LASTEXITCODE
}

$stdout = Join-Path $logDir "litellm.out.log"
$stderr = Join-Path $logDir "litellm.err.log"
$p = Start-Process -FilePath "litellm" -ArgumentList @("--config", "litellm.yaml", "--port", "4100") `
      -WorkingDirectory $repoRoot -WindowStyle Hidden `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
Write-Host "litellm started (pid $($p.Id)) on 4100"
