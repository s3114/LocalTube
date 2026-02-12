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
} = require("./server/config-store");
const {
  registerSettingsWallpaperRoutes,
} = require("./server/routes/settings-wallpaper-routes");
const {
  registerLocalMediaRoutes,
} = require("./server/routes/local-media-routes");
const { registerDownloadRoutes } = require("./server/routes/download-routes");
const { registerLiveChatRoutes } = require("./server/routes/live-chat-routes");
const { registerInfoRoutes } = require("./server/routes/info-routes");
const { registerNetworkRoutes } = require("./server/routes/network-routes");
const { registerScheduleRoutes } = require("./server/routes/schedule-routes");
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
const {
  createLocalVideoService,
} = require("./server/services/local-video-service");
const {
  createWallpaperService,
} = require("./server/services/wallpaper-service");
const {
  createLocalPathService,
} = require("./server/services/local-path-service");
const {
  createConfigService,
} = require("./server/services/config-service");
const {
  initializeDirectoryLayout,
} = require("./server/services/startup-service");
const { createLogger } = require("./server/services/logger-service");

// Expressアプリケーションのインスタンスを作成します。
const app = express();
const logger = createLogger("server");
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
const {
  downloadsDir,
  movieDir,
  thumbnailDir,
  fallbackThumbnailDir,
  commentsDir,
  provisionalInfoDir,
  liveChatDir,
  subtitleDir,
  pendingChatDir,
} = initializeDirectoryLayout({
  fs,
  path,
  baseDir: __dirname,
});

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
    logger.error("Latency test failed", { error: e.message });
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
const configService = createConfigService({
  path,
  baseDir: __dirname,
});

async function loadConfig() {
  return configService.loadConfig();
}

async function saveConfig(config) {
  return configService.saveConfig(config);
}

const localPathService = createLocalPathService({
  path,
  normalizeDirList,
  movieDir,
  loadConfig,
});

const fetchWithTimeout = createFetchWithTimeout();
const wallpaperService = createWallpaperService({
  fs,
  path,
  publicDir,
});

const localVideoService = createLocalVideoService({
  fs,
  path,
  crypto,
  runCommand,
  runCommandCapture,
  movieDir,
  thumbnailDir,
  fallbackThumbnailDir,
  provisionalInfoDir,
  baseDir: __dirname,
  getLocalVideoDirs: localPathService.getLocalVideoDirs,
});

const routeBaseDeps = {
  fs,
  path,
  baseDir: __dirname,
  apiOk,
  apiError,
};

registerSettingsWallpaperRoutes(app, {
  ...routeBaseDeps,
  publicDir,
  upload,
  WALLPAPER_EXTS: wallpaperService.wallpaperExts,
  clearWallpaperFiles: wallpaperService.clearWallpaperFiles,
  loadConfig,
  saveConfig,
  normalizeDirList,
  getWallpaperPublicUrl: wallpaperService.getWallpaperPublicUrl,
  apiOk,
  apiError,
});

registerDownloadRoutes(app, {
  ...routeBaseDeps,
  upload,
  crypto,
  jobHistory,
  broadcast,
  downloadQueueService,
  getUrlsFromInput: inputUrlResolver.getUrlsFromInput,
});

registerLiveChatRoutes(app, {
  ...routeBaseDeps,
});

registerInfoRoutes(app, {
  ...routeBaseDeps,
  getProvisionalInfoPath: localVideoService.getProvisionalInfoPath,
  findLocalVideoPathById: localVideoService.findLocalVideoPathById,
  createProvisionalInfoFromVideo: localVideoService.createProvisionalInfoFromVideo,
});

registerLocalMediaRoutes(app, {
  ...routeBaseDeps,
  thumbnailDir,
  fallbackThumbnailDir,
  getLocalVideoDirs: localPathService.getLocalVideoDirs,
  loadConfig,
  isPathWithin: localPathService.isPathWithin,
  findExistingThumbnailPath: localVideoService.findExistingThumbnailPath,
  ensureFallbackThumbnail: localVideoService.ensureFallbackThumbnail,
});

registerNetworkRoutes(app, {
  ...routeBaseDeps,
  fetchWithTimeout,
});

registerScheduleRoutes(app, {
  ...routeBaseDeps,
  path,
  os,
  exec,
});

// ■ サーバーの起動
// --------------------------------------------------
function startServer(listenPort = port) {
  return app.listen(listenPort, () => {
    logger.info("サーバー起動", { url: `http://localhost:${listenPort}` });
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
