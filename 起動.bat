@echo off
chcp 65001 >nul
setlocal
cd /d %~dp0
set "SAVE_DIR=%~dp0"

echo ==================================================
echo      開発環境セットアップを開始します...
echo ==================================================

echo.
echo [1/6] LocalTube の更新を確認しています...

if exist "%~dp0update.bat" (
  call "%~dp0update.bat"
  if errorlevel 1 (
    echo.
    echo ERROR: 自動アップデートに失敗しました。
    echo 処理を中断します。
    pause
    exit /b 1
  )
) else (
  echo WARNING: update.bat が見つかりません。更新をスキップします。
)

echo.
echo [2/6] Node.js とサーバーモジュールを確認しています...
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js が見つかりません。自動インストールを試みます...
  net session >nul 2>&1
  if errorlevel 1 (
    echo 管理者権限が必要です。管理者として再起動します...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
  )
  winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js のインストールが完了しました。
  echo このファイルをもう一度実行してください。
  pause
  exit /b
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm が見つかりません。Node.js のインストールに問題がある可能性があります。
  pause
  exit /b 1
)

echo Node.js モジュールをインストール/確認しています...
call npm install --silent
if errorlevel 1 (
  echo ERROR: npm install に失敗しました。
  pause
  exit /b
)
echo Node.js のセットアップが完了しました。

echo.
echo [3/6] ffmpeg を確認・セットアップしています...
winget install ffmpeg --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo ERROR: ffmpeg のインストールに失敗しました。手動でインストールしてください。
  pause
  exit /b
)
echo ffmpeg のセットアップが完了しました。

echo.
echo [4/6] yt-dlp を確認・セットアップしています...
if exist "%SAVE_DIR%yt-dlp.exe" (
  echo yt-dlp.exe を更新しています...
) else (
  echo yt-dlp.exe をダウンロードしています...
  curl -L -o "%SAVE_DIR%yt-dlp.exe" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" || (echo ERROR: yt-dlp のダウンロードに失敗しました。 & pause & exit /b)
)
"%SAVE_DIR%yt-dlp.exe" -U
echo yt-dlp のセットアップが完了しました。

echo.
echo [5/6] AtomicParsley を確認・セットアップしています...
if exist "%SAVE_DIR%AtomicParsley.exe" (
  echo AtomicParsley.exe は既に存在します。
) else (
  echo AtomicParsley をダウンロードしています...
  curl -L -o "%SAVE_DIR%AtomicParsley.zip" "https://github.com/wez/atomicparsley/releases/download/20240608.083822.1ed9031/AtomicParsleyWindows.zip" || (echo ERROR: AtomicParsley のダウンロードに失敗しました。 & pause & exit /b)
  if exist "%SAVE_DIR%AtomicParsley.zip" (
    echo AtomicParsley.zip を展開しています...
    powershell -Command "Expand-Archive -Path '%SAVE_DIR%AtomicParsley.zip' -DestinationPath '%SAVE_DIR%' -Force"
    del "%SAVE_DIR%AtomicParsley.zip"
  )
)
echo AtomicParsley のセットアップが完了しました。

echo.
echo [6/6] Deno を確認・セットアップしています...
if exist "%SAVE_DIR%deno.exe" (
  echo Deno をアップグレードしています...
  "%SAVE_DIR%deno.exe" upgrade
  if exist "%SAVE_DIR%deno.old.exe" (
    del "%SAVE_DIR%deno.old.exe"
  )
) else (
  echo Deno をダウンロードしています...
  curl -L -o "%SAVE_DIR%deno.zip" "https://github.com/denoland/deno/releases/download/v1.44.4/deno-x86_64-pc-windows-msvc.zip" || (echo ERROR: Deno のダウンロードに失敗しました。 & pause & exit /b)
  if exist "%SAVE_DIR%deno.zip" (
    echo deno.zip を展開しています...
    powershell -Command "Expand-Archive -Path '%SAVE_DIR%deno.zip' -DestinationPath '%SAVE_DIR%' -Force"
    del "%SAVE_DIR%deno.zip"
  )
)
echo Deno のセットアップが完了しました。

echo.
echo ==================================================
echo      セットアップ完了。サーバーを起動します...
echo ==================================================
echo.

node "%~dp0server.js"
pause
