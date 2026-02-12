const { createLogger } = require("../services/logger-service");

function registerNetworkRoutes(app, deps) {
  const { fetchWithTimeout, apiOk, apiError } = deps;
  const logger = deps.logger || createLogger("route-network");

  app.get("/api/validate-url", async (req, res) => {
    const { url } = req.query;

    if (!url) {
      return apiError(res, 400, "URLが指定されていません。", { isValid: false });
    }

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "HEAD",
          redirect: "follow",
        },
        5000,
      );

      if (response.ok) {
        apiOk(res, { isValid: true });
      } else {
        apiOk(res, { isValid: false, error: `HTTPステータス: ${response.status}` });
      }
    } catch (error) {
      if (error.name === "AbortError") {
        apiOk(res, {
          isValid: false,
          error: "URLへの接続がタイムアウトしました。",
        });
      } else {
        logger.warn("URL検証エラー", { url, error: error.message });
        apiOk(res, {
          isValid: false,
          error: `URLに接続できません: ${error.message}`,
        });
      }
    }
  });

  app.post("/api/resolve-handle", async (req, res) => {
    const { url } = req.body;

    if (!url || !url.includes("youtube.com/@")) {
      return apiError(res, 400, "有効なYouTubeハンドルURLを指定してください。");
    }

    try {
      let response;
      try {
        response = await fetchWithTimeout(url, {}, 10000);
      } catch (fetchError) {
        if (fetchError.name === "AbortError") {
          logger.warn("fetch timeout", { url });
          return apiError(res, 504, "YouTubeページへの接続がタイムアウトしました。");
        }
        logger.error("YouTube page fetch failed", { url, error: fetchError.message });
        return apiError(res, 500, "YouTubeページの取得に失敗しました。");
      }

      if (!response.ok) {
        logger.warn("YouTube page response not ok", {
          url,
          status: response.status,
        });
        return apiError(
          res,
          response.status,
          `YouTubeページの取得に失敗しました。ステータス: ${response.status}`,
        );
      }

      const html = await response.text();
      const canonicalRegex = /<link\s+rel="canonical"\s+href="([^"]+)">/;
      const canonicalMatch = html.match(canonicalRegex);

      if (!canonicalMatch || !canonicalMatch[1]) {
        logger.warn("canonical URL not found", { url });
        return apiError(res, 404, "チャンネルの正規URLが見つかりませんでした。");
      }

      const canonicalUrl = canonicalMatch[1];
      const channelIdRegex = /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/;
      const channelIdMatch = canonicalUrl.match(channelIdRegex);

      if (!channelIdMatch || !channelIdMatch[1]) {
        logger.warn("channel ID not found in canonical URL", {
          canonicalUrl,
          originalUrl: url,
        });
        return apiError(res, 404, "チャンネルIDを抽出できませんでした。");
      }

      const channelId = channelIdMatch[1];
      apiOk(res, { channelId });
    } catch (error) {
      logger.error("handle resolution error", { error: error.message });
      apiError(res, 500, "ハンドルの解決中に予期せぬエラーが発生しました。");
    }
  });
}

module.exports = {
  registerNetworkRoutes,
};
