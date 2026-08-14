Start-ScheduledTask -TaskName "Overlay365 System Agent"
Start-Sleep -Seconds 15
$i = Get-ScheduledTaskInfo -TaskName "Overlay365 System Agent"
Write-Output ("Result: " + $i.LastTaskResult)
$c = Get-NetTCPConnection -LocalPort 3405 -ErrorAction SilentlyContinue
if ($c) { Write-Output ("PORT 3405 OPEN by pid " + $c[0].OwningProcess) } else { Write-Output "PORT 3405 NOT OPEN" }
