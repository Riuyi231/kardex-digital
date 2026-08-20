param(
  [string]$ApiBase = "https://nexalert.duckdns.org",
  [string]$Src = "C:\Users\STIVEN\Documents\Default Project\nexalert-server\app"
)
$ErrorActionPreference = "Stop"
$www = Join-Path $PSScriptRoot "www"
if (Test-Path $www) { Remove-Item -Recurse -Force $www }
New-Item -ItemType Directory -Force -Path $www | Out-Null
Copy-Item "$Src\index.html" $www
Copy-Item "$Src\styles.css" $www
if (Test-Path "$Src\logo.png") { Copy-Item "$Src\logo.png" $www }

$js = [System.IO.File]::ReadAllText((Resolve-Path "$Src\app.js").Path)
if ($js -notmatch "const API_BASE") {
  $js = $js -replace "const TOKEN_KEY = 'nexalert_token';", "const API_BASE = '$ApiBase';`r`n  const TOKEN_KEY = 'nexalert_token';"
  $js = $js -replace "fetch\(path,", "fetch(API_BASE + path,"
}
[System.IO.File]::WriteAllText((Join-Path $www "app.js"), $js, (New-Object System.Text.UTF8Encoding($false)))

if ($js -notmatch "const API_BASE") { throw "No se pudo inyectar API_BASE" }
Write-Host "www actualizado (API: $ApiBase)"
Get-ChildItem $www | Select-Object -ExpandProperty Name
