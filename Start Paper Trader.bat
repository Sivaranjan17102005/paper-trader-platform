@echo off
setlocal
cd /d "%~dp0"
start "Paper Trader server" cmd /k npm start
timeout /t 4 /nobreak >nul
start "" "http://localhost:3000"
endlocal

