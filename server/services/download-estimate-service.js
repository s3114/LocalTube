const { createLogger } = require("./logger-service");
const { resolveYtDlpPath } = require("./tool-path-service");

function createDownloadEstimateService({ spawn, path, baseDir, logger }) {
  if (typeof spawn !== "function") throw new Error("spawn is required");
  if (!path) throw new Error("path is required");
  if (!baseDir) throw new Error("baseDir is required");

  const serviceLogger = logger || createLogger("download-estimate");

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return "不明";

    const units = ["B", "KB", "MB", "GB", "TB"];
    let unitIndex = 0;
    let size = value;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const digits = size >= 100 || unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(digits).replace(/\.0$/, "")} ${units[unitIndex]}`;
  }

  function extractNumericSize(candidate) {
    const size = Number(candidate);
    return Number.isFinite(size) && size > 0 ? size : null;
  }

  function sumKnownSizes(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    let total = 0;
    let found = false;
    for (const item of items) {
      const size =
        extractNumericSize(item?.filesize) ??
        extractNumericSize(item?.filesize_approx);
      if (!size) continue;
      total += size;
      found = true;
    }
    return found ? total : null;
  }

  function extractEstimatedBytes(info) {
    return (
      extractNumericSize(info?.filesize) ??
      extractNumericSize(info?.filesize_approx) ??
      sumKnownSizes(info?.requested_downloads) ??
      sumKnownSizes(info?.requested_formats)
    );
  }

  function isCurrentlyLive(info) {
    if (info?.is_live === true) return true;
    return String(info?.live_status || "").trim().toLowerCase() === "is_live";
  }

  function shouldRetryWithoutFormat(stderrText) {
    const text = String(stderrText || "").trim().toLowerCase();
    return text.includes("requested format is not available");
  }

  function runEstimateCommand(ytDlpPath, args) {
    return new Promise((resolve, reject) => {
      serviceLogger.info("ダウンロードサイズ見積もりコマンド実行", {
        args: args.join(" "),
      });

      const child = spawn(ytDlpPath, args, { windowsHide: true });
      const stdoutChunks = [];
      const stderrChunks = [];

      child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
      child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

      child.on("close", (code) => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
        if (code !== 0) {
          reject(new Error(stderr || `yt-dlp exited with code ${code}`));
          return;
        }
        resolve({ stdout, stderr });
      });

      child.on("error", (error) => reject(error));
    });
  }

  async function estimateUrl(url, { cookiePath, selectedBrowser, format, downloadVideo } = {}) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      return {
        url: normalizedUrl,
        title: normalizedUrl,
        estimatedBytes: null,
        estimatedSizeText: "不明",
      };
    }

    const ytDlpPath = resolveYtDlpPath(baseDir);
    const baseArgs = [
      normalizedUrl,
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
    ];
    const canUseFormat =
      (downloadVideo === true || downloadVideo === "true") &&
      format &&
      !normalizedUrl.includes("abema.tv");
    const formatArgs = canUseFormat ? ["-f", String(format)] : [];
    const cookieArgs = cookiePath
      ? ["--cookies", cookiePath]
      : (selectedBrowser ? ["--cookies-from-browser", String(selectedBrowser)] : []);

    return (async () => {
      let stdout = "";

      try {
        ({ stdout } = await runEstimateCommand(ytDlpPath, [
          ...baseArgs,
          ...formatArgs,
          ...cookieArgs,
        ]));
      } catch (error) {
        if (!formatArgs.length || !shouldRetryWithoutFormat(error.message)) {
          throw error;
        }
        serviceLogger.warn("サイズ見積もりでformat指定が使えないため再試行", {
          url: normalizedUrl,
          error: error.message,
        });
        ({ stdout } = await runEstimateCommand(ytDlpPath, [
          ...baseArgs,
          ...cookieArgs,
        ]));
      }

      const info = JSON.parse(stdout);
      if (isCurrentlyLive(info)) {
        return {
          url: normalizedUrl,
          title: String(info?.title || normalizedUrl),
          estimatedBytes: null,
          estimatedSizeText: "配信中のため未取得",
          skippedLiveEstimate: true,
        };
      }
      const estimatedBytes = extractEstimatedBytes(info);
      return {
        url: normalizedUrl,
        title: String(info?.title || normalizedUrl),
        estimatedBytes,
        estimatedSizeText: formatBytes(estimatedBytes),
      };
    })();
  }

  function buildEstimateSummary(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const liveSkippedCount = list.filter((entry) => entry?.skippedLiveEstimate === true).length;
    const known = list.filter((entry) => extractNumericSize(entry?.estimatedBytes) !== null);
    const unknownCount = list.length - known.length - liveSkippedCount;
    const totalKnownBytes = known.reduce(
      (sum, entry) => sum + Number(entry.estimatedBytes || 0),
      0,
    );

    let totalText = "不明";
    if (known.length > 0) {
      totalText = formatBytes(totalKnownBytes);
      if (liveSkippedCount > 0) {
        totalText = `${totalText} + 配信中${liveSkippedCount}件`;
      }
      if (unknownCount > 0) {
        totalText = `${totalText} + 不明${unknownCount}件`;
      }
    } else if (liveSkippedCount > 0) {
      totalText = "配信中のため未取得";
      if (unknownCount > 0) {
        totalText = `${totalText} + 不明${unknownCount}件`;
      }
    } else if (unknownCount > 0) {
      totalText = "不明";
    }

    return {
      count: list.length,
      totalKnownBytes,
      unknownCount,
      liveSkippedCount,
      totalText,
      label: `予測サイズ: ${totalText}${list.length > 0 ? ` (${list.length}件)` : ""}`,
    };
  }

  return {
    estimateUrl,
    buildEstimateSummary,
  };
}

module.exports = {
  createDownloadEstimateService,
};
