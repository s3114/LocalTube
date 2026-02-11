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
  },
) {
  app.post("/api/clear-history", async (_req, res) => {
    try {
      const historyPath = path.join(baseDir, "finished.txt");
      await fs.promises.writeFile(historyPath, "", "utf-8");
      console.log("ダウンロード履歴を削除しました。");
      apiOk(res, { message: "履歴を削除しました。" });
    } catch (error) {
      console.error("履歴の削除に失敗しました:", error);
      apiError(res, 500, "履歴の削除に失敗しました。");
    }
  });

  app.get("/jobs", (_req, res) => {
    apiOk(res, Array.from(jobHistory.values()));
  });

  app.post("/download", upload.single("cookieFile"), async (req, res) => {
    const {
      urls,
      format,
      saveHistory,
      downloadThumb,
      drmProtect,
      savePath,
      parallelDownloads,
      concurrentFragments,
      commentOptions,
    } = req.body;
    const cookieFile = req.file;

    if (!urls) {
      return apiError(res, 400, "動画のURLは必須です。");
    }

    downloadQueueService.setMaxConcurrentDownloads(parallelDownloads);

    const inputUrls = urls.split(/[\n\s,]+/).filter((url) => url.trim() !== "");
    const newJobs = [];

    for (const url of inputUrls) {
      try {
        const videoUrls = await getUrlsFromInput(url, cookieFile?.path);
        for (const videoUrl of videoUrls) {
          const jobId = crypto.randomUUID();
          const job = {
            id: jobId,
            url: videoUrl.trim(),
            options: {
              format,
              saveHistory: saveHistory === "true",
              downloadThumb: downloadThumb === "true",
              drmProtect: drmProtect === "true",
              savePath,
              concurrentFragments,
              commentOptions,
            },
            cookieFile,
            status: "queued",
            title: videoUrl.trim(),
            progress: {
              percentage: 0,
              size: "",
              totalSize: "",
              speed: "",
              eta: "",
            },
          };
          newJobs.push(job);
        }
      } catch (error) {
        console.error(`URLの解析に失敗しました: ${url}`, error);
      }
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
