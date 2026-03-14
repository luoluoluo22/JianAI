$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$playwrightRoot = Join-Path $env:LOCALAPPDATA 'ms-playwright'
$bundleRoot = Join-Path $repoRoot 'resources\chromium'

if (-not (Test-Path $playwrightRoot)) {
  Write-Host 'Playwright Chromium not found locally. Installing...'
  Push-Location $repoRoot
  try {
    pnpm exec playwright install chromium
  } finally {
    Pop-Location
  }
}

$chromiumDir = Get-ChildItem $playwrightRoot -Directory |
  Where-Object { $_.Name -like 'chromium-*' -and $_.Name -notlike 'chromium_headless_shell-*' } |
  Sort-Object Name -Descending |
  Select-Object -First 1

if (-not $chromiumDir) {
  throw 'No Playwright Chromium directory found after install.'
}

$sourceChromeWin = Join-Path $chromiumDir.FullName 'chrome-win'
$sourceExe = Join-Path $sourceChromeWin 'chrome.exe'
if (-not (Test-Path $sourceExe)) {
  throw "Bundled Chromium executable not found: $sourceExe"
}

if (Test-Path $bundleRoot) {
  Remove-Item $bundleRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $bundleRoot | Out-Null
Copy-Item $sourceChromeWin -Destination (Join-Path $bundleRoot 'chrome-win') -Recurse

Write-Host "Bundled Chromium synced from: $sourceChromeWin"
Write-Host "Bundled Chromium output: $bundleRoot"
