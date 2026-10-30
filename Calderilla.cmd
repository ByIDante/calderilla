@echo off
rem Abre Calderilla con doble clic. Para salir, cierra esta ventana.
setlocal
cd /d "%~dp0"
title Calderilla

where node >nul 2>nul
if errorlevel 1 (
  echo No encuentro Node.js. Instala la version LTS ^(24 o superior^) desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set MAYOR=%%v
if %MAYOR% LSS 24 (
  echo Calderilla necesita Node.js 24 o superior y tienes la version %MAYOR%. Actualizalo desde https://nodejs.org
  pause
  exit /b 1
)

node scripts\comprobar-dependencias.ts
if errorlevel 1 (
  echo Instalando lo necesario, solo tarda la primera vez...
  call npm ci --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo No se pudo instalar. Revisa tu conexion a internet.
    pause
    exit /b 1
  )
)

node src\main.ts
rem Sin ventana (Calderilla.vbs) no se puede pulsar ninguna tecla: no se espera
if errorlevel 1 if not defined CALDERILLA_OCULTO pause
