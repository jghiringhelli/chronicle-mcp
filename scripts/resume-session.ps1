<#
.SYNOPSIS
  Resume the AI session for the current git repo.

.DESCRIPTION
  Looks up ~/.chronicle/registry.json using the git root-commit SHA.
  Works even if the folder has been moved or renamed.

.EXAMPLES
  # List all registered sessions for this repo
  .\resume-session.ps1

  # Get the Copilot resume command for account "work1"
  .\resume-session.ps1 -Client copilot -Account work1

  # Get the Claude resume hint for personal account
  .\resume-session.ps1 -Client claude -Account personal

.PARAMETER Client
  AI client: "copilot" or "claude"

.PARAMETER Account
  Account label registered earlier

.PARAMETER Copy
  Copy the resume command to clipboard instead of printing it
#>
param(
  [ValidateSet("copilot","claude","")][string]$Client = "",
  [string]$Account = "",
  [switch]$Copy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Locate repo ----------------------------------------------------------
$gitRoot = git rev-parse --show-toplevel 2>$null
if (-not $gitRoot) { Write-Error "Not inside a git repository."; exit 1 }
$gitRoot = $gitRoot.Trim()

$repoId = (git -C $gitRoot rev-list --max-parents=0 HEAD).Trim()
$repoName = Split-Path $gitRoot -Leaf

# --- Load registry -------------------------------------------------------
$registryPath = Join-Path $HOME ".chronicle\registry.json"
if (-not (Test-Path $registryPath)) {
  Write-Host "No sessions registered yet. Run register-session.ps1 first." -ForegroundColor Yellow
  exit 0
}

$registry = Get-Content $registryPath -Raw | ConvertFrom-Json -AsHashtable

if (-not $registry.repos.ContainsKey($repoId)) {
  Write-Host "No sessions found for repo '$repoName' (id: $repoId)." -ForegroundColor Yellow
  Write-Host "Run register-session.ps1 to register one."
  exit 0
}

$repo    = $registry.repos[$repoId]
$sessions = $repo["sessions"]

# --- Detect if folder moved, update registry silently -------------------
$storedPath = $repo["localPath"]
if ($storedPath -and ($storedPath.Replace("/","\") -ne $gitRoot.Replace("/","\"))) {
  Write-Host "  (folder path updated: $storedPath → $gitRoot)" -ForegroundColor DarkGray
  $registry.repos[$repoId]["localPath"] = $gitRoot
  $registry | ConvertTo-Json -Depth 10 | Set-Content $registryPath -Encoding UTF8
}

# --- List mode (no params) -----------------------------------------------
if (-not $Client) {
  Write-Host ""
  Write-Host "Sessions for: $repoName" -ForegroundColor Cyan
  Write-Host "  Repo ID : $repoId"
  Write-Host "  Path    : $gitRoot"
  Write-Host ""
  if ($sessions.Count -eq 0) {
    Write-Host "  (none registered yet)" -ForegroundColor DarkGray
  } else {
    foreach ($key in $sessions.Keys | Sort-Object) {
      $s = $sessions[$key]
      $info = if ($s.client -eq "copilot") { "session-id: $($s.sessionId)" } else { "workdir: $($s.workdir)" }
      Write-Host ("  [{0,-20}]  {1}  (saved {2:yyyy-MM-dd})" -f $key, $info, [datetime]$s.savedAt) -ForegroundColor White
    }
  }
  Write-Host ""
  exit 0
}

# --- Targeted resume ------------------------------------------------------
$key = "$Client`:$Account"
if (-not $sessions.ContainsKey($key)) {
  Write-Host "No session found for [$key] in repo '$repoName'." -ForegroundColor Yellow
  Write-Host "Available keys: $($sessions.Keys -join ', ')"
  exit 1
}

$s = $sessions[$key]

if ($Client -eq "copilot") {
  $cmd = "gh copilot session --resume $($s.sessionId)"
  if ($Copy) {
    $cmd | Set-Clipboard
    Write-Host "✓ Copied to clipboard: $cmd" -ForegroundColor Green
  } else {
    Write-Host ""
    Write-Host "Resume command:" -ForegroundColor Cyan
    Write-Host "  $cmd" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "(pass -Copy to copy to clipboard)" -ForegroundColor DarkGray
  }

} elseif ($Client -eq "claude") {
  $workdir = $s.workdir
  # Update workdir to current location if folder moved
  if ($workdir.Replace("/","\") -ne $gitRoot.Replace("/","\")) {
    $workdir = $gitRoot
  }
  $cmd = "cd `"$workdir`""
  if ($Copy) {
    $cmd | Set-Clipboard
    Write-Host "✓ Copied to clipboard: $cmd" -ForegroundColor Green
  } else {
    Write-Host ""
    Write-Host "Claude resumes from the working directory:" -ForegroundColor Cyan
    Write-Host "  $workdir" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  cd `"$workdir`"" -ForegroundColor White
    Write-Host "  # then open Claude in that folder" -ForegroundColor DarkGray
    Write-Host ""
  }
}
