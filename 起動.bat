@echo off
chcp 65001 >nul
cd /d %~dp0

where node >nul 2>&1
if errorlevel 1 (
    echo [INFO] Node.js が見つかりません。自動インストールします。 

    net session >nul 2>&1
    if errorlevel 1 (
        echo [ERR] 管理者権限が必要です。 
            powershell -Command ^
      "Start-Process '%~f0' -Verb RunAs"
        exit /b
    )

    winget install OpenJS.NodeJS
    echo.
    echo [INFO] Node.js のインストールが完了しました。 
    echo [INFO] 手動で bat ファイルを実行しなおしてください。 
    pause
    exit /b
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm が見つかりません。 
  echo Node.js のインストールに問題がある可能性があります。 
  pause
  exit /b 1
)

if not exist package.json (
  start "" /wait /min cmd /c "npm init -y"
)

if not exist node_modules (
  start "" /wait /min cmd /c "npm install express"
)

node server.js

pause
