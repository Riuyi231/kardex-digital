param(
  [Parameter(Mandatory=$true)][string]$VmName,
  [Parameter(Mandatory=$true)][string]$Domain,
  [Parameter(Mandatory=$true)][string]$DuckToken,
  [string]$Zone = "us-central1-a"
)

$src = "C:\Users\STIVEN\Documents\Default Project\nexalert-server"
$tmp = "$env:TEMP\nexalert-deploy"

$gcloudBin = "C:\Users\STIVEN\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin"
if (Test-Path "$gcloudBin\gcloud.cmd") { $env:Path = "$gcloudBin;$env:Path" }
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Host "No se encontro gcloud. Instalandolo..." -ForegroundColor Cyan
  winget install --id Google.CloudSDK -e --accept-source-agreements --accept-package-agreements
  if (Test-Path "$gcloudBin\gcloud.cmd") { $env:Path = "$gcloudBin;$env:Path" }
}

Write-Host "1) Comprobando autenticacion de Google..." -ForegroundColor Cyan
$cuenta = (gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>&1) | Select-Object -First 1
if (-not $cuenta) {
  Write-Host "   Abre el navegador y autoriza con tu cuenta de Google..." -ForegroundColor Yellow
  gcloud auth login
}

Write-Host "2) Preparando el paquete del codigo (sin datos locales)" -ForegroundColor Cyan
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force -Path "$tmp\deploy" | Out-Null
Copy-Item "$src\src" "$tmp\src" -Recurse
Copy-Item "$src\app" "$tmp\app" -Recurse
Copy-Item "$src\deploy\setup.sh" "$tmp\deploy\setup.sh"
Copy-Item "$src\package.json" "$tmp\package.json"
Copy-Item "$src\package-lock.json" "$tmp\package-lock.json"

Write-Host "3) Abriendo puertos 80 y 443 en el firewall de Google" -ForegroundColor Cyan
gcloud compute firewall-rules create allow-nexalert-http --allow tcp:80 --description "NexAlert HTTP" --quiet 2>&1 | Out-Null
gcloud compute firewall-rules create allow-nexalert-https --allow tcp:443 --description "NexAlert HTTPS" --quiet 2>&1 | Out-Null

Write-Host "4) Subiendo el codigo a la VM ($VmName)..." -ForegroundColor Cyan
$remoteHome = ((gcloud compute ssh --zone=$Zone $VmName --command="getent passwd `$USER | cut -d: -f6" --quiet 2>&1) | Select-Object -Last 1)
if (-not $remoteHome) { $remoteHome = "/home/$VmName" }
Write-Host "   Directorio remoto: $remoteHome" -ForegroundColor DarkGray
gcloud compute scp --recurse --zone=$Zone $tmp "${VmName}:$remoteHome/" --quiet

Write-Host "5) Instalando y configurando el servidor en la VM (varios minutos)..." -ForegroundColor Cyan
gcloud compute ssh --zone=$Zone $VmName --command "sudo bash $remoteHome/nexalert-deploy/deploy/setup.sh $Domain $DuckToken"

Write-Host "" -ForegroundColor Cyan
Write-Host "LISTO! URL para los tecnicos: https://$Domain" -ForegroundColor Green
Write-Host "En NexAlert (tu PC) cambia la URL de sincronizacion a esa direccion y toca 'Sincronizar ahora'." -ForegroundColor Green
