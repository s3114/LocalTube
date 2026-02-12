const { createLogger } = require("./logger-service");

function createDownloadQueueService({
  jobHistory,
  broadcast,
  processJob,
  maxRetries = 3,
  retryDelayMs = 5000,
}) {
  const logger = createLogger("download-queue");
  if (!jobHistory) throw new Error("jobHistory is required");
  if (typeof processJob !== "function") throw new Error("processJob is required");

  const downloadQueue = [];
  let activeDownloads = 0;
  let maxConcurrentDownloads = 1;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setMaxConcurrentDownloads(value) {
    const parsed = parseInt(value, 10);
    maxConcurrentDownloads = parsed > 0 ? parsed : 1;
    startNextDownload();
  }

  function enqueueJobs(jobs) {
    const list = Array.isArray(jobs) ? jobs : [];
    for (const job of list) {
      downloadQueue.push(job);
      jobHistory.set(job.id, job);
    }
    startNextDownload();
  }

  function getSnapshot() {
    return {
      activeDownloads,
      queuedDownloads: downloadQueue.length,
      maxConcurrentDownloads,
    };
  }

  async function runJob(job) {
    job.status = "downloading";
    job.progress.eta = "開始中...";
    broadcast("status_update", {
      id: job.id,
      status: job.status,
      progress: job.progress,
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await processJob(job);
        job.status = "completed";
        job.progress.eta = "完了";
        broadcast("status_update", {
          id: job.id,
          status: job.status,
          progress: job.progress,
        });
        return;
      } catch (error) {
        logger.error("ジョブ失敗", {
          attempt: `${attempt}/${maxRetries}`,
          jobId: job.id,
          error: error.message,
        });

        if (attempt === maxRetries) {
          job.status = "error";
          job.progress.eta = `${error.message}`;
          broadcast("status_update", {
            id: job.id,
            status: "error",
            progress: job.progress,
            error: error.message,
          });
          return;
        }

        job.progress.eta = `${retryDelayMs / 1000}秒後に再試行... (${attempt})`;
        broadcast("status_update", {
          id: job.id,
          status: "downloading",
          progress: job.progress,
        });
        await sleep(retryDelayMs);
      }
    }
  }

  function startNextDownload() {
    while (activeDownloads < maxConcurrentDownloads && downloadQueue.length > 0) {
      const job = downloadQueue.shift();
      if (!job) continue;

      activeDownloads++;
      (async () => {
        try {
          await runJob(job);
        } finally {
          activeDownloads--;
          startNextDownload();
        }
      })();
    }
  }

  return {
    enqueueJobs,
    setMaxConcurrentDownloads,
    startNextDownload,
    getSnapshot,
  };
}

module.exports = {
  createDownloadQueueService,
};
