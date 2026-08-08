# ============================================================================
# graphify-index.ps1 — Build the Graphify knowledge graph for the workspace
# ============================================================================
# Installs Graphify (PyPI: graphifyy) if missing, then maps the ecosystem into
# a queryable knowledge graph at graphify-out/ (graph.json + GRAPH_REPORT.md).
# Code extraction is local (tree-sitter AST, no API calls). Docs/PDFs need an
# LLM backend — pass -Backend gemini (uses GEMINI_API_KEY) or use -CodeOnly to
# skip them entirely.
#
# Usage:
#   .\scripts\graphify-index.ps1               # code-only (offline, recommended)
#   .\scripts\graphify-index.ps1 -CodeOnly    # same
#   .\scripts\graphify-index.ps1 -Full        # include docs/PDFs (needs a key)
#   .\scripts\graphify-index.ps1 -SkipInstall # graphify already installed
# ============================================================================

param(
  [switch]$CodeOnly,
  [switch]$Full,
  [switch]$SkipInstall,
  [string]$Backend = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

# 1. Ensure graphify is installed.
if (-not $SkipInstall) {
  try {
    $g = (Get-Command graphify -ErrorAction Stop).Source
    Write-Host "graphify found: $g"
  } catch {
    Write-Host "Installing graphify (graphifyy)..."
    if (Get-Command uv -ErrorAction SilentlyContinue) {
      uv tool install graphifyy
      uv tool update-shell
    } elseif (Get-Command pipx -ErrorAction SilentlyContinue) {
      pipx install graphifyy
    } else {
      pip install graphifyy
    }
    if (-not (Get-Command graphify -ErrorAction SilentlyContinue)) {
      Write-Warning "graphify not on PATH — run: uv tool update-shell (or pipx ensurepath), then re-open the terminal."
    }
  }
}

# 2. Build the graph.
$argsList = @(".")
if ($CodeOnly -or -not $Full) {
  $argsList += "--code-only"
  $argsList += "--no-viz"
}
if ($Backend -ne "") {
  $argsList += "--backend"
  $argsList += $Backend
}

Write-Host "Running: graphify $($argsList -join ' ')  (this maps the whole ecosystem — may take a while)"
& graphify @argsList

Write-Host ""
Write-Host "Knowledge graph written to graphify-out/"
Write-Host "  - graphify-out/graph.json        the full graph (query via MCP)"
Write-Host "  - graphify-out/GRAPH_REPORT.md   god nodes, communities, surprises"
Write-Host ""
Write-Host "Serve it to the chat:  .\scripts\start-tools.ps1 -Tools graphify"
