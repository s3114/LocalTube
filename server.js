// 必要なモジュールをインポートします。
const express = require('express'); // Webサーバーフレームワーク
const { spawn } = require('child_process'); // 外部コマンド（yt-dlp.exe）を実行するため
const path = require('path'); // ファイルパスを扱うため
const fs = require('fs'); // ファイルシステムを操作するため（ディレクトリ作成など）
const multer = require('multer'); // ファイルアップロードを処理するため
const os = require('os'); // OS情報（一時ディレクトリなど）を取得するため
const sseExpress = require('sse-express'); // Server-Sent Eventsを扱うため
const crypto = require('crypto'); // ユニークIDを生成するため
const iconv = require('iconv-lite'); // 文字コード変換のため

// Expressアプリケーションのインスタンスを作成します。
const app = express();
const port = 3000; // サーバーがリッスンするポート番号

// ■ ミドルウェアの設定
// --------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'))); // 'public' ディレクトリ内の静的ファイルを提供

// ■ ファイルアップロードの設定
// --------------------------------------------------
const upload = multer({ dest: os.tmpdir() }); // 一時ディレクトリにファイルを保存

// ■ 初期設定
// --------------------------------------------------
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);
const movieDir = path.join(downloadsDir, '動画');
if (!fs.existsSync(movieDir)) fs.mkdirSync(movieDir);
const thumbnailDir = path.join(downloadsDir, 'サムネイル');
if (!fs.existsSync(thumbnailDir)) fs.mkdirSync(thumbnailDir);

// ■ ダウンロードキューと状態管理
// --------------------------------------------------
const jobHistory = new Map(); // 全てのジョブをIDで管理
const downloadQueue = [];
let isDownloading = false;

// ■ SSE (Server-Sent Events) の設定
// --------------------------------------------------
const sseClients = new Set();

function broadcast(event, data) {
    // console.log(`Broadcasting event: ${event}`, data); // For debugging
    for (const client of sseClients) {
        client.sse(event, data);
    }
}

app.get('/events', sseExpress, (req, res) => {
    sseClients.add(res);
    console.log('New SSE client connected.');

    // 現在の全ジョブの状態を新しいクライアントに送信
    res.sse('initial_state', Array.from(jobHistory.values()));

    req.on('close', () => {
        sseClients.delete(res);
        console.log('SSE client disconnected.');
    });
});

// ■ APIエンドポイントの設定
// --------------------------------------------------
app.get('/jobs', (req, res) => {
    res.json(Array.from(jobHistory.values()));
});

app.post('/download', upload.single('cookieFile'), (req, res) => {
    const { urls, format, saveHistory, downloadThumb, drmProtect, savePath, parallelDownloads } = req.body;
    const cookieFile = req.file;

    if (!urls) {
        return res.status(400).json({ error: '動画のURLは必須です。' });
    }

    const urlList = urls.split(/[\n\s,]+/).filter(url => url.trim() !== '');
    const newJobs = [];

    for (const url of urlList) {
        const jobId = crypto.randomUUID();
        const job = {
            id: jobId,
            url: url.trim(),
            options: { format, saveHistory: saveHistory === 'true', downloadThumb: downloadThumb === 'true', drmProtect: drmProtect === 'true', savePath, parallelDownloads },
            cookieFile, // 注意: 全てのURLで同じCookieファイルが使われます
            status: 'queued',
            title: url.trim(),
            progress: { percentage: 0, size: '', totalSize: '', speed: '', eta: '' }
        };
        downloadQueue.push(job);
        jobHistory.set(job.id, job);
        newJobs.push(job);
    }

    broadcast('jobs_added', newJobs);

    res.status(202).json({ message: `${newJobs.length}件のダウンロードがキューに追加されました。` });

    if (!isDownloading) {
        processQueue();
    }
});

// キューを処理するメイン関数
async function processQueue() {
    if (isDownloading || downloadQueue.length === 0) {
        return;
    }

    isDownloading = true;
    const job = downloadQueue[0];
    job.status = 'downloading';
    job.progress.eta = '開始中...';
    broadcast('status_update', { id: job.id, status: job.status, progress: job.progress });

    const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');

    // 1. まずタイトルを取得
    try {
        const title = await getTitle(ytDlpPath, job.url);
        job.title = title;
        broadcast('title_update', { id: job.id, title: job.title });
    } catch (error) {
        console.error(`タイトルの取得に失敗: ${job.url}`, error);
        job.status = 'error';
        job.progress.eta = 'タイトル取得失敗';
        broadcast('status_update', { id: job.id, status: 'error', progress: job.progress });
        
        cleanupAndContinue(job);
        return;
    }

    // 2. ダウンロードを開始
    const outputDir = job.options.savePath && job.options.savePath.trim() !== '' ? job.options.savePath : downloadsDir;
    if (!fs.existsSync(outputDir)) {
        try {
            fs.mkdirSync(outputDir, { recursive: true });
        } catch (error) {
            console.error(`保存先ディレクトリの作成に失敗しました ${outputDir}: ${error.message}`);
            job.status = 'error';
            job.progress.eta = '保存先エラー';
            broadcast('status_update', { id: job.id, status: 'error', progress: job.progress });
            cleanupAndContinue(job);
            return;
        }
    }

    let args = buildArgs(job, outputDir);
    const ytDlp = spawn(ytDlpPath, args);

    // プロセスのイベントハンドリング
    let stdoutBuffer = '';
    ytDlp.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
        // 改行コード（\rまたは\n）で分割し、不完全な最後の行はバッファに残す
        const lines = stdoutBuffer.split(/[\r\n]/);
        stdoutBuffer = lines.pop() || ''; 

        for (const line of lines) {
            if (line.trim() === '') continue;

            // yt-dlpのデフォルトプログレス出力に合わせた正規表現
            // 例: [download]  10.2% of 11.00MiB at 806.79KiB/s ETA 00:12
            const progressMatch = line.match(/\[download\]\s+([\d.]+)% of\s+([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+([\d:]+)/);
            if (progressMatch) {
                job.progress = {
                    percentage: parseFloat(progressMatch[1]),
                    totalSize: progressMatch[2],
                    speed: progressMatch[3],
                    eta: progressMatch[4]
                };
                broadcast('progress_update', { id: job.id, progress: job.progress });
            }
        }
    });

    ytDlp.stderr.on('data', (data) => {
        console.error(`yt-dlp stderr: ${data.toString().trim()}`);
    });

    ytDlp.on('close', (code) => {
        if (code === 0) {
            job.status = 'completed';
            job.progress.eta = '完了';
            moveFiles(outputDir, job.options.downloadThumb);
        } else {
            job.status = 'error';
            job.progress.eta = 'エラー';
        }
        broadcast('status_update', { id: job.id, status: job.status, progress: job.progress });
        cleanupAndContinue(job);
    });

    ytDlp.on('error', (err) => {
        console.error(`yt-dlpプロセスの起動に失敗しました: ${err.message}`);
        job.status = 'error';
        job.progress.eta = '起動失敗';
        broadcast('status_update', { id: job.id, status: 'error', progress: job.progress });
        cleanupAndContinue(job);
    });
}

function cleanupAndContinue(job) {
    if (job.cookieFile) {
        fs.unlink(job.cookieFile.path, (err) => {
            if (err) console.error(`一時クッキーファイルの削除に失敗しました: ${job.cookieFile.path}`, err);
            else console.log(`一時クッキーファイルを削除しました: ${job.cookieFile.path}`);
        });
    }

    downloadQueue.shift();
    isDownloading = false;
    processQueue();
}

// yt-dlpの引数を組み立てるヘルパー関数
function buildArgs(job, outputDir) {
    const { url, options } = job;
    let args = [
        url,
        '-o', path.join(outputDir, '%(upload_date)s-%(title)s.%(ext)s'),
        '--embed-thumbnail', '--add-metadata', '--ignore-errors', '--retries', 'infinite',
        '--progress', // 進捗情報を強制的に表示させる
        '--no-color', // 色コードを無効化
        '--newline', // 進捗情報を改行で区切る
    ];

    if (options.format) args.push('-f', options.format);
    if (options.downloadThumb) args.push('--write-thumbnail');
    if (options.saveHistory) args.push('--download-archive', path.join(__dirname, 'finished.txt'));
    if (job.cookieFile) args.push('--cookies', job.cookieFile.path);
    if (options.parallelDownloads && parseInt(options.parallelDownloads) > 0) {
        args.push('--concurrent-fragments', options.parallelDownloads);
    }
    if (options.drmProtect) {
        args.push('--add-header', 'youtube:player-client=default,-tv,web_safari,web_embedded');
    }
    return args;
}

// タイトルを取得するヘルパー関数
function getTitle(ytDlpPath, url) {
    return new Promise((resolve, reject) => {
        const ytDlpProcess = spawn(ytDlpPath, [url, '--get-title', '--no-warnings']);

        const stdoutChunks = [];
        const stderrChunks = [];

        ytDlpProcess.stdout.on('data', (data) => {
            stdoutChunks.push(data);
        });

        ytDlpProcess.stderr.on('data', (data) => {
            stderrChunks.push(data);
        });

        ytDlpProcess.on('close', (code) => {
            const stdoutBuffer = Buffer.concat(stdoutChunks);
            // iconv-liteを使って、Bufferをcp932(Shift_JIS)としてデコード
            const title = iconv.decode(stdoutBuffer, 'cp932');

            if (code === 0 && title.trim() !== '') {
                resolve(title.trim());
            } else {
                const stderrBuffer = Buffer.concat(stderrChunks);
                const stderr = iconv.decode(stderrBuffer, 'cp932');
                reject(new Error(`yt-dlp exited with code ${code}. Stderr: ${stderr}`));
            }
        });

        ytDlpProcess.on('error', (err) => {
            reject(err);
        });
    });
}

// ファイル移動のヘルパー関数
function moveFiles(outputDir, downloadThumb) {
    try {
        const files = fs.readdirSync(outputDir);
        for (const file of files) {
            const oldPath = path.join(outputDir, file);
            if (!fs.statSync(oldPath).isFile()) continue;

            const fileExt = path.extname(file).toLowerCase();
            const thumbnailExtensions = ['.webp', '.jpg', '.jpeg', '.png'];

            if (fileExt === '.mp4') { // Assume downloaded video is mp4, could be improved
                const newPath = path.join(movieDir, file);
                try { fs.renameSync(oldPath, newPath); } catch (e) { console.error(`Failed to move ${file}: ${e}`); }
            } else if (thumbnailExtensions.includes(fileExt)) {
                if (downloadThumb) {
                    const newPath = path.join(thumbnailDir, file);
                    try { fs.renameSync(oldPath, newPath); } catch (e) { console.error(`Failed to move thumb ${file}: ${e}`); }
                } else {
                    try { fs.unlinkSync(oldPath); } catch (e) { console.error(`Failed to delete thumb ${file}: ${e}`); }
                }
            }
        }
    } catch (err) {
        console.error(`ファイルの移動/削除中にエラー: ${err}`);
    }
}


// ■ サーバーの起動
// --------------------------------------------------
app.listen(port, () => {
    console.log(`サーバーが http://localhost:${port} で起動しました。`);
});