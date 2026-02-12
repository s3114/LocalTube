const { createLogger } = require("../services/logger-service");

function registerLiveChatRoutes(app, deps) {
  const { fs, path, baseDir, apiError } = deps;
  const logger = deps.logger || createLogger("route-live-chat");

  app.get("/api/live-chat/:videoFile", async (req, res) => {
    try {
      const videoFile = decodeURIComponent(req.params.videoFile);
      const chatDir = path.join(baseDir, "downloads", "ライブチャット");

      let chatFile = path.join(chatDir, videoFile);
      if (!fs.existsSync(chatFile)) {
        const withExt = `${videoFile}.live_chat.json`;
        const altPath = path.join(chatDir, withExt);
        logger.info("primary not found, trying alt path", { altPath });
        if (fs.existsSync(altPath)) {
          chatFile = altPath;
        }
      }

      logger.info("resolved chat path", { chatFile });
      if (!fs.existsSync(chatFile)) {
        logger.warn("chat file not found", { chatFile });
        return apiError(res, 404, "対応するライブチャットがありません");
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      fs.createReadStream(chatFile).pipe(res);
    } catch (e) {
      logger.error("failed to serve live chat", { error: e.message });
      apiError(res, 500, "ライブチャットの取得に失敗しました");
    }
  });
}

module.exports = {
  registerLiveChatRoutes,
};
