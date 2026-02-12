const { createLogger } = require("../services/logger-service");

function registerInfoRoutes(app, deps) {
  const {
    fs,
    path,
    baseDir,
    apiOk,
    apiError,
    getProvisionalInfoPath,
    findLocalVideoPathById,
    createProvisionalInfoFromVideo,
    ensureProvisionalInfo,
  } = deps;
  const logger = deps.logger || createLogger("route-info");

  function pickHomeLiteFields(info = {}) {
    return {
      id: info.id || null,
      title: info.title || "",
      channel: info.channel || "",
      uploader: info.uploader || info.uploader_id || "",
      upload_date: info.upload_date || "",
      duration: Number.isFinite(Number(info.duration))
        ? Math.max(0, Math.round(Number(info.duration)))
        : null,
      view_count: Number.isFinite(Number(info.view_count))
        ? Number(info.view_count)
        : null,
      channel_thumbnail: info.channel_thumbnail || "",
    };
  }

  async function resolveInfoJsonPath(videoId) {
    const commentDir = path.join(baseDir, "downloads", "コメント");
    const files = await fs.promises.readdir(commentDir);
    const match = files.find(
      (f) => f.startsWith(videoId) && f.endsWith(".info.json"),
    );
    if (!match) return null;
    return path.join(commentDir, match);
  }

  async function resolveLiteInfoByVideoId(videoId) {
    const provisionalPath = getProvisionalInfoPath(videoId);
    const infoPath = await resolveInfoJsonPath(videoId);
    if (infoPath) {
      const raw = await fs.promises.readFile(infoPath, "utf-8");
      return pickHomeLiteFields(JSON.parse(raw));
    }

    if (fs.existsSync(provisionalPath)) {
      try {
        const raw = await fs.promises.readFile(provisionalPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed?._provisional_info_version >= 3) {
          return pickHomeLiteFields(parsed);
        }
      } catch (_error) {
        // ignore
      }
    }

    const videoPath = await findLocalVideoPathById(videoId);
    if (!videoPath) return null;

    if (typeof ensureProvisionalInfo === "function") {
      const generated = await ensureProvisionalInfo(videoPath, videoId);
      return pickHomeLiteFields(generated?.info || {});
    }

    const provisionalInfo = await createProvisionalInfoFromVideo(videoPath, videoId);
    await fs.promises.writeFile(
      provisionalPath,
      JSON.stringify(provisionalInfo, null, 2),
      "utf-8",
    );
    return pickHomeLiteFields(provisionalInfo);
  }

  app.get("/info/:videoId", async (req, res) => {
    try {
      const startedAt = Date.now();
      const videoId = decodeURIComponent(req.params.videoId);
      const commentDir = path.join(baseDir, "downloads", "コメント");
      const provisionalPath = getProvisionalInfoPath(videoId);

      logger.info("info lookup start", { videoId });

      const files = await fs.promises.readdir(commentDir);
      const match = files.find(
        (f) => f.startsWith(videoId) && f.endsWith(".info.json"),
      );

      if (!match) {
        if (fs.existsSync(provisionalPath)) {
          try {
            const cachedRaw = await fs.promises.readFile(provisionalPath, "utf-8");
            const cached = JSON.parse(cachedRaw);
            if (cached?._provisional_info_version >= 3) {
              res.type("application/json; charset=utf-8");
              return res.sendFile(provisionalPath);
            }
          } catch (_error) {
            // 壊れたJSONや旧形式は再生成する
          }
        }

        const videoPath = await findLocalVideoPathById(videoId);
        if (!videoPath) {
          logger.warn("info not found and no local video", { videoId });
          return res.status(404).json({ error: "info.json が見つかりません" });
        }

        if (typeof ensureProvisionalInfo === "function") {
          const generated = await ensureProvisionalInfo(videoPath, videoId);
          logger.info("provisional info resolved", {
            provisionalPath: generated?.path || provisionalPath,
            fromCache: Boolean(generated?.fromCache),
            elapsedMs: Date.now() - startedAt,
          });
        } else {
          const provisionalInfo = await createProvisionalInfoFromVideo(videoPath, videoId);
          await fs.promises.writeFile(
            provisionalPath,
            JSON.stringify(provisionalInfo, null, 2),
            "utf-8",
          );
          logger.info("generated provisional info", {
            provisionalPath,
            elapsedMs: Date.now() - startedAt,
          });
        }

        res.type("application/json; charset=utf-8");
        return res.sendFile(provisionalPath);
      }

      const infoPath = path.join(commentDir, match);
      logger.info("serving existing info", {
        infoPath,
        elapsedMs: Date.now() - startedAt,
      });

      res.type("application/json; charset=utf-8");
      res.sendFile(infoPath);
    } catch (e) {
      logger.error("failed to serve info.json", { error: e.message });
      res.status(500).json({ error: "info.json の取得に失敗しました" });
    }
  });

  app.get("/api/info-lite/:videoId", async (req, res) => {
    try {
      const startedAt = Date.now();
      const videoId = decodeURIComponent(req.params.videoId);
      const lite = await resolveLiteInfoByVideoId(videoId);
      if (!lite) {
        return apiError(res, 404, "info-lite が見つかりません");
      }
      logger.info("serving info-lite", {
        videoId,
        elapsedMs: Date.now() - startedAt,
      });
      apiOk(res, lite);
    } catch (error) {
      logger.error("failed to serve info-lite", { error: error.message });
      apiError(res, 500, "info-lite の取得に失敗しました");
    }
  });

  app.get("/api/home-info", async (req, res) => {
    try {
      const startedAt = Date.now();
      const idsRaw = String(req.query.ids || "");
      const ids = idsRaw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 200);
      if (ids.length === 0) {
        return apiError(res, 400, "ids が必要です");
      }

      const entries = await Promise.all(
        ids.map(async (videoId) => {
          const lite = await resolveLiteInfoByVideoId(videoId);
          return [videoId, lite];
        }),
      );

      const data = {};
      for (const [videoId, lite] of entries) {
        if (lite) data[videoId] = lite;
      }
      logger.info("serving home-info batch", {
        requested: ids.length,
        resolved: Object.keys(data).length,
        elapsedMs: Date.now() - startedAt,
      });
      apiOk(res, data);
    } catch (error) {
      logger.error("failed to serve home-info", { error: error.message });
      apiError(res, 500, "home-info の取得に失敗しました");
    }
  });
}

module.exports = {
  registerInfoRoutes,
};
