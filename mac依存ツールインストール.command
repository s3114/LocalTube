#!/bin/bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "このスクリプトはmacOS専用です。"
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew が見つかりません。先に https://brew.sh/ の手順でHomebrewをインストールしてください。"
  read -r -p "Enterキーで閉じます..."
  exit 1
fi

echo "macOS用の依存ツールをインストール/更新します。"
echo "Windows用の .exe ではなく、macOSで実行できるコマンドをHomebrewから入れます。"
brew install node yt-dlp ffmpeg atomicparsley deno

echo "完了しました。起動.command または npm start でLocalTubeを起動してください。"
read -r -p "Enterキーで閉じます..."
