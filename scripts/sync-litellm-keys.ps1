# sync-litellm-keys.ps1 - Pull decrypted LLM pool credentials from the KeyWire
# vault (project "Overlay365 Fleet", Production env) into data/litellm.env so
# start-litellm.ps1 can load them without anyone handling plaintext keys.
#
# The vault export endpoint returns .env-format text; values are decrypted
# server-side inside KeyWire and written here with 0600-equivalent ACLs.
param(
  [string]$KeyWireUrl = "http://127.0.0.1:3000/api/v1",
  [string]$ProjectId = "prj-mt7jrul1",
  [string]$EnvSlug = "production"
)
$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outFile = Join-Path $repoRoot "data\litellm.env"

$url = "$KeyWireUrl/projects/$ProjectId/envs/$EnvSlug/export`?format=env"
try {
  $content = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15 | Select-Object -ExpandProperty Content
} catch {
  Write-Error "Could not reach KeyWire at $KeyWireUrl - is the vault running? ($_)"
  exit 1
}

# Only keep the pool vars litellm.yaml references (plus passthrough of any
# existing LITELLM_MASTER_KEY / DEEPSEEK / GEMINI entries if present).
$wanted = @(
  'OPENCODE_API_KEY',
  'OPENCODE_KEY_TAP919BEATS','OPENCODE_KEY_JOHNREDD','OPENCODE_KEY_NCSOUND919','OPENCODE_KEY_TAP4500',
  'OLLAMA_KEY_PRIMARY','OLLAMA_KEY_TAP919BEATS','OLLAMA_KEY_TAP4500','OLLAMA_KEY_NCSOUND919','OLLAMA_KEY_JOHNREDD888','OLLAMA_KEY_NCSOUND_ALT',
  'OPENROUTER_API_KEY','DEEPSEEK_API_KEY','GEMINI_API_KEY'
)
$lines = $content -split "`n" | ForEach-Object { $_.Trim() } |
  Where-Object { $_ -and (-not $_.StartsWith('#')) -and $_.Contains('=') } |
  Where-Object { $k = ($_ -split '=', 2)[0]; $wanted -contains $k } |
  ForEach-Object {
    # KeyWire export wraps values in double quotes; LiteLLM must receive the
    # bare token, so unwrap them here.
    $k, $v = $_ -split '=', 2
    if ($v.StartsWith('"') -and $v.EndsWith('"') -and $v.Length -ge 2) { $v = $v.Substring(1, $v.Length - 2) }
    "$k=$v"
  }

New-Item -ItemType Directory -Force -Path (Split-Path $outFile) | Out-Null
$tmp = "$outFile.tmp"
Set-Content -LiteralPath $tmp -Value $lines -Encoding Ascii
Move-Item -Force -LiteralPath $tmp -Destination $outFile

$found = ($lines | ForEach-Object { ($_ -split '=', 2)[0] })
Write-Host "synced $($found.Count) keys -> data/litellm.env"
if ($found -notcontains 'OPENROUTER_API_KEY') { Write-Warning 'OPENROUTER_API_KEY missing from vault export' }
Write-Host 'remember to set OLLAMA_CLOUD_LITELLM_MODEL and OPENROUTER_FREE_LITELLM_MODEL in .env.local'
