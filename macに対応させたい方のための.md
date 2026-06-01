## macに対応させるにあたって
### すべての機能を移行する場合
  - 依存ソフト関係（それぞれの詳細は起動.batの項目に。）
    - AtomicParsley.exe
    - deno.exe
    - ffmpeg.exe
    - libopenh264.dll（ffmpeg関連ソフトの実行に要求される可能性のあるライブラリ）
    - yt-dlp.exe

### macOSで使う対応ツール
Windows用の `.exe` / `.dll` はmacOSでは実行できないため、macOSでは次のコマンドを使用します。Homebrew Formulaeと各公式ドキュメントでmacOS向けの提供を確認しています。

| Windows側で使っていたもの | macOSで使うもの | Homebrewでの導入例 | 用途 |
| --- | --- | --- | --- |
| `yt-dlp.exe` | `yt-dlp` | `brew install yt-dlp` | YouTube等の動画/コメント/ライブチャット取得 |
| `ffmpeg.exe` | `ffmpeg` | `brew install ffmpeg` | 音声・動画の結合、メタデータ処理、サムネイル生成 |
| `AtomicParsley.exe` | `AtomicParsley` | `brew install atomicparsley` | MP4へのサムネイル/メタデータ埋め込み |
| `deno.exe` | `deno` | `brew install deno` | yt-dlpの一部機能で必要になるJavaScript/TypeScriptランタイム |
| `libopenh264.dll` | 原則不要 | `ffmpeg`のmacOSビルド側に任せる | Windows用DLLのためmacOSでは直接配置しない |

まとめて入れる場合は、`mac依存ツールインストール.command` を実行してください。このスクリプトもFinder起動時にHomebrewを見つけられるよう `/opt/homebrew/bin` / `/usr/local/bin` をPATHへ補完します。手動の場合は次を実行します。

```sh
brew install node yt-dlp ffmpeg atomicparsley deno
```

参考: Homebrew Formulae ([node](https://formulae.brew.sh/formula/node), [yt-dlp](https://formulae.brew.sh/formula/yt-dlp), [ffmpeg](https://formulae.brew.sh/formula/ffmpeg), [atomicparsley](https://formulae.brew.sh/formula/atomicparsley), [deno](https://formulae.brew.sh/formula/deno))、[yt-dlp公式インストール案内](https://github.com/yt-dlp/yt-dlp/wiki/Installation)、[FFmpeg公式ダウンロード案内](https://www.ffmpeg.org/download.html)、[Deno公式インストール案内](https://docs.deno.com/runtime/getting_started/installation/) を確認しています。

  - nightly_update.bat
    - yt-dlpのバージョンをdevの最新版にするための物（不要）

  - 起動.bat
    - アプリ自体のアップデート
      - 少し弄ればmacに対応させたままアプリの更新を受け取れるはず。
      - 動作的には丸ごとリポジトリをzip化して解凍して置き換えているだけです。
    - Node.jsのインストール、アップデート
      - localhostでサーバーを建てるための依存アプリケーション
    - ffmpeg.exe
      - yt-dlpにて取得した音声、動画の結合
      - チャンネル情報の取得
    - libopenh264.dllの取得
      - macで必要かは不明
    - yt-dlp
      - youtube等のDLに用いている必須ソフト
    - AtomicParsley
      - 動画にサムネを埋め込む際のためのソフト
    - deno.exe
      - yt-dlpの動作に必要なソフト
    - 共通起動ファイル `start-localtube.js` からサーバーを起動

  - 起動最小構成.bat
    - 共通起動ファイル `start-localtube.js` からサーバーを起動

  - create_autostart_task.ps1、delete_autostart_task.ps1
    - 自動起動のため、Windowsのタスクスケジューラに処理を追加/削除するためのPowerShellスクリプト
    - 設定ページの「PC起動時の自動実行」はWindowsの場合だけこれらを呼び出します。macOSでは `/api/schedule/status` が `supported: false` を返し、UI側で無効表示にします。

- ffmpegに関しては、yt-dlpにコマンドを渡す箇所でパスを指定するようにしているので、そこも修正する必要があります。

### 共通起動ファイル
- `start-localtube.js` はWindows/macOS共通の起動ファイルです。
- Windowsの `起動.bat` / `起動最小構成.bat` とmacOSの `起動.command` は、この共通ファイルを呼び出します。
- OSごとに必要な外部コマンド名だけを切り替え、同じリポジトリのファイル一式でWindows/macOSの両方を起動できるようにしています。

### 動画を見るだけの場合
- `node start-localtube.js` で起動できます。
