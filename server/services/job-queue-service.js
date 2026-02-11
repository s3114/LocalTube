const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

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
  if (!rootDir) throw new Error("rootDir is required");
  if (!pendingChatDir) throw new Error("pendingChatDir is required");

  fs.mkdirSync(pendingChatDir, { recursive: true });

  const processingQueue = [];
  let isProcessing = false;

  function defaultRunBatchScript(command) {
    return new Promise((resolve, reject) => {
      console.log(`[EXEC] ${command}`);
      const proc = exec(command, { shell: "powershell.exe" });
      proc.stdout.on("data", (data) => console.log(data.toString()));
      proc.stderr.on("data", (data) => console.error(data.toString()));
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
        } else if (file.endsWith(".live_chat.json")) {
          newPath = path.join(liveChatDir, file);
        } else if (file.endsWith(".vtt") || file.endsWith(".srt")) {
          newPath = path.join(subtitleDir, file);
        }

        if (!newPath) continue;

        try {
          await fs.promises.rename(oldPath, newPath);
          console.log(`Moved ${file} to ${newPath}`);
        } catch (err) {
          console.error(`Failed to move ${file}: ${err}`);
        }
      }
    } catch (err) {
      console.error(`Error while sorting extra files in ${sourceDir}: ${err}`);
    }

    try {
      if (sourceDir.startsWith(pendingChatDir)) {
        console.log(`[A] 仮置きジョブフォルダを削除: ${sourceDir}`);
        fs.rmSync(sourceDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`[A] 仮置きフォルダ削除に失敗: ${sourceDir}`, err);
    }
  }

  async function processQueue() {
    if (isProcessing || processingQueue.length === 0) return;
    isProcessing = true;
    const jobPath = processingQueue.shift();

    console.log(`[QUEUE] 処理開始: ${jobPath}`);
    try {
      await runBatchScript(
        `node "${path.join(rootDir, "メンバーバッチ保存.js")}" "${jobPath}"`,
      );
      await runBatchScript(
        `node "${path.join(rootDir, "メンバー絵文字保存.js")}" "${jobPath}"`,
      );
      await moveExtraFiles(jobPath);
      console.log(`[QUEUE] 完了: ${jobPath}`);
    } catch (err) {
      console.error(`[QUEUE] エラー: ${jobPath}`, err);
      if (typeof broadcast === "function") {
        broadcast("status_update", {
          id: path.basename(jobPath),
          status: "error",
          progress: { percent: 0, eta: "処理エラー" },
        });
      }
    } finally {
      isProcessing = false;
      if (processingQueue.length > 0) processQueue();
    }
  }

  function enqueueJob(jobPath) {
    if (!jobPath) return;
    if (!processingQueue.includes(jobPath)) {
      processingQueue.push(jobPath);
      console.log(`[QUEUE] ジョブ登録: ${jobPath}`);
    }
    setTimeout(processQueue, 300);
  }

  if (enableWatch) {
    fs.watch(pendingChatDir, (_eventType, filename) => {
      if (!filename || !filename.startsWith("job_")) return;
      const jobPath = path.join(pendingChatDir, filename);
      try {
        if (fs.existsSync(jobPath) && fs.statSync(jobPath).isDirectory()) {
          console.log(`[QUEUE] 新ジョブ検出: ${filename}`);
          enqueueJob(jobPath);
        }
      } catch (err) {
        console.warn(`[QUEUE] ジョブ検出失敗: ${jobPath}`, err.message);
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
