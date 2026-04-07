<#
.SYNOPSIS
  Start Chronicle MCP HTTP server as a background daemon.

.DESCRIPTION
  Builds Chronicle (if needed) then launches on port 3100.
  Add this to Windows Task Scheduler or call from your shell profile on login.

.PARAMETER Port
  HTTP port (default: 3100)

.PARAMETER NoRebuild
  Skip the build step if dist/ is already up to date
#>
param(
  [int]$Port    = 3100,
  [switch]$NoRebuild
)

$chronicleDir = "C:\workspace\PragmaWorks\mcp\chronicle"
$distEntry    = Join-Path $chronicleDir "dist\index.js"
$logFile      = "$HOME\.chronicle\server.log"
$pidFile      = "$HOME\.chronicle\server.pid"

# --- Check if already running -------------------------------------------
if (Test-Path $pidFile) {
  $existingPid = Get-Content $pidFile -Raw | ForEach-Object { $_.Trim() }
  $proc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Host "Chronicle already running (PID $existingPid) on :$Port" -ForegroundColor Green
    exit 0
  }
  Remove-Item $pidFile -Force
}

# --- Build if needed ------------------------------------------------------
if (-not $NoRebuild) {
  Write-Host "Building Chronicle..." -ForegroundColor Cyan
  Push-Location $chronicleDir
  $buildResult = & pnpm run build 2>&1
  Pop-Location
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed:" -ForegroundColor Red
    $buildResult | Write-Host
    exit 1
  }
  Write-Host "Build OK" -ForegroundColor Green
}

if (-not (Test-Path $distEntry)) {
  Write-Error "dist\index.js not found. Run without -NoRebuild first."
  exit 1
}

# --- Launch daemon --------------------------------------------------------
$proc = Start-Process -FilePath "node" `
  -ArgumentList $distEntry, "--http", "--port", $Port `
  -RedirectStandardOutput $logFile `
  -RedirectStandardError  "$HOME\.chronicle\server.err.log" `
  -WindowStyle Hidden `
  -PassThru

$proc.Id | Set-Content $pidFile -Encoding UTF8
Write-Host "✓ Chronicle started (PID $($proc.Id)) on http://localhost:$Port/mcp" -ForegroundColor Green
Write-Host "  Logs: $logFile"
Write-Host "  Stop: Stop-Process -Id $($proc.Id)"

# Brief health check
Start-Sleep -Seconds 2
try {
  $response = Invoke-RestMethod "http://localhost:$Port/health" -TimeoutSec 3 -ErrorAction Stop
  Write-Host "  Health: OK ($response)" -ForegroundColor Green
} catch {
  Write-Host "  Health: no /health endpoint yet (server may still be starting)" -ForegroundColor DarkYellow
}
