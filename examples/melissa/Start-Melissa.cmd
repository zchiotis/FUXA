@echo off
cd /d "%~dp0"
node.exe server\tools\melissa\prepare.js
if errorlevel 1 exit /b 1
echo Open http://127.0.0.1:1881 in the browser on this computer.
node.exe server\main.js --userDir "%~dp0data" --port 1881
