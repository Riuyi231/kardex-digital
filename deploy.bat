@echo off
setlocal

echo ============================================
echo   NexAlert Deploy - Desktop + Movil + Server
echo ============================================
echo.

set "ROOT=%~dp0"
set "DESKTOP=%ROOT%reportes-equipos"
set "MOBILE=%ROOT%nexalert-app"
set "SERVER_JS=%ROOT%nexalert-server\src\index.js"
set "GCP_INSTANCE=nexalert"
set "GCP_ZONE=us-central1-a"
set "SERVER_UPDATES=/opt/nexalert-server/updates"
set "SERVER_APP=/opt/nexalert-server/app"
set "SERVER_SRC=/opt/nexalert-server/src"

if "%~1"=="" goto :no_version

echo Nueva version: %~1
echo.
call powershell -ExecutionPolicy Bypass -File "%ROOT%update-version.ps1" -Version "%~1"
if %errorlevel% neq 0 (echo ERROR al actualizar versiones & exit /b 1)
echo.

:no_version

set "VERSION="
for /f "usebackq tokens=2 delims=:," %%a in (`findstr /C:"version" "%DESKTOP%\package.json"`) do (
    if not defined VERSION (
        set "V=%%a"
        set "V=!V:"=!"
        set "V=!V: =!"
        if not "!V:~0,1!"=="!" set "VERSION=!V!"
    )
)
if not defined VERSION (
    echo No se pudo leer la version
    exit /b 1
)
echo Version actual: %VERSION%
echo.

echo ============================================
echo   Building Desktop...
echo ============================================
cd /d "%DESKTOP%"
call npm run dist
if %errorlevel% neq 0 (echo ERROR: Build desktop fallo & exit /b 1)
echo Desktop build OK
echo.

echo ============================================
echo   Building APK...
echo ============================================
cd /d "%MOBILE%"
call npx cap sync android
if %errorlevel% neq 0 (echo ERROR: Cap sync fallo & exit /b 1)
cd android
call gradlew.bat assembleDebug
if %errorlevel% neq 0 (echo ERROR: Gradle build fallo & exit /b 1)
echo APK build OK
echo.

echo ============================================
echo   Subiendo archivos al servidor...
echo ============================================
gcloud compute scp "%DESKTOP%\dist\latest.yml" %GCP_INSTANCE%:/home/STIVEN/latest.yml --zone=%GCP_ZONE%
gcloud compute scp "%DESKTOP%\dist\NexAlert Setup %VERSION%.exe" %GCP_INSTANCE%:/home/STIVEN/setup.exe --zone=%GCP_ZONE%
gcloud compute scp "%MOBILE%\android\app\build\outputs\apk\debug\app-debug.apk" %GCP_INSTANCE%:/home/STIVEN/app-latest.apk --zone=%GCP_ZONE%
gcloud compute scp "%SERVER_JS%" %GCP_INSTANCE%:/home/STIVEN/index.js --zone=%GCP_ZONE%
gcloud compute scp "%MOBILE%\www\app.js" %GCP_INSTANCE%:/home/STIVEN/app.js --zone=%GCP_ZONE%
gcloud compute scp "%MOBILE%\www\index.html" %GCP_INSTANCE%:/home/STIVEN/index.html --zone=%GCP_ZONE%
echo Upload OK
echo.

echo ============================================
echo   Copiando en servidor y reiniciando...
echo ============================================
gcloud compute ssh %GCP_INSTANCE% --zone=%GCP_ZONE% --command="sudo cp /home/STIVEN/latest.yml %SERVER_UPDATES%/ && sudo cp /home/STIVEN/setup.exe %SERVER_UPDATES%/'NexAlert Setup %VERSION%.exe' && sudo cp /home/STIVEN/app-latest.apk %SERVER_UPDATES%/ && sudo cp /home/STIVEN/index.js %SERVER_SRC%/ && sudo cp /home/STIVEN/app.js %SERVER_APP%/ && sudo cp /home/STIVEN/index.html %SERVER_APP%/ && sudo chmod -R 755 %SERVER_UPDATES%/ && sudo systemctl restart nexalert && echo Deploy OK"

echo.
echo ============================================
echo   Deploy %VERSION% completado!
echo ============================================
echo.
pause
