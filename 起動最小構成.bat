@echo off
cd /d %~dp0
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList '\"%~dp0start-localtube.js\"' -WorkingDirectory '%~dp0'"
exit /b