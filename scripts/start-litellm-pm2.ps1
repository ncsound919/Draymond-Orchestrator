# start-litellm-pm2.ps1 - (Re)register the LiteLLM gateway under pm2 WITH the
# KeyWire-synced free-account pool keys loaded. pm2 env vars are frozen at
# start time, so this wrapper loads .env.local + data/litellm.env into the
# calling shell before handing off to pm2.
#
# Flow: scripts/sync-litellm-keys.ps1  ->  data/litellm.env  ->  this script.
param()
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

foreach ($envFile in @(".env.local", "data\litellm.env")) {
  $path = Join-Path $repoRoot $envFile
  if (-not (Test-Path $path)) { if ($envFile -eq 'data\litellm.env') { Write-Warning "$envFile missing - run sync-litellm-keys.ps1" }; continue }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $k, $v = $line -split "=", 2
      if ($k -and $v) { Set-Item -Path "Env:$k" -Value $v }
    }
  }
}

$poolCount = (Get-Content (Join-Path $repoRoot "data\litellm.env") | Measure-Object).Count
Write-Host "starting litellm under pm2 with $poolCount pool key(s) loaded"

pm2 delete litellm 2>$null
pm2 start litellm --name litellm --max-memory-restart 1G -- --config litellm.yaml --port 4100
pm2 save
