// 必要なモジュールをインポートします。
const express = require('express'); // Webサーバーフレームワーク
const { spawn } = require('child_process'); // 外部コマンド（yt-dlp.exe）を実行するため
const path = require('path'); // ファイルパスを扱うため
const fs = require('fs'); // ファイルシステムを操作するため（ディレクトリ作成など）

// Expressアプリケーションのインスタンスを作成します。
const app = express();
const port = 3000; // サーバーがリッスンするポート番号

// ■ ミドルウェアの設定
// --------------------------------------------------

// POSTリクエストで送られてくるJSON形式のボディを解析できるようにします。
app.use(express.json());
// 'public' ディレクトリ内の静的ファイル（HTML, CSS, JS）を提供します。
app.use(express.static(path.join(__dirname, 'public')));

// ■ 初期設定
// --------------------------------------------------

// 'downloads' ディレクトリが存在することを確認し、なければ作成します。
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// ■ APIエンドポイントの設定
// --------------------------------------------------

// '/download' というパスにPOSTリクエストが来たときの処理を定義します。
app.post('/download', (req, res) => {
    // フロントエンドから送信されたオプションを取得します。
    const { url, format, saveHistory, downloadThumb, bypassDrm, savePath } = req.body;

    // URLが指定されていない場合は、エラーステータス400を返します。
    if (!url) {
        return res.status(400).json({ error: '動画のURLは必須です。' });
    }

    console.log(`ダウンロードを開始します: ${url}`);

    // yt-dlp.exeへのパスを組み立てます。
    const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
    
    // 保存先ディレクトリを決定します。savePathが指定されていればそちらを、なければデフォルトの 'downloads' を使用します。
    const outputDir = savePath && savePath.trim() !== '' ? savePath : downloadsDir;

    // 保存先ディレクトリが存在しない場合は作成します。
    if (!fs.existsSync(outputDir)) {
        try {
            fs.mkdirSync(outputDir, { recursive: true });
        } catch (error) {
            console.error(`保存先ディレクトリの作成に失敗しました ${outputDir}: ${error.message}`);
            return res.status(500).json({ error: '保存先ディレクトリの作成に失敗しました。', details: error.message });
        }
    }

    // yt-dlp.exeに渡すコマンドライン引数を組み立てます。
    let args = [
        url, // ダウンロードする動画のURL
        '-o', path.join(outputDir, '%(upload_date)s-%(title)s.%(ext)s'), // 出力ファイル名のテンプレート
        '--embed-thumbnail', // サムネイルを動画に埋め込む
        '--add-metadata',    // 動画にメタデータを追加する
        '--ignore-errors',   // エラーが発生してもダウンロードを続行する
        '--retries', 'infinity',    // 一時的なエラー時に無限回再試行する
    ];

    // フロントエンドのオプションに応じて引数を追加します。
    if (format) {
        args.push('-f', format); // 画質フォーマット
    }
    if (downloadThumb) {
        args.push('--write-thumbnail'); // サムネイルをダウンロード
    }
    // 'saveHistory' や 'bypassDrm' などの他のオプションもここに追加できます。

    // yt-dlp.exeを別プロセスとして実行します。
    const commandString = `${ytDlpPath} ${args.map(arg => `"${arg}"`).join(' ')}`;
    console.log(`yt-dlpコマンド: ${commandString}`);
    const ytDlp = spawn(ytDlpPath, args);

    // ■ yt-dlpプロセスのイベントハンドリング
    // --------------------------------------------------

    let stdoutBuffer = []; // 標準出力のログを保持するバッファ
    let stderrBuffer = []; // 標準エラー出力のログを保持するバッファ

    // 標準出力を受け取ったときの処理
    ytDlp.stdout.on('data', (data) => {
        const line = data.toString();
        stdoutBuffer.push(line);
        console.log(`yt-dlp stdout: ${line.trim()}`); // サーバーコンソールに進捗を表示
    });

    // 標準エラー出力を受け取ったときの処理
    ytDlp.stderr.on('data', (data) => {
        const line = data.toString();
        stderrBuffer.push(line);
        console.error(`yt-dlp stderr: ${line.trim()}`); // サーバーコンソールにエラーを表示
    });

    // プロセスが終了したときの処理
    ytDlp.on('close', (code) => {
        if (code === 0) {
            // 成功した場合 (終了コード 0)
            console.log(`ダウンロードが成功しました: ${url}`);
            res.json({
                message: 'ダウンロードが正常に完了しました！',
                status: 'success',
                output: stdoutBuffer.join('') // フロントエンドに成功ログを返す
            });
        } else {
            // 失敗した場合 (終了コード 0以外)
            console.error(`yt-dlpがエラーコード ${code} で終了しました: ${url}`);
            res.status(500).json({
                message: '動画のダウンロードに失敗しました。',
                status: 'error',
                error: stderrBuffer.join('') || '不明なエラーです', // フロントエンドにエラーログを返す
                output: stdoutBuffer.join('')
            });
        }
    });

    // プロセス自体の起動に失敗したときのエラー処理
    ytDlp.on('error', (err) => {
        console.error(`yt-dlpプロセスの起動に失敗しました: ${err.message}`);
        res.status(500).json({ error: 'ダウンロードプロセスの開始に失敗しました。', details: err.message });
    });
});

// ■ サーバーの起動
// --------------------------------------------------

// 指定したポートでリクエストの待受を開始します。
app.listen(port, () => {
    console.log(`サーバーが http://localhost:${port} で起動しました。`);
});