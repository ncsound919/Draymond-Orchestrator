# ============================================================================
# install-system-agent.ps1 - Register the System-Agent as a SYSTEM scheduled task
# ============================================================================
# Requires elevation (UAC). The agent runs as the SYSTEM account (highest
# privileges), binds to 127.0.0.1:3405, and starts at logon with restart-on-
# failure. This makes the agent survive reboots and gives it the privileges it
# needs to control the laptop and protect the whole machine.
#
# Usage:
#   .\scripts\install-system-agent.ps1            # install (elevate if needed)
#   .\scripts\install-system-agent.ps1 -Uninstall  # remove the task
#   .\scripts\install-system-agent.ps1 -CheckOnly  # report task state only
# ============================================================================

param(
  [switch]$Uninstall,
  [switch]$CheckOnly,
  [switch]$Start
)

$ErrorActionPreference = "Stop"
$TaskName = "Overlay365 System Agent"

# ── Elevate if not admin ─────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  $transcript = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "data\system-agent-install.log"
  Start-Transcript -Path $transcript -Force | Out-Null
}
if (-not $isAdmin) {
  Write-Host "Elevating to administrator..."
  $self = $MyInvocation.MyCommand.Path
  $elevArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$self`"")
  if ($Uninstall) { $elevArgs += "-Uninstall" }
  elseif ($CheckOnly) { $elevArgs += "-CheckOnly" }
  elseif ($Start) { $elevArgs += "-Start" }
  $psi = Start-Process -FilePath "powershell.exe" -ArgumentList $elevArgs -Verb RunAs -Wait -PassThru
  Write-Host "Elevated exit code: $($psi.ExitCode)"
  exit $psi.ExitCode
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$agentDir = Join-Path $repoRoot "agents\system-agent"
$nodeBin = "C:\Program Files\nodejs\node.exe"

if (-not (Test-Path $nodeBin)) {
  # Fall back to whatever node is on PATH.
  $cmdNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $cmdNode) { Write-Error "node.exe not found"; exit 1 }
  $nodeBin = $cmdNode.Source
}

if ($CheckOnly) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Write-Host "Task exists: $($task.TaskName)"
    Write-Host "  State: $($task.State)"
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "  Last run: $($info.LastRunTime)"
    Write-Host "  Last result: $($info.LastTaskResult)"
  } else {
    Write-Host "Task NOT installed."
  }
  exit 0
}

if ($Start) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { Write-Error "Task not installed. Run without -Start first."; if ($isAdmin) { Stop-Transcript | Out-Null }; exit 1 }
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started task '$TaskName'. Wait ~10s then verify port 3405."
  if ($isAdmin) { Stop-Transcript | Out-Null }
  exit 0
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Uninstalled task '$TaskName'."
  exit 0
}

# ── Prepare the agent dir ─────────────────────────────────────────────────────
if (-not (Test-Path $agentDir)) { Write-Error "agent dir missing: $agentDir"; exit 1 }
if (-not (Test-Path (Join-Path $agentDir "node_modules"))) {
  Write-Host "Installing system-agent dependencies (first run)..."
  Push-Location $agentDir
  npm install --no-audit --no-fund
  Pop-Location
}
if (-not (Test-Path (Join-Path $agentDir ".env"))) {
  Copy-Item (Join-Path $agentDir ".env.example") (Join-Path $agentDir ".env")
  Write-Host "Created .env from example. Set SYSTEM_AGENT_KEY before first use."
}

# ── Build the command line (quoted) ─────────────────────────────────────────
# node --import tsx src/server.ts  (cwd = agent dir)
$nodeQuoted = "`"$nodeBin`""
$argsQuoted = "--import tsx src/server.ts"
$workDir = $agentDir
$action = New-ScheduledTaskAction -Execute $nodeQuoted -Argument $argsQuoted -WorkingDirectory $workDir

# Run as SYSTEM (highest privileges).
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# At logon + a startup trigger; restart on failure every minute, up to 3 times.
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Registered task '$TaskName' as SYSTEM (highest privileges)."
Write-Host "  Exec: $nodeBin --import tsx src/server.ts"
Write-Host "  CWD : $workDir"
Write-Host ""
Write-Host "Verify with:  .\scripts\install-system-agent.ps1 -CheckOnly"
Write-Host "Start now with:  Start-ScheduledTask -TaskName '$TaskName'"

if ($isAdmin) { Stop-Transcript | Out-Null }
