<#
.SYNOPSIS
  List all registered sessions across all projects.

.DESCRIPTION
  Reads ~/.chronicle/registry.json and shows every project's sessions.
  Use this after a PC restart to see what's available to resume.

.EXAMPLES
  .\list-sessions.ps1
  .\list-sessions.ps1 -Client copilot
#>
param(
  [ValidateSet("copilot","claude","")][string]$Client = ""
)

$registryPath = Join-Path $HOME ".chronicle\registry.json"
if (-not (Test-Path $registryPath)) {
  Write-Host "No session registry found at $registryPath" -ForegroundColor Yellow
  Write-Host "Run register-session.ps1 inside a project first."
  exit 0
}

$registry = Get-Content $registryPath -Raw | ConvertFrom-Json -AsHashtable

if ($registry.repos.Count -eq 0) {
  Write-Host "Registry is empty. No sessions registered yet." -ForegroundColor Yellow
  exit 0
}

Write-Host ""
Write-Host "Chronicle Session Registry" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host ""

foreach ($repoId in $registry.repos.Keys | Sort-Object) {
  $repo = $registry.repos[$repoId]
  $sessions = $repo["sessions"]

  # Filter by client if requested
  $filtered = if ($Client) {
    $sessions.Keys | Where-Object { $sessions[$_].client -eq $Client }
  } else {
    $sessions.Keys
  }
  if (-not $filtered) { continue }

  Write-Host "  $($repo.name)" -ForegroundColor White -NoNewline
  if ($repo["remoteUrl"]) { Write-Host "  ($($repo.remoteUrl))" -ForegroundColor DarkGray -NoNewline }
  Write-Host ""
  Write-Host "  Path: $($repo.localPath)" -ForegroundColor DarkGray
  Write-Host ""

  foreach ($key in $filtered | Sort-Object) {
    $s = $sessions[$key]
    if ($s.client -eq "copilot") {
      Write-Host ("    [{0,-22}]  gh copilot session --resume {1}" -f $key, $s.sessionId) -ForegroundColor Yellow
    } else {
      Write-Host ("    [{0,-22}]  cd `"{1}`"" -f $key, $s.workdir) -ForegroundColor Green
    }
    Write-Host ("    {0,26}  saved {1:yyyy-MM-dd HH:mm}" -f "", [datetime]$s.savedAt) -ForegroundColor DarkGray
  }
  Write-Host ""
}
