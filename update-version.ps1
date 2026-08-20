param([string]$Version)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = Join-Path $root "reportes-equipos"
$mobile = Join-Path $root "nexalert-app"
$server = Join-Path $root "nexalert-server\src\index.js"

Write-Host "[1/4] Actualizando package.json (desktop)..."
$pkg = Get-Content (Join-Path $desktop "package.json") -Raw | ConvertFrom-Json
$pkg.version = $Version
$pkg | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $desktop "package.json")

Write-Host "[2/4] Actualizando app.js (movil)..."
$appJs = Get-Content (Join-Path $mobile "www\app.js") -Raw
$appJs = $appJs -replace "const CURRENT_APP_VERSION = '[^']+'", "const CURRENT_APP_VERSION = '$Version'"
Set-Content (Join-Path $mobile "www\app.js") $appJs

Write-Host "[3/4] Actualizando index.js (server)..."
$serverJs = Get-Content $server -Raw
$serverJs = $serverJs -replace "const APP_VERSION = '[^']+'", "const APP_VERSION = '$Version'"
Set-Content $server $serverJs

Write-Host "[4/4] Actualizando cache buster en index.html..."
$html = Get-Content (Join-Path $mobile "www\index.html") -Raw
$html = $html -replace "app\.js\?v=[^`"]+", "app.js?v=$Version"
Set-Content (Join-Path $mobile "www\index.html") $html

Write-Host "Version actualizada a $Version"
