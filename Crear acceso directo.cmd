@echo off
rem Crea en el escritorio un acceso directo que abre Calderilla sin la ventana negra.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Calderilla.lnk');" ^
  "$s.TargetPath = 'wscript.exe';" ^
  "$s.Arguments = '\"%~dp0Calderilla.vbs\"';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.IconLocation = '%~dp0src\estatico\calderilla.ico';" ^
  "$s.Description = 'Calderilla: tus ingresos, gastos, ocio e inversiones';" ^
  "$s.Save()"
if errorlevel 1 (
  echo No se pudo crear el acceso directo.
) else (
  echo Listo: tienes Calderilla en el escritorio. Para cerrarla: Ajustes - Cerrar Calderilla.
)
pause
