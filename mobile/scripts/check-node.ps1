$ErrorActionPreference = "Stop"
$portable = Join-Path $env:LOCALAPPDATA "node-v20\node-v20.20.2-win-x64\node.exe"
if (Test-Path $portable) {
  $v = & $portable -v
  Write-Host ('Portable Node ' + $v + ' OK (npm run run:android uses this)')
  exit 0
}
$v = node -v 2>$null
$m = [int]($v -replace '^v(\d+).*', '$1')
if ($m -ge 23) {
  Write-Host ""
  Write-Host -ForegroundColor Yellow ('[!] Default node is ' + $v + ' - Expo on Windows needs Node 20.')
  Write-Host '    Run: npm run run:android (uses portable Node 20 under LocalAppData\node-v20)'
  Write-Host '    Or install Node 20 LTS from https://nodejs.org'
  exit 1
}
Write-Host ('Node ' + $v + ' OK')
exit 0
