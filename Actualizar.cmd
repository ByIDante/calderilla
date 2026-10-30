@echo off
rem Baja la ultima version de Calderilla desde GitHub. Tus datos no se tocan: estan en tu carpeta de datos.
rem El acceso directo del escritorio ya lo hace solo cada vez que abres Calderilla.
setlocal
cd /d "%~dp0"
title Actualizar Calderilla
rem Paquete para Windows (lleva Node dentro y no usa Git). Va en un solo bloque porque este archivo tambien
rem puede cambiar al actualizar y Windows lee el bloque entero antes de ejecutarlo
if exist VERSION if not exist .git (
  set "PATH=%~dp0node;%PATH%"
  node scripts\actualizar.ts
  echo Si Calderilla estaba abierta, cierrala y vuelve a abrirla para usar la version nueva.
  pause
  exit /b 0
)
where git >nul 2>nul
if errorlevel 1 (
  echo Para actualizar necesitas Git: descargalo de https://git-scm.com/download/win,
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
  echo No se pudo conectar con GitHub. Revisa la conexion.
  pause
  exit /b 1
)
rem Este archivo tambien puede cambiar al actualizar: todo lo que queda va en un solo bloque, que Windows
rem lee entero antes de ejecutarlo
(
  git reset -q --hard origin/main
  echo.
  echo Calderilla esta al dia.
  echo Si estaba abierta, te avisara para reiniciarla con la version nueva.
  pause
  exit /b 0
)
