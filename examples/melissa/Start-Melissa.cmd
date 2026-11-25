@echo off
cd /d "%~dp0"
if not exist node.exe goto failed
node.exe server\tools\melissa\prepare.js
if errorlevel 1 goto failed
echo Open http://127.0.0.1:1881 in the browser on this computer.
node.exe server\main.js --userDir "%~dp0data" --port 1881
if errorlevel 1 goto failed
exit /b 0
:failed
echo Melissa could not start. Keep this window open and copy the error above.
pause
exit /b 1
