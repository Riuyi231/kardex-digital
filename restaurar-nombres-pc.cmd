@echo off
title NexAlert - Restaurar nombres de clientes
echo.
echo Abriendo NexAlert para restaurar los nombres de clientes en el servidor...
echo La app se actualiza sola a 1.5.16 (si pide permiso, acepta) y al sincronizar
echo manda los nombres reales al servidor. Los telefonos volveran a mostrar
echo el nombre correcto en unos segundos.
echo.

set "EXE=%LOCALAPPDATA%\Programs\NexAlert\NexAlert.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles%\NexAlert\NexAlert.exe"
if not exist "%EXE%" set "EXE=%ProgramFiles(x86)%\NexAlert\NexAlert.exe"

if exist "%EXE%" (
  start "" "%EXE%"
  echo NexAlert abierto. Mantenla abierta unos segundos y listo.
) else (
  echo No encontre NexAlert instalado en la PC.
  echo Abrelo manualmente y toca "Sincronizar ahora" en Configuracion.
)
echo.
pause