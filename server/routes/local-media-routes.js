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
      console.error("Failed to serve local media:", e);
      apiError(res, 500, "ローカルメディアの取得に失敗しました。");
    }
  });

  app.get("/api/local-thumb-fallback", async (req, res) => {
    try {
      const videoPath = String(req.query.videoPath || "");
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
      const thumbPath = existingThumbPath || (await ensureFallbackThumbnail(videoPath));
      if (!thumbPath) {
        return res.redirect("/none_icon.jpg");
      }
      res.sendFile(path.resolve(thumbPath));
    } catch (error) {
      console.warn("Fallback thumbnail creation skipped:", error.message);
      res.redirect("/none_icon.jpg");
    }
  });

  app.get("/api/local-videos", async (_req, res) => {
    try {
      const sourceDirs = await getLocalVideoDirs();
      const settings = await loadConfig();
      const fallbackEnabled = settings.enableFallbackThumbnails !== false;

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
          const thumbPath = findExistingThumbnailPath(fullPath, fallbackEnabled);

          videos.push({
            title: base,
            video: `/api/local-media?type=video&path=${encodeURIComponent(fullPath)}`,
            thumb: thumbPath
              ? `/api/local-media?type=thumb&path=${encodeURIComponent(thumbPath)}`
              : fallbackEnabled
                ? `/api/local-thumb-fallback?videoPath=${encodeURIComponent(fullPath)}`
                : null,
            filename: file,
            mtime: (await fs.promises.stat(fullPath)).mtimeMs,
            sourceDir,
          });
        }
      }

      videos.sort((a, b) => b.mtime - a.mtime);
      apiOk(res, videos);
    } catch (e) {
      console.error("Failed to scan local videos:", e);
      apiError(res, 500, "動画一覧の取得に失敗しました。");
    }
  });
}

module.exports = {
  registerLocalMediaRoutes,
};
