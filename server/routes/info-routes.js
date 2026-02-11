function registerInfoRoutes(app, deps) {
  const {
    fs,
    path,
    baseDir,
    getProvisionalInfoPath,
    findLocalVideoPathById,
    createProvisionalInfoFromVideo,
  } = deps;

  app.get("/info/:videoId", async (req, res) => {
    try {
      const videoId = decodeURIComponent(req.params.videoId);
      const commentDir = path.join(baseDir, "downloads", "コメント");
      const provisionalPath = getProvisionalInfoPath(videoId);

      console.log("[INFO] looking for base:", videoId);

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
          console.error("[INFO] Not found for:", videoId);
          return res.status(404).json({ error: "info.json が見つかりません" });
        }

        const provisionalInfo = await createProvisionalInfoFromVideo(videoPath, videoId);
        await fs.promises.writeFile(
          provisionalPath,
          JSON.stringify(provisionalInfo, null, 2),
          "utf-8",
        );
        console.log("[INFO] generated provisional info:", provisionalPath);

        res.type("application/json; charset=utf-8");
        return res.sendFile(provisionalPath);
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
}

module.exports = {
  registerInfoRoutes,
};
