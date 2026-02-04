// 必要なモジュールをインポートします。
const express = require("express"); // Webサーバーフレームワーク
const serverStartTime = Date.now();
const { spawn } = require("child_process"); // 外部コマンド（yt-dlp.exe）を実行するため
const path = require("path"); // ファイルパスを扱うため
const fs = require("fs"); // ファイルシステムを操作するため（ディレクトリ作成など）
const multer = require("multer"); // ファイルアップロードを処理するため
const os = require("os"); // OS情報（一時ディレクトリなど）を取得するため
const sseExpress = require("sse-express"); // Server-Sent Eventsを扱うため
const crypto = require("crypto"); // ユニークIDを生成するため
const iconv = require("iconv-lite"); // 文字コード変換のため

// Expressアプリケーションのインスタンスを作成します。
const app = express();
const port = 3000; // サーバーがリッスンするポート番号

// ■ ミドルウェアの設定
// --------------------------------------------------
app.use(express.static(path.join(__dirname, "public"))); // 'public' ディレクトリ内の静的ファイルを提供
app.use(express.json()); // JSONリクエストボディをパースするためのミドルウェアを追加
app.use("/downloads", express.static(path.join(__dirname, "downloads")));

// ■ ファイルアップロードの設定
// --------------------------------------------------
const upload = multer({ dest: os.tmpdir() }); // 一時ディレクトリにファイルを保存

// ■ 初期設定
// --------------------------------------------------
const downloadsDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);
const movieDir = path.join(downloadsDir, "動画");
if (!fs.existsSync(movieDir)) fs.mkdirSync(movieDir);
const thumbnailDir = path.join(downloadsDir, "サムネイル");
if (!fs.existsSync(thumbnailDir)) fs.mkdirSync(thumbnailDir);
const commentsDir = path.join(downloadsDir, "コメント");
if (!fs.existsSync(commentsDir)) fs.mkdirSync(commentsDir);
const liveChatDir = path.join(downloadsDir, "ライブチャット");
if (!fs.existsSync(liveChatDir)) fs.mkdirSync(liveChatDir);

const PENDING_CHAT_DIR = path.join(__dirname, "syorimachi_folder");
fs.mkdirSync(PENDING_CHAT_DIR, { recursive: true });

function makeJobFolderName() {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");

  const ms = now.getTime().toString().slice(-6); // 衝突防止
  return `job_${ymd}_${ms}`;
}

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

async function measureNetworkMbps() {
  const TEST_URL = "https://www.google.com/generate_204";
  const start = Date.now();
  try {
    await fetch(TEST_URL, { method: "HEAD" });
    const ms = Date.now() - start;
    const approxMbps = Math.min(1000, Math.max(10, Math.round(8000 / ms)));
    return {
      latency_ms: ms,
      approx_mbps: approxMbps,
    };
  } catch (e) {
    console.error("Latency test failed:", e.message);
    return null;
  }
}

app.get("/events", sseExpress, (req, res) => {
  sseClients.add(res);
  console.log("New SSE client connected.");
  res.sse("initial_state", Array.from(jobHistory.values()));
  async function broadcastSystemInfo() {
    const uptimeSec = Math.floor((Date.now() - serverStartTime) / 1000);

    // --- サーバー現在時刻（ISO → 整形して送る）---
    const now = new Date();
    const serverTime = {
      yyyy: now.getFullYear(),
      MM: String(now.getMonth() + 1).padStart(2, "0"),
      dd: String(now.getDate()).padStart(2, "0"),
      hh: String(now.getHours()).padStart(2, "0"),
      mm: String(now.getMinutes()).padStart(2, "0"),
      ss: String(now.getSeconds()).padStart(2, "0"),
    };

    // ★ 失敗しても止まらないように安全化
    let net = null;
    try {
      net = await measureNetworkMbps();
    } catch (e) {
      console.error("measureNetworkMbps error:", e.message);
    }

    res.sse("system_info", {
      server_time: serverTime,
      latency_ms: net ? net.latency_ms : null,
      network_mbps: net ? net.approx_mbps : null,
      uptime_sec: uptimeSec,
    });
  }

  const sysInfoInterval = setInterval(broadcastSystemInfo, 1000);

  req.on("close", () => {
    sseClients.delete(res);
    clearInterval(sysInfoInterval);
    console.log("SSE client disconnected.");
  });
});

app.get("/ping", (req, res) => {
  res.json({ ok: true });
});
// --------------------------------------------------

// ■ 設定管理
// --------------------------------------------------
const CONFIG_PATH = path.join(__dirname, "config.json");

// 設定を読み込むAPI
app.get("/api/settings", async (req, res) => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const configData = await fs.promises.readFile(CONFIG_PATH, "utf-8");
      res.json(JSON.parse(configData));
    } else {
      // ファイルが存在しない場合はデフォルト設定を返す
      res.json({ selectedBrowser: "" });
    }
  } catch (error) {
    console.error("設定の読み込みに失敗しました:", error);
    res.status(500).json({ error: "設定の読み込みに失敗しました。" });
  }
});

// 設定を保存するAPI
app.post("/api/settings", async (req, res) => {
  try {
    const { browser } = req.body;
    if (typeof browser === "undefined") {
      return res.status(400).json({ error: "無効なリクエストです。" });
    }

    const newConfig = { selectedBrowser: browser };

    await fs.promises.writeFile(
      CONFIG_PATH,
      JSON.stringify(newConfig, null, 2),
    );

    console.log("設定を保存しました:", newConfig);
    res.json({ message: "設定を保存しました。" });
  } catch (error) {
    console.error("設定の保存に失敗しました:", error);
    res.status(500).json({ error: "設定の保存に失敗しました。" });
  }
});

app.get("/jobs", (req, res) => {
  res.json(Array.from(jobHistory.values()));
});

app.post("/download", upload.single("cookieFile"), async (req, res) => {
  const {
    urls,
    format,
    saveHistory,
    downloadThumb,
    drmProtect,
    savePath,
    parallelDownloads,
    concurrentFragments,
    commentOptions,
  } = req.body;
  const cookieFile = req.file;

  if (!urls) {
    return res.status(400).json({ error: "動画のURLは必須です。" });
  }

  maxConcurrentDownloads = parseInt(parallelDownloads, 10) || 1;

  const inputUrls = urls.split(/[\n\s,]+/).filter((url) => url.trim() !== "");
  const newJobs = [];

  for (const url of inputUrls) {
    try {
      const videoUrls = await getUrlsFromInput(url, cookieFile?.path);
      for (const videoUrl of videoUrls) {
        const jobId = crypto.randomUUID();
        const job = {
          id: jobId,
          url: videoUrl.trim(),
          options: {
            format,
            saveHistory: saveHistory === "true",
            downloadThumb: downloadThumb === "true",
            drmProtect: drmProtect === "true",
            savePath,
            concurrentFragments,
            commentOptions,
          },
          cookieFile,
          status: "queued",
          title: videoUrl.trim(),
          progress: {
            percentage: 0,
            size: "",
            totalSize: "",
            speed: "",
            eta: "",
          },
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

  broadcast("jobs_added", newJobs);

  res.status(202).json({
    message: `${newJobs.length}件のダウンロードがキューに追加されました。`,
  });

  startNextDownload();
});

// URLを解析して動画URLのリストを取得する関数
function getUrlsFromInput(url, cookiePath) {
  return new Promise((resolve, reject) => {
    const ytDlpPath = path.join(__dirname, "yt-dlp.exe");
    let args = [];
    const commonArgs = ["--skip-download", "--quiet", "--no-warnings"];
    if (cookiePath) {
      commonArgs.push("--cookies", cookiePath);
    }

    // YouTube
    if (url.includes("youtube.com/playlist?list=")) {
      args = [url, "--flat-playlist", "--get-url", ...commonArgs];
    } else if (
      url.includes("youtube.com/watch?v=") ||
      url.includes("youtu.be/")
    ) {
      // プレイリストの一部である可能性を考慮してindexを取り除く
      const cleanUrl = url.split("&")[0];
      resolve([cleanUrl]);
      return;
    } else if (
      url.includes("youtube.com/@") ||
      url.includes("youtube.com/channel")
    ) {
      args = [url, "--flat-playlist", "--get-id", ...commonArgs];
    }
    // ABEMA
    else if (url.includes("abema.tv/video/title/")) {
      //シリーズ
      args = [url, "--flat-playlist", "--get-url", ...commonArgs];
    } else if (url.includes("abema.tv/video/episode/")) {
      //動画
      resolve([url]);
      return;
    } else {
      // 不明なURLはそのまま渡す
      resolve([url]);
      return;
    }

    const ytDlp = spawn(ytDlpPath, args);
    let videoUrls = "";
    ytDlp.stdout.on("data", (data) => {
      videoUrls += data.toString();
    });

    ytDlp.stderr.on("data", (data) => {
      console.error(`[${url}] yt-dlp stderr: ${data}`);
    });

    ytDlp.on("close", (code) => {
      if (code === 0) {
        const urls = videoUrls.split("\n").filter((u) => u.trim() !== "");
        // チャンネルの場合、IDのリストが返るのでURLに変換する
        if (
          url.includes("youtube.com/@") ||
          url.includes("youtube.com/channel")
        ) {
          resolve(urls.map((id) => `https://www.youtube.com/watch?v=${id}`));
        } else {
          resolve(urls);
        }
      } else {
        reject(new Error(`yt-dlp exited with code ${code} for URL: ${url}`));
      }
    });

    ytDlp.on("error", (err) => {
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

    job.status = "downloading";
    job.progress.eta = "開始中...";
    broadcast("status_update", {
      id: job.id,
      status: job.status,
      progress: job.progress,
    });

    // 非同期の即時実行関数でダウンロード処理をラップ
    (async () => {
      const maxRetries = 3;
      const retryDelay = 5000; // 5秒

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await processDownloadJob(job); // タイトル取得、ダウンロード、移動を含む

          job.status = "completed";
          job.progress.eta = "完了";
          broadcast("status_update", {
            id: job.id,
            status: job.status,
            progress: job.progress,
          });
          cleanupAndContinue(job);
          return; // 成功したのでリトライせず終了
        } catch (error) {
          console.error(
            `[Attempt ${attempt}/${maxRetries}] Job ${job.id} failed: ${error.message}`,
          );

          if (attempt === maxRetries) {
            job.status = "error";
            job.progress.eta = "エラー";
            broadcast("status_update", {
              id: job.id,
              status: "error",
              progress: job.progress,
              error: error.message,
            });
            cleanupAndContinue(job);
          } else {
            job.progress.eta = `${retryDelay / 1000}秒後に再試行... (${attempt})`;
            broadcast("status_update", {
              id: job.id,
              status: "downloading",
              progress: job.progress,
            });
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
          }
        }
      }
    })();
  }
}

async function processDownloadJob(job) {
  const ytDlpPath = path.join(__dirname, "yt-dlp.exe");

  // 設定ファイルを先に読み込む

  let settings = {};

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const configData = await fs.promises.readFile(CONFIG_PATH, "utf-8");

      settings = JSON.parse(configData);
    }
  } catch (error) {
    console.error("ダウンロード処理中に設定の読み込みに失敗しました:", error);

    // 設定が読めなくても処理は続行する
  }

  // 1. まずタイトルを取得

  try {
    const title = await getTitle(
      ytDlpPath,
      job.url,
      job.cookieFile?.path,
      settings,
    );

    job.title = title;

    broadcast("title_update", { id: job.id, title: job.title });
  } catch (error) {
    // タイトル取得はリトライ不能なエラーとして扱い、すぐに失敗させる

    throw new Error(`タイトル取得失敗: ${error.message}`);
  }

  // 2. 保存パスを決定する
  const customSavePath =
    job.options.savePath && job.options.savePath.trim() !== ""
      ? job.options.savePath
      : null;
  const finalMovieDir = customSavePath || movieDir;
  const finalThumbnailDir = customSavePath
    ? path.join(customSavePath, "サムネイル")
    : thumbnailDir;
  const finalTempDir = customSavePath || downloadsDir;

  // 必要に応じて保存先ディレクトリを作成
  if (customSavePath) {
    if (!fs.existsSync(finalMovieDir)) {
      try {
        fs.mkdirSync(finalMovieDir, { recursive: true });
      } catch (error) {
        throw new Error(
          `カスタム保存先ディレクトリの作成に失敗しました ${finalMovieDir}: ${error.message}`,
        );
      }
    }

    if (job.options.downloadThumb && !fs.existsSync(finalThumbnailDir)) {
      try {
        fs.mkdirSync(finalThumbnailDir, { recursive: true });
      } catch (error) {
        throw new Error(
          `カスタムサムネイル保存先ディレクトリの作成に失敗しました ${finalThumbnailDir}: ${error.message}`,
        );
      }
    }
  }

  // このPromiseがダウンロードとファイル移動のプロセス全体をカプセル化する
  return new Promise((resolve, reject) => {
    const args = buildArgs(
      job,
      {
        movieDir: finalMovieDir,
        thumbnailDir: finalThumbnailDir,
        tempDir: finalTempDir,
      },
      settings,
    );
    const ytDlp = spawn(ytDlpPath, args);

    let stderrOutput = "";
    let stdoutBuffer = "";

    ytDlp.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/[\r\n]/);
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim() === "") continue;
        const progressMatch = line.match(/\[download\]\s+([\d.]+)%/);
        if (progressMatch) {
          job.progress = {
            percentage: parseFloat(progressMatch[1]),
            totalSize: progressMatch[2],
            speed: progressMatch[3],
            eta: progressMatch[4],
          };
          broadcast("progress_update", { id: job.id, progress: job.progress });
        }
      }
    });

    ytDlp.stderr.on("data", (data) => {
      const errorMsg = data.toString().trim();
      stderrOutput += errorMsg + "\n";
      console.error(`yt-dlp stderr: ${errorMsg}`);
    });

    ytDlp.on("close", async (code) => {
      if (code === 0) {
        const isProcessingExtras =
          job.options.commentOptions && job.options.commentOptions !== "none";

        // コメント/チャットのダウンロードが要求されている場合、ステータスを更新
        if (isProcessingExtras) {
          job.progress.eta = "コメント/チャットを整理中...";
          broadcast("status_update", {
            id: job.id,
            status: "downloading",
            progress: job.progress,
          });
        }

        // ==========================================================
        // ★ ここから：仮置きフォルダへの振り分け（新規追加）
        // ==========================================================

        const files = fs.readdirSync(finalMovieDir);

        const infoFile = files.find((f) => f.endsWith(".info.json"));
        const chatFile = files.find((f) => f.endsWith(".live_chat.json"));

        // --- 仮置きフォルダを作成 ---
        const PENDING_CHAT_DIR = path.join(__dirname, "syorimachi_folder");
        fs.mkdirSync(PENDING_CHAT_DIR, { recursive: true });

        // ジョブごとのフォルダ名を作成
        const jobName = `job_${Date.now()}`;
        const jobPendingDir = path.join(PENDING_CHAT_DIR, jobName);
        fs.mkdirSync(jobPendingDir, { recursive: true });

        console.log("仮置きジョブフォルダ:", jobPendingDir);

        // --- info.json / live_chat.json を仮置きへ移動 ---
        if (infoFile) {
          const src = path.join(finalMovieDir, infoFile);
          const dest = path.join(jobPendingDir, infoFile);
          fs.renameSync(src, dest);
          console.log("仮置きへ移動（info）:", dest);
        }

        if (chatFile) {
          const src = path.join(finalMovieDir, chatFile);
          const dest = path.join(jobPendingDir, chatFile);
          fs.renameSync(src, dest);
          console.log("仮置きへ移動（chat）:", dest);
        }

        // ==========================================================
        // ★ ここまで
        // ==========================================================

        // その後で通常の整理処理（動画など）
        await moveExtraFiles(finalMovieDir);

        resolve(); // すべて成功
      } else {
        reject(
          new Error(
            `yt-dlpがエラーコード${code}で終了しました。Stderr: ${stderrOutput}`,
          ),
        );
      }
    });

    ytDlp.on("error", (err) => {
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
function buildArgs(job, paths, settings) {
  const { url, options } = job;
  const { movieDir, thumbnailDir, tempDir } = paths;

  let args = [
    url,
    // -o にはファイル名パターンのみを指定
    "-o",
    "%(upload_date)s-%(title)s.%(ext)s",

    // -P で各ファイルの保存先を指定
    "-P",
    `home:${movieDir}`,
    "-P",
    `temp:${tempDir}`,

    "--embed-thumbnail",
    "--add-metadata",
    "--ignore-errors",
    "--retries",
    "infinite",
    "--progress", // 進捗情報を強制的に表示させる
    "--no-color", // 色コードを無効化
    "--newline", // 進捗情報を改行で区切る
  ];

  if (options.format) args.push("-f", options.format);
  if (options.downloadThumb) {
    args.push("--write-thumbnail");
    // サムネイルの保存先を指定
    args.push("-P", `thumbnail:${thumbnailDir}`);
  }
  if (options.saveHistory)
    args.push("--download-archive", path.join(__dirname, "finished.txt"));

  // --- Cookie関連の引数を決定 ---
  if (job.cookieFile) {
    // 1. 手動でのファイル指定が最優先
    args.push("--cookies", job.cookieFile.path);
  } else if (settings && settings.selectedBrowser) {
    // 2. 設定ファイルでのブラウザ指定
    args.push("--cookies-from-browser", settings.selectedBrowser);
  }
  // 3. どちらもなければCookie関連の引数は追加しない

  if (
    options.concurrentFragments &&
    parseInt(options.concurrentFragments) > 0
  ) {
    args.push("--concurrent-fragments", options.concurrentFragments);
  }
  if (options.drmProtect) {
    args.push(
      "--add-header",
      "youtube:player-client=default,-tv,web_safari,web_embedded",
    );
  }

  // --- コメント関連の引数を追加 ---
  if (
    options.commentOptions === "comments" ||
    options.commentOptions === "both"
  ) {
    args.push("--get-comments");
  }
  if (options.commentOptions === "sub" || options.commentOptions === "both") {
    args.push("--write-sub");
  }

  return args;
}

// タイトルを取得するヘルパー関数

function getTitle(ytDlpPath, url, cookiePath, settings) {
  return new Promise((resolve, reject) => {
    const args = [url, "--get-title", "--no-warnings"];
    if (cookiePath) {
      args.push("--cookies", cookiePath);
    } else if (settings && settings.selectedBrowser) {
      args.push("--cookies-from-browser", settings.selectedBrowser);
    }
    console.log(
      `[yt-dlp Title Command] Path: ${ytDlpPath}, Args: ${args.join(" ")}`,
    );
    const ytDlpProcess = spawn(ytDlpPath, args);
    const stdoutChunks = [];
    const stderrChunks = [];
    ytDlpProcess.stdout.on("data", (data) => {
      stdoutChunks.push(data);
    });
    ytDlpProcess.stderr.on("data", (data) => {
      stderrChunks.push(data);
    });

    ytDlpProcess.on("close", (code) => {
      const stdoutBuffer = Buffer.concat(stdoutChunks);
      const title = iconv.decode(stdoutBuffer, "cp932");
      if (code === 0 && title.trim() !== "") {
        resolve(title.trim());
      } else {
        const stderrBuffer = Buffer.concat(stderrChunks);
        const stderr = iconv.decode(stderrBuffer, "cp932");
        reject(new Error(`yt-dlp exited with code ${code}. Stderr: ${stderr}`));
      }
    });

    ytDlpProcess.on("error", (err) => {
      reject(err);
    });
  });
}

// ダウンロード完了後に余分なファイルを仕分けるヘルパー関数

async function moveExtraFiles(sourceDir) {
  try {
    const files = await fs.promises.readdir(sourceDir);

    for (const file of files) {
      const oldPath = path.join(sourceDir, file);

      try {
        const stat = await fs.promises.stat(oldPath);

        if (!stat.isFile()) continue;
      } catch (e) {
        // ファイルが存在しないなどの場合はスキップ

        if (e.code === "ENOENT") continue;

        throw e;
      }

      let newPath;

      if (file.endsWith(".info.json")) {
        newPath = path.join(commentsDir, file);
      } else if (file.endsWith(".live_chat.json")) {
        newPath = path.join(liveChatDir, file);
      }

      if (newPath) {
        try {
          await fs.promises.rename(oldPath, newPath);

          console.log(`Moved ${file} to ${newPath}`);
        } catch (err) {
          console.error(`Failed to move ${file}: ${err}`);

          // ファイルの移動に失敗しても、エラーをスローせずに処理を続行
        }
      }
    }
  } catch (err) {
    console.error(`Error while sorting extra files in ${sourceDir}: ${err}`);

    // ここでもエラーをスローしない
  }
}

// ==================================================
// ■ ライブチャット取得API（新規）
// ==================================================
app.get("/api/live-chat/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;

    // 保存先（あなたの環境と一致）
    const liveChatPath = path.join(
      __dirname,
      "downloads",
      "ライブチャット",
      filename,
    );

    if (!fs.existsSync(liveChatPath)) {
      console.error("Live chat not found:", liveChatPath);
      return res.status(404).json({ error: "ライブチャットが見つかりません" });
    }

    // NDJSON（1行=1JSON）としてそのまま返す
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    fs.createReadStream(liveChatPath).pipe(res);
  } catch (e) {
    console.error("Failed to serve live chat:", e);
    res.status(500).json({ error: "ライブチャットの取得に失敗しました" });
  }
});

// ==================================================
// ■ ローカル動画一覧API（プレイヤー用）
// ==================================================
// ==================================================
// ■ ライブチャット取得API（★これを追加）
// ==================================================
app.get("/api/live-chat/:videoFile", async (req, res) => {
  try {
    const videoFile = decodeURIComponent(req.params.videoFile);

    // 拡張子を置き換えてチャットファイル名を作る
    const base = videoFile.replace(/\.(mp4|mkv|webm|mov)$/i, "");
    const chatFile = path.join(
      __dirname,
      "downloads",
      "ライブチャット",
      `${base}.live_chat.json`,
    );

    if (!fs.existsSync(chatFile)) {
      return res
        .status(404)
        .json({ error: "対応するライブチャットがありません" });
    }

    const data = await fs.promises.readFile(chatFile, "utf8");
    res.type("application/json").send(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "読み込みに失敗しました" });
  }
});

app.get("/api/local-videos", async (req, res) => {
  try {
    const movieDir = path.join(__dirname, "downloads", "動画");
    const thumbDir = path.join(__dirname, "downloads", "サムネイル");

    const files = await fs.promises.readdir(movieDir);

    // 再生可能な動画拡張子
    const videoExt = [".mp4", ".mkv", ".webm", ".mov"];

    const videos = [];

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!videoExt.includes(ext)) continue;

      const base = path.parse(file).name;

      // 対応するサムネイルを探す
      let thumb = null;
      const possibleThumbs = [`${base}.jpg`, `${base}.png`, `${base}.webp`];

      for (const t of possibleThumbs) {
        const tpath = path.join(thumbDir, t);
        if (fs.existsSync(tpath)) {
          thumb = `/downloads/サムネイル/${encodeURIComponent(t)}`;
          break;
        }
      }

      videos.push({
        title: base,
        video: `/downloads/動画/${encodeURIComponent(file)}`,
        thumb: thumb || null,
        filename: file,
        mtime: (await fs.promises.stat(path.join(movieDir, file))).mtimeMs,
      });
    }

    // 新しい順にソート
    videos.sort((a, b) => b.mtime - a.mtime);

    res.json(videos);
  } catch (e) {
    console.error("Failed to scan local videos:", e);
    res.status(500).json({ error: "動画一覧の取得に失敗しました。" });
  }
});

// ■ サーバーの起動
// --------------------------------------------------
app.listen(port, () => {
  console.log(`サーバーが http://localhost:${port} で起動しました。`);
});
