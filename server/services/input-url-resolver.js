const { createLogger } = require("./logger-service");

function createInputUrlResolver({ spawn, path, baseDir, logger }) {
  if (typeof spawn !== "function") throw new Error("spawn is required");
  if (!path) throw new Error("path is required");
  if (!baseDir) throw new Error("baseDir is required");
  const serviceLogger = logger || createLogger("input-url-resolver");

  function getUrlsFromInput(url, cookiePath) {
    return new Promise((resolve, reject) => {
      const ytDlpPath = path.join(baseDir, "yt-dlp.exe");
      let args = [];
      const commonArgs = ["--skip-download", "--quiet", "--no-warnings"];
      if (cookiePath) {
        commonArgs.push("--cookies", cookiePath);
      }

      if (url.includes("youtube.com/playlist?list=")) {
        args = [url, "--flat-playlist", "--get-url", ...commonArgs];
      } else if (url.includes("youtube.com/watch?v=") || url.includes("youtu.be/")) {
        const cleanUrl = url.split("&")[0];
        resolve([cleanUrl]);
        return;
      } else if (url.includes("youtube.com/@") || url.includes("youtube.com/channel")) {
        args = [url, "--flat-playlist", "--get-id", ...commonArgs];
      } else if (url.includes("abema.tv/video/title/")) {
        args = [url, "--flat-playlist", "--get-url", ...commonArgs];
      } else if (url.includes("abema.tv/video/episode/")) {
        resolve([url]);
        return;
      } else {
        resolve([url]);
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
        serviceLogger.warn("yt-dlp stderr", { url, message: String(data).trim() });
      });

      ytDlp.on("close", (code) => {
        if (code === 0) {
          const urls = videoUrls.split("\n").filter((u) => u.trim() !== "");
          if (url.includes("youtube.com/@") || url.includes("youtube.com/channel")) {
            resolve(urls.map((id) => `https://www.youtube.com/watch?v=${id}`));
          } else {
            resolve(urls);
          }
          return;
        }
        reject(new Error(`yt-dlp exited with code ${code} for URL: ${url}`));
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
