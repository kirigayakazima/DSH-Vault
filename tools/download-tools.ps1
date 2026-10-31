# Script to download official restic and rest-server binaries for DSH-Vault
$ErrorActionPreference = 'Stop'

$toolsDir = $PSScriptRoot
$resticDir = Join-Path $toolsDir "restic\bin"
$restServerDir = Join-Path $toolsDir "rest-server\bin\rest-server_0.14.0_windows_amd64"

New-Item -ItemType Directory -Force -Path $resticDir | Out-Null
New-Item -ItemType Directory -Force -Path $restServerDir | Out-Null

Write-Host "=== Downloading restic 0.19.1 (Windows amd64) ==="
$resticZip = Join-Path $toolsDir "restic.zip"
$resticUrl = "https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_windows_amd64.zip"
Invoke-WebRequest -Uri $resticUrl -OutFile $resticZip
Expand-Archive -Path $resticZip -DestinationPath $resticDir -Force
Remove-Item $resticZip -Force

Write-Host "=== Downloading rest-server 0.14.0 (Windows amd64) ==="
$restServerZip = Join-Path $toolsDir "rest-server.zip"
$restServerUrl = "https://github.com/restic/rest-server/releases/download/v0.14.0/rest-server_0.14.0_windows_amd64.zip"
Invoke-WebRequest -Uri $restServerUrl -OutFile $restServerZip
Expand-Archive -Path $restServerZip -DestinationPath (Join-Path $toolsDir "rest-server\bin") -Force
Remove-Item $restServerZip -Force

Write-Host "=== Downloading restic 0.19.1 (Linux arm64 for mobile agent) ==="
$resticArmUrl = "https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_linux_arm64.bz2"
$resticArmBz2 = Join-Path (Join-Path $toolsDir "restic") "restic-linux-arm64.bz2"
Invoke-WebRequest -Uri $resticArmUrl -OutFile $resticArmBz2

Write-Host "[SUCCESS] Tools downloaded and structured successfully."
