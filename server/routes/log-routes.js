const { getLogEntries } = require("../services/log-stream-service");

function registerLogRoutes(app, deps) {
  const { apiOk, apiError } = deps;

  app.get("/api/logs", (req, res) => {
    try {
      const sinceId = Number(req.query.sinceId || 0);
      const limit = Number(req.query.limit || 200);
      const logs = getLogEntries({ sinceId, limit });
      const lastId = logs.length > 0 ? logs[logs.length - 1].id : sinceId;
      return apiOk(res, { logs, lastId });
    } catch (error) {
      return apiError(res, 500, "ログ取得に失敗しました。", {
        detail: error.message,
      });
    }
  });
}

module.exports = {
  registerLogRoutes,
};

