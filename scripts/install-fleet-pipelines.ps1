# ============================================================================
# install-fleet-pipelines.ps1 - Provision folded-pipeline dependencies
# ============================================================================
# Installs the consolidated dependency manifest for one fleet pipeline (or
# every pipeline) so each parent agent's folded tools are runnable with a
# single `pip install -r`. The manifests live in pipelines/<parent>/.
#
# Usage:
#   .\scripts\install-fleet-pipelines.ps1                 # install all pipelines
#   .\scripts\install-fleet-pipelines.ps1 -Parent bookbridge
#   .\scripts\install-fleet-pipelines.ps1 -List           # list pipelines + manifests
#   .\scripts\install-fleet-pipelines.ps1 -CheckOnly      # verify manifests exist
# ============================================================================

param(
  [string]$Parent = "",       # pipeline parent slug; empty = all
  [switch]$List,              # print the pipeline -> manifest map and exit
  [switch]$CheckOnly,         # only verify manifests resolve, don't install
  [string]$Pip = "pip",       # pip executable (default: pip)
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# parent -> requirements file (must match fleet-pipelines.ts)
$PIPELINES = @{
  "social-media-dashboard" = "pipelines\social-media-dashboard\requirements.txt"
  "generative-video-ai"    = "pipelines\generative-video-ai\requirements.txt"
  "bookbridge"             = "pipelines\bookbridge\requirements.txt"
  "omniresearch-pro"       = "pipelines\omniresearch-pro\requirements.txt"
  "litellm"                = "pipelines\litellm\requirements.txt"
  "agent-browser"          = "pipelines\agent-browser\requirements.txt"
  "ufc-mcp"                = "pipelines\ufc-mcp\requirements.txt"
  "depscan"                = "pipelines\depscan\requirements.txt"
  "trading-agents"         = "pipelines\trading-agents\requirements.txt"
}

if ($List) {
  Write-Host "Fleet pipeline dependency manifests:"
  foreach ($k in ($PIPELINES.Keys | Sort-Object)) {
    $rel = Join-Path $repoRoot $PIPELINES[$k]
    $exists = Test-Path $rel
    Write-Host ("  {0,-22} {1}  {2}" -f $k, $(if ($exists) { "ok " } else { "MISSING" }), $PIPELINES[$k])
  }
  exit 0
}

$targets = @()
if ($Parent -ne "") {
  if (-not $PIPELINES.ContainsKey($Parent)) {
    Write-Host "ERROR: unknown pipeline parent '$Parent'. Known:" ($PIPELINES.Keys | Sort-Object) -join ", "
    exit 1
  }
  $targets = @($Parent)
} else {
  $targets = @($PIPELINES.Keys | Sort-Object)
}

$installed = 0
$failed = 0
foreach ($p in $targets) {
  $rel = Join-Path $repoRoot $PIPELINES[$p]
  if (-not (Test-Path $rel)) {
    Write-Host "  WARN  $p - manifest missing: $rel (skipping)"
    $failed++
    continue
  }
  if ($CheckOnly) {
    if (-not $Quiet) { Write-Host "  ok    $p  ->  $($PIPELINES[$p])" }
    continue
  }
  if (-not $Quiet) { Write-Host "  install $p  ->  $($PIPELINES[$p])" }
  & $Pip install -r $rel
  if ($LASTEXITCODE -eq 0) { $installed++ } else { $failed++ }
}

if ($CheckOnly) {
  Write-Host "Manifests checked: $($targets.Count) resolved, $failed missing."
} else {
  Write-Host "Pipeline deps installed: $installed ok, $failed failed."
}
