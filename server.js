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
let activeDownloads = 0;
let maxConcurrentDownloads = 1; // デフォルトは1

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

app.post('/download', upload.single('cookieFile'), async (req, res) => {
    const { urls, format, saveHistory, downloadThumb, drmProtect, savePath, parallelDownloads, concurrentFragments } = req.body;
    const cookieFile = req.file;

    if (!urls) {
        return res.status(400).json({ error: '動画のURLは必須です。' });
    }

    maxConcurrentDownloads = parseInt(parallelDownloads, 10) || 1;

    const inputUrls = urls.split(/[\n\s,]+/).filter(url => url.trim() !== '');
    const newJobs = [];

    for (const url of inputUrls) {
        try {
            const videoUrls = await getUrlsFromInput(url, cookieFile?.path);
            for (const videoUrl of videoUrls) {
                const jobId = crypto.randomUUID();
                const job = {
                    id: jobId,
                    url: videoUrl.trim(),
                    options: { format, saveHistory: saveHistory === 'true', downloadThumb: downloadThumb === 'true', drmProtect: drmProtect === 'true', savePath, concurrentFragments },
                    cookieFile,
                    status: 'queued',
                    title: videoUrl.trim(),
                    progress: { percentage: 0, size: '', totalSize: '', speed: '', eta: '' }
                };
                downloadQueue.push(job);
                jobHistory.set(job.id, job);
                newJobs.push(job);
            }
        } catch (error) {
            console.error(`URLの解析に失敗しました: ${url}`, error);
            // エラーをクライアントに通知することも検討
        }
    }


    broadcast('jobs_added', newJobs);

    res.status(202).json({ message: `${newJobs.length}件のダウンロードがキューに追加されました。` });

    startNextDownload();
});

// URLを解析して動画URLのリストを取得する関数
function getUrlsFromInput(url, cookiePath) {
    return new Promise((resolve, reject) => {
        const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
        let args = [];
        const commonArgs = ['--skip-download', '--quiet', '--no-warnings'];
        if (cookiePath) {
            commonArgs.push('--cookies', cookiePath);
        }

        // YouTube
        if (url.includes('youtube.com/playlist?list=')) {
            args = [url, '--flat-playlist', '--get-url', ...commonArgs];
        } else if (url.includes('youtube.com/watch?v=') || url.includes('youtu.be/')) {
            // プレイリストの一部である可能性を考慮してindexを取り除く
            const cleanUrl = url.split('&')[0];
            resolve([cleanUrl]);
            return;
        } else if (url.includes('youtube.com/@') || url.includes('youtube.com/channel')) {
            args = [url, '--flat-playlist', '--get-id', ...commonArgs];
        }
        // ABEMA
        else if (url.includes('abema.tv/video/title/')) { //シリーズ
             args = [url, '--flat-playlist', '--get-url', ...commonArgs];
        } else if (url.includes('abema.tv/video/episode/')) { //動画
            resolve([url]);
            return;
        }
        else {
            // 不明なURLはそのまま渡す
            resolve([url]);
            return;
        }

        const ytDlp = spawn(ytDlpPath, args);
        let videoUrls = '';
        ytDlp.stdout.on('data', (data) => {
            videoUrls += data.toString();
        });

        ytDlp.stderr.on('data', (data) => {
            console.error(`[${url}] yt-dlp stderr: ${data}`);
        });

        ytDlp.on('close', (code) => {
            if (code === 0) {
                const urls = videoUrls.split('\n').filter(u => u.trim() !== '');
                // チャンネルの場合、IDのリストが返るのでURLに変換する
                if (url.includes('youtube.com/@') || url.includes('youtube.com/channel')) {
                    resolve(urls.map(id => `https://www.youtube.com/watch?v=${id}`));
                } else {
                    resolve(urls);
                }
            } else {
                reject(new Error(`yt-dlp exited with code ${code} for URL: ${url}`));
            }
        });
        
        ytDlp.on('error', (err) => {
            reject(err);
        });
    });
}


// キューを処理するメイン関数
async function startNextDownload() {
    while (activeDownloads < maxConcurrentDownloads && downloadQueue.length > 0) {
        activeDownloads++;
        const job = downloadQueue.shift();
        
        if (!job) {
            activeDownloads--;
            continue;
        }

        job.status = 'downloading';
        job.progress.eta = '開始中...';
        broadcast('status_update', { id: job.id, status: job.status, progress: job.progress });
        
        // 非同期の即時実行関数でダウンロード処理をラップ
        (async () => {
            const maxRetries = 3;
            const retryDelay = 5000; // 5秒

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    await processDownloadJob(job); // タイトル取得、ダウンロード、移動を含む
                    
                    job.status = 'completed';
                    job.progress.eta = '完了';
                    broadcast('status_update', { id: job.id, status: job.status, progress: job.progress });
                    cleanupAndContinue(job);
                    return; // 成功したのでリトライせず終了

                } catch (error) {
                    console.error(`[Attempt ${attempt}/${maxRetries}] Job ${job.id} failed: ${error.message}`);
                    
                    if (attempt === maxRetries) {
                        job.status = 'error';
                        job.progress.eta = 'エラー';
                        broadcast('status_update', { id: job.id, status: 'error', progress: job.progress, error: error.message });
                        cleanupAndContinue(job);
                    } else {
                        job.progress.eta = `${retryDelay / 1000}秒後に再試行... (${attempt})`;
                        broadcast('status_update', { id: job.id, status: 'downloading', progress: job.progress });
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                    }
                }
            }
        })();
    }
}

async function processDownloadJob(job) {
    const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');

    // 1. まずタイトルを取得
    try {
        const title = await getTitle(ytDlpPath, job.url, job.cookieFile?.path);
        job.title = title;
        broadcast('title_update', { id: job.id, title: job.title });
    } catch (error) {
        // タイトル取得はリトライ不能なエラーとして扱い、すぐに失敗させる
        throw new Error(`タイトル取得失敗: ${error.message}`);
    }

    // 2. 保存パスを決定する
    const customSavePath = job.options.savePath && job.options.savePath.trim() !== '' ? job.options.savePath : null;
    const finalMovieDir = customSavePath || movieDir;
    const finalThumbnailDir = customSavePath ? path.join(customSavePath, 'サムネイル') : thumbnailDir;
    const finalTempDir = customSavePath || downloadsDir;

    // 必要に応じて保存先ディレクトリを作成
    if (customSavePath) {
        if (!fs.existsSync(finalMovieDir)) {
            try {
                fs.mkdirSync(finalMovieDir, { recursive: true });
            } catch (error) {
                throw new Error(`カスタム保存先ディレクトリの作成に失敗しました ${finalMovieDir}: ${error.message}`);
            }
        }
        if (job.options.downloadThumb && !fs.existsSync(finalThumbnailDir)) {
             try {
                fs.mkdirSync(finalThumbnailDir, { recursive: true });
            } catch (error) {
                throw new Error(`カスタムサムネイル保存先ディレクトリの作成に失敗しました ${finalThumbnailDir}: ${error.message}`);
            }
        }
    }
    
    // このPromiseがダウンロードとファイル移動のプロセス全体をカプセル化する
    return new Promise((resolve, reject) => {
        const args = buildArgs(job, { movieDir: finalMovieDir, thumbnailDir: finalThumbnailDir, tempDir: finalTempDir });
        const ytDlp = spawn(ytDlpPath, args);
        let stderrOutput = '';
        let stdoutBuffer = '';

        ytDlp.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split(/[\r\n]/);
            stdoutBuffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim() === '') continue;

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
            const errorMsg = data.toString().trim();
            stderrOutput += errorMsg + '\n';
            console.error(`yt-dlp stderr: ${errorMsg}`);
        });

        ytDlp.on('close', async (code) => {
            if (code === 0) {
                resolve(); // すべて成功
            } else {
                reject(new Error(`yt-dlpがエラーコード${code}で終了しました。Stderr: ${stderrOutput}`));
            }
        });

        ytDlp.on('error', (err) => {
            reject(new Error(`yt-dlpプロセスの起動に失敗: ${err.message}`));
        });
    });
}


function cleanupAndContinue(job) {
    if (job.cookieFile) {
        // 同じCookieファイルが他のジョブで使われている可能性があるため、すぐに削除しない
    }
    
    activeDownloads--;
    startNextDownload(); // 次のダウンロードを開始
}


// yt-dlpの引数を組み立てるヘルパー関数
function buildArgs(job, paths) {
    const { url, options } = job;
    const { movieDir, thumbnailDir, tempDir } = paths;

    let args = [
        url,
        // -o にはファイル名パターンのみを指定
        '-o', '%(upload_date)s-%(title)s.%(ext)s',

        // -P で各ファイルの保存先を指定
        '-P', `home:${movieDir}`,
        '-P', `temp:${tempDir}`,

        '--embed-thumbnail', '--add-metadata', '--ignore-errors', '--retries', 'infinite',
        '--progress', // 進捗情報を強制的に表示させる
        '--no-color', // 色コードを無効化
        '--newline', // 進捗情報を改行で区切る
    ];

    if (options.format) args.push('-f', options.format);
    if (options.downloadThumb) {
        args.push('--write-thumbnail');
        // サムネイルの保存先を指定
        args.push('-P', `thumbnail:${thumbnailDir}`);
    }
    if (options.saveHistory) args.push('--download-archive', path.join(__dirname, 'finished.txt'));
    if (job.cookieFile) args.push('--cookies', job.cookieFile.path);
    if (options.concurrentFragments && parseInt(options.concurrentFragments) > 0) {
        args.push('--concurrent-fragments', options.concurrentFragments);
    }
    if (options.drmProtect) {
        args.push('--add-header', 'youtube:player-client=default,-tv,web_safari,web_embedded');
    }
    return args;
}

// タイトルを取得するヘルパー関数
function getTitle(ytDlpPath, url, cookiePath) {
    return new Promise((resolve, reject) => {
        const args = [url, '--get-title', '--no-warnings'];
        if (cookiePath) {
            args.push('--cookies', cookiePath);
        }
        const ytDlpProcess = spawn(ytDlpPath, args);

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





// ■ サーバーの起動
// --------------------------------------------------
app.listen(port, () => {
    console.log(`サーバーが http://localhost:${port} で起動しました。`);
});