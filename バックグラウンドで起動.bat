@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/k call \"%~dp0起動.bat\"' -WindowStyle Hidden"
exit