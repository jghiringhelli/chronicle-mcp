<#
.SYNOPSIS
  Stop the Chronicle MCP daemon.
#>
$pidFile = "$HOME\.chronicle\server.pid"
if (Test-Path $pidFile) {
  $pid = Get-Content $pidFile -Raw | ForEach-Object { $_.Trim() }
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($proc) {
    Stop-Process -Id $pid -Force
    Write-Host "✓ Chronicle stopped (PID $pid)" -ForegroundColor Green
  } else {
    Write-Host "Process $pid not found (already stopped)" -ForegroundColor DarkGray
  }
  Remove-Item $pidFile -Force
} else {
  Write-Host "Chronicle is not running (no PID file)" -ForegroundColor DarkGray
}
