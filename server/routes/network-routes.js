const { createLogger } = require("../services/logger-service");

function isSupportedYoutubeResolveUrl(url) {
  const value = String(url || "").trim();
  return (
    /^https?:\/\/(www\.)?youtube\.com\/@[^/?#]+\/?$/i.test(value) ||
    /^https?:\/\/(www\.)?youtube\.com\/channel\/UC[a-zA-Z0-9_-]{22}\/?$/i.test(value) ||
    /^https?:\/\/(www\.)?youtube\.com\/watch\?[^#]*\bv=[^&]+/i.test(value) ||
    /^https?:\/\/youtu\.be\/[^/?#]+/i.test(value)
  );
}

function extractChannelIdFromHtml(html) {
  const canonicalRegex = /<link\s+rel="canonical"\s+href="([^"]+)">/i;
  const canonicalMatch = String(html || "").match(canonicalRegex);
  if (canonicalMatch?.[1]) {
    const channelIdMatch = canonicalMatch[1].match(
      /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/i,
    );
    if (channelIdMatch?.[1]) {
      return channelIdMatch[1];
    }
  }

  const patterns = [
    /"channelId":"(UC[a-zA-Z0-9_-]{22})"/,
    /itemprop="channelId"\s+content="(UC[a-zA-Z0-9_-]{22})"/i,
    /"externalId":"(UC[a-zA-Z0-9_-]{22})"/,
    /https?:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/i,
  ];

  for (const pattern of patterns) {
    const match = String(html || "").match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function registerNetworkRoutes(app, deps) {
  const { fetchWithTimeout, apiOk, apiError, os } = deps;
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

    if (!isSupportedYoutubeResolveUrl(url)) {
      return apiError(
        res,
        400,
        "有効なYouTubeチャンネルURL、ハンドルURL、または動画URLを指定してください。",
      );
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
      const channelId = extractChannelIdFromHtml(html);

      if (!channelId) {
        logger.warn("channel ID not found in HTML", {
          originalUrl: url,
        });
        return apiError(res, 404, "チャンネルIDを抽出できませんでした。");
      }

      apiOk(res, { channelId });
    } catch (error) {
      logger.error("handle resolution error", { error: error.message });
      apiError(res, 500, "ハンドルの解決中に予期せぬエラーが発生しました。");
    }
  });

  app.get("/api/network/local-ip", (_req, res) => {
    try {
      const interfaces = typeof os?.networkInterfaces === "function"
        ? os.networkInterfaces()
        : {};
      const localIps = [];

      Object.values(interfaces || {}).forEach((entries) => {
        if (!Array.isArray(entries)) return;
        entries.forEach((entry) => {
          if (!entry) return;
          const family = String(entry.family || "").toLowerCase();
          const isIpv4 = family === "ipv4" || entry.family === 4;
          if (!isIpv4) return;
          if (entry.internal) return;
          if (!entry.address) return;
          localIps.push(String(entry.address));
        });
      });

      const uniqueIps = Array.from(new Set(localIps));
      apiOk(res, {
        localIps: uniqueIps,
        primaryIp: uniqueIps[0] || null,
      });
    } catch (error) {
      logger.error("LAN内IP取得エラー", { error: error.message });
      apiError(res, 500, "LAN内IPの取得に失敗しました。");
    }
  });
}

module.exports = {
  extractChannelIdFromHtml,
  isSupportedYoutubeResolveUrl,
  registerNetworkRoutes,
};
