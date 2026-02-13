const { execFileSync } = require("child_process");
const { createLogger } = require("./logger-service");

function createDownloadJobService({
  fs,
  path,
  spawn,
  iconv,
  baseDir,
  downloadsDir,
  movieDir,
  thumbnailDir,
  pendingChatDir,
  jobQueueService,
  broadcast,
  loadConfig,
}) {
  const logger = createLogger("download-job");
  const LIVE_CHAT_JSON_PATTERN = /\.live_chat(?:\.[^.]+)?\.json$/i;

  function buildArgs(job, paths, settings) {
    const { url, options } = job;
    const { movieDir: targetMovieDir, thumbnailDir: targetThumbDir, tempDir } = paths;

    const args = [
      url,
      "-o",
      "%(upload_date)s-%(title)s.%(ext)s",
      "-P",
      `home:${targetMovieDir}`,
      "-P",
      `temp:${tempDir}`,
      "--embed-thumbnail",
      "--add-metadata",
      "--ignore-errors",
      "--retries",
      "infinite",
      "--progress",
      "--no-color",
      "--newline",
    ];

    if (options.format && !url.includes("abema.tv")) args.push("-f", options.format);
    if (options.downloadThumb) {
      args.push("--write-thumbnail");
      args.push("-P", `thumbnail:${targetThumbDir}`);
    }
    if (options.saveHistory) {
      args.push("--download-archive", path.join(baseDir, "finished.txt"));
    }
    if (job.cookieFile) {
      args.push("--cookies", job.cookieFile.path);
    } else if (settings && settings.selectedBrowser) {
      args.push("--cookies-from-browser", settings.selectedBrowser);
    }
    if (options.concurrentFragments && parseInt(options.concurrentFragments, 10) > 0) {
      args.push("--concurrent-fragments", options.concurrentFragments);
    }
    if (options.drmProtect) {
      args.push(
        "--add-header",
        "youtube:player-client=default,-tv,web_safari,web_embedded",
      );
    }
    if (options.commentOptions === "comments" || options.commentOptions === "both") {
      args.push("--get-comments");
    }
    if (options.commentOptions === "sub" || options.commentOptions === "both") {
      args.push("--write-subs");
      args.push("--sub-langs", "live_chat,all");
    }

    return args;
  }

  async function loadSettingsSafe() {
    try {
      return (await loadConfig?.()) || {};
    } catch (error) {
      logger.error("設定読み込み失敗", { error: error.message });
      return {};
    }
  }

  function resolveOutputPaths(job) {
    const customSavePath =
      job.options.savePath && job.options.savePath.trim() !== ""
        ? job.options.savePath
        : null;
    return {
      customSavePath,
      finalMovieDir: customSavePath || movieDir,
      finalThumbnailDir: customSavePath
        ? path.join(customSavePath, "サムネイル")
        : thumbnailDir,
      finalTempDir: customSavePath || downloadsDir,
    };
  }

  function ensureCustomOutputDirs(job, paths) {
    const { customSavePath, finalMovieDir, finalThumbnailDir } = paths;
    if (!customSavePath) return;

    if (!fs.existsSync(finalMovieDir)) {
      fs.mkdirSync(finalMovieDir, { recursive: true });
    }
    if (job.options.downloadThumb && !fs.existsSync(finalThumbnailDir)) {
      fs.mkdirSync(finalThumbnailDir, { recursive: true });
    }
  }

  function parseDownloadProgressFromLine(line) {
    const detailMatch = line.match(
      /\[download\]\s+([\d.]+)%\s+of\s+(.+?)\s+at\s+(.+?)\s+ETA\s+(.+)/i,
    );
    if (detailMatch) {
      return {
        percentage: Math.max(0, Math.min(100, parseFloat(detailMatch[1]))),
        totalSize: detailMatch[2],
        speed: detailMatch[3],
        eta: detailMatch[4],
      };
    }

    const simpleMatch = line.match(/\[download\]\s+([\d.]+)%/i);
    if (!simpleMatch) return null;
    return {
      percentage: Math.max(0, Math.min(100, parseFloat(simpleMatch[1]))),
      totalSize: "",
      speed: "",
      eta: "ダウンロード中...",
    };
  }

  function parseCommentProgressFromLine(line, progressState, currentProgress) {
    const sectionMatch = line.match(/\[youtube\]\s+Downloading comment section API JSON/i);
    if (sectionMatch) {
      return {
        percentage: currentProgress?.percentage || 0,
        totalSize: currentProgress?.totalSize || "",
        speed: "",
        eta: "コメント取得の準備中...",
      };
    }

    const totalMatch = line.match(/\[youtube\]\s+Downloading\s+~?(\d+)\s+comments/i);
    if (totalMatch) {
      progressState.commentTotal = Number(totalMatch[1]);
      progressState.commentCurrent = 0;
      const total = progressState.commentTotal || 0;
      return {
        percentage: progressState.sawDownload ? 85 : 0,
        totalSize: total > 0 ? `0/${total} comments` : "",
        speed: "",
        eta: total > 0 ? `コメント取得中 (0/${total})` : "コメント取得中...",
      };
    }

    const pageMatch = line.match(
      /\[youtube\]\s+Downloading comment API JSON page \d+\s+\((\d+)\/~?(\d+)\)/i,
    );
    if (pageMatch) {
      const current = Number(pageMatch[1]);
      const total = Number(pageMatch[2]);
      progressState.commentCurrent = Number.isFinite(current) ? current : 0;
      progressState.commentTotal = Number.isFinite(total) && total > 0 ? total : null;

      const ratio =
        progressState.commentTotal && progressState.commentTotal > 0
          ? Math.max(0, Math.min(1, progressState.commentCurrent / progressState.commentTotal))
          : 0;
      const percentage = progressState.sawDownload
        ? 85 + Math.round(ratio * 14)
        : Math.round(ratio * 100);
      const currentText = progressState.commentCurrent || 0;
      const totalText = progressState.commentTotal || "?";
      return {
        percentage,
        totalSize: `${currentText}/${totalText} comments`,
        speed: "",
        eta: `コメント取得中 (${currentText}/${totalText})`,
      };
    }

    const extractedMatch = line.match(/\[youtube\]\s+Extracted\s+(\d+)\s+comments/i);
    if (extractedMatch) {
      const extracted = Number(extractedMatch[1]);
      progressState.commentCurrent = Number.isFinite(extracted) ? extracted : 0;
      if (!progressState.commentTotal || progressState.commentTotal < progressState.commentCurrent) {
        progressState.commentTotal = progressState.commentCurrent;
      }
      const currentText = progressState.commentCurrent || 0;
      const totalText = progressState.commentTotal || currentText || "?";
      return {
        percentage: progressState.sawDownload ? 99 : 100,
        totalSize: `${currentText}/${totalText} comments`,
        speed: "",
        eta: `コメント抽出完了 (${currentText}件)`,
      };
    }

    return null;
  }

  function parseProgressFromLine(line, progressState, currentProgress) {
    const downloadProgress = parseDownloadProgressFromLine(line);
    if (downloadProgress) {
      progressState.sawDownload = true;
      return downloadProgress;
    }
    return parseCommentProgressFromLine(line, progressState, currentProgress);
  }

  function getTitle(ytDlpPath, url, cookiePath, settings) {
    return new Promise((resolve, reject) => {
      const args = [url, "--get-title", "--no-warnings"];
      if (cookiePath) {
        args.push("--cookies", cookiePath);
      } else if (settings && settings.selectedBrowser) {
        args.push("--cookies-from-browser", settings.selectedBrowser);
      }
      logger.info("タイトル取得コマンド実行", { args: args.join(" ") });

      const ytDlpProcess = spawn(ytDlpPath, args, { windowsHide: true });
      const stdoutChunks = [];
      const stderrChunks = [];

      ytDlpProcess.stdout.on("data", (data) => stdoutChunks.push(data));
      ytDlpProcess.stderr.on("data", (data) => stderrChunks.push(data));

      ytDlpProcess.on("close", (code) => {
        const stdoutBuffer = Buffer.concat(stdoutChunks);
        const title = iconv.decode(stdoutBuffer, "cp932");
        if (code === 0 && title.trim() !== "") {
          resolve(title.trim());
          return;
        }

        const stderrBuffer = Buffer.concat(stderrChunks);
        const stderr = iconv.decode(stderrBuffer, "cp932");
        reject(new Error(`yt-dlp exited with code ${code}. Stderr: ${stderr}`));
      });

      ytDlpProcess.on("error", (err) => reject(err));
    });
  }

  function enrichInfoWithChannelThumbnail(infoObj, job, settings) {
    if (typeof infoObj.channel_url !== "string") return infoObj;

    try {
      const channelArgs = ["-J", "--no-playlist", "--playlist-items", "0"];
      if (job.cookieFile?.path) {
        channelArgs.push("--cookies", job.cookieFile.path);
      } else if (settings && settings.selectedBrowser) {
        channelArgs.push("--cookies-from-browser", settings.selectedBrowser);
      }
      channelArgs.push(infoObj.channel_url);

      const channelJson = execFileSync(path.join(baseDir, "yt-dlp.exe"), channelArgs, {
        encoding: "utf-8",
        timeout: 3000,
        windowsHide: true,
      });
      const channelObj = JSON.parse(channelJson);

      try {
        const channelSaveDir = path.join(downloadsDir, "チャンネル");
        fs.mkdirSync(channelSaveDir, { recursive: true });
        fs.writeFileSync(
          path.join(channelSaveDir, `${channelObj.channel_id}.channel.json`),
          channelJson,
          "utf-8",
        );
      } catch (err) {
        logger.warn("チャンネルJSON保存失敗", { error: err.message });
      }

      let avatar = null;
      if (Array.isArray(channelObj.thumbnails)) {
        avatar = channelObj.thumbnails.find((t) => t.id === "avatar_uncropped");
        if (!avatar) {
          avatar = channelObj.thumbnails.reduce((best, cur) => {
            if (!best) return cur;
            if (
              typeof cur.preference === "number" &&
              typeof best.preference === "number"
            ) {
              return cur.preference > best.preference ? cur : best;
            }
            return best;
          }, null);
        }
        if (!avatar && channelObj.thumbnails.length > 0) {
          avatar = channelObj.thumbnails[0];
        }
      }

      if (avatar?.url) {
        infoObj.channel_thumbnail = avatar.url;
      }
    } catch (err) {
      logger.warn("チャンネル情報取得失敗", { error: err.message });
    }

    return infoObj;
  }

  function moveOptionalFile(src, dest, kind) {
    if (!fs.existsSync(src)) {
      logger.warn(`${kind} が見つかりません`, { path: src });
      return false;
    }
    fs.renameSync(src, dest);
    logger.info(`仮置きへ移動（${kind}）`, { path: dest });
    return true;
  }

  function stageDownloadedExtraFiles(job, settings, finalMovieDir) {
    const files = fs.readdirSync(finalMovieDir);
    const infoFile = files.find((f) => f.endsWith(".info.json"));
    const chatFile = files.find((f) => LIVE_CHAT_JSON_PATTERN.test(f));

    const jobPendingDir = path.join(pendingChatDir, `job_${Date.now()}`);
    fs.mkdirSync(jobPendingDir, { recursive: true });
    logger.info("仮置きジョブフォルダ作成", { path: jobPendingDir });

    if (infoFile) {
      const src = path.join(finalMovieDir, infoFile);
      const dest = path.join(jobPendingDir, infoFile);
      if (fs.existsSync(src)) {
        try {
          const raw = fs.readFileSync(src, "utf-8");
          const parsed = JSON.parse(raw);
          const updated = enrichInfoWithChannelThumbnail(parsed, job, settings);
          fs.writeFileSync(src, JSON.stringify(updated, null, 2), "utf-8");
        } catch (error) {
          logger.warn("info.json書き換え失敗", { error: error.message });
        }
        moveOptionalFile(src, dest, "info");
      }
    }

    if (chatFile) {
      const src = path.join(finalMovieDir, chatFile);
      const dest = path.join(jobPendingDir, chatFile);
      moveOptionalFile(src, dest, "chat");
    } else {
      logger.warn("live chat ファイルが見つかりません", {
        finalMovieDir,
      });
    }

    return { infoFile, jobPendingDir };
  }

  async function runYtDlpDownload(job, settings, ytDlpPath, paths) {
    return new Promise((resolve, reject) => {
      const args = buildArgs(
        job,
        {
          movieDir: paths.finalMovieDir,
          thumbnailDir: paths.finalThumbnailDir,
          tempDir: paths.finalTempDir,
        },
        settings,
      );
      logger.info("ダウンロードコマンド実行", { args: args.join(" ") });
      const ytDlp = spawn(ytDlpPath, args, { windowsHide: true });

      let stderrOutput = "";
      let stdoutBuffer = "";
      const progressState = {
        sawDownload: false,
        commentTotal: null,
        commentCurrent: 0,
      };

      ytDlp.stdout.on("data", (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split(/[\r\n]/);
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() === "") continue;
          const progress = parseProgressFromLine(line, progressState, job.progress);
          if (!progress) continue;
          job.progress = {
            ...job.progress,
            ...progress,
          };
          broadcast("progress_update", { id: job.id, progress: job.progress });
        }
      });

      ytDlp.stderr.on("data", (data) => {
        const errorMsg = data.toString().trim();
        stderrOutput += `${errorMsg}\n`;
        logger.warn("yt-dlp stderr", { message: errorMsg });
      });

      ytDlp.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`yt-dlpがエラーコード${code}で終了しました。Stderr: ${stderrOutput}`));
      });

      ytDlp.on("error", (err) => {
        reject(new Error(`yt-dlpプロセスの起動に失敗: ${err.message}`));
      });
    });
  }

  async function processDownloadJob(job) {
    const ytDlpPath = path.join(baseDir, "yt-dlp.exe");
    const settings = await loadSettingsSafe();

    try {
      const title = await getTitle(ytDlpPath, job.url, job.cookieFile?.path, settings);
      job.title = title;
      broadcast("title_update", { id: job.id, title: job.title });
    } catch (error) {
      throw new Error(`タイトル取得失敗: ${error.message}`);
    }

    const paths = resolveOutputPaths(job);
    try {
      ensureCustomOutputDirs(job, paths);
    } catch (error) {
      throw new Error(`保存先準備失敗: ${error.message}`);
    }

    await runYtDlpDownload(job, settings, ytDlpPath, paths);

    const isProcessingExtras =
      job.options.commentOptions && job.options.commentOptions !== "none";
    if (isProcessingExtras) {
      job.progress.eta = "コメント/チャットを整理中...";
      broadcast("status_update", {
        id: job.id,
        status: "downloading",
        progress: job.progress,
      });
    }

    const { infoFile, jobPendingDir } = stageDownloadedExtraFiles(
      job,
      settings,
      paths.finalMovieDir,
    );

    if (!infoFile) {
      logger.warn("info.json が無いため登録不可", { jobPendingDir });
      broadcast("status_update", {
        id: job.id,
        status: "completed",
        progress: { percent: 100, eta: "スキップ完了（info.jsonなし）" },
      });
      return;
    }

    jobQueueService.enqueueJob(jobPendingDir);
    broadcast("status_update", {
      id: job.id,
      status: "completed",
      progress: { percent: 100, eta: "完了" },
    });
  }

  return {
    processDownloadJob,
  };
}

module.exports = {
  createDownloadJobService,
};
