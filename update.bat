@echo off
chcp 65001 >nul
setlocal

echo ===== LocalTube 自動アップデート =====

set ZIP_URL=https://github.com/s3114/LocalTube/archive/refs/heads/main.zip
set TEMP_DIR=%~dp0temp_update
set ZIP_FILE=%~dp0update.zip

echo [1/4] 最新版をダウンロード中...
powershell -Command "Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%ZIP_FILE%'"

echo [2/4] 展開中...
powershell -Command "Expand-Archive -Force '%ZIP_FILE%' '%TEMP_DIR%'"

echo [3/4] ファイルを更新中...
xcopy /E /Y "%TEMP_DIR%\LocalTube-main\*" "%~dp0"

echo [4/4] 不要ファイルを削除中...
rd /s /q "%TEMP_DIR%"
del "%ZIP_FILE%"

echo 依存関係を確認中...
call npm install

echo.
echo ===== 更新完了 =====
pause
endlocal
