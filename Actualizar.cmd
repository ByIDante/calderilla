@echo off
rem Baja la ultima version de Calderilla desde GitHub. Tus datos no se tocan: estan en tu carpeta de datos.
rem Necesita Git (https://git-scm.com/download/win). La primera vez te pedira entrar en GitHub.
setlocal
cd /d "%~dp0"
title Actualizar Calderilla
where git >nul 2>nul
if errorlevel 1 (
  echo Para actualizar con un clic necesitas Git: descargalo de https://git-scm.com/download/win,
  echo instalalo con las opciones por defecto y vuelve a abrir este archivo.
  pause
  exit /b 1
)
if not exist .git (
  echo Preparando esta carpeta para poder actualizarse ^(solo la primera vez^)...
  git init -q -b main
  git remote add origin https://github.com/ByIDante/calderilla.git
)
echo Buscando la ultima version...
git fetch -q origin main
if errorlevel 1 (
  echo No se pudo conectar con GitHub. Revisa la conexion o entra con tu cuenta cuando te lo pida.
  pause
  exit /b 1
)
rem El programa no se edita a mano: se deja exactamente como esta en GitHub
git reset -q --hard origin/main
for /f %%v in ('git log -1 --format^=%%cd --date^=format:%%d/%%m/%%Y') do set FECHA=%%v
echo.
echo Calderilla esta al dia (version del %FECHA%).
echo Si estaba abierta, cierrala (Ajustes - Cerrar Calderilla) y vuelve a abrirla.
pause
