@echo off
cd /d %~dp0
chcp 65001 >nul
node "%~dp0server.js"
pause