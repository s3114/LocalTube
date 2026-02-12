const { createLogger } = require("../services/logger-service");

function registerLocalMediaRoutes(app, deps) {
  const {
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
  } = deps;
  const logger = deps.logger || createLogger("route-local-media");
  const LOCAL_VIDEOS_CACHE_TTL_MS = 5000;
  let localVideosCache = {
    expiresAt: 0,
    signature: "",
    data: null,
  };

  async function buildLocalVideoDirsSignature(sourceDirs) {
    const stats = await Promise.all(
      sourceDirs.map(async (dir) => {
        try {
          if (!fs.existsSync(dir)) return `${dir}:missing`;
          const stat = await fs.promises.stat(dir);
          return `${dir}:${Math.round(stat.mtimeMs)}`;
        } catch (_error) {
          return `${dir}:error`;
        }
      }),
    );
    return stats.join("|");
  }

  app.get("/api/local-media", async (req, res) => {
    try {
      const type = req.query.type;
      const targetPath = String(req.query.path || "");

      if (!targetPath || !["video", "thumb"].includes(type)) {
        return apiError(res, 400, "無効なリクエストです。");
      }

      const allowedVideoDirs = await getLocalVideoDirs();
      const allowedThumbDirs = [thumbnailDir, fallbackThumbnailDir, ...allowedVideoDirs];
      const allowedDirs = type === "video" ? allowedVideoDirs : allowedThumbDirs;

      const isAllowed = allowedDirs.some((dir) => isPathWithin(targetPath, dir));
      if (!isAllowed) {
        return apiError(res, 403, "アクセスが許可されていません。");
      }

      const ext = path.extname(targetPath).toLowerCase();
      const videoExt = [".mp4", ".mkv", ".webm", ".mov"];
      const thumbExt = [".jpg", ".jpeg", ".png", ".webp"];

      if (type === "video" && !videoExt.includes(ext)) {
        return apiError(res, 400, "無効な動画ファイルです。");
      }

      if (type === "thumb" && !thumbExt.includes(ext)) {
        return apiError(res, 400, "無効な画像ファイルです。");
      }

      if (!fs.existsSync(targetPath)) {
        return apiError(res, 404, "ファイルが見つかりません。");
      }

      res.sendFile(path.resolve(targetPath));
    } catch (e) {
      logger.error("ローカルメディアの配信に失敗", { error: e.message });
      apiError(res, 500, "ローカルメディアの取得に失敗しました。");
    }
  });

  app.get("/api/local-thumb-fallback", async (req, res) => {
    try {
      const videoPath = String(req.query.videoPath || "");
      const priority = String(req.query.priority || "normal").toLowerCase();
      if (!videoPath) {
        return apiError(res, 400, "videoPath が必要です。");
      }

      const allowedVideoDirs = await getLocalVideoDirs();
      const isAllowed = allowedVideoDirs.some((dir) => isPathWithin(videoPath, dir));
      if (!isAllowed) {
        return apiError(res, 403, "アクセスが許可されていません。");
      }

      const ext = path.extname(videoPath).toLowerCase();
      const videoExt = [".mp4", ".mkv", ".webm", ".mov"];
      if (!videoExt.includes(ext)) {
        return apiError(res, 400, "無効な動画ファイルです。");
      }

      if (!fs.existsSync(videoPath)) {
        return apiError(res, 404, "動画が見つかりません。");
      }

      const settings = await loadConfig();
      const fallbackEnabled = settings.enableFallbackThumbnails !== false;
      if (!fallbackEnabled) {
        return res.redirect("/none_icon.jpg");
      }

      const existingThumbPath = findExistingThumbnailPath(videoPath, true);
      const thumbPath =
        existingThumbPath || (await ensureFallbackThumbnail(videoPath, priority));
      if (!thumbPath) {
        return res.redirect("/none_icon.jpg");
      }
      res.sendFile(path.resolve(thumbPath));
    } catch (error) {
      logger.warn("フォールバックサムネイル生成をスキップ", {
        error: error.message,
      });
      res.redirect("/none_icon.jpg");
    }
  });

  app.get("/api/local-videos", async (_req, res) => {
    try {
      const startedAt = Date.now();
      const sourceDirs = await getLocalVideoDirs();
      const settings = await loadConfig();
      const fallbackEnabled = settings.enableFallbackThumbnails !== false;
      const signature = await buildLocalVideoDirsSignature(sourceDirs);
      const now = Date.now();
      if (
        localVideosCache.data &&
        localVideosCache.expiresAt > now &&
        localVideosCache.signature === signature
      ) {
        logger.info("local videos cache hit", {
          count: localVideosCache.data.length,
          elapsedMs: Date.now() - startedAt,
        });
        return apiOk(res, localVideosCache.data);
      }

      const videoExt = [".mp4", ".mkv", ".webm", ".mov"];
      const videos = [];

      for (const sourceDir of sourceDirs) {
        if (!fs.existsSync(sourceDir)) continue;

        const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
        const files = entries
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name);

        const scanned = await Promise.all(
          files.map(async (file) => {
          const ext = path.extname(file).toLowerCase();
          if (!videoExt.includes(ext)) return null;

          const fullPath = path.join(sourceDir, file);
          const base = path.parse(file).name;
          const thumbPath = findExistingThumbnailPath(fullPath, fallbackEnabled);
          const stat = await fs.promises.stat(fullPath);

          return {
            title: base,
            video: `/api/local-media?type=video&path=${encodeURIComponent(fullPath)}`,
            thumb: thumbPath
              ? `/api/local-media?type=thumb&path=${encodeURIComponent(thumbPath)}`
              : fallbackEnabled
                ? `/api/local-thumb-fallback?videoPath=${encodeURIComponent(fullPath)}&priority=low`
                : null,
            filename: file,
            mtime: stat.mtimeMs,
            sourceDir,
          };
        }),
        );

        videos.push(...scanned.filter(Boolean));
      }

      videos.sort((a, b) => b.mtime - a.mtime);
      localVideosCache = {
        expiresAt: Date.now() + LOCAL_VIDEOS_CACHE_TTL_MS,
        signature,
        data: videos,
      };
      logger.info("local videos scanned", {
        count: videos.length,
        sourceDirs: sourceDirs.length,
        elapsedMs: Date.now() - startedAt,
      });
      apiOk(res, videos);
    } catch (e) {
      logger.error("ローカル動画のスキャンに失敗", { error: e.message });
      apiError(res, 500, "動画一覧の取得に失敗しました。");
    }
  });
}

module.exports = {
  registerLocalMediaRoutes,
};
