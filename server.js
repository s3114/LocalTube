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
const {
  normalizeDirList,
  normalizeConfig,
  normalizeEmojiDictionary,
  normalizePlaylistsState,
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
const { registerLogRoutes } = require("./server/routes/log-routes");
const { registerReportRoutes } = require("./server/routes/report-routes");
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
app.use("/shared", express.static(path.join(__dirname, "shared")));
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
  normalizeEmojiDictionary,
  normalizePlaylistsState,
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
  getLocalVideoDirs: localPathService.getLocalVideoDirs,
  loadConfig,
  saveConfig,
});

registerInfoRoutes(app, {
  ...routeBaseDeps,
  getLocalVideoDirs: localPathService.getLocalVideoDirs,
  getProvisionalInfoPath: localVideoService.getProvisionalInfoPath,
  findLocalVideoPathById: localVideoService.findLocalVideoPathById,
  createProvisionalInfoFromVideo: localVideoService.createProvisionalInfoFromVideo,
  ensureProvisionalInfo: localVideoService.ensureProvisionalInfo,
});

registerLocalMediaRoutes(app, {
  ...routeBaseDeps,
  thumbnailDir,
  fallbackThumbnailDir,
  getLocalVideoDirs: localPathService.getLocalVideoDirs,
  loadConfig,
  isPathWithin: localPathService.isPathWithin,
  findExistingThumbnailPath: localVideoService.findExistingThumbnailPath,
  findCachedFallbackThumbnailPath: localVideoService.findCachedFallbackThumbnailPath,
  ensureFallbackThumbnail: localVideoService.ensureFallbackThumbnail,
  ensureCachedThumbnailFromPath: localVideoService.ensureCachedThumbnailFromPath,
  runCommand,
});

registerNetworkRoutes(app, {
  ...routeBaseDeps,
  fetchWithTimeout,
  os,
});

registerScheduleRoutes(app, {
  ...routeBaseDeps,
  path,
  os,
  spawn,
});

registerLogRoutes(app, {
  ...routeBaseDeps,
});

registerReportRoutes(app, {
  ...routeBaseDeps,
  loadConfig,
  jobHistory,
  serverStartTime,
});

function scheduleServerRestart({ preferStartupBat }) {
  const scriptPath = path.resolve(__dirname, "server.js");
  const startupBatPath = path.resolve(__dirname, "起動.bat");
  const useStartupBat = Boolean(preferStartupBat && fs.existsSync(startupBatPath));
  const helperCode = `
const { spawn } = require("child_process");
const nodePath = ${JSON.stringify(process.execPath)};
const scriptPath = ${JSON.stringify(scriptPath)};
const cwd = ${JSON.stringify(__dirname)};
const startupBatPath = ${JSON.stringify(startupBatPath)};
const useStartupBat = ${JSON.stringify(useStartupBat)};

setTimeout(() => {
  const child = useStartupBat
    ? spawn(startupBatPath, [], {
        shell: true,
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: process.env,
      })
    : spawn(nodePath, [scriptPath], {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: process.env,
      });
  child.unref();
}, 1000);
`;
  const child = spawn(process.execPath, ["-e", helperCode], {
    cwd: __dirname,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env },
  });

  child.unref();
}

function isLoopbackRequest(req) {
  const remote = String(req.socket?.remoteAddress || "").toLowerCase();
  return remote === "::1" || remote === "127.0.0.1" || remote === "::ffff:127.0.0.1";
}

app.post("/api/system/restart", (req, res) => {
  if (!isLoopbackRequest(req)) {
    return apiError(res, 403, "この操作はサーバー本体PC（localhost）からのみ実行できます。");
  }
  try {
    scheduleServerRestart({ preferStartupBat: true });
    apiOk(res, {
      message: "サーバーを再起動しています。15秒後に再読み込みしてください。",
    });

    setTimeout(() => {
      process.exit(0);
    }, 300);
  } catch (error) {
    apiError(res, 500, "サーバー再起動に失敗しました。", {
      detail: error.message,
    });
  }
});

app.post("/api/system/restart-node", (req, res) => {
  if (!isLoopbackRequest(req)) {
    return apiError(res, 403, "この操作はサーバー本体PC（localhost）からのみ実行できます。");
  }
  try {
    scheduleServerRestart({ preferStartupBat: false });
    apiOk(res, {
      message: "server.js を再起動しています。3秒後に再読み込みしてください。",
    });

    setTimeout(() => {
      process.exit(0);
    }, 300);
  } catch (error) {
    apiError(res, 500, "server.js の再起動に失敗しました。", {
      detail: error.message,
    });
  }
});

app.post("/api/system/shutdown", (req, res) => {
  if (!isLoopbackRequest(req)) {
    return apiError(res, 403, "この操作はサーバー本体PC（localhost）からのみ実行できます。");
  }
  apiOk(res, {
    message: "サーバーを強制終了しています。",
  });
  setTimeout(() => {
    process.exit(0);
  }, 150);
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
