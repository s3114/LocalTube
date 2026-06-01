#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。macOSでは .exe ではなく Homebrew 等で入る node コマンドを使用します。"
  echo "Homebrew を使う場合: brew install node"
  read -r -p "Enterキーで閉じます..."
  exit 1
fi

exec node "$SCRIPT_DIR/start-localtube.js"
