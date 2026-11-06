@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Exhibit PC needs Node.js + npm on PATH. Run npm install once in this folder.
set "PORT=8899"
set "URL=http://127.0.0.1:%PORT%/index.html"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install Node.js LTS from https://nodejs.org/ then run npm install in this folder.
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm not found. Reinstall Node.js so npm is on PATH.
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if not defined CHROME (
  echo Google Chrome not found under Program Files. Install Chrome or edit this script to set CHROME to chrome.exe.
  exit /b 1
)

start "invisible-violence server" /MIN cmd /c "cd /d ""%~dp0"" && set PORT=%PORT% && npm start"

timeout /t 2 /nobreak >nul
start "" "%CHROME%" --kiosk --start-fullscreen "%URL%"

endlocal
exit /b 0
