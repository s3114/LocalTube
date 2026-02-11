const { execSync } = require("child_process");

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
      args.push("--write-sub");
    }

    return args;
  }

  function getTitle(ytDlpPath, url, cookiePath, settings) {
    return new Promise((resolve, reject) => {
      const args = [url, "--get-title", "--no-warnings"];
      if (cookiePath) {
        args.push("--cookies", cookiePath);
      } else if (settings && settings.selectedBrowser) {
        args.push("--cookies-from-browser", settings.selectedBrowser);
      }
      console.log(`[yt-dlp Title Command] Path: ${ytDlpPath}, Args: ${args.join(" ")}`);
      const ytDlpProcess = spawn(ytDlpPath, args);
      const stdoutChunks = [];
      const stderrChunks = [];
      ytDlpProcess.stdout.on("data", (data) => {
        stdoutChunks.push(data);
      });
      ytDlpProcess.stderr.on("data", (data) => {
        stderrChunks.push(data);
      });

      ytDlpProcess.on("close", (code) => {
        const stdoutBuffer = Buffer.concat(stdoutChunks);
        const title = iconv.decode(stdoutBuffer, "cp932");
        if (code === 0 && title.trim() !== "") {
          resolve(title.trim());
        } else {
          const stderrBuffer = Buffer.concat(stderrChunks);
          const stderr = iconv.decode(stderrBuffer, "cp932");
          reject(new Error(`yt-dlp exited with code ${code}. Stderr: ${stderr}`));
        }
      });

      ytDlpProcess.on("error", (err) => {
        reject(err);
      });
    });
  }

  async function processDownloadJob(job) {
    const ytDlpPath = path.join(baseDir, "yt-dlp.exe");
    let settings = {};

    try {
      settings = (await loadConfig?.()) || {};
    } catch (error) {
      console.error("ダウンロード処理中に設定の読み込みに失敗しました:", error);
    }

    try {
      const title = await getTitle(ytDlpPath, job.url, job.cookieFile?.path, settings);
      job.title = title;
      broadcast("title_update", { id: job.id, title: job.title });
    } catch (error) {
      throw new Error(`タイトル取得失敗: ${error.message}`);
    }

    const customSavePath =
      job.options.savePath && job.options.savePath.trim() !== ""
        ? job.options.savePath
        : null;
    const finalMovieDir = customSavePath || movieDir;
    const finalThumbnailDir = customSavePath
      ? path.join(customSavePath, "サムネイル")
      : thumbnailDir;
    const finalTempDir = customSavePath || downloadsDir;

    if (customSavePath) {
      if (!fs.existsSync(finalMovieDir)) {
        try {
          fs.mkdirSync(finalMovieDir, { recursive: true });
        } catch (error) {
          throw new Error(
            `カスタム保存先ディレクトリの作成に失敗しました ${finalMovieDir}: ${error.message}`,
          );
        }
      }

      if (job.options.downloadThumb && !fs.existsSync(finalThumbnailDir)) {
        try {
          fs.mkdirSync(finalThumbnailDir, { recursive: true });
        } catch (error) {
          throw new Error(
            `カスタムサムネイル保存先ディレクトリの作成に失敗しました ${finalThumbnailDir}: ${error.message}`,
          );
        }
      }
    }

    return new Promise((resolve, reject) => {
      const args = buildArgs(
        job,
        {
          movieDir: finalMovieDir,
          thumbnailDir: finalThumbnailDir,
          tempDir: finalTempDir,
        },
        settings,
      );
      console.log(`[yt-dlp Download Command] Path: ${ytDlpPath}, Args: ${args.join(" ")}`);
      const ytDlp = spawn(ytDlpPath, args);

      let stderrOutput = "";
      let stdoutBuffer = "";

      ytDlp.stdout.on("data", (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split(/[\r\n]/);
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() === "") continue;
          const progressMatch = line.match(/\[download\]\s+([\d.]+)%/);
          if (progressMatch) {
            job.progress = {
              percentage: parseFloat(progressMatch[1]),
              totalSize: progressMatch[2],
              speed: progressMatch[3],
              eta: progressMatch[4],
            };
            broadcast("progress_update", { id: job.id, progress: job.progress });
          }
        }
      });

      ytDlp.stderr.on("data", (data) => {
        const errorMsg = data.toString().trim();
        stderrOutput += errorMsg + "\n";
        console.error(`yt-dlp stderr: ${errorMsg}`);
      });

      ytDlp.on("close", async (code) => {
        if (code === 0) {
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

          const files = fs.readdirSync(finalMovieDir);
          const infoFile = files.find((f) => f.endsWith(".info.json"));
          const chatFile = files.find((f) => f.endsWith(".live_chat.json"));

          const jobPendingDir = path.join(pendingChatDir, `job_${Date.now()}`);
          fs.mkdirSync(jobPendingDir, { recursive: true });
          console.log("仮置きジョブフォルダ:", jobPendingDir);

          if (infoFile) {
            const src = path.join(finalMovieDir, infoFile);
            const dest = path.join(jobPendingDir, infoFile);

            if (fs.existsSync(src)) {
              try {
                const infoRaw = fs.readFileSync(src, "utf-8");
                const infoObj = JSON.parse(infoRaw);
                let channelThumbUrl = null;

                if (typeof infoObj.channel_url === "string") {
                  try {
                    console.log("[INFO EDIT] チャンネル情報を取得:", infoObj.channel_url);
                    const channelArgs = ["-J", "--no-playlist", "--playlist-items", "0"];

                    if (job.cookieFile?.path) {
                      channelArgs.push("--cookies", job.cookieFile.path);
                    } else if (settings && settings.selectedBrowser) {
                      channelArgs.push("--cookies-from-browser", settings.selectedBrowser);
                    }

                    channelArgs.push(infoObj.channel_url);
                    const fullCommand = `"${path.join(baseDir, "yt-dlp.exe")}" ${channelArgs
                      .map((a) => `"${a}"`)
                      .join(" ")}`;
                    console.log(`[yt-dlp Channel Info Command] Command: ${fullCommand}`);
                    const channelJson = execSync(fullCommand, {
                      encoding: "utf-8",
                      timeout: 3000,
                    });

                    try {
                      const channelSaveDir = path.join(downloadsDir, "チャンネル");
                      fs.mkdirSync(channelSaveDir, { recursive: true });
                      const channelObj = JSON.parse(channelJson);
                      const channelJsonPath = path.join(
                        channelSaveDir,
                        `${channelObj.channel_id}.channel.json`,
                      );
                      fs.writeFileSync(channelJsonPath, channelJson, "utf-8");
                      console.log("[INFO EDIT] チャンネルJSONを保存:", channelJsonPath);
                    } catch (err) {
                      console.error("[INFO EDIT] チャンネルJSONの保存に失敗:", err.message);
                    }

                    const channelObj = JSON.parse(channelJson);
                    let foundAvatar = null;
                    if (Array.isArray(channelObj.thumbnails)) {
                      foundAvatar = channelObj.thumbnails.find(
                        (t) => t.id === "avatar_uncropped",
                      );
                      if (!foundAvatar) {
                        foundAvatar = channelObj.thumbnails.reduce((best, cur) => {
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
                      if (!foundAvatar && channelObj.thumbnails.length > 0) {
                        foundAvatar = channelObj.thumbnails[0];
                      }
                    }

                    if (foundAvatar && foundAvatar.url) {
                      channelThumbUrl = foundAvatar.url;
                      console.log(
                        "[INFO EDIT] channel_thumbnail（avatar_uncropped）を取得:",
                        channelThumbUrl,
                      );
                    }
                  } catch (err) {
                    console.error("[INFO EDIT] チャンネル情報取得に失敗:", err.message);
                  }
                }

                if (channelThumbUrl) {
                  infoObj.channel_thumbnail = channelThumbUrl;
                } else {
                  console.log("[INFO EDIT] channel_thumbnail を取得できませんでした");
                }

                fs.writeFileSync(src, JSON.stringify(infoObj, null, 2), "utf-8");
              } catch (e) {
                console.error("[INFO EDIT] info.json の書き換えに失敗:", e);
              }

              fs.renameSync(src, dest);
              console.log("仮置きへ移動（info）:", dest);
            } else {
              console.warn("info.json が見つかりません:", src);
            }
          }

          if (chatFile) {
            const src = path.join(finalMovieDir, chatFile);
            const dest = path.join(jobPendingDir, chatFile);
            if (fs.existsSync(src)) {
              fs.renameSync(src, dest);
              console.log("仮置きへ移動（chat）:", dest);
            } else {
              console.warn("live_chat.json が見つかりません:", src);
            }
          }

          if (!infoFile) {
            console.warn("[QUEUE] info.json が無いため登録不可:", jobPendingDir);
            broadcast("status_update", {
              id: job.id,
              status: "completed",
              progress: {
                percent: 100,
                eta: "スキップ完了（info.jsonなし）",
              },
            });
            resolve();
            return;
          }

          jobQueueService.enqueueJob(jobPendingDir);
          broadcast("status_update", {
            id: job.id,
            status: "completed",
            progress: {
              percent: 100,
              eta: "完了",
            },
          });
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

  return {
    processDownloadJob,
  };
}

module.exports = {
  createDownloadJobService,
};
