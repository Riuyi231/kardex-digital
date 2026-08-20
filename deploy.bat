@echo off
echo ============================================
echo   NexAlert Deploy
echo ============================================
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
if %errorlevel% neq 0 (
    echo ERROR: Deploy fallo
)
pause
