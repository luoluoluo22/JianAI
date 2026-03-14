$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$playwrightRoot = Join-Path $env:LOCALAPPDATA 'ms-playwright'
$bundleRoot = Join-Path $repoRoot 'resources\ms-playwright'

if (-not (Test-Path $playwrightRoot)) {
  Push-Location $repoRoot
  try {
    pnpm exec playwright install chromium ffmpeg
  } finally {
    Pop-Location
  }
}

$requiredPatterns = @(
  'chromium-*',
  'ffmpeg-*',
  'winldd-*'
)

$entriesToCopy = @()
foreach ($pattern in $requiredPatterns) {
  $entry = Get-ChildItem $playwrightRoot -Directory |
    Where-Object { $_.Name -like $pattern -and $_.Name -notlike 'chromium_headless_shell-*' } |
    Sort-Object Name -Descending |
    Select-Object -First 1
  if (-not $entry) {
    throw "Required Playwright runtime entry not found for pattern: $pattern"
  }
  $entriesToCopy += $entry
}

$linksDir = Join-Path $playwrightRoot '.links'
if (Test-Path $linksDir) {
  $entriesToCopy += Get-Item $linksDir
}

if (Test-Path $bundleRoot) {
  Remove-Item $bundleRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $bundleRoot | Out-Null

foreach ($entry in $entriesToCopy) {
  Copy-Item $entry.FullName -Destination (Join-Path $bundleRoot $entry.Name) -Recurse -Force
}

Write-Host 'Bundled Playwright runtime synced:'
$entriesToCopy | ForEach-Object { Write-Host " - $($_.Name)" }
Write-Host "Output: $bundleRoot"
