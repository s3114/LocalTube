# LocalTube

YouTube動画をPCに保存し、ローカルで管理・再生するためのツールです。  

- 動画のダウンロード
- 保存した動画の一覧表示・再生
- コメントやライブチャット、サムネイルの保存、再生


## セットアップ

動画での詳しいセットアップ方法はこちら
[https://www.youtube.com/watch?v=CHa9mrQl_lM
](https://localtube-sample.netlify.app/player)

1. インストーラーを[ダウンロード](https://github.com/s3114/LocalTube/releases/latest)
2. 解凍し、任意の場所に移動したうえで `起動.bat` をダブルクリック
3. 初回は自動セットアップが走るので待機
4. ブラウザで `http://localhost:3000` を開く


## macOSでの起動

`macに対応させたい方のための.md` の内容をもとに、macOSでも最低限の起動と動画ダウンロードに対応しています。

1. Node.js 20 以上をインストール
   - Homebrewを使う場合: `brew install node`
2. 動画をダウンロードする場合は必要なmacOS用外部ツールをインストール
   - まとめて入れる場合: `mac依存ツールインストール.command` をダブルクリック
   - 手動で入れる場合: `brew install yt-dlp ffmpeg atomicparsley deno`
3. 初回のみ依存パッケージをインストール
   - `npm install`
4. `起動.command` をダブルクリック、またはターミナルで `npm start` / `node start-localtube.js` を実行
5. ブラウザで `http://localhost:3000` を開く

`start-localtube.js` はWindows/macOS共通の起動ファイルです。Windowsの `起動.bat` / `起動最小構成.bat` とmacOSの `起動.command` は、最終的にこの共通ファイルからサーバーを起動します。
macOSではWindows用の `.exe` / `.dll` は実行しません。Homebrew等でインストールされる `yt-dlp`、`ffmpeg`、`AtomicParsley`、`deno` コマンドを使用します。Finderから起動した場合でも `/opt/homebrew/bin` / `/usr/local/bin` をPATHへ補完します。
自動起動設定はWindowsでは `create_autostart_task.ps1` / `delete_autostart_task.ps1` を使ってタスクスケジューラを操作します。macOSではWindows専用の自動起動設定（タスクスケジューラ）は利用できないため、設定ページ上では無効表示になります。

## ライセンス

このプロジェクトは MIT License のもとで公開されています。

詳細は LICENSE ファイルを参照してください。

## コントリビューション

本プロジェクトの改変、機能追加、修正は自由に行えます。

改良版を公開する場合は、可能であれば GitHub の Fork として公開し、Pull Request によるフィードバックや変更の共有をご検討ください。

不具合修正や機能改善など、コミュニティへの貢献を歓迎します。
