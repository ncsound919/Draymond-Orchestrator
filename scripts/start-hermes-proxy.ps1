# Boots hermes-proxy on HERMES_PROXY_PORT (default 8648). The chat backend was
# moved to real Hermes (api_server) on 8642 in Phase 1; this keeps only the
# media + voice proxy responsibilities (local edge-tts / faster-whisper bridge,
# with AetherDesk passthrough when configured).
#
# hermes-proxy lives inside the Draymond repo (hermes-proxy/).
#
# Run in a dedicated terminal:  powershell -ExecutionPolicy Bypass -File <this>

$ErrorActionPreference = 'Stop'
$proxyDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'hermes-proxy'
if (-not (Test-Path -LiteralPath (Join-Path $proxyDir 'server.js'))) {
    throw "hermes-proxy/server.js not found under $proxyDir"
}
Set-Location -LiteralPath $proxyDir

if (-not $env:HERMES_PROXY_PORT) { $env:HERMES_PROXY_PORT = 8648 }

# Load AetherDesk voice keys (server-side only — never sent to Hermes).
$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.env.local'
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        if ($_ -match '^(?<k>AETHERDESK_[A-Z0-9_]+)=(?<v>.*)$') {
            Set-Item -Path "Env:\$($Matches.k)" -Value $Matches.v
        }
    }
}

Write-Host "[hermes-proxy] booting on http://127.0.0.1:$env:HERMES_PROXY_PORT (media + voice only)"
& node "$proxyDir/server.js"
