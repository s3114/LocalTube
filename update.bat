@echo off
chcp 65001 >nul
setlocal

echo ===== LocalTube Auto Update =====

set ZIP_URL=https://github.com/s3114/LocalTube/archive/refs/heads/main.zip
set TEMP_DIR=%~dp0temp_update
set ZIP_FILE=%~dp0update.zip

echo [1/4] Downloading the latest version...
powershell -Command "Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%ZIP_FILE%'"

echo [2/4] Extracting files...
powershell -Command "Expand-Archive -Force '%ZIP_FILE%' '%TEMP_DIR%'"

echo [3/4] Updating files...
xcopy /E /Y "%TEMP_DIR%\LocalTube-main\*" "%~dp0"

echo [4/4] Cleaning up temporary files...
rd /s /q "%TEMP_DIR%"
del "%ZIP_FILE%"

echo Checking dependencies...
call npm install

echo.
echo ===== Update Complete =====
pause
endlocal
