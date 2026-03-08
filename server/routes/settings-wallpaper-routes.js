const { createLogger } = require("../services/logger-service");

function registerSettingsWallpaperRoutes(app, deps) {
  const {
    fs,
    path,
    publicDir,
    upload,
    WALLPAPER_EXTS,
    clearWallpaperFiles,
    loadConfig,
    saveConfig,
    normalizeDirList,
    normalizePlaylistsState,
    getWallpaperPublicUrl,
    apiOk,
    apiError,
  } = deps;
  const logger = deps.logger || createLogger("route-settings");

  async function moveFileWithCrossDeviceFallback(fromPath, toPath) {
    try {
      await fs.promises.rename(fromPath, toPath);
      return;
    } catch (error) {
      if (!error || error.code !== "EXDEV") {
        throw error;
      }
    }

    await fs.promises.copyFile(fromPath, toPath);
    await fs.promises.unlink(fromPath);
  }

  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await loadConfig();
      apiOk(res, settings);
    } catch (error) {
      logger.error("設定の読み込みに失敗", { error: error.message });
      apiError(res, 500, "設定の読み込みに失敗しました。");
    }
  });

  app.get("/api/wallpaper-meta", async (_req, res) => {
    try {
      const settings = await loadConfig();
      const url = getWallpaperPublicUrl();
      apiOk(res, {
        exists: Boolean(url),
        url,
        wallpaperBlur: settings.wallpaperBlur ?? 2,
        wallpaperBrightness: settings.wallpaperBrightness ?? 50,
      });
    } catch (error) {
      logger.error("壁紙メタ情報の取得に失敗", { error: error.message });
      apiError(res, 500, "壁紙メタ情報の取得に失敗しました。");
    }
  });

  app.post("/api/wallpaper", upload.single("wallpaper"), async (req, res) => {
    const tempPath = req.file?.path;
    try {
      if (!req.file) {
        return apiError(res, 400, "壁紙ファイルが指定されていません。");
      }

      const ext = path.extname(req.file.originalname || "").toLowerCase();
      if (!WALLPAPER_EXTS.includes(ext)) {
        return apiError(res, 400, "対応していない画像形式です。");
      }

      if (clearWallpaperFiles) {
        await clearWallpaperFiles();
      } else {
        for (const oldExt of WALLPAPER_EXTS) {
          const oldPath = path.join(publicDir, `wallpaper${oldExt}`);
          if (fs.existsSync(oldPath)) {
            await fs.promises.unlink(oldPath);
          }
        }
      }

      const finalPath = path.join(publicDir, `wallpaper${ext}`);
      await moveFileWithCrossDeviceFallback(req.file.path, finalPath);

      const config = await loadConfig();
      if (typeof req.body?.wallpaperBlur !== "undefined") {
        config.wallpaperBlur = Number(req.body.wallpaperBlur);
      }
      if (typeof req.body?.wallpaperBrightness !== "undefined") {
        config.wallpaperBrightness = Number(req.body.wallpaperBrightness);
      }
      await saveConfig(config);

      apiOk(res, {
        message: "壁紙を保存しました。",
        url: getWallpaperPublicUrl(),
        wallpaperBlur: config.wallpaperBlur ?? 2,
        wallpaperBrightness: config.wallpaperBrightness ?? 50,
      });
    } catch (error) {
      logger.error("壁紙の保存に失敗", { error: error.message });
      apiError(res, 500, "壁紙の保存に失敗しました。");
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        try {
          await fs.promises.unlink(tempPath);
        } catch (_error) {
          // noop
        }
      }
    }
  });

  app.post("/api/wallpaper/clear", async (_req, res) => {
    try {
      if (clearWallpaperFiles) {
        await clearWallpaperFiles();
      } else {
        for (const ext of WALLPAPER_EXTS) {
          const target = path.join(publicDir, `wallpaper${ext}`);
          if (fs.existsSync(target)) {
            await fs.promises.unlink(target);
          }
        }
      }

      apiOk(res, {
        message: "壁紙をクリアしました。",
        url: null,
      });
    } catch (error) {
      logger.error("壁紙クリアに失敗", { error: error.message });
      apiError(res, 500, "壁紙クリアに失敗しました。");
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const {
        browser,
        localVideoDirs,
        enableFallbackThumbnails,
        wallpaperBlur,
        wallpaperBrightness,
        playlistsState,
      } = req.body || {};
      if (
        typeof browser === "undefined" &&
        typeof localVideoDirs === "undefined" &&
        typeof enableFallbackThumbnails === "undefined" &&
        typeof wallpaperBlur === "undefined" &&
        typeof wallpaperBrightness === "undefined" &&
        typeof playlistsState === "undefined"
      ) {
        return apiError(res, 400, "無効なリクエストです。");
      }

      const currentConfig = await loadConfig();

      if (typeof browser !== "undefined") {
        currentConfig.selectedBrowser = browser;
      }

      if (typeof localVideoDirs !== "undefined") {
        currentConfig.localVideoDirs = normalizeDirList(localVideoDirs);
      }

      if (typeof enableFallbackThumbnails !== "undefined") {
        currentConfig.enableFallbackThumbnails = Boolean(enableFallbackThumbnails);
      }

      if (typeof wallpaperBlur !== "undefined") {
        currentConfig.wallpaperBlur = Number(wallpaperBlur);
      }
      if (typeof wallpaperBrightness !== "undefined") {
        currentConfig.wallpaperBrightness = Number(wallpaperBrightness);
      }

      if (typeof playlistsState !== "undefined") {
        currentConfig.playlistsState = normalizePlaylistsState(playlistsState);
      }

      const savedConfig = await saveConfig(currentConfig);

      logger.info("設定を保存", {
        selectedBrowser: savedConfig.selectedBrowser || "",
        localVideoDirs: Array.isArray(savedConfig.localVideoDirs)
          ? savedConfig.localVideoDirs.length
          : 0,
      });
      apiOk(res, { message: "設定を保存しました。", settings: savedConfig });
    } catch (error) {
      logger.error("設定の保存に失敗", { error: error.message });
      apiError(res, 500, "設定の保存に失敗しました。");
    }
  });
}

module.exports = {
  registerSettingsWallpaperRoutes,
};
