@echo off
chcp 65001 >nul
cd /d %~dp0
set "SAVE_DIR=%~dp0"

echo ==================================================
echo      Starting development environment setup...
echo ==================================================

echo.
echo [1/5] Checking and setting up ffmpeg...
winget install ffmpeg --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo ERROR: Failed to install ffmpeg. Please try installing it manually.
  pause
  exit /b
)
echo ffmpeg setup complete.

echo.
echo [2/5] Checking and setting up yt-dlp...
if exist "%SAVE_DIR%yt-dlp.exe" (
  echo Updating yt-dlp.exe...
) else (
  echo Downloading yt-dlp.exe...
  curl -L -o "%SAVE_DIR%yt-dlp.exe" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" || (echo ERROR: Failed to download yt-dlp. & pause & exit /b)
)
yt-dlp.exe -U
echo yt-dlp setup complete.

echo.
echo [3/5] Checking and setting up AtomicParsley...
if exist "%SAVE_DIR%AtomicParsley.exe" (
  echo AtomicParsley.exe already exists.
) else (
  echo Downloading AtomicParsley...
  curl -L -o "%SAVE_DIR%AtomicParsley.zip" "https://github.com/wez/atomicparsley/releases/download/20240608.083822.1ed9031/AtomicParsleyWindows.zip" || (echo ERROR: Failed to download AtomicParsley. & pause & exit /b)
  if exist "%SAVE_DIR%AtomicParsley.zip" (
    echo Extracting AtomicParsley.zip...
    powershell -Command "Expand-Archive -Path '%SAVE_DIR%AtomicParsley.zip' -DestinationPath '%SAVE_DIR%' -Force"
    del "%SAVE_DIR%AtomicParsley.zip"
  )
)
echo AtomicParsley setup complete.

echo.
echo [4/5] Checking and setting up Deno...
if exist "%SAVE_DIR%deno.exe" (
  echo Upgrading Deno...
  "%SAVE_DIR%deno.exe" upgrade
  if exist "%SAVE_DIR%deno.old.exe" (
    del "%SAVE_DIR%deno.old.exe"
  )
) else (
  echo Downloading Deno...
  curl -L -o "%SAVE_DIR%deno.zip" "https://github.com/denoland/deno/releases/download/v1.44.4/deno-x86_64-pc-windows-msvc.zip" || (echo ERROR: Failed to download Deno. & pause & exit /b)
  if exist "%SAVE_DIR%deno.zip" (
    echo Extracting deno.zip...
    powershell -Command "Expand-Archive -Path '%SAVE_DIR%deno.zip' -DestinationPath '%SAVE_DIR%' -Force"
    del "%SAVE_DIR%deno.zip"
  )
)
echo Deno setup complete.

echo.
echo [5/5] Checking Node.js and server modules...
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Attempting to install automatically...
  net session >nul 2>&1
  if errorlevel 1 (
    echo Administrator privileges are required. Please allow the UAC prompt...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
  )
  winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js installation complete.
  echo Please run this file again.
  pause
  exit /b
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm not found. There might be an issue with your Node.js installation.
  pause
  exit /b 1
)

echo Installing/verifying Node.js modules...
call npm install --silent
if errorlevel 1 (
  echo ERROR: npm install failed.
  pause
  exit /b
)
echo Node.js setup complete.
echo.
echo ==================================================
echo      Setup complete. Starting server...
echo ==================================================
echo.

node server.js
pause