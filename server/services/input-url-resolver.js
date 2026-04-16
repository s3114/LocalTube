const { createLogger } = require("./logger-service");

function createInputUrlResolver({ spawn, path, baseDir, logger, fetchWithTimeout }) {
  if (typeof spawn !== "function") throw new Error("spawn is required");
  if (!path) throw new Error("path is required");
  if (!baseDir) throw new Error("baseDir is required");
  const serviceLogger = logger || createLogger("input-url-resolver");

  async function resolveAbemaShortUrl(url) {
    const raw = String(url || "").trim();
    if (!/^https?:\/\/abema\.go\.link\/[^/?#]+/i.test(raw)) {
      return raw;
    }
    if (typeof fetchWithTimeout !== "function") {
      return raw;
    }

    try {
      const response = await fetchWithTimeout(
        raw,
        {
          method: "HEAD",
          redirect: "follow",
        },
        10000,
      );
      return String(response?.url || raw).trim() || raw;
    } catch (error) {
      serviceLogger.warn("abema短縮URLの解決に失敗", {
        url: raw,
        error: error.message,
      });
      return raw;
    }
  }

  async function getUrlsFromInput(url, cookiePath) {
    const resolvedUrl = await resolveAbemaShortUrl(url);

    return new Promise((resolve, reject) => {
      const ytDlpPath = path.join(baseDir, "yt-dlp.exe");
      let args = [];
      const commonArgs = ["--skip-download", "--quiet", "--no-warnings"];
      if (cookiePath) {
        commonArgs.push("--cookies", cookiePath);
      }

      if (resolvedUrl.includes("youtube.com/playlist?list=")) {
        args = [resolvedUrl, "--flat-playlist", "--get-url", ...commonArgs];
      } else if (resolvedUrl.includes("youtube.com/watch?v=") || resolvedUrl.includes("youtu.be/")) {
        const cleanUrl = resolvedUrl.split("&")[0];
        resolve([cleanUrl]);
        return;
      } else if (resolvedUrl.includes("youtube.com/@") || resolvedUrl.includes("youtube.com/channel")) {
        args = [resolvedUrl, "--flat-playlist", "--get-id", ...commonArgs];
      } else if (resolvedUrl.includes("abema.tv/video/title/")) {
        args = [resolvedUrl, "--flat-playlist", "--get-url", ...commonArgs];
      } else if (resolvedUrl.includes("abema.tv/video/episode/")) {
        resolve([resolvedUrl]);
        return;
      } else {
        resolve([resolvedUrl]);
        return;
      }

      serviceLogger.info("yt-dlp input resolve command", {
        ytDlpPath,
        args: args.join(" "),
      });
      const ytDlp = spawn(ytDlpPath, args, { windowsHide: true });
      let videoUrls = "";
      ytDlp.stdout.on("data", (data) => {
        videoUrls += data.toString();
      });

      ytDlp.stderr.on("data", (data) => {
        serviceLogger.warn("yt-dlp stderr", { url: resolvedUrl, message: String(data).trim() });
      });

      ytDlp.on("close", (code) => {
        if (code === 0) {
          const urls = videoUrls.split("\n").filter((u) => u.trim() !== "");
          if (resolvedUrl.includes("youtube.com/@") || resolvedUrl.includes("youtube.com/channel")) {
            resolve(urls.map((id) => `https://www.youtube.com/watch?v=${id}`));
          } else {
            resolve(urls);
          }
          return;
        }
        reject(new Error(`yt-dlp exited with code ${code} for URL: ${resolvedUrl}`));
      });

      ytDlp.on("error", (err) => {
        reject(err);
      });
    });
  }

  return {
    getUrlsFromInput,
  };
}

module.exports = {
  createInputUrlResolver,
};
