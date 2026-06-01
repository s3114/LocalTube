## macに対応させるにあたって
### すべての機能を移行する場合
  - 依存ソフト関係（それぞれの詳細は起動.batの項目に。）
    - AtomicParsley.exe
    - deno.exe
    - ffmpeg.exe
    - libopenh264.dll（ffmpeg関連ソフトの実行に要求される可能性のあるライブラリ）
    - yt-dlp.exe

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
    - nodeでserver.jsを起動

  - 起動最小構成.bat
    - nodeでserver.jsを起動

  - create_autostart_task.ps1、delete_autostart_task.ps1
    -  自動起動のため、windowsのタスクスケジュラーに処理を追加するためのシェルスクリプト

- ffmpegに関しては、yt-dlpにコマンドを渡す箇所でパスを指定するようにしているので、そこも修正する必要があります。

### 動画を見るだけの場合
- nodeでserver.jsを起動するだけでできます。