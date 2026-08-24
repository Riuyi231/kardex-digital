param([string]$Version)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = Join-Path $root "reportes-equipos"
$mobile = Join-Path $root "nexalert-app"
$server = Join-Path $root "nexalert-server\src\index.js"
$gradle = Join-Path $mobile "android\app\build.gradle"

if (-not $Version) {
    $pkg = Get-Content (Join-Path $desktop "package.json") -Raw | ConvertFrom-Json
    $parts = $pkg.version.Split('.')
    $parts[2] = [int]$parts[2] + 1
    $Version = $parts -join '.'
}

Write-Host "Version: $Version" -ForegroundColor Green

Write-Host "[1/5] package.json..."
$p = Get-Content (Join-Path $desktop "package.json") -Raw | ConvertFrom-Json
$p.version = $Version
$p | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $desktop "package.json")

Write-Host "[2/5] app.js..."
$c = Get-Content (Join-Path $mobile "www\app.js") -Raw
$c = $c -replace "const CURRENT_APP_VERSION = '[^']+'", "const CURRENT_APP_VERSION = '$Version'"
Set-Content (Join-Path $mobile "www\app.js") $c

Write-Host "[3/5] index.js..."
$s = Get-Content $server -Raw
$s = $s -replace "const APP_VERSION = '[^']+'", "const APP_VERSION = '$Version'"
Set-Content $server $s

Write-Host "[4/5] index.html..."
$h = Get-Content (Join-Path $mobile "www\index.html") -Raw
$h = $h -replace "app\.js\?v=[^`"]+", "app.js?v=$Version"
Set-Content (Join-Path $mobile "www\index.html") $h

Write-Host "[5/5] build.gradle (versionCode + versionName)..."
$parts = $Version.Split('.')
$versionCode = [int]$parts[0] * 10000 + [int]$parts[1] * 100 + [int]$parts[2]
$g = Get-Content $gradle -Raw
$g = $g -replace 'versionCode \d+', "versionCode $versionCode"
$g = $g -replace 'versionName "[^"]+"', "versionName `"$Version`""
Set-Content $gradle $g

Write-Host "Version actualizada: $Version (versionCode: $versionCode)" -ForegroundColor Green
