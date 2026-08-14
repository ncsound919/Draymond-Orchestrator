param([string]$Name, [string]$Dir, [string]$Port)
$ErrorActionPreference = "Stop"
$logDir = "C:\Users\User\Downloads\Uplift\Draymond-Orchestrator\data\server-logs"
$out = Join-Path $logDir "$Name.out.log"
$err = Join-Path $logDir "$Name.err.log"
$p = Start-Process -FilePath "python" -ArgumentList @("-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", $Port) -WorkingDirectory $Dir -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
Write-Host "$Name started pid $($p.Id) on $Port"
