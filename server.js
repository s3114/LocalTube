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
const { exec } = require("child_process");

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
const fallbackThumbnailDir = path.join(downloadsDir, "仮サムネイル");
if (!fs.existsSync(fallbackThumbnailDir)) fs.mkdirSync(fallbackThumbnailDir);
const commentsDir = path.join(downloadsDir, "コメント");
if (!fs.existsSync(commentsDir)) fs.mkdirSync(commentsDir);
const liveChatDir = path.join(downloadsDir, "ライブチャット");
if (!fs.existsSync(liveChatDir)) fs.mkdirSync(liveChatDir);
const subtitleDir = path.join(downloadsDir, "字幕");
if (!fs.existsSync(subtitleDir)) fs.mkdirSync(subtitleDir);

const PENDING_CHAT_DIR = path.join(__dirname, "syorimachi_folder");
fs.mkdirSync(PENDING_CHAT_DIR, { recursive: true });

let processingQueue = [];
let isProcessing = false;

fs.watch(PENDING_CHAT_DIR, (eventType, filename) => {
  if (!filename) return;

  const jobPath = path.join(PENDING_CHAT_DIR, filename);

  // job_xxxxx フォルダのみ対象
  if (
    filename.startsWith("job_") &&
    fs.existsSync(jobPath) &&
    fs.statSync(jobPath).isDirectory()
  ) {
    console.log(`[QUEUE] 新ジョブ検出: ${filename}`);

    // 既にキューにない場合のみ追加
    if (!processingQueue.includes(jobPath) && !isProcessing) {
      processingQueue.push(jobPath);
      processQueue();
      setTimeout(processQueue, 300);
    }
  }
});

async function processQueue() {
  if (isProcessing) return;
  if (processingQueue.length === 0) return;

  isProcessing = true;
  const jobPath = processingQueue.shift(); // 先頭を取得

  console.log(`[QUEUE] 処理開始: ${jobPath}`);

  try {
    // ① まずバッチ処理を実行（★重要：移動より先）
    await runBatchScript(
      `node "${path.join(__dirname, "メンバーバッチ保存.js")}" "${jobPath}"`,
    );

    await runBatchScript(
      `node "${path.join(__dirname, "メンバー絵文字保存.js")}" "${jobPath}"`,
    );

    // ② ★バッチ処理が終わってから整理（A）
    await moveExtraFiles(jobPath);

    console.log(`[QUEUE] 完了: ${jobPath}`);
  } catch (err) {
    console.error(`[QUEUE] エラー: ${jobPath}`, err);

    // ★★★ UI にエラー通知 ★★★
    broadcast("status_update", {
      id: path.basename(jobPath),
      status: "error",
      progress: {
        percent: 0,
        eta: "処理エラー",
      },
    });
  }

  isProcessing = false;

  // 次があれば自動で続行
  processQueue();
}

function runBatchScript(command) {
  return new Promise((resolve, reject) => {
    console.log(`[EXEC] ${command}`);

    const proc = exec(command, { shell: "powershell.exe" });

    proc.stdout.on("data", (data) => console.log(data.toString()));
    proc.stderr.on("data", (data) => console.error(data.toString()));

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`スクリプト終了コード: ${code}`));
    });
  });
}

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

async function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { selectedBrowser: "", localVideoDirs: [] };
    }

    const configData = await fs.promises.readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(configData);

    return {
      selectedBrowser: parsed.selectedBrowser || "",
      localVideoDirs: Array.isArray(parsed.localVideoDirs)
        ? parsed.localVideoDirs
        : [],
    };
  } catch (error) {
    console.error("設定ファイル読み込みエラー:", error);
    return { selectedBrowser: "", localVideoDirs: [] };
  }
}

async function saveConfig(config) {
  const normalized = {
    selectedBrowser: config.selectedBrowser || "",
    localVideoDirs: Array.isArray(config.localVideoDirs)
      ? config.localVideoDirs
      : [],
  };

  await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

function normalizeDirList(dirList) {
  if (!Array.isArray(dirList)) return [];

  return dirList
    .map((dir) => String(dir || "").trim())
    .filter(Boolean)
    .filter((dir, idx, arr) => arr.indexOf(dir) === idx);
}

function isPathWithin(targetPath, baseDir) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(baseDir);
  return (
    resolvedTarget === resolvedBase ||
    resolvedTarget.startsWith(resolvedBase + path.sep)
  );
}

async function getLocalVideoDirs() {
  const config = await loadConfig();
  const extraDirs = normalizeDirList(config.localVideoDirs);
  return [movieDir, ...extraDirs].filter(
    (dir, idx, arr) => arr.indexOf(dir) === idx,
  );
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    });
  });
}

let ffmpegCommandCache;
async function resolveFfmpegCommand() {
  if (typeof ffmpegCommandCache !== "undefined") return ffmpegCommandCache;

  const candidates = ["ffmpeg", "ffmpeg.exe"];
  for (const cmd of candidates) {
    try {
      await runCommand(cmd, ["-version"]);
      ffmpegCommandCache = cmd;
      return ffmpegCommandCache;
    } catch (_error) {
      // 次候補を試す
    }
  }

  ffmpegCommandCache = null;
  return ffmpegCommandCache;
}

function getFallbackThumbPath(videoPath) {
  const hash = crypto.createHash("sha1").update(videoPath).digest("hex").slice(0, 12);
  const baseName = path
    .parse(videoPath)
    .name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return path.join(fallbackThumbnailDir, `${baseName}_${hash}.png`);
}

function findExistingThumbnailPath(videoPath) {
  const thumbExts = [".jpg", ".png", ".webp", ".jpeg"];
  const sourceDir = path.dirname(videoPath);
  const base = path.parse(videoPath).name;

  const candidates = [];
  for (const tExt of thumbExts) {
    candidates.push(path.join(sourceDir, `${base}${tExt}`));
  }

  if (path.resolve(sourceDir) === path.resolve(movieDir)) {
    for (const tExt of thumbExts) {
      candidates.push(path.join(thumbnailDir, `${base}${tExt}`));
    }
  }

  candidates.push(getFallbackThumbPath(videoPath));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

const fallbackThumbnailJobs = new Map();

async function ensureFallbackThumbnail(videoPath) {
  const outputPath = getFallbackThumbPath(videoPath);
  if (fs.existsSync(outputPath)) return outputPath;

  if (!fallbackThumbnailJobs.has(outputPath)) {
    const job = (async () => {
      const ffmpegCmd = await resolveFfmpegCommand();
      if (!ffmpegCmd) {
        throw new Error("ffmpeg が見つかりません。");
      }

      const attemptArgs = [
        [
          "-y",
          "-loglevel",
          "error",
          "-ss",
          "00:00:01.500",
          "-i",
          videoPath,
          "-an",
          "-sn",
          "-dn",
          "-frames:v",
          "1",
          "-f",
          "image2",
          outputPath,
        ],
        [
          "-y",
          "-loglevel",
          "error",
          "-i",
          videoPath,
          "-an",
          "-sn",
          "-dn",
          "-frames:v",
          "1",
          "-f",
          "image2",
          outputPath,
        ],
      ];

      let lastError = null;
      for (const args of attemptArgs) {
        try {
          await runCommand(ffmpegCmd, args);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError) {
        throw lastError;
      }

      if (!fs.existsSync(outputPath)) {
        throw new Error("サムネイル生成後のファイルが見つかりません。");
      }

      return outputPath;
    })();

    fallbackThumbnailJobs.set(outputPath, job);
    job.then(
      () => fallbackThumbnailJobs.delete(outputPath),
      () => fallbackThumbnailJobs.delete(outputPath),
    );
  }

  return fallbackThumbnailJobs.get(outputPath);
}

// 設定を読み込むAPI
app.get("/api/settings", async (req, res) => {
  try {
    const settings = await loadConfig();
    res.json(settings);
  } catch (error) {
    console.error("設定の読み込みに失敗しました:", error);
    res.status(500).json({ error: "設定の読み込みに失敗しました。" });
  }
});

// 設定を保存するAPI
app.post("/api/settings", async (req, res) => {
  try {
    const { browser, localVideoDirs } = req.body || {};
    if (typeof browser === "undefined" && typeof localVideoDirs === "undefined") {
      return res.status(400).json({ error: "無効なリクエストです。" });
    }

    const currentConfig = await loadConfig();

    if (typeof browser !== "undefined") {
      currentConfig.selectedBrowser = browser;
    }

    if (typeof localVideoDirs !== "undefined") {
      currentConfig.localVideoDirs = normalizeDirList(localVideoDirs);
    }

    const savedConfig = await saveConfig(currentConfig);

    console.log("設定を保存しました:", savedConfig);
    res.json({ message: "設定を保存しました。", settings: savedConfig });
  } catch (error) {
    console.error("設定の保存に失敗しました:", error);
    res.status(500).json({ error: "設定の保存に失敗しました。" });
  }
});

// 履歴を削除するAPI
app.post("/api/clear-history", async (req, res) => {
  try {
    const historyPath = path.join(__dirname, "finished.txt");
    await fs.promises.writeFile(historyPath, "", "utf-8");
    console.log("ダウンロード履歴を削除しました。");
    res.json({ message: "履歴を削除しました。" });
  } catch (error) {
    console.error("履歴の削除に失敗しました:", error);
    res.status(500).json({ error: "履歴の削除に失敗しました。" });
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

    console.log(
      `[yt-dlp getUrlsFromInput Command] Path: ${ytDlpPath}, Args: ${args.join(" ")}`,
    );
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
            job.progress.eta = `${error.message}`;
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
    console.log(
      `[yt-dlp Download Command] Path: ${ytDlpPath}, Args: ${args.join(" ")}`,
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

        // ==============================
        // ① info.json / live_chat.json を検出
        // ==============================
        const files = fs.readdirSync(finalMovieDir);

        const infoFile = files.find((f) => f.endsWith(".info.json"));
        const chatFile = files.find((f) => f.endsWith(".live_chat.json"));

        // 仮置きジョブフォルダを作成
        const jobPendingDir = path.join(PENDING_CHAT_DIR, `job_${Date.now()}`);
        fs.mkdirSync(jobPendingDir, { recursive: true });

        console.log("仮置きジョブフォルダ:", jobPendingDir);

        // ==============================
        // ② まず両方とも仮置きへ移動（★キューより先）
        // ==============================

        if (infoFile) {
          const src = path.join(finalMovieDir, infoFile);
          const dest = path.join(jobPendingDir, infoFile);

          if (fs.existsSync(src)) {
            // ===== ★ ここで info.json を読み込んで書き換える（仮置き直前） =====
            // ===== ★ ここで info.json を読み込んで書き換える（仮置き直前） =====
            try {
              const infoRaw = fs.readFileSync(src, "utf-8");
              const infoObj = JSON.parse(infoRaw);

              let channelThumbUrl = null;

              // ★【唯一の正解】チャンネルURLに対して yt-dlp -J を実行
              if (typeof infoObj.channel_url === "string") {
                try {
                  const { execSync } = require("child_process");

                  console.log(
                    "[INFO EDIT] チャンネル情報を取得:",
                    infoObj.channel_url,
                  );

                  let channelArgs = [
                    "-J",
                    "--no-playlist",
                    "--playlist-items",
                    "0",
                  ];

                  // ★ 先にCookieを入れる（重要）
                  if (job.cookieFile?.path) {
                    channelArgs.push("--cookies", job.cookieFile.path);
                  } else if (settings && settings.selectedBrowser) {
                    channelArgs.push(
                      "--cookies-from-browser",
                      settings.selectedBrowser,
                    );
                  }

                  // ★ 最後にURLを追加（これが正しい並び）
                  channelArgs.push(infoObj.channel_url);

                  // ③ どちらも無ければ Cookie 引数なし
                  const fullCommand = `"${path.join(__dirname, "yt-dlp.exe")}" ${channelArgs
                    .map((a) => `"${a}"`)
                    .join(" ")}`;
                  console.log(
                    `[yt-dlp Channel Info Command] Command: ${fullCommand}`,
                  );
                  const channelJson = execSync(fullCommand, {
                    encoding: "utf-8",
                    timeout: 3000,
                  });

                  // ===== ★ チャンネル情報JSONを丸ごと保存 ★ =====
                  try {
                    const channelSaveDir = path.join(
                      downloadsDir,
                      "チャンネル",
                    );

                    // フォルダが無ければ作成
                    fs.mkdirSync(channelSaveDir, { recursive: true });

                    const channelObj = JSON.parse(channelJson);

                    // info.json と同じベース名で保存
                    const channelJsonPath = path.join(
                      channelSaveDir,
                      channelObj.channel_id + ".channel.json",
                    );

                    fs.writeFileSync(channelJsonPath, channelJson, "utf-8");

                    console.log(
                      "[INFO EDIT] チャンネルJSONを保存:",
                      channelJsonPath,
                    );
                  } catch (err) {
                    console.error(
                      "[INFO EDIT] チャンネルJSONの保存に失敗:",
                      err.message,
                    );
                  }
                  // ===============================================

                  const channelObj = JSON.parse(channelJson);

                  // ★★★ ここから：avatar_uncropped を明示的に取得 ★★★
                  let foundAvatar = null;

                  if (Array.isArray(channelObj.thumbnails)) {
                    // ① まず avatar_uncropped を探す（最優先）
                    foundAvatar = channelObj.thumbnails.find(
                      (t) => t.id === "avatar_uncropped",
                    );

                    // ② 万が一なければ、preference が一番高いものを探す（保険）
                    if (!foundAvatar) {
                      foundAvatar = channelObj.thumbnails.reduce(
                        (best, cur) => {
                          if (!best) return cur;
                          if (
                            typeof cur.preference === "number" &&
                            typeof best.preference === "number"
                          ) {
                            return cur.preference > best.preference
                              ? cur
                              : best;
                          }
                          return best;
                        },
                        null,
                      );
                    }

                    // ③ それでもダメなら先頭（最終フォールバック）
                    if (!foundAvatar && channelObj.thumbnails.length > 0) {
                      foundAvatar = channelObj.thumbnails[0];
                    }
                  }

                  if (foundAvatar && foundAvatar.url) {
                    channelThumbUrl = foundAvatar.url;
                    console.log(
                      "[INFO EDIT] channel_thumbnail（avatar_uncropped）を取得:",
                      channelThumbUrl,
                    );
                  }
                } catch (err) {
                  console.error(
                    "[INFO EDIT] チャンネル情報取得に失敗:",
                    err.message,
                  );
                }
              }

              // ★ 取得できた場合のみ追加（ここ以外からは取らない）
              if (channelThumbUrl) {
                infoObj.channel_thumbnail = channelThumbUrl;
              } else {
                console.log(
                  "[INFO EDIT] channel_thumbnail を取得できませんでした",
                );
              }

              // 上書き保存（同じパスに書き戻す）
              fs.writeFileSync(src, JSON.stringify(infoObj, null, 2), "utf-8");
            } catch (e) {
              console.error("[INFO EDIT] info.json の書き換えに失敗:", e);
            }

            fs.renameSync(src, dest);
            console.log("仮置きへ移動（info）:", dest);
          } else {
            console.warn("info.json が見つかりません:", src);
          }
        }

        if (chatFile) {
          const src = path.join(finalMovieDir, chatFile);
          const dest = path.join(jobPendingDir, chatFile);

          if (fs.existsSync(src)) {
            fs.renameSync(src, dest);
            console.log("仮置きへ移動（chat）:", dest);
          } else {
            console.warn("live_chat.json が見つかりません:", src);
          }
        }

        // ==============================
        // ③ 両方そろっているか最終チェック
        // ==============================
        const hasInfo = infoFile
          ? fs.existsSync(path.join(jobPendingDir, infoFile))
          : false;

        const hasChat = chatFile
          ? fs.existsSync(path.join(jobPendingDir, chatFile))
          : false;

        if (!infoFile) {
          console.warn("[QUEUE] info.json が無いため登録不可:", jobPendingDir);

          // ★★★ ここで UI に「完了」を通知 ★★★
          broadcast("status_update", {
            id: job.id,
            status: "completed",
            progress: {
              percent: 100,
              eta: "スキップ完了（info.jsonなし）",
            },
          });

          resolve(); // ★ 次のダウンロードを開始するためにPromiseを解決
          return;
        }

        // ==============================
        // ④ ここで初めてキューに登録（★超重要）
        // ==============================
        processingQueue.push(jobPendingDir);
        setTimeout(processQueue, 300);

        // ★★★ UIに「完了」を必ず通知 ★★★
        broadcast("status_update", {
          id: job.id,
          status: "completed",
          progress: {
            percent: 100,
            eta: "完了",
          },
        });

        resolve(); // yt-dlp 処理自体は成功扱い
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

  if (options.format && !url.includes("abema.tv"))
    args.push("-f", options.format);
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
      } else if (file.endsWith(".vtt") || file.endsWith(".srt")) {
        newPath = path.join(subtitleDir, file);
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
  try {
    if (sourceDir.startsWith(PENDING_CHAT_DIR)) {
      console.log(`[A] 仮置きジョブフォルダを削除: ${sourceDir}`);
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[A] 仮置きフォルダ削除に失敗: ${sourceDir}`, err);
  }
}

// ==================================================
// ■ ライブチャット取得API（拡張子あり／なし 両対応版）
// ==================================================
app.get("/api/live-chat/:videoFile", async (req, res) => {
  try {
    const videoFile = decodeURIComponent(req.params.videoFile);

    const chatDir = path.join(__dirname, "downloads", "ライブチャット");

    // ① まず「受け取った値そのまま」で探す
    let chatFile = path.join(chatDir, videoFile);

    // ② なければ ".live_chat.json" を補完して探す
    if (!fs.existsSync(chatFile)) {
      const withExt = `${videoFile}.live_chat.json`;
      const altPath = path.join(chatDir, withExt);

      console.log("[LIVE CHAT] primary not found, trying:", altPath);

      if (fs.existsSync(altPath)) {
        chatFile = altPath;
      }
    }

    console.log("[LIVE CHAT] final path:", chatFile);

    if (!fs.existsSync(chatFile)) {
      console.error("[LIVE CHAT] Not found:", chatFile);
      return res
        .status(404)
        .json({ error: "対応するライブチャットがありません" });
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    fs.createReadStream(chatFile).pipe(res);
  } catch (e) {
    console.error("[LIVE CHAT] Error:", e);
    res.status(500).json({ error: "ライブチャットの取得に失敗しました" });
  }
});

app.get("/info/:videoId", async (req, res) => {
  try {
    const videoId = decodeURIComponent(req.params.videoId);
    const commentDir = path.join(__dirname, "downloads", "コメント");

    console.log("[INFO] looking for base:", videoId);

    // フォルダ内を検索（前方一致）
    const files = await fs.promises.readdir(commentDir);
    const match = files.find(
      (f) => f.startsWith(videoId) && f.endsWith(".info.json"),
    );

    if (!match) {
      console.error("[INFO] Not found for:", videoId);
      return res.status(404).json({ error: "info.json が見つかりません" });
    }

    const infoPath = path.join(commentDir, match);
    console.log("[INFO] serving:", infoPath);

    res.type("application/json; charset=utf-8");
    res.sendFile(infoPath);
  } catch (e) {
    console.error("Failed to serve info.json:", e);
    res.status(500).json({ error: "info.json の取得に失敗しました" });
  }
});

app.get("/api/local-media", async (req, res) => {
  try {
    const type = req.query.type;
    const targetPath = String(req.query.path || "");

    if (!targetPath || !["video", "thumb"].includes(type)) {
      return res.status(400).json({ error: "無効なリクエストです。" });
    }

    const allowedVideoDirs = await getLocalVideoDirs();
    const allowedThumbDirs = [thumbnailDir, fallbackThumbnailDir, ...allowedVideoDirs];
    const allowedDirs = type === "video" ? allowedVideoDirs : allowedThumbDirs;

    const isAllowed = allowedDirs.some((dir) => isPathWithin(targetPath, dir));
    if (!isAllowed) {
      return res.status(403).json({ error: "アクセスが許可されていません。" });
    }

    const ext = path.extname(targetPath).toLowerCase();
    const videoExt = [".mp4", ".mkv", ".webm", ".mov"];
    const thumbExt = [".jpg", ".jpeg", ".png", ".webp"];

    if (type === "video" && !videoExt.includes(ext)) {
      return res.status(400).json({ error: "無効な動画ファイルです。" });
    }

    if (type === "thumb" && !thumbExt.includes(ext)) {
      return res.status(400).json({ error: "無効な画像ファイルです。" });
    }

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: "ファイルが見つかりません。" });
    }

    res.sendFile(path.resolve(targetPath));
  } catch (e) {
    console.error("Failed to serve local media:", e);
    res.status(500).json({ error: "ローカルメディアの取得に失敗しました。" });
  }
});

app.get("/api/local-thumb-fallback", async (req, res) => {
  try {
    const videoPath = String(req.query.videoPath || "");
    if (!videoPath) {
      return res.status(400).json({ error: "videoPath が必要です。" });
    }

    const allowedVideoDirs = await getLocalVideoDirs();
    const isAllowed = allowedVideoDirs.some((dir) => isPathWithin(videoPath, dir));
    if (!isAllowed) {
      return res.status(403).json({ error: "アクセスが許可されていません。" });
    }

    const ext = path.extname(videoPath).toLowerCase();
    const videoExt = [".mp4", ".mkv", ".webm", ".mov"];
    if (!videoExt.includes(ext)) {
      return res.status(400).json({ error: "無効な動画ファイルです。" });
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: "動画が見つかりません。" });
    }

    const existingThumbPath = findExistingThumbnailPath(videoPath);
    const thumbPath = existingThumbPath || (await ensureFallbackThumbnail(videoPath));
    res.sendFile(path.resolve(thumbPath));
  } catch (error) {
    console.error("Fallback thumbnail creation failed:", error);
    res.redirect("/none_icon.jpg");
  }
});

app.get("/api/local-videos", async (req, res) => {
  try {
    const sourceDirs = await getLocalVideoDirs();

    const videoExt = [".mp4", ".mkv", ".webm", ".mov"];
    const videos = [];

    for (const sourceDir of sourceDirs) {
      if (!fs.existsSync(sourceDir)) continue;

      const files = await fs.promises.readdir(sourceDir);

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!videoExt.includes(ext)) continue;

        const fullPath = path.join(sourceDir, file);
        const base = path.parse(file).name;
        const thumbPath = findExistingThumbnailPath(fullPath);

        videos.push({
          title: base,
          video: `/api/local-media?type=video&path=${encodeURIComponent(fullPath)}`,
          thumb: thumbPath
            ? `/api/local-media?type=thumb&path=${encodeURIComponent(thumbPath)}`
            : `/api/local-thumb-fallback?videoPath=${encodeURIComponent(fullPath)}`,
          filename: file,
          mtime: (await fs.promises.stat(fullPath)).mtimeMs,
          sourceDir,
        });
      }
    }

    videos.sort((a, b) => b.mtime - a.mtime);

    res.json(videos);
  } catch (e) {
    console.error("Failed to scan local videos:", e);
    res.status(500).json({ error: "動画一覧の取得に失敗しました。" });
  }
});

// URLのアクセシビリティをチェックするAPI
app.get("/api/validate-url", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res
      .status(400)
      .json({ isValid: false, error: "URLが指定されていません。" });
  }

  try {
    const fetch = await import("node-fetch").then((mod) => mod.default); // Import node-fetch dynamically

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒のタイムアウト

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow", // リダイレクトを追跡
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      // 2xx のステータスコードは成功
      res.json({ isValid: true });
    } else {
      res.json({ isValid: false, error: `HTTPステータス: ${response.status}` });
    }
  } catch (error) {
    if (error.name === "AbortError") {
      res.json({
        isValid: false,
        error: "URLへの接続がタイムアウトしました。",
      });
    } else {
      console.error(`URL検証エラー (${url}):`, error);
      res.json({
        isValid: false,
        error: `URLに接続できません: ${error.message}`,
      });
    }
  }
});

// API to resolve a YouTube handle URL to a channel ID
app.post("/api/resolve-handle", async (req, res) => {
  const { url } = req.body;

  if (!url || !url.includes("youtube.com/@")) {
    return res
      .status(400)
      .json({ error: "有効なYouTubeハンドルURLを指定してください。" });
  }

  try {
    const fetch = await import("node-fetch").then((mod) => mod.default); // Ensure node-fetch is available

    // Fetch the YouTube page HTML
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout

    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === "AbortError") {
        console.error(`Fetch timeout for URL: ${url}`);
        return res
          .status(504)
          .json({ error: "YouTubeページへの接続がタイムアウトしました。" });
      }
      console.error(`Error fetching YouTube page for URL ${url}:`, fetchError);
      return res
        .status(500)
        .json({ error: "YouTubeページの取得に失敗しました。" });
    }

    if (!response.ok) {
      console.error(
        `Failed to fetch YouTube page. Status: ${response.status} for URL: ${url}`,
      );
      return res
        .status(response.status)
        .json({
          error: `YouTubeページの取得に失敗しました。ステータス: ${response.status}`,
        });
    }

    const html = await response.text();

    // Regex to find the canonical URL
    const canonicalRegex = /<link\s+rel="canonical"\s+href="([^"]+)">/;
    const canonicalMatch = html.match(canonicalRegex);

    if (!canonicalMatch || !canonicalMatch[1]) {
      console.error(`Canonical URL not found in HTML for URL: ${url}`);
      return res
        .status(404)
        .json({ error: "チャンネルの正規URLが見つかりませんでした。" });
    }

    const canonicalUrl = canonicalMatch[1];
    // Regex to extract the channel ID from the canonical URL
    const channelIdRegex = /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/;
    const channelIdMatch = canonicalUrl.match(channelIdRegex);

    if (!channelIdMatch || !channelIdMatch[1]) {
      console.error(
        `Channel ID not found in canonical URL: ${canonicalUrl} for original URL: ${url}`,
      );
      return res
        .status(404)
        .json({ error: "チャンネルIDを抽出できませんでした。" });
    }

    const channelId = channelIdMatch[1]; // This will be UCxxxxxxxxxxx
    res.json({ channelId });
  } catch (error) {
    console.error("Handle resolution error:", error);
    res
      .status(500)
      .json({ error: "ハンドルの解決中に予期せぬエラーが発生しました。" });
  }
});

// ■ Task Scheduler API
// --------------------------------------------------
app.post("/api/schedule/create", (req, res) => {
  const taskName = "YoutubeDL-AutoStart";
  const batPath = path.resolve(__dirname, "起動.bat");
  const psScriptPath = path.resolve(__dirname, "create_autostart_task.ps1");
  const resultFilePath = path.join(
    os.tmpdir(),
    `autostart_result_create_${Date.now()}.txt`,
  );

  // PowerShellスクリプトを呼び出すコマンドを構築
  const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}" -TaskName "${taskName}" -BatPath "${batPath}" -ResultFilePath "${resultFilePath}"`;
  console.log(`Executing PowerShell command: ${command}`);

  exec(command, { shell: "powershell.exe" }, async (error, stdout, stderr) => {
    // PowerShellスクリプトが結果ファイルのパスをstdoutに出力する
    // PowerShellスクリプトのstdoutには結果メッセージが直接出力されるようになった
    const resultContent = stdout.trim(); // stdoutを直接結果内容として使用

    // --- デバッグ用追加 ---
    console.log(`resultContent: '${resultContent}'`);
    console.log(`stdout type: ${typeof stdout}`);
    console.log(`stdout.length: ${stdout.length}`);
    console.log(
      `stdout startsWith 'SUCCESS:': ${stdout.startsWith("SUCCESS:")}`,
    );
    console.log(`stdout[0-8]: '${stdout.substring(0, 8)}'`);
    // --- デバッグ用追加 ---

    if (resultContent.startsWith("SUCCESS:")) {
      // 成功メッセージの整形
      // 日本語の schtasks 出力は不要なので、最初の行のみ抽出して整形する
      const messageLines = resultContent.split("\n");
      const cleanMessage = messageLines[0].replace("SUCCESS: ", "").trim();
      return res.json({ message: cleanMessage });
    } else if (resultContent.startsWith("ERROR:")) {
      const messageLines = resultContent.split("\n");
      const cleanMessage = messageLines[0].replace("ERROR: ", "").trim();

      return res.status(500).json({
        message: cleanMessage,
        error: resultContent.trim(),
      });
    } else if (error) {
      // exec自体がエラーを返した場合
      return res.status(500).json({
        message: "コマンド実行に失敗しました。",
        error: stderr || error.message,
      });
    } else {
      // 予期せぬ出力の場合（UACキャンセルなど）
      return res.status(500).json({
        message: "タスク作成リクエストの処理中に予期せぬ問題が発生しました。",
        error: `stdout: ${stdout}, stderr: ${stderr}`,
      });
    }
  });
});

app.post("/api/schedule/delete", (req, res) => {
  const taskName = "YoutubeDL-AutoStart";
  const psScriptPath = path.resolve(__dirname, "delete_autostart_task.ps1");
  const resultFilePath = path.join(
    os.tmpdir(),
    `autostart_result_delete_${Date.now()}.txt`,
  );

  const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}" -TaskName "${taskName}" -ResultFilePath "${resultFilePath}"`;
  console.log(`Executing PowerShell command: ${command}`);

  exec(command, { shell: "powershell.exe" }, async (error, stdout, stderr) => {
    // PowerShellスクリプトのstdoutには結果メッセージが直接出力されるようになった
    const resultContent = stdout.trim(); // stdoutを直接結果内容として使用

    // --- デバッグ用追加 ---
    console.log(`resultContent: '${resultContent}'`);
    console.log(`stdout type: ${typeof stdout}`);
    console.log(`stdout.length: ${stdout.length}`);
    console.log(
      `stdout startsWith 'SUCCESS:': ${stdout.startsWith("SUCCESS:")}`,
    );
    console.log(`stdout[0-8]: '${stdout.substring(0, 8)}'`);
    // --- デバッグ用追加 ---

    if (resultContent.startsWith("SUCCESS:")) {
      const messageLines = resultContent.split("\n");
      const cleanMessage = messageLines[0].replace("SUCCESS: ", "").trim();
      return res.json({ message: cleanMessage });
    } else if (resultContent.startsWith("ERROR:")) {
      const messageLines = resultContent.split("\n");
      const cleanMessage = messageLines[0].replace("ERROR: ", "").trim();
      return res.status(500).json({
        message: cleanMessage,
        error: resultContent.trim(),
      });
    } else if (error) {
      // exec自体がエラーを返した場合
      return res.status(500).json({
        message: "コマンド実行に失敗しました。",
        error: stderr || error.message,
      });
    } else {
      // 予期せぬ出力の場合（UACキャンセルなど）
      return res.status(500).json({
        message: "タスク削除リクエストの処理中に予期せぬ問題が発生しました。",
        error: `stdout: ${stdout}, stderr: ${stderr}`,
      });
    }
  });
});

// ■ サーバーの起動
// --------------------------------------------------
app.listen(port, () => {
  console.log(`サーバーが http://localhost:${port} で起動しました。`);
});
