@echo off
setlocal
set "PRISM_APP=%~dp0dist\3d-viz-studio.html"

if not exist "%PRISM_APP%" (
  echo Prism could not find the application file:
  echo %PRISM_APP%
  echo.
  pause
  exit /b 1
)

start "" "%PRISM_APP%"
exit /b 0
