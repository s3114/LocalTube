@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d %~dp0
set "SAVE_DIR=%~dp0"
set "SERVER_PORT=%PORT%"
if "%SERVER_PORT%"=="" set "SERVER_PORT=3000"

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

echo [0/7] Checking version information...

powershell -NoProfile -Command "$path = '%TEMP_REMOTE_VERSION%'; $dir = Split-Path -Path $path -Parent; if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory | Out-Null }; $r = Invoke-WebRequest -Uri '%REMOTE_VERSION_URL%' -UseBasicParsing; $r.Content.Trim() | Out-File -Encoding utf8 $path"

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
  echo [1/7] Checking for LocalTube updates...
  
  echo ===== LocalTube Auto Update =====
  
  set "ZIP_URL=https://github.com/s3114/LocalTube/archive/refs/heads/main.zip"
  set "TEMP_DIR=%~dp0temp_update"
  set "ZIP_FILE=%~dp0update.zip"
  
  echo [1/4 /7] Downloading the latest version...
  
  powershell -Command "$path = '!ZIP_FILE!'; $dir = Split-Path -Path $path -Parent; if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory | Out-Null }; Invoke-WebRequest -Uri '!ZIP_URL!' -OutFile $path"
  if errorlevel 1 (
    echo ERROR: Failed to download update package.
    pause
    exit /b 1
  )
  
  if not exist "!TEMP_DIR!" mkdir "!TEMP_DIR!"
  echo [2/4 /7] Extracting files...
  powershell -Command "Expand-Archive -Force '!ZIP_FILE!' '!TEMP_DIR!'"
  if errorlevel 1 (
    echo ERROR: Failed to extract update package.
    pause
    exit /b 1
  )
  
  echo [3/4 /7] Updating files...
  xcopy /E /Y "!TEMP_DIR!\LocalTube-main\*" "%~dp0"
  if errorlevel 1 (
    echo ERROR: Failed to copy updated files.
    pause
    exit /b 1
  )
  
  echo [4/4 /7] Cleaning up temporary files...
  rd /s /q "!TEMP_DIR!"
  del "!ZIP_FILE!"
  
  copy /y "%~dp0version.txt" "%LOCAL_VERSION_FILE%"
)

echo.
echo ===== Update Complete =====

echo.
echo [2/7] Checking Node.js and server modules...
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
echo [3/7] Checking and setting up ffmpeg...
ffmpeg -version >nul 2>&1
if errorlevel 1 (
  set "FFMPEG_URL=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
  set "FFMPEG_ZIP=%SAVE_DIR%ffmpeg.zip"
  set "FFMPEG_TEMP_DIR=%SAVE_DIR%ffmpeg_temp"
  set "FFMPEG_EXE=%SAVE_DIR%ffmpeg.exe"

  if exist "!FFMPEG_ZIP!" del "!FFMPEG_ZIP!" >nul 2>&1
  if exist "!FFMPEG_TEMP_DIR!" rd /s /q "!FFMPEG_TEMP_DIR!"

  echo ffmpeg command not found. Downloading package...
  curl -L -o "!FFMPEG_ZIP!" "!FFMPEG_URL!"
  if errorlevel 1 (
    echo ERROR: Failed to download ffmpeg package.
    if exist "!FFMPEG_ZIP!" del "!FFMPEG_ZIP!" >nul 2>&1
    pause
    exit /b 1
  )

  echo Extracting ffmpeg package...
  powershell -NoProfile -Command "Expand-Archive -Path '!FFMPEG_ZIP!' -DestinationPath '!FFMPEG_TEMP_DIR!' -Force"
  if errorlevel 1 (
    echo ERROR: Failed to extract ffmpeg package.
    if exist "!FFMPEG_ZIP!" del "!FFMPEG_ZIP!" >nul 2>&1
    if exist "!FFMPEG_TEMP_DIR!" rd /s /q "!FFMPEG_TEMP_DIR!"
    pause
    exit /b 1
  )

  echo Deploying ffmpeg.exe...
  powershell -NoProfile -Command "$exe = Get-ChildItem -Path '!FFMPEG_TEMP_DIR!' -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1 -ExpandProperty FullName; if (-not $exe) { exit 1 }; Copy-Item -LiteralPath $exe -Destination '!FFMPEG_EXE!' -Force"
  if errorlevel 1 (
    echo ERROR: ffmpeg.exe was not found in the downloaded package.
    if exist "!FFMPEG_ZIP!" del "!FFMPEG_ZIP!" >nul 2>&1
    if exist "!FFMPEG_TEMP_DIR!" rd /s /q "!FFMPEG_TEMP_DIR!"
    pause
    exit /b 1
  )

  if exist "!FFMPEG_TEMP_DIR!" rd /s /q "!FFMPEG_TEMP_DIR!"
  if exist "!FFMPEG_ZIP!" del "!FFMPEG_ZIP!" >nul 2>&1

  if not exist "!FFMPEG_EXE!" (
    echo ERROR: ffmpeg.exe could not be placed in the application folder.
    pause
    exit /b 1
  )
) else (
  echo ffmpeg command is already available.
)
echo ffmpeg setup completed.

echo.
echo [4/7] Checking and setting up OpenH264...
set "OPENH264_URL=http://ciscobinary.openh264.org/openh264-2.5.1-win64.dll.bz2"
set "OPENH264_BZ2=%SAVE_DIR%openh264-2.5.1-win64.dll.bz2"
set "OPENH264_DLL=%SAVE_DIR%openh264-2.5.1-win64.dll"
set "OPENH264_TARGET=%SAVE_DIR%libopenh264.dll"

if exist "!OPENH264_BZ2!" del "!OPENH264_BZ2!" >nul 2>&1
if exist "!OPENH264_DLL!" del "!OPENH264_DLL!" >nul 2>&1

echo Downloading OpenH264 package...
curl -L -o "!OPENH264_BZ2!" "!OPENH264_URL!"
if errorlevel 1 (
  echo ERROR: Failed to download OpenH264 package.
  if exist "!OPENH264_BZ2!" del "!OPENH264_BZ2!" >nul 2>&1
  pause
  exit /b 1
)

echo Extracting OpenH264 package...
set "OPENH264_EXTRACTED=0"
where bunzip2 >nul 2>&1
if not errorlevel 1 (
  bunzip2 -f -k "!OPENH264_BZ2!" >nul 2>&1
  if not errorlevel 1 set "OPENH264_EXTRACTED=1"
)
if "%OPENH264_EXTRACTED%"=="0" (
  where bzip2 >nul 2>&1
  if not errorlevel 1 (
    bzip2 -d -f -k "!OPENH264_BZ2!" >nul 2>&1
    if not errorlevel 1 set "OPENH264_EXTRACTED=1"
  )
)
if "%OPENH264_EXTRACTED%"=="0" (
  where py >nul 2>&1
  if not errorlevel 1 (
    py -3 -c "import bz2, pathlib; src = pathlib.Path(r'!OPENH264_BZ2!'); dst = pathlib.Path(r'!OPENH264_DLL!'); dst.write_bytes(bz2.decompress(src.read_bytes()))" >nul 2>&1
    if not errorlevel 1 set "OPENH264_EXTRACTED=1"
  )
)
if "%OPENH264_EXTRACTED%"=="0" (
  where python >nul 2>&1
  if not errorlevel 1 (
    python -c "import bz2, pathlib; src = pathlib.Path(r'!OPENH264_BZ2!'); dst = pathlib.Path(r'!OPENH264_DLL!'); dst.write_bytes(bz2.decompress(src.read_bytes()))" >nul 2>&1
    if not errorlevel 1 set "OPENH264_EXTRACTED=1"
  )
)
if "%OPENH264_EXTRACTED%"=="0" (
  echo ERROR: Failed to extract OpenH264 package. No usable BZip2 extractor was found.
  if exist "!OPENH264_BZ2!" del "!OPENH264_BZ2!" >nul 2>&1
  if exist "!OPENH264_DLL!" del "!OPENH264_DLL!" >nul 2>&1
  pause
  exit /b 1
)

if not exist "!OPENH264_DLL!" (
  echo ERROR: OpenH264 DLL was not found after extraction.
  if exist "!OPENH264_BZ2!" del "!OPENH264_BZ2!" >nul 2>&1
  pause
  exit /b 1
)

if exist "!OPENH264_TARGET!" del "!OPENH264_TARGET!" >nul 2>&1
move /Y "!OPENH264_DLL!" "!OPENH264_TARGET!" >nul
if errorlevel 1 (
  echo ERROR: Failed to place libopenh264.dll in the application folder.
  if exist "!OPENH264_BZ2!" del "!OPENH264_BZ2!" >nul 2>&1
  if exist "!OPENH264_DLL!" del "!OPENH264_DLL!" >nul 2>&1
  pause
  exit /b 1
)

if exist "!OPENH264_BZ2!" del "!OPENH264_BZ2!" >nul 2>&1

if not exist "!OPENH264_TARGET!" (
  echo ERROR: libopenh264.dll could not be created.
  pause
  exit /b 1
)
echo OpenH264 setup completed.

echo.
echo [5/7] Checking and setting up yt-dlp...
if exist "%SAVE_DIR%yt-dlp.exe" (
  echo Updating yt-dlp.exe...
  ) else (
  echo Downloading yt-dlp.exe...
  curl -L -o "%SAVE_DIR%yt-dlp.exe" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" || (echo ERROR: Failed to download yt-dlp. & pause & exit /b)
)
"%SAVE_DIR%yt-dlp.exe" -U
echo yt-dlp setup completed.

echo.
echo [6/7] Checking and setting up AtomicParsley...
if exist "%SAVE_DIR%AtomicParsley.exe" (
  echo AtomicParsley.exe already exists.
  ) else (
  echo Downloading AtomicParsley...
  curl -L -o "%SAVE_DIR%AtomicParsley.zip" "https://github.com/wez/atomicparsley/releases/download/20240608.083822.1ed9031/AtomicParsleyWindows.zip" || (echo ERROR: Failed to download AtomicParsley. & pause & exit /b)
  if exist "%SAVE_DIR%AtomicParsley.zip" (
    echo Extracting AtomicParsley.zip...
    powershell -Command "$destPath = '%SAVE_DIR%'; Expand-Archive -Path '%SAVE_DIR%AtomicParsley.zip' -DestinationPath $destPath -Force"
    del "%SAVE_DIR%AtomicParsley.zip"
  )
)
echo AtomicParsley setup completed.

echo.
echo [7/7] Checking and setting up Deno...
if exist "%SAVE_DIR%deno.exe" (
  echo Upgrading Deno...
  "%SAVE_DIR%deno.exe" upgrade
  if exist "%SAVE_DIR%deno.old.exe" del "%SAVE_DIR%deno.old.exe"
  ) else (
  echo Downloading Deno...
  curl -L -o "%SAVE_DIR%deno.zip" "https://github.com/denoland/deno/releases/download/v1.44.4/deno-x86_64-pc-windows-msvc.zip" || (echo ERROR: Failed to download Deno. & pause & exit /b)
  if exist "%SAVE_DIR%deno.zip" (
    echo Extracting deno.zip...
    powershell -Command "$destPath = '%SAVE_DIR%'; Expand-Archive -Path '%SAVE_DIR%deno.zip' -DestinationPath $destPath -Force"
    del "%SAVE_DIR%deno.zip"
  )
)
echo Deno setup completed.

echo.
echo ==================================================
echo  Setup complete. Starting server...
echo ==================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Filter '*.bat' | ForEach-Object { $f = $_.FullName; $raw = Get-Content -LiteralPath $f -Raw; $normalized = $raw -replace \"`r?`n\", \"`r`n\"; [System.IO.File]::WriteAllText($f, $normalized, [System.Text.Encoding]::GetEncoding(932)); }"

:START_SERVER
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList '\"%~dp0server.js\"' -WorkingDirectory '%~dp0'"
echo Server started at http://localhost:%SERVER_PORT%
echo Window will close after 15 seconds...
timeout /t 15 /nobreak >nul
exit /b
