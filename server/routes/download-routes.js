const { createLogger } = require("../services/logger-service");

function registerDownloadRoutes(
  app,
  {
    upload,
    crypto,
    jobHistory,
    broadcast,
    downloadQueueService,
    getUrlsFromInput,
    fs,
    path,
    baseDir,
    apiOk,
    apiError,
    logger,
    downloadEstimateService,
  },
) {
  const routeLogger = logger || createLogger("route-download");
  const DOWNLOAD_ESTIMATE_CONCURRENCY = 30;

  function parseEstimateEntries(rawValue) {
    const text = String(rawValue || "").trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  async function mapWithConcurrency(items, concurrency, iteratee) {
    const list = Array.isArray(items) ? items : [];
    const limit = Math.max(1, Number(concurrency) || 1);
    const results = new Array(list.length);
    let nextIndex = 0;

    async function worker() {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= list.length) {
          return;
        }
        results[currentIndex] = await iteratee(list[currentIndex], currentIndex);
      }
    }

    const workerCount = Math.min(limit, list.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  async function buildResolvedEntries(inputUrls, cookieFile) {
    const resolvedGroups = await mapWithConcurrency(
      inputUrls,
      DOWNLOAD_ESTIMATE_CONCURRENCY,
      async (url) => {
        const entries = [];
        try {
          const videoUrls = await getUrlsFromInput(url, cookieFile?.path);
          for (const videoUrl of videoUrls) {
            entries.push({
              inputUrl: String(url || "").trim(),
              resolvedUrl: String(videoUrl || "").trim(),
            });
          }
        } catch (error) {
          routeLogger.warn("URLの解析に失敗", { url, error: error.message });
        }
        return entries;
      },
    );
    return resolvedGroups.flat();
  }

  async function buildEstimatedEntries(resolvedEntries, { cookieFile, format, downloadVideo }) {
    return mapWithConcurrency(
      resolvedEntries,
      DOWNLOAD_ESTIMATE_CONCURRENCY,
      async (entry) => {
      try {
        return await downloadEstimateService.estimateUrl(entry.resolvedUrl, {
          cookiePath: cookieFile?.path,
          format,
          downloadVideo,
        });
      } catch (error) {
        routeLogger.warn("サイズ見積もりに失敗", {
          url: entry.resolvedUrl,
          error: error.message,
        });
        return {
          url: entry.resolvedUrl,
          title: entry.resolvedUrl,
          estimatedBytes: null,
          estimatedSizeText: "不明",
        };
      }
      },
    );
  }

  function buildEstimateMap(rawValue) {
    const map = new Map();
    for (const entry of parseEstimateEntries(rawValue)) {
      const key = String(entry?.url || "").trim();
      if (!key) continue;
      map.set(key, entry);
    }
    return map;
  }

  app.post("/api/clear-history", async (_req, res) => {
    try {
      const historyPath = path.join(baseDir, "finished.txt");
      await fs.promises.writeFile(historyPath, "", "utf-8");
      routeLogger.info("ダウンロード履歴を削除");
      apiOk(res, { message: "履歴を削除しました。" });
    } catch (error) {
      routeLogger.error("履歴の削除に失敗", { error: error.message });
      apiError(res, 500, "履歴の削除に失敗しました。");
    }
  });

  app.get("/jobs", (_req, res) => {
    apiOk(res, Array.from(jobHistory.values()));
  });

  app.post("/api/download-estimate", upload.single("cookieFile"), async (req, res) => {
    const {
      urls,
      format,
      downloadVideo,
    } = req.body;
    const cookieFile = req.file;

    if (!urls) {
      return apiError(res, 400, "動画のURLは必須です。");
    }
    if (!downloadEstimateService) {
      return apiError(res, 500, "サイズ見積もりサービスが利用できません。");
    }

    const inputUrls = urls.split(/[\n\s,]+/).filter((url) => url.trim() !== "");
    const resolvedEntries = await buildResolvedEntries(inputUrls, cookieFile);
    const estimatedEntries = await buildEstimatedEntries(resolvedEntries, {
      cookieFile,
      format,
      downloadVideo,
    });

    apiOk(res, {
      entries: estimatedEntries,
      summary: downloadEstimateService.buildEstimateSummary(estimatedEntries),
    });
  });

  app.post("/download", upload.single("cookieFile"), async (req, res) => {
    const {
      urls,
      format,
      saveHistory,
      downloadThumb,
      embedThumbnail,
      addMetadata,
      remuxVideo,
      forceIpv4,
      drmProtect,
      savePath,
      parallelDownloads,
      concurrentFragments,
      commentOptions,
      downloadComments,
      downloadChat,
      downloadVideo,
      estimateEntriesJson,
    } = req.body;
    const cookieFile = req.file;

    if (!urls) {
      return apiError(res, 400, "動画のURLは必須です。");
    }

    downloadQueueService.setMaxConcurrentDownloads(parallelDownloads);

    const inputUrls = urls.split(/[\n\s,]+/).filter((url) => url.trim() !== "");
    const estimateMap = buildEstimateMap(estimateEntriesJson);
    const resolvedEntries = await buildResolvedEntries(inputUrls, cookieFile);
    const newJobs = [];

    for (const entry of resolvedEntries) {
      const estimate = estimateMap.get(entry.resolvedUrl);
      const jobId = crypto.randomUUID();
      const job = {
        id: jobId,
        url: entry.resolvedUrl,
        options: {
          format,
          saveHistory: saveHistory === "true",
          downloadThumb: downloadThumb === true || downloadThumb === "true",
          embedThumbnail: embedThumbnail !== "false",
          addMetadata: addMetadata !== "false",
          remuxVideo: remuxVideo === true || remuxVideo === "true",
          forceIpv4: forceIpv4 === "true",
          drmProtect: drmProtect === "true",
          downloadComments:
            downloadComments === true || downloadComments === "true",
          downloadChat: downloadChat === true || downloadChat === "true",
          downloadVideo: downloadVideo === true || downloadVideo === "true",
          savePath,
          concurrentFragments,
          commentOptions,
        },
        cookieFile,
        status: "queued",
        title: String(estimate?.title || entry.resolvedUrl).trim(),
        progress: {
          percentage: 0,
          size: "",
          totalSize: "",
          speed: "",
          eta: "",
          estimatedTotalSize: String(estimate?.estimatedSizeText || "").trim(),
        },
      };
      newJobs.push(job);
    }

    broadcast("jobs_added", newJobs);

    apiOk(
      res,
      { message: `${newJobs.length}件のダウンロードがキューに追加されました。` },
      202,
    );

    downloadQueueService.enqueueJobs(newJobs);
  });
}

module.exports = {
  registerDownloadRoutes,
};
