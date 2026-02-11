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
const {
  normalizeDirList,
  normalizeConfig,
  loadConfig: loadConfigFromPath,
  saveConfig: saveConfigToPath,
} = require("./server/config-store");
const {
  registerSettingsWallpaperRoutes,
} = require("./server/routes/settings-wallpaper-routes");
const {
  registerLocalMediaRoutes,
} = require("./server/routes/local-media-routes");
const { registerInfoRoutes } = require("./server/routes/info-routes");
const { registerNetworkRoutes } = require("./server/routes/network-routes");
const { registerScheduleRoutes } = require("./server/routes/schedule-routes");
const {
  registerDownloadRoutes,
} = require("./server/routes/download-routes");
const { createSseBus } = require("./server/services/sse-bus");
const { apiOk, apiError } = require("./server/services/http-utils");
const {
  runCommand,
  runCommandCapture,
} = require("./server/services/process-utils");
const { createFetchWithTimeout } = require("./server/services/fetch-utils");
const {
  createJobQueueService,
} = require("./server/services/job-queue-service");
const {
  createDownloadJobService,
} = require("./server/services/download-job-service");
const {
  createDownloadQueueService,
} = require("./server/services/download-queue-service");
const {
  createInputUrlResolver,
} = require("./server/services/input-url-resolver");

// Expressアプリケーションのインスタンスを作成します。
const app = express();
const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000; // サーバーがリッスンするポート番号
const publicDir = process.env.YTDL_PUBLIC_DIR
  ? path.resolve(process.env.YTDL_PUBLIC_DIR)
  : path.join(__dirname, "public");

// ■ ミドルウェアの設定
// --------------------------------------------------
app.use(express.static(publicDir)); // 'public' ディレクトリ内の静的ファイルを提供
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
const provisionalInfoDir = path.join(downloadsDir, "仮コメント");
if (!fs.existsSync(provisionalInfoDir)) fs.mkdirSync(provisionalInfoDir);
const liveChatDir = path.join(downloadsDir, "ライブチャット");
if (!fs.existsSync(liveChatDir)) fs.mkdirSync(liveChatDir);
const subtitleDir = path.join(downloadsDir, "字幕");
if (!fs.existsSync(subtitleDir)) fs.mkdirSync(subtitleDir);

const pendingChatDir = path.join(__dirname, "syorimachi_folder");

// ■ ダウンロードキューと状態管理
// --------------------------------------------------
const jobHistory = new Map(); // 全てのジョブをIDで管理

// ■ SSE (Server-Sent Events) の設定
// --------------------------------------------------
let broadcast = () => {};

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

const sseBus = createSseBus({
  sseExpress,
  jobHistory,
  serverStartTime,
  measureNetworkMbps,
  apiOk,
});
broadcast = sseBus.broadcast;
sseBus.registerRoutes(app);

const jobQueueService = createJobQueueService({
  rootDir: __dirname,
  pendingChatDir,
  commentsDir,
  liveChatDir,
  subtitleDir,
  broadcast,
});

const downloadJobService = createDownloadJobService({
  fs,
  path,
  spawn,
  iconv,
  baseDir: __dirname,
  downloadsDir,
  movieDir,
  thumbnailDir,
  pendingChatDir,
  jobQueueService,
  broadcast,
  loadConfig,
});

const downloadQueueService = createDownloadQueueService({
  jobHistory,
  broadcast,
  processJob: (job) => downloadJobService.processDownloadJob(job),
});
const inputUrlResolver = createInputUrlResolver({
  spawn,
  path,
  baseDir: __dirname,
});
// --------------------------------------------------

// ■ 設定管理
// --------------------------------------------------
const CONFIG_PATH = process.env.YTDL_CONFIG_PATH
  ? path.resolve(process.env.YTDL_CONFIG_PATH)
  : path.join(__dirname, "config.json");

async function loadConfig() {
  return loadConfigFromPath(CONFIG_PATH);
}

async function saveConfig(config) {
  return saveConfigToPath(CONFIG_PATH, config);
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

const WALLPAPER_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];

function findWallpaperFilePath() {
  for (const ext of WALLPAPER_EXTS) {
    const candidate = path.join(publicDir, `wallpaper${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function getWallpaperPublicUrl() {
  const filePath = findWallpaperFilePath();
  if (!filePath) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mtime = fs.statSync(filePath).mtimeMs;
  return `/wallpaper${ext}?v=${Math.floor(mtime)}`;
}

const fetchWithTimeout = createFetchWithTimeout();

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

let ffprobeCommandCache;
async function resolveFfprobeCommand() {
  if (typeof ffprobeCommandCache !== "undefined") return ffprobeCommandCache;

  const candidates = ["ffprobe", "ffprobe.exe"];
  for (const cmd of candidates) {
    try {
      await runCommand(cmd, ["-version"]);
      ffprobeCommandCache = cmd;
      return ffprobeCommandCache;
    } catch (_error) {
      // 次候補を試す
    }
  }

  ffprobeCommandCache = null;
  return ffprobeCommandCache;
}

function getFallbackThumbPath(videoPath) {
  const hash = crypto
    .createHash("sha1")
    .update(videoPath)
    .digest("hex")
    .slice(0, 12);
  const baseName = path
    .parse(videoPath)
    .name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return path.join(fallbackThumbnailDir, `${baseName}_${hash}.png`);
}

function findExistingThumbnailPath(videoPath, includeFallback = true) {
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

  if (includeFallback) {
    candidates.push(getFallbackThumbPath(videoPath));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function makeSafeFileStem(input) {
  const safe = String(input || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return safe || "unknown";
}

function getProvisionalInfoPath(videoId) {
  const safeStem = makeSafeFileStem(videoId);
  const hash = crypto
    .createHash("sha1")
    .update(String(videoId))
    .digest("hex")
    .slice(0, 10);
  return path.join(provisionalInfoDir, `${safeStem}_${hash}.info.json`);
}

async function findLocalVideoPathById(videoId) {
  const sourceDirs = await getLocalVideoDirs();
  const normalizedId = String(videoId || "").trim();
  const videoExt = [".mp4", ".mkv", ".webm", ".mov"];

  for (const sourceDir of sourceDirs) {
    if (!fs.existsSync(sourceDir)) continue;
    const files = await fs.promises.readdir(sourceDir);

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!videoExt.includes(ext)) continue;

      const base = path.parse(file).name;
      if (
        base !== normalizedId &&
        !base.startsWith(normalizedId) &&
        !normalizedId.startsWith(base)
      ) {
        continue;
      }

      return path.join(sourceDir, file);
    }
  }

  return null;
}

function formatDateYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function extractLikelyYoutubeId(text) {
  const source = String(text || "");
  const m = source.match(
    /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{11})(?=$|[^A-Za-z0-9_-])/,
  );
  return m ? m[2] : null;
}

function normalizeUploadDate(value) {
  const source = String(value || "").trim();
  if (!source) return null;

  const digits = source.replace(/\D/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  return null;
}

function extractYoutubeIdFromUrl(text) {
  const source = String(text || "");
  const watchMatch = source.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = source.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

function getTagValue(allTags, keys) {
  for (const key of keys) {
    const value = allTags[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return null;
}

async function readVideoMetadataTags(videoPath) {
  const ffprobeCmd = await resolveFfprobeCommand();
  if (!ffprobeCmd) return {};

  try {
    const output = await runCommandCapture(ffprobeCmd, [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      videoPath,
    ]);

    const parsed = JSON.parse(output);
    const lowerTags = {};
    const duration = Number(parsed?.format?.duration);

    const addTags = (obj) => {
      if (!obj || typeof obj !== "object") return;
      for (const [k, v] of Object.entries(obj)) {
        const key = String(k || "").toLowerCase();
        if (typeof v === "string" && v.trim() !== "" && !lowerTags[key]) {
          lowerTags[key] = v.trim();
        }
      }
    };

    addTags(parsed?.format?.tags);
    if (Array.isArray(parsed?.streams)) {
      for (const s of parsed.streams) {
        addTags(s?.tags);
      }
    }

    return {
      tags: lowerTags,
      duration: Number.isFinite(duration) ? duration : null,
    };
  } catch (error) {
    console.warn("ffprobe metadata read failed:", error.message);
    return { tags: {}, duration: null };
  }
}

async function createProvisionalInfoFromVideo(videoPath, videoId) {
  const stats = await fs.promises.stat(videoPath);
  const base = path.parse(videoPath).name;
  const metadata = await readVideoMetadataTags(videoPath);
  const tags = metadata.tags || {};
  const durationSec = Number(metadata.duration);
  const normalizedDuration = Number.isFinite(durationSec)
    ? Math.max(0, Math.round(durationSec))
    : null;
  const commentText = getTagValue(tags, ["comment"]);
  const metaTitle = getTagValue(tags, ["title"]);
  const metaDescription = getTagValue(tags, [
    "description",
    "longdescription",
    "synopsis",
    "comment",
  ]);
  const metaChannel = getTagValue(tags, [
    "artist",
    "performer",
    "album_artist",
    "uploader",
  ]);
  const metaUploadDate =
    normalizeUploadDate(
      getTagValue(tags, [
        "recorded_date",
        "recording_date",
        "recording_time",
        "date",
        "creation_time",
        "encoded_date",
      ]),
    ) || formatDateYYYYMMDD(stats.mtime);

  const likelyId =
    extractYoutubeIdFromUrl(commentText) ||
    extractLikelyYoutubeId(base) ||
    extractLikelyYoutubeId(videoId);

  return {
    id: likelyId || null,
    title: metaTitle || base,
    description:
      metaDescription ||
      "info.json が見つからなかったため、ローカル動画のメタデータから自動生成しました。",
    upload_date: metaUploadDate,
    channel: metaChannel || "ローカル動画",
    channel_url: "#",
    uploader_id: metaChannel || "local",
    channel_follower_count: null,
    like_count: null,
    view_count: null,
    duration: normalizedDuration,
    comments: [],
    _provisional_info: true,
    _provisional_info_version: 3,
    _generated_at: new Date().toISOString(),
    _source_video: videoPath,
    _source_mtime_ms: stats.mtimeMs,
    _source_size: stats.size,
    _source_tags: {
      title: metaTitle || null,
      description: metaDescription || null,
      channel: metaChannel || null,
      upload_date: metaUploadDate || null,
      comment: commentText || null,
      duration: normalizedDuration,
    },
  };
}

const fallbackThumbnailJobs = new Map();
const failedFallbackThumbnails = new Set();

async function ensureFallbackThumbnail(videoPath) {
  const outputPath = getFallbackThumbPath(videoPath);
  if (fs.existsSync(outputPath)) return outputPath;
  if (failedFallbackThumbnails.has(outputPath)) return null;

  if (!fallbackThumbnailJobs.has(outputPath)) {
    const job = (async () => {
      const ffmpegCmd = await resolveFfmpegCommand();
      if (!ffmpegCmd) {
        failedFallbackThumbnails.add(outputPath);
        return null;
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
          "-update",
          "1",
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
          "-update",
          "1",
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
        failedFallbackThumbnails.add(outputPath);
        throw lastError;
      }

      if (!fs.existsSync(outputPath)) {
        failedFallbackThumbnails.add(outputPath);
        return null;
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

registerSettingsWallpaperRoutes(app, {
  fs,
  path,
  publicDir,
  upload,
  WALLPAPER_EXTS,
  loadConfig,
  saveConfig,
  normalizeDirList,
  getWallpaperPublicUrl,
  apiOk,
  apiError,
});

registerDownloadRoutes(app, {
  upload,
  crypto,
  jobHistory,
  broadcast,
  downloadQueueService,
  getUrlsFromInput: inputUrlResolver.getUrlsFromInput,
  fs,
  path,
  baseDir: __dirname,
  apiOk,
  apiError,
});

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
      return apiError(res, 404, "対応するライブチャットがありません");
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    fs.createReadStream(chatFile).pipe(res);
  } catch (e) {
    console.error("[LIVE CHAT] Error:", e);
    apiError(res, 500, "ライブチャットの取得に失敗しました");
  }
});

registerInfoRoutes(app, {
  fs,
  path,
  baseDir: __dirname,
  getProvisionalInfoPath,
  findLocalVideoPathById,
  createProvisionalInfoFromVideo,
});

registerLocalMediaRoutes(app, {
  fs,
  path,
  thumbnailDir,
  fallbackThumbnailDir,
  getLocalVideoDirs,
  loadConfig,
  isPathWithin,
  findExistingThumbnailPath,
  ensureFallbackThumbnail,
  apiOk,
  apiError,
});

registerNetworkRoutes(app, {
  fetchWithTimeout,
  apiOk,
  apiError,
});

registerScheduleRoutes(app, {
  path,
  os,
  exec,
  baseDir: __dirname,
  apiOk,
  apiError,
});

// ■ サーバーの起動
// --------------------------------------------------
function startServer(listenPort = port) {
  return app.listen(listenPort, () => {
    console.log(`サーバーが http://localhost:${listenPort} で起動しました。`);
  });
}

if (require.main === module) {
  startServer(port);
}

module.exports = {
  app,
  startServer,
  loadConfig,
  saveConfig,
  normalizeConfig,
  normalizeDirList,
};
