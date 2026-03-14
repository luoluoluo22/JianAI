$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$bundleRoot = Join-Path $repoRoot 'resources\ffmpeg'

$candidateExePaths = @(
  'C:\Program Files\ffmpeg\bin\ffmpeg.exe',
  'C:\ffmpeg\ffmpeg.exe'
)

$sourceExePath = $candidateExePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $sourceExePath) {
  $playwrightRoot = Join-Path $env:LOCALAPPDATA 'ms-playwright'
  if (-not (Test-Path $playwrightRoot)) {
    Write-Host 'Playwright FFmpeg not found locally. Installing...'
    Push-Location $repoRoot
    try {
      pnpm exec playwright install ffmpeg
    } finally {
      Pop-Location
    }
  }

  $ffmpegDir = Get-ChildItem $playwrightRoot -Directory |
    Where-Object { $_.Name -like 'ffmpeg-*' } |
    Sort-Object Name -Descending |
    Select-Object -First 1

  if (-not $ffmpegDir) {
    throw 'No FFmpeg source found locally.'
  }

  $sourceExe = Get-ChildItem $ffmpegDir.FullName -Filter 'ffmpeg*.exe' | Select-Object -First 1
  if (-not $sourceExe) {
    throw "Bundled FFmpeg executable not found in: $($ffmpegDir.FullName)"
  }
  $sourceExePath = $sourceExe.FullName
}

if (Test-Path $bundleRoot) {
  Remove-Item $bundleRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $bundleRoot | Out-Null
Copy-Item $sourceExePath -Destination (Join-Path $bundleRoot 'ffmpeg.exe')

Write-Host "Bundled FFmpeg synced from: $sourceExePath"
Write-Host "Bundled FFmpeg output: $bundleRoot"
