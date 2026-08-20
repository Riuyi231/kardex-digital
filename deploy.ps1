$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = Join-Path $root "reportes-equipos"

# Auto-increment version
$pkg = Get-Content (Join-Path $desktop "package.json") -Raw | ConvertFrom-Json
$parts = $pkg.version.Split('.')
$parts[2] = [int]$parts[2] + 1
$newVersion = $parts -join '.'

Write-Host "Deploy v$newVersion..." -ForegroundColor Cyan

# Update all version files
& "$root\update-version.ps1" -Version $newVersion

# Commit and push
Set-Location $root
git add -A
git commit -m "v$newVersion"
git push

Write-Host ""
Write-Host "Deploy v$newVersion enviado!" -ForegroundColor Green
Write-Host "Progreso: https://github.com/Riuyi231/nexalert/actions" -ForegroundColor Yellow
