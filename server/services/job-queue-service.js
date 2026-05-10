const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { createLogger } = require("./logger-service");

function createJobQueueService({
  rootDir,
  pendingChatDir,
  commentsDir,
  liveChatDir,
  subtitleDir,
  broadcast,
  runScript,
  enableWatch = true,
}) {
  const logger = createLogger("job-queue");
  const LIVE_CHAT_JSON_PATTERN = /\.live_chat(?:\.[^.]+)?\.json$/i;
  if (!rootDir) throw new Error("rootDir is required");
  if (!pendingChatDir) throw new Error("pendingChatDir is required");

  fs.mkdirSync(pendingChatDir, { recursive: true });

  const processingQueue = [];
  const pendingResolvers = new Map();
  let isProcessing = false;

  function defaultRunBatchScript(command) {
    return new Promise((resolve, reject) => {
      logger.info("スクリプト実行", { command });
      const proc = exec(command, { shell: "powershell.exe", windowsHide: true });
      proc.stdout.on("data", (data) =>
        logger.info("script stdout", { message: data.toString().trim() }),
      );
      proc.stderr.on("data", (data) =>
        logger.warn("script stderr", { message: data.toString().trim() }),
      );
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`スクリプト終了コード: ${code}`));
      });
    });
  }
  const runBatchScript = runScript || defaultRunBatchScript;

  async function moveExtraFiles(sourceDir) {
    try {
      const files = await fs.promises.readdir(sourceDir);
      for (const file of files) {
        const oldPath = path.join(sourceDir, file);
        try {
          const stat = await fs.promises.stat(oldPath);
          if (!stat.isFile()) continue;
        } catch (e) {
          if (e.code === "ENOENT") continue;
          throw e;
        }

        let newPath;
        if (file.endsWith(".info.json")) {
          newPath = path.join(commentsDir, file);
        } else if (LIVE_CHAT_JSON_PATTERN.test(file)) {
          newPath = path.join(liveChatDir, file);
        } else if (file.endsWith(".vtt") || file.endsWith(".srt")) {
          newPath = path.join(subtitleDir, file);
        }

        if (!newPath) continue;

        try {
          await fs.promises.rename(oldPath, newPath);
          logger.info("ファイル移動", { file, to: newPath });
        } catch (err) {
          logger.error("ファイル移動失敗", { file, error: err.message });
        }
      }
    } catch (err) {
      logger.error("追加ファイル仕分け失敗", {
        sourceDir,
        error: err.message,
      });
    }

    try {
      if (sourceDir.startsWith(pendingChatDir)) {
        logger.info("仮置きジョブフォルダ削除", { sourceDir });
        fs.rmSync(sourceDir, { recursive: true, force: true });
      }
    } catch (err) {
      logger.error("仮置きフォルダ削除失敗", {
        sourceDir,
        error: err.message,
      });
    }
  }

  async function processQueue() {
    if (isProcessing || processingQueue.length === 0) return;
    isProcessing = true;
    const jobPath = processingQueue.shift();
    const pending = pendingResolvers.get(jobPath);

    logger.info("処理開始", { jobPath });
    try {
      await runBatchScript(
        `node "${path.join(rootDir, "メンバーバッチ保存.js")}" "${jobPath}"`,
      );
      await runBatchScript(
        `node "${path.join(rootDir, "メンバー絵文字保存.js")}" "${jobPath}"`,
      );
      await moveExtraFiles(jobPath);
      logger.info("処理完了", { jobPath });
      pending?.resolve?.();
    } catch (err) {
      logger.error("処理失敗", { jobPath, error: err.message });
      pending?.reject?.(err);
      if (typeof broadcast === "function") {
        broadcast("status_update", {
          id: path.basename(jobPath),
          status: "error",
          progress: { percent: 0, eta: "処理エラー" },
        });
      }
    } finally {
      pendingResolvers.delete(jobPath);
      isProcessing = false;
      if (processingQueue.length > 0) processQueue();
    }
  }

  function enqueueJob(jobPath) {
    if (!jobPath) return Promise.resolve();
    const existing = pendingResolvers.get(jobPath);
    if (existing?.promise) {
      return existing.promise;
    }

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    promise.catch(() => {});
    pendingResolvers.set(jobPath, {
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
    });

    if (!processingQueue.includes(jobPath)) {
      processingQueue.push(jobPath);
      logger.info("ジョブ登録", { jobPath });
    }
    setTimeout(processQueue, 300);
    return promise;
  }

  if (enableWatch) {
    fs.watch(pendingChatDir, (_eventType, filename) => {
      if (!filename || !filename.startsWith("job_")) return;
      const jobPath = path.join(pendingChatDir, filename);
      try {
        if (fs.existsSync(jobPath) && fs.statSync(jobPath).isDirectory()) {
          logger.info("新ジョブ検出", { filename });
          enqueueJob(jobPath);
        }
      } catch (err) {
        logger.warn("ジョブ検出失敗", { jobPath, error: err.message });
      }
    });
  }

  return {
    enqueueJob,
    processQueue,
  };
}

module.exports = {
  createJobQueueService,
};
