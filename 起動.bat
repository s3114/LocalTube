@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d %~dp0
set "SAVE_DIR=%~dp0"

echo ==================================================
echo  Starting development environment setup...
echo ==================================================

ping -n 1 8.8.8.8 >nul 2>&1
if errorlevel 1 (
  echo [WARN] Network unavailable. Skipping to server start.
  goto START_SERVER
)

set "REMOTE_VERSION_URL=https://raw.githubusercontent.com/s3114/LocalTube/main/version.txt"
set "LOCAL_VERSION_FILE=%~dp0version.txt"
set "TEMP_REMOTE_VERSION=%~dp0remote_version.txt"

echo [0/6] Checking version information...

powershell -NoProfile -Command "$r = Invoke-WebRequest -Uri '%REMOTE_VERSION_URL%' -UseBasicParsing; $r.Content.Trim() | Out-File -Encoding utf8 '%TEMP_REMOTE_VERSION%'"

if not exist "%LOCAL_VERSION_FILE%" (
  echo Local version.txt not found. Update required.
  set NEED_UPDATE=1
) else (
  for /f "usebackq tokens=* delims=" %%R in ("%TEMP_REMOTE_VERSION%") do set REMOTE_VER=%%R
  for /f "usebackq tokens=* delims=" %%L in ("%LOCAL_VERSION_FILE%") do set LOCAL_VER=%%L

  echo Local version : [!LOCAL_VER!]
  echo Remote version: [!REMOTE_VER!]

  if "!LOCAL_VER!"=="!REMOTE_VER!" (
    echo Version is up to date.
    set NEED_UPDATE=0
  ) else (
    echo Newer version found. Update required.
    set NEED_UPDATE=1
  )
)

del "%TEMP_REMOTE_VERSION%" >nul 2>&1


if "%NEED_UPDATE%"=="1" (
  echo.
  echo [1/6] Checking for LocalTube updates...
  
  echo ===== LocalTube Auto Update =====
  
  set "ZIP_URL=https://github.com/s3114/LocalTube/archive/refs/heads/main.zip"
  set "TEMP_DIR=%~dp0temp_update"
  set "ZIP_FILE=%~dp0update.zip"
  
  echo [1/4 /6] Downloading the latest version...
  powershell -Command "Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%ZIP_FILE%'"
  if errorlevel 1 (
    echo ERROR: Failed to download update package.
    pause
    exit /b 1
  )
  
  echo [2/4 /6] Extracting files...
  powershell -Command "Expand-Archive -Force '%ZIP_FILE%' '%TEMP_DIR%'"
  if errorlevel 1 (
    echo ERROR: Failed to extract update package.
    pause
    exit /b 1
  )
  
  echo [3/4 /6] Updating files...
  xcopy /E /Y "%TEMP_DIR%\LocalTube-main\*" "%~dp0"
  if errorlevel 1 (
    echo ERROR: Failed to copy updated files.
    pause
    exit /b 1
  )
  
  echo [4/4 /6] Cleaning up temporary files...
  rd /s /q "%TEMP_DIR%"
  del "%ZIP_FILE%"
  
  echo Checking dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed during update.
    pause
    exit /b 1
  )
  copy /y "%~dp0version.txt" "%LOCAL_VERSION_FILE%"
)

echo.
echo ===== Update Complete =====

echo.
echo [2/6] Checking Node.js and server modules...
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Attempting automatic installation...
  net session >nul 2>&1
  if errorlevel 1 (
    echo Administrator privileges are required. Restarting as administrator...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
  )
  winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js installation completed.
  echo Please run this file again.
  pause
  exit /b
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm was not found. There may be a problem with your Node.js installation.
  pause
  exit /b 1
)

echo Installing/checking Node.js modules...
call npm install --silent
if errorlevel 1 (
  echo ERROR: npm install failed.
  pause
  exit /b
)
echo Node.js setup completed.

echo.
echo [3/6] Checking and setting up ffmpeg...
winget install ffmpeg --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo ERROR: Failed to install ffmpeg. Please install it manually.
  pause
  exit /b
)
echo ffmpeg setup completed.

echo.
echo [4/6] Checking and setting up yt-dlp...
if exist "%SAVE_DIR%yt-dlp.exe" (
  echo Updating yt-dlp.exe...
  ) else (
  echo Downloading yt-dlp.exe...
  curl -L -o "%SAVE_DIR%yt-dlp.exe" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" || (echo ERROR: Failed to download yt-dlp. & pause & exit /b)
)
"%SAVE_DIR%yt-dlp.exe" -U
echo yt-dlp setup completed.

echo.
echo [5/6] Checking and setting up AtomicParsley...
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
echo AtomicParsley setup completed.

echo.
echo [6/6] Checking and setting up Deno...
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
echo Deno setup completed.

echo.
echo ==================================================
echo  Setup complete. Starting server...
echo ==================================================
echo.

:START_SERVER
node "%~dp0server.js"
pause
