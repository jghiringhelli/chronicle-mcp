<#
.SYNOPSIS
  Register an AI session for the current git repo.

.DESCRIPTION
  Uses the git root-commit SHA as a stable repo ID (survives renames/moves).
  Stores session metadata in ~/.chronicle/registry.json.

.EXAMPLES
  # Register a Copilot session (copy session ID from CLI output)
  .\register-session.ps1 -Client copilot -Account "work1" -SessionId "abc-123"

  # Register second Copilot account
  .\register-session.ps1 -Client copilot -Account "work2" -SessionId "xyz-456"

  # Register Claude session (auto-detects current folder)
  .\register-session.ps1 -Client claude -Account "personal"

.PARAMETER Client
  AI client: "copilot" or "claude"

.PARAMETER Account
  Account label, e.g. "work1", "work2", "personal"

.PARAMETER SessionId
  Session ID (required for copilot; omit for claude)
#>
param(
  [Parameter(Mandatory)][ValidateSet("copilot","claude")][string]$Client,
  [Parameter(Mandatory)][string]$Account,
  [string]$SessionId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Locate git repo root -----------------------------------------------
$gitRoot = git rev-parse --show-toplevel 2>$null
if (-not $gitRoot) { Write-Error "Not inside a git repository."; exit 1 }
$gitRoot = $gitRoot.Trim().Replace("/", "\")

# Stable repo identity = SHA of the very first commit
$repoId = (git -C $gitRoot rev-list --max-parents=0 HEAD).Trim()
if (-not $repoId) { Write-Error "Could not determine repo identity."; exit 1 }

# Human-readable name (folder name)
$repoName = Split-Path $gitRoot -Leaf

# Remote URL if available
$remoteUrl = (git -C $gitRoot remote get-url origin 2>$null) -replace "`n",""

# --- Load registry -------------------------------------------------------
$registryPath = Join-Path $HOME ".chronicle\registry.json"
if (Test-Path $registryPath) {
  $registry = Get-Content $registryPath -Raw | ConvertFrom-Json -AsHashtable
} else {
  $registry = @{ repos = @{} }
}
if (-not $registry.ContainsKey("repos")) { $registry["repos"] = @{} }

# Initialise repo entry if missing
if (-not $registry.repos.ContainsKey($repoId)) {
  $registry.repos[$repoId] = @{
    name      = $repoName
    repoId    = $repoId
    remoteUrl = $remoteUrl
    sessions  = @{}
  }
}

# Always refresh local path (handles folder moves)
$registry.repos[$repoId]["localPath"] = $gitRoot
if ($remoteUrl) { $registry.repos[$repoId]["remoteUrl"] = $remoteUrl }

# --- Register session ----------------------------------------------------
$key = "$Client`:$Account"
$now = (Get-Date).ToUniversalTime().ToString("o")

if ($Client -eq "copilot") {
  if (-not $SessionId) { Write-Error "-SessionId is required for copilot."; exit 1 }
  $registry.repos[$repoId]["sessions"][$key] = @{
    client    = $Client
    account   = $Account
    sessionId = $SessionId
    savedAt   = $now
  }
  Write-Host "✓ Registered  copilot/$Account  session $SessionId  →  $repoName" -ForegroundColor Green

} elseif ($Client -eq "claude") {
  $registry.repos[$repoId]["sessions"][$key] = @{
    client    = $Client
    account   = $Account
    workdir   = $gitRoot
    savedAt   = $now
  }
  Write-Host "✓ Registered  claude/$Account  workdir $gitRoot  →  $repoName" -ForegroundColor Green
}

# --- Persist -------------------------------------------------------------
$registry | ConvertTo-Json -Depth 10 | Set-Content $registryPath -Encoding UTF8
Write-Host "  Registry: $registryPath"
