@echo off
setlocal

set "ROOT=%~dp0"
set "VERSION_FILE=%ROOT%reportes-equipos\package.json"

:: Read current version and auto-increment patch
for /f "tokens=2 delims=:, " %%a in ('findstr /C:"version" "%VERSION_FILE%"') do (
    set "RAW=%%~a"
    goto :parsed
)
:parsed
set "RAW=%RAW:"=%"
for /f "tokens=1-3 delims=." %%a in ("%RAW%") do (
    set /a "PATCH=%%c+1"
    set "NEW_VERSION=%%a.%%b.%PATCH%"
)

echo ============================================
echo   NexAlert Deploy - v%NEW_VERSION%
echo ============================================
echo.

:: Update versions
call powershell -ExecutionPolicy Bypass -File "%ROOT%update-version.ps1" -Version "%NEW_VERSION%"

:: Commit and push
git add -A
git commit -m "v%NEW_VERSION%"
git push

echo.
echo ============================================
echo   Deploy v%NEW_VERSION% enviado!
echo ============================================
echo   Ve el progreso: https://github.com/Riuyi231/nexalert/actions
echo.
pause
