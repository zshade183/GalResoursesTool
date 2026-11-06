@echo off
setlocal
cd /d "%~dp0"
set "API_HOST=127.0.0.1"
set "API_PORT=3001"
set "DATABASE_PATH=%~dp0data\studio.sqlite"
set "NODE_ENV=production"
echo Open http://127.0.0.1:3001 after the server starts.
echo Press Ctrl+C to stop. Keep this window open while using the app.
if exist "%~dp0.env" (
  "%~dp0runtime\node.exe" --env-file="%~dp0.env" "%~dp0app\apps\api\dist\server.js"
) else (
  "%~dp0runtime\node.exe" "%~dp0app\apps\api\dist\server.js"
)
if errorlevel 1 pause
endlocal
