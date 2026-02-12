const { createLogger } = require("../services/logger-service");

function registerInfoRoutes(app, deps) {
  const {
    fs,
    path,
    baseDir,
    getProvisionalInfoPath,
    findLocalVideoPathById,
    createProvisionalInfoFromVideo,
  } = deps;
  const logger = deps.logger || createLogger("route-info");

  app.get("/info/:videoId", async (req, res) => {
    try {
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

        const provisionalInfo = await createProvisionalInfoFromVideo(videoPath, videoId);
        await fs.promises.writeFile(
          provisionalPath,
          JSON.stringify(provisionalInfo, null, 2),
          "utf-8",
        );
        logger.info("generated provisional info", { provisionalPath });

        res.type("application/json; charset=utf-8");
        return res.sendFile(provisionalPath);
      }

      const infoPath = path.join(commentDir, match);
      logger.info("serving existing info", { infoPath });

      res.type("application/json; charset=utf-8");
      res.sendFile(infoPath);
    } catch (e) {
      logger.error("failed to serve info.json", { error: e.message });
      res.status(500).json({ error: "info.json の取得に失敗しました" });
    }
  });
}

module.exports = {
  registerInfoRoutes,
};
