const { execFileSync } = require("child_process");
const { createLogger } = require("./logger-service");
const { resolveFfmpegPath, resolveYtDlpPath } = require("./tool-path-service");

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
  const COMMENTS_JSON_PATTERN = /\.comments(?:\.[^.]+)?\.json$/i;
  const LIVE_FILTER_SKIP_FRAGMENT = "does not pass filter";
  const LIVE_ENDED_RETRY_MESSAGES = [
    "Video is no longer live",
    "Did not get any data blocks",
  ];
  let cachedFfmpegCheck = null;

  function normalizeYoutubeUrl(url) {
    const raw = String(url || "").trim();
    const studioMatch = raw.match(
      /^https?:\/\/studio\.youtube\.com\/video\/([A-Za-z0-9_-]{11})\/livestreaming/i,
    );
    if (studioMatch) {
      return `https://www.youtube.com/watch?v=${studioMatch[1]}`;
    }
    return raw;
  }

  function getUsableFfmpegPath() {
    if (cachedFfmpegCheck) {
      return cachedFfmpegCheck.ok ? cachedFfmpegCheck.path : null;
    }

    const ffmpegPath = resolveFfmpegPath(baseDir);
    try {
      execFileSync(ffmpegPath, ["-version"], {
        windowsHide: true,
        stdio: "ignore",
      });
      cachedFfmpegCheck = { ok: true, path: ffmpegPath };
      return ffmpegPath;
    } catch (error) {
      cachedFfmpegCheck = {
        ok: false,
        path: ffmpegPath,
        error,
      };
      logger.warn("ffmpeg 実行確認に失敗", {
        ffmpegPath,
        error: error.message,
        status: error.status,
      });
      return null;
    }
  }

  function assertFfmpegAvailable(job) {
    const ffmpegPath = getUsableFfmpegPath();
    if (ffmpegPath) return ffmpegPath;

    const downloadVideoEnabled =
      job.options.downloadVideo === true || job.options.downloadVideo === "true";
    const needsFfmpeg =
      (downloadVideoEnabled && job.options.embedThumbnail !== false) ||
      (downloadVideoEnabled && job.options.addMetadata !== false) ||
      (downloadVideoEnabled && Boolean(job.options.remuxVideo)) ||
      (downloadVideoEnabled &&
        Boolean(job.options.format && String(job.options.format).includes("+")));

    if (!needsFfmpeg) return null;

    const checkedPath = cachedFfmpegCheck?.path || resolveFfmpegPath(baseDir) || "ffmpeg";
    const status = cachedFfmpegCheck?.error?.status;
    throw new Error(
      `ffmpeg を起動できません: ${checkedPath}${typeof status === "number" ? ` (status=${status})` : ""}`,
    );
  }

  function splitCustomCommandArgs(commandText) {
    const text = String(commandText || "").trim();
    if (!text) return [];

    const args = [];
    let current = "";
    let quote = null;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === "\\" && quote && next === quote) {
        current += next;
        i += 1;
        continue;
      }

      if ((char === '"' || char === "'")) {
        if (!quote) {
          quote = char;
          continue;
        }
        if (quote === char) {
          quote = null;
          continue;
        }
      }

      if (!quote && /\s/.test(char)) {
        if (current) {
          args.push(current);
          current = "";
        }
        continue;
      }

      current += char;
    }

    if (current) {
      args.push(current);
    }

    return args;
  }

  function buildArgs(job, paths, settings, mode = {}) {
    const options = job.options;
    const url = normalizeYoutubeUrl(job.url);
    const { movieDir: targetMovieDir, thumbnailDir: targetThumbDir, tempDir } = paths;
    const ffmpegPath = getUsableFfmpegPath();
    const baseDownloadThumbEnabled =
      options.downloadThumb === true || options.downloadThumb === "true";
    const baseDownloadVideoEnabled =
      options.downloadVideo === true || options.downloadVideo === "true";
    const hasCookieOption = Boolean(job.cookieFile?.path || settings?.selectedBrowser);
    const liveReplayMode = mode.liveReplayMode === true;
    const liveVideoOnly = mode.liveVideoOnly === true;
    const liveChatOnly = mode.liveChatOnly === true;
    const plainRetryMode = mode.plainRetryMode === true;
    const downloadVideoEnabled = liveChatOnly ? false : baseDownloadVideoEnabled;
    const downloadThumbEnabled = liveChatOnly ? false : baseDownloadThumbEnabled;
    const enableComments =
      !liveVideoOnly && (options.commentOptions === "comments" || options.commentOptions === "both");
    const enableLiveChat =
      !liveVideoOnly && (options.commentOptions === "sub" || options.commentOptions === "both");

    const args = [
      url,
      "-o",
      "%(upload_date)s-%(title)s.%(ext)s",
      "-P",
      `home:${targetMovieDir}`,
      "-P",
      `temp:${tempDir}`,
      "--ignore-errors",
      "--retries",
      "infinite",
      "--progress",
      "--no-color",
      "--newline",
      "--merge-output-format",
      "mp4"
    ];
    if (!liveReplayMode && !plainRetryMode) {
      // ライブ特別処理の対象は「現在ライブ中」のみ。
      // was_live/post_live は通常動画として扱い、アーカイブを巻き込まない。
      args.push("--match-filter", "!is_live");
    }

    if (ffmpegPath) {
      args.push("--ffmpeg-location", ffmpegPath);
    }

    if (!downloadVideoEnabled) {
      args.push("--skip-download");
    }
    if (downloadVideoEnabled && options.addMetadata !== false) args.push("--add-metadata");
    if (downloadVideoEnabled && options.embedThumbnail !== false) args.push("--embed-thumbnail");
    if (options.forceIpv4) args.push("--force-ipv4");
    if (downloadVideoEnabled && options.format && !url.includes("abema.tv")) {
      args.push("-f", options.format);
    }
    if (downloadThumbEnabled) {
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
    if (hasCookieOption) {
      args.push(
        "--sleep-requests",
        "3",
        "--sleep-interval",
        "10",
        "--max-sleep-interval",
        "60",
      );
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
    if (enableComments) {
      args.push("--get-comments");
    }
    if (enableLiveChat) {
      args.push("--write-subs");
      args.push("--sub-langs", "live_chat,all");
    }
    if (liveReplayMode) {
      args.push(
        "--live-from-start",
        "--wait-for-video",
        "30",
        "--fragment-retries",
        "infinite",
        "--hls-use-mpegts",
      );
    }

    const customArgs = splitCustomCommandArgs(settings?.ytDlpCustomCommand);
    if (customArgs.length > 0) {
      args.push(...customArgs);
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
    const downloadThumbEnabled =
      job.options.downloadThumb === true || job.options.downloadThumb === "true";
    if (downloadThumbEnabled && !fs.existsSync(finalThumbnailDir)) {
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

  function applyProgressFromLine(job, line, progressState) {
    const progress = parseProgressFromLine(line, progressState, job.progress);
    if (!progress) return false;
    job.progress = {
      ...job.progress,
      ...progress,
    };
    broadcast("progress_update", { id: job.id, progress: job.progress });
    return true;
  }

  function formatElapsedTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function shouldRetryAsCompletedVideo(error) {
    const message = String(error?.message || "");
    return LIVE_ENDED_RETRY_MESSAGES.some((token) => message.includes(token));
  }

  function getTitle(ytDlpPath, url, cookiePath, settings) {
    return new Promise((resolve, reject) => {
      const normalizedUrl = normalizeYoutubeUrl(url);
      const args = [
        normalizedUrl,
        "--get-title",
        "--no-warnings",
      ];
      const ffmpegPath = getUsableFfmpegPath();
      if (ffmpegPath) {
        args.push("--ffmpeg-location", ffmpegPath);
      }
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
    if (typeof infoObj.channel_thumbnail === "string" && infoObj.channel_thumbnail.trim()) {
      return infoObj;
    }

    function normalizeChannelMetadataUrl(channelUrl) {
      const raw = String(channelUrl || "").trim();
      if (!raw || raw === "#") return "";
      const normalized = raw.replace(/\/+$/, "");
      if (
        /youtube\.com\/(channel|@|c\/|user\/)/i.test(normalized) &&
        !/\/(videos|featured|streams|shorts)$/i.test(normalized)
      ) {
        return `${normalized}/videos`;
      }
      return normalized;
    }

    function pickChannelAvatarUrl(channelObj) {
      let avatar = null;
      if (Array.isArray(channelObj?.thumbnails)) {
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
      return avatar?.url || "";
    }

    try {
      const existingChannelId = String(infoObj.channel_id || "").trim();
      if (existingChannelId) {
        const cachedChannelPath = path.join(
          downloadsDir,
          "チャンネル",
          `${existingChannelId}.channel.json`,
        );
        if (fs.existsSync(cachedChannelPath)) {
          const cachedChannelJson = fs.readFileSync(cachedChannelPath, "utf-8");
          const cachedChannelObj = JSON.parse(cachedChannelJson);
          const cachedAvatarUrl = pickChannelAvatarUrl(cachedChannelObj);
          if (cachedAvatarUrl) {
            infoObj.channel_thumbnail = cachedAvatarUrl;
            return infoObj;
          }
        }
      }

      const channelArgs = [
        "-J",
        "--flat-playlist",
        "--playlist-items",
        "0",
        "--no-warnings",
      ];
      const ffmpegPath = getUsableFfmpegPath();
      if (ffmpegPath) {
        channelArgs.push("--ffmpeg-location", ffmpegPath);
      }
      if (job.cookieFile?.path) {
        channelArgs.push("--cookies", job.cookieFile.path);
      } else if (settings && settings.selectedBrowser) {
        channelArgs.push("--cookies-from-browser", settings.selectedBrowser);
      }
      const metadataUrl = normalizeChannelMetadataUrl(infoObj.channel_url);
      if (!metadataUrl) return infoObj;
      channelArgs.push(metadataUrl);

      const channelJson = execFileSync(resolveYtDlpPath(baseDir), channelArgs, {
        encoding: "utf-8",
        timeout: 10000,
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

      const avatarUrl = pickChannelAvatarUrl(channelObj);
      if (avatarUrl) {
        infoObj.channel_thumbnail = avatarUrl;
      }
    } catch (err) {
      logger.warn("チャンネル情報取得失敗", {
        error: err.message,
        stderr: String(err?.stderr || "").trim(),
      });
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
    const commentFiles = files.filter((f) => COMMENTS_JSON_PATTERN.test(f));

    if (!infoFile && !chatFile && commentFiles.length === 0) {
      return { infoFile: null, jobPendingDir: null };
    }

    const stagingDir = path.join(
      pendingChatDir,
      `.staging_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    );
    fs.mkdirSync(stagingDir, { recursive: true });
    logger.info("仮置きステージングフォルダ作成", { path: stagingDir });

    let movedCount = 0;

    if (infoFile) {
      const src = path.join(finalMovieDir, infoFile);
      const dest = path.join(stagingDir, infoFile);
      if (fs.existsSync(src)) {
        try {
          const raw = fs.readFileSync(src, "utf-8");
          const parsed = JSON.parse(raw);
          const updated = enrichInfoWithChannelThumbnail(parsed, job, settings);
          fs.writeFileSync(src, JSON.stringify(updated, null, 2), "utf-8");
        } catch (error) {
          logger.warn("info.json書き換え失敗", { error: error.message });
        }
        if (moveOptionalFile(src, dest, "info")) movedCount++;
      }
    }

    if (chatFile) {
      const src = path.join(finalMovieDir, chatFile);
      const dest = path.join(stagingDir, chatFile);
      if (moveOptionalFile(src, dest, "chat")) movedCount++;
    } else {
      logger.warn("live chat ファイルが見つかりません", {
        finalMovieDir,
      });
    }

    for (const commentFile of commentFiles) {
      const src = path.join(finalMovieDir, commentFile);
      const dest = path.join(stagingDir, commentFile);
      if (moveOptionalFile(src, dest, "comments")) movedCount++;
    }

    if (movedCount === 0) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return { infoFile: null, jobPendingDir: null };
    }

    const jobPendingDir = path.join(pendingChatDir, `job_${Date.now()}`);
    fs.renameSync(stagingDir, jobPendingDir);
    logger.info("仮置きジョブフォルダ確定", { path: jobPendingDir });

    return { infoFile, jobPendingDir };
  }

  function findVideoFileForInfo(finalMovieDir, infoFile) {
    const files = fs.readdirSync(finalMovieDir);
    const videoExts = new Set([
      ".mp4",
      ".mkv",
      ".webm",
      ".flv",
      ".mov",
      ".m4v",
      ".ts",
      ".avi",
      ".wmv",
    ]);
    const videoFiles = files
      .filter((file) => {
        const ext = path.extname(file).toLowerCase();
        return ext !== ".json" && videoExts.has(ext);
      })
      .map((file) => path.join(finalMovieDir, file));

    if (infoFile) {
      const baseName = infoFile.replace(/\.info\.json$/i, "");
      const matches = videoFiles
        .filter((filePath) => path.basename(filePath).startsWith(`${baseName}.`))
        .sort((a, b) => {
          const aExt = path.extname(a).toLowerCase();
          const bExt = path.extname(b).toLowerCase();
          if (aExt === ".mp4" && bExt !== ".mp4") return -1;
          if (bExt === ".mp4" && aExt !== ".mp4") return 1;
          return a.localeCompare(b);
        });

      if (matches.length > 0) return matches[0];
    }

    if (videoFiles.length === 0) return null;
    videoFiles.sort((a, b) => {
      const aStat = fs.statSync(a);
      const bStat = fs.statSync(b);
      if (aStat.mtimeMs !== bStat.mtimeMs) return bStat.mtimeMs - aStat.mtimeMs;
      return b.localeCompare(a);
    });
    return videoFiles[0];
  }

  async function runFfmpegRemux(inputPath) {
    return new Promise((resolve, reject) => {
      const ffmpegPath = resolveFfmpegPath(baseDir);
      const parsed = path.parse(inputPath);
      const outputPath = path.join(parsed.dir, `${parsed.name}_fix.mp4`);
      const finalPath = path.join(parsed.dir, `${parsed.name}.mp4`);

      if (!fs.existsSync(inputPath)) {
        reject(new Error(`入力ファイルが見つかりません: ${inputPath}`));
        return;
      }

      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }

      const args = [
        "-y",
        "-fflags",
        "+genpts",
        "-i",
        inputPath,
        "-c",
        "copy",
        outputPath,
      ];
      const inputStat = fs.statSync(inputPath);
      logger.info("ffmpeg 再エンコード実行", {
        args: args.join(" "),
        inputPath,
        inputBytes: inputStat.size,
      });
      const ffmpeg = spawn(ffmpegPath, args, { windowsHide: true });

      let stderrOutput = "";
      ffmpeg.stderr.on("data", (data) => {
        stderrOutput += data.toString();
      });

      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `ffmpegがエラーコード${code}で終了しました。Stderr: ${stderrOutput}`,
            ),
          );
          return;
        }

        try {
          if (fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
          }
          fs.renameSync(outputPath, finalPath);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      ffmpeg.on("error", (err) => {
        reject(new Error(`ffmpegプロセスの起動に失敗: ${err.message}`));
      });
    });
  }

  async function runYtDlpDownloadAttempt(job, settings, ytDlpPath, paths, mode = {}) {
    return new Promise((resolve, reject) => {
      const args = buildArgs(
        job,
        {
          movieDir: paths.finalMovieDir,
          thumbnailDir: paths.finalThumbnailDir,
          tempDir: paths.finalTempDir,
        },
        settings,
        mode,
      );
      logger.info("ダウンロードコマンド実行", { args: args.join(" ") });
      const ytDlp = spawn(ytDlpPath, args, { windowsHide: true });

      let stderrOutput = "";
      let stdoutOutput = "";
      let stdoutBuffer = "";
      let skippedByLiveFilter = false;
      let shouldAbortForCompletedRetry = false;
      let closed = false;
      const attemptStartedAt = Date.now();
      const progressLabel = mode.progressLabel || "";
      let liveTicker = null;
      const progressState = {
        sawDownload: false,
        commentTotal: null,
        commentCurrent: 0,
      };

      if (mode.liveReplayMode && progressLabel) {
        liveTicker = setInterval(() => {
          const elapsedText = formatElapsedTime(Date.now() - attemptStartedAt);
          job.progress = {
            ...job.progress,
            elapsedText,
          };
          if (!job.progress.totalSize && !job.progress.speed) {
            job.progress.eta = progressLabel;
          }
          broadcast("progress_update", { id: job.id, progress: job.progress });
        }, 1000);
      }

      ytDlp.stdout.on("data", (data) => {
        const chunkText = data.toString();
        stdoutOutput += chunkText;
        stdoutBuffer += chunkText;
        if (chunkText.includes(LIVE_FILTER_SKIP_FRAGMENT)) {
          skippedByLiveFilter = true;
        }
        const lines = stdoutBuffer.split(/[\r\n]/);
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() === "") continue;
          applyProgressFromLine(job, line, progressState);
        }
      });

      ytDlp.stderr.on("data", (data) => {
        const chunkText = data.toString();
        const stderrLines = chunkText.split(/[\r\n]/).filter((line) => line.trim() !== "");
        const errorMsg = chunkText.trim();
        stderrOutput += `${errorMsg}\n`;
        if (chunkText.includes(LIVE_FILTER_SKIP_FRAGMENT)) {
          skippedByLiveFilter = true;
        }
        if (
          mode.liveReplayMode &&
          chunkText.includes("Video is no longer live. Giving up after 3 retries")
        ) {
          shouldAbortForCompletedRetry = true;
          if (!closed) {
            ytDlp.kill();
          }
        }
        let handledAsProgress = false;
        for (const line of stderrLines) {
          handledAsProgress = applyProgressFromLine(job, line, progressState) || handledAsProgress;
        }
        if (!handledAsProgress && errorMsg !== "") {
          logger.warn("yt-dlp stderr", { message: errorMsg });
        }
      });

      ytDlp.on("close", (code) => {
        closed = true;
        if (liveTicker) clearInterval(liveTicker);
        if (
          stdoutBuffer.includes(LIVE_FILTER_SKIP_FRAGMENT) ||
          stdoutOutput.includes(LIVE_FILTER_SKIP_FRAGMENT) ||
          stderrOutput.includes(LIVE_FILTER_SKIP_FRAGMENT)
        ) {
          skippedByLiveFilter = true;
        }
        if (skippedByLiveFilter) {
          resolve({ skippedByLiveFilter: true });
          return;
        }
        if (shouldAbortForCompletedRetry) {
          reject(
            new Error(
              `yt-dlpがライブ終了を検出しました。Stderr: ${stderrOutput}`,
            ),
          );
          return;
        }
        if (code === 0) {
          resolve({ skippedByLiveFilter: false });
          return;
        }
        reject(new Error(`yt-dlpがエラーコード${code}で終了しました。Stderr: ${stderrOutput}`));
      });

      ytDlp.on("error", (err) => {
        if (liveTicker) clearInterval(liveTicker);
        reject(new Error(`yt-dlpプロセスの起動に失敗: ${err.message}`));
      });
    });
  }

  async function runYtDlpDownload(job, settings, ytDlpPath, paths) {
    const firstAttempt = await runYtDlpDownloadAttempt(job, settings, ytDlpPath, paths);
    if (!firstAttempt.skippedByLiveFilter) {
      return;
    }

    const downloadVideoEnabled =
      job.options.downloadVideo === true || job.options.downloadVideo === "true";
    if (downloadVideoEnabled) {
      job.progress = {
        ...job.progress,
        percentage: Math.max(1, Number(job.progress?.percentage || 0)),
        speed: "",
        totalSize: "",
        eta: "ライブ動画の取得を開始しています...",
        elapsedText: "00:00",
      };
      broadcast("progress_update", { id: job.id, progress: job.progress });
      logger.info("ライブ配信を検出したため、動画を先に取得します", {
        url: job.url,
      });
      try {
        await runYtDlpDownloadAttempt(job, settings, ytDlpPath, paths, {
          liveReplayMode: true,
          liveVideoOnly: true,
          progressLabel: "ライブ動画取得中",
        });
      } catch (error) {
        if (shouldRetryAsCompletedVideo(error)) {
          logger.info("ライブ配信の終了を検出したため、通常動画として再試行します", {
            url: job.url,
          });
          await runYtDlpDownloadAttempt(job, settings, ytDlpPath, paths, {
            plainRetryMode: true,
          });
          return;
        }
        throw error;
      }
    }

    if (job.options.commentOptions === "sub" || job.options.commentOptions === "both") {
      job.progress = {
        ...job.progress,
        percentage: downloadVideoEnabled ? Math.max(85, Number(job.progress?.percentage || 0)) : 1,
        speed: "",
        totalSize: "",
        eta: "ライブチャット取得を開始しています...",
        elapsedText: "00:00",
      };
      broadcast("progress_update", { id: job.id, progress: job.progress });
      logger.info("ライブチャット取得を別プロセスで開始します", {
        url: job.url,
      });
      await runYtDlpDownloadAttempt(job, settings, ytDlpPath, paths, {
        liveReplayMode: true,
        liveChatOnly: true,
        progressLabel: "ライブチャット取得中",
      });
    }
  }

  async function processDownloadJob(job) {
    const ytDlpPath = resolveYtDlpPath(baseDir);
    const settings = await loadSettingsSafe();
    job.url = normalizeYoutubeUrl(job.url);

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
      assertFfmpegAvailable(job);
    } catch (error) {
      throw new Error(`保存先準備失敗: ${error.message}`);
    }

    await runYtDlpDownload(job, settings, ytDlpPath, paths);

    const downloadVideoEnabled =
      job.options.downloadVideo === true || job.options.downloadVideo === "true";
    if (downloadVideoEnabled && job.options.remuxVideo) {
      const files = fs.readdirSync(paths.finalMovieDir);
      const infoFile = files.find((f) => f.endsWith(".info.json"));
      const targetVideoPath = findVideoFileForInfo(paths.finalMovieDir, infoFile);
      if (!targetVideoPath) {
        logger.warn("再エンコード対象が見つかりません", {
          finalMovieDir: paths.finalMovieDir,
        });
      } else {
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            await runFfmpegRemux(targetVideoPath);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            logger.warn("再エンコードに失敗", {
              attempt,
              error: error.message,
              targetVideoPath,
            });
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
        if (lastError) {
          logger.warn("再エンコードのリトライが失敗", {
            error: lastError.message,
            targetVideoPath,
          });
        }
      }
    }

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
      job.progress = {
        ...job.progress,
        percentage: 100,
        eta: "スキップ完了（info.jsonなし）",
      };
      return;
    }

    await jobQueueService.enqueueJob(jobPendingDir);
    job.progress = {
      ...job.progress,
      percentage: 100,
      eta: "完了",
    };
  }

  return {
    processDownloadJob,
  };
}

module.exports = {
  createDownloadJobService,
};
