# Build qlix wheel + copy into backend assets for hybrid starter packs.
$ErrorActionPreference = "Stop"

# scripts -> python -> sdk -> repo root (qlix)
$SdkPython = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Root = (Resolve-Path (Join-Path $SdkPython "..\..")).Path
$Assets = Join-Path $Root "backend\assets\hybrid-starter"

New-Item -ItemType Directory -Force -Path $Assets | Out-Null

Push-Location $SdkPython
try {
  python -m pip install build hatchling -q
  if (-not (Test-Path dist)) { New-Item -ItemType Directory -Path dist | Out-Null }
  python -m pip wheel . -w dist --no-deps
  $wheel = Get-ChildItem dist\qlix-*.whl | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $wheel) { throw "No qlix-*.whl produced in $SdkPython\dist" }
  # hybridStarterPack.ts + Start Qlix Agent.bat expect this exact filename.
  Copy-Item $wheel.FullName (Join-Path $Assets "qlix-0.1.0-py3-none-any.whl") -Force
  Copy-Item $wheel.FullName (Join-Path $Assets "qlix-agent.whl") -Force
  Write-Host "Built $(Join-Path $Assets 'qlix-0.1.0-py3-none-any.whl')"
} finally {
  Pop-Location
}
