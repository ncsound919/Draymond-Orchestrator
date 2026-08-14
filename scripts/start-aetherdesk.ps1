# start-aetherdesk.ps1 - Boot the Aetherdesk Call Center API on 8002.
$ErrorActionPreference = "Stop"
$aetherdeskRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\04_Integrations\Aetherdesk-Call-Center")).Path
$logDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "data\server-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$stdout = Join-Path $logDir "aetherdesk.out.log"
$stderr = Join-Path $logDir "aetherdesk.err.log"
$p = Start-Process -FilePath "python" `
      -ArgumentList @("-m", "uvicorn", "src.api.main:app", "--host", "127.0.0.1", "--port", "8002") `
      -WorkingDirectory $aetherdeskRoot -WindowStyle Hidden `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
Write-Host "aetherdesk started (pid $($p.Id)) on 8002"
