const { createLogger } = require("./logger-service");

function createLocalVideoService(deps) {
  const {
    fs,
    path,
    crypto,
    runCommand,
    runCommandCapture,
    movieDir,
    thumbnailDir,
    fallbackThumbnailDir,
    provisionalInfoDir,
    baseDir,
    getLocalVideoDirs,
  } = deps;
  const logger = deps.logger || createLogger("local-video");

  let ffmpegCommandCache;
  let ffprobeCommandCache;
  const THUMB_EXTS = [".jpg", ".png", ".webp", ".jpeg"];
  const fallbackThumbnailJobs = new Map();
  const cachedThumbnailJobs = new Map();
  const fallbackThumbnailQueue = [];
  let activeFallbackThumbnailJobs = 0;
  const FALLBACK_THUMBNAIL_CONCURRENCY = 2;
  const failedFallbackThumbnails = new Set();
  const provisionalInfoJobs = new Map();
  const provisionalJobQueue = [];
  let activeProvisionalJobs = 0;
  const PROVISIONAL_JOB_CONCURRENCY = 2;

  function fallbackPriorityToScore(priority) {
    if (priority === "high") return 2;
    if (priority === "low") return 0;
    return 1;
  }

  function pumpFallbackThumbnailQueue() {
    while (
      activeFallbackThumbnailJobs < FALLBACK_THUMBNAIL_CONCURRENCY &&
      fallbackThumbnailQueue.length > 0
    ) {
      fallbackThumbnailQueue.sort((a, b) => b.priorityScore - a.priorityScore);
      const next = fallbackThumbnailQueue.shift();
      if (!next) break;
      activeFallbackThumbnailJobs += 1;
      next.run()
        .then(next.resolve)
        .catch(next.reject)
        .finally(() => {
          activeFallbackThumbnailJobs = Math.max(0, activeFallbackThumbnailJobs - 1);
          pumpFallbackThumbnailQueue();
        });
    }
  }

  function enqueueFallbackThumbnailJob(run, priority = "normal") {
    return new Promise((resolve, reject) => {
      fallbackThumbnailQueue.push({
        run,
        resolve,
        reject,
        priorityScore: fallbackPriorityToScore(priority),
      });
      pumpFallbackThumbnailQueue();
    });
  }

  async function resolveFfmpegCommand() {
    if (typeof ffmpegCommandCache !== "undefined") return ffmpegCommandCache;

    const candidates = ["ffmpeg", "ffmpeg.exe"];
    for (const cmd of candidates) {
      try {
        await runCommand(cmd, ["-version"]);
        ffmpegCommandCache = cmd;
        return ffmpegCommandCache;
      } catch (_error) {
        // try next candidate
      }
    }

    ffmpegCommandCache = null;
    return ffmpegCommandCache;
  }

  async function resolveFfprobeCommand() {
    if (typeof ffprobeCommandCache !== "undefined") return ffprobeCommandCache;

    const candidates = ["ffprobe", "ffprobe.exe"];
    for (const cmd of candidates) {
      try {
        await runCommand(cmd, ["-version"]);
        ffprobeCommandCache = cmd;
        return ffprobeCommandCache;
      } catch (_error) {
        // try next candidate
      }
    }

    ffprobeCommandCache = null;
    return ffprobeCommandCache;
  }

  function getFallbackThumbBasePath(videoPath) {
    const hash = crypto.createHash("sha1").update(videoPath).digest("hex").slice(0, 12);
    const baseName = path
      .parse(videoPath)
      .name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
    return path.join(fallbackThumbnailDir, `${baseName}_${hash}`);
  }

  function getFallbackThumbPath(videoPath) {
    return `${getFallbackThumbBasePath(videoPath)}.png`;
  }

  function getFallbackThumbCandidates(videoPath) {
    const base = getFallbackThumbBasePath(videoPath);
    return THUMB_EXTS.map((ext) => `${base}${ext}`);
  }

  function findCachedFallbackThumbnailPath(videoPath) {
    const candidates = getFallbackThumbCandidates(videoPath);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  function inferLibraryRootFromVideoPath(videoPath) {
    const resolvedVideoDir = path.resolve(path.dirname(videoPath));
    const parsed = path.parse(resolvedVideoDir);
    const relative = resolvedVideoDir.slice(parsed.root.length);
    const segments = relative.split(path.sep).filter(Boolean);
    const videoDirIndex = segments.lastIndexOf("動画");
    if (videoDirIndex < 0) return null;
    return path.join(parsed.root, ...segments.slice(0, videoDirIndex));
  }

  function findExistingThumbnailPath(videoPath, includeFallback = true) {
    const thumbExts = THUMB_EXTS;
    const sourceDir = path.dirname(videoPath);
    const base = path.parse(videoPath).name;
    const libraryRoot = inferLibraryRootFromVideoPath(videoPath);

    const candidates = [];
    for (const tExt of thumbExts) {
      candidates.push(path.join(sourceDir, `${base}${tExt}`));
    }

    if (path.resolve(sourceDir) === path.resolve(movieDir)) {
      for (const tExt of thumbExts) {
        candidates.push(path.join(thumbnailDir, `${base}${tExt}`));
      }
    }

    if (libraryRoot) {
      const siblingThumbDirs = [
        path.join(libraryRoot, "サムネ"),
        path.join(libraryRoot, "サムネイル"),
      ];
      for (const thumbDir of siblingThumbDirs) {
        for (const tExt of thumbExts) {
          candidates.push(path.join(thumbDir, `${base}${tExt}`));
        }
      }
    }

    if (includeFallback) {
      candidates.push(...getFallbackThumbCandidates(videoPath));
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return null;
  }

  function makeSafeFileStem(input) {
    const safe = String(input || "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .slice(0, 80);
    return safe || "unknown";
  }

  function getProvisionalInfoPath(videoId) {
    const safeStem = makeSafeFileStem(videoId);
    const hash = crypto
      .createHash("sha1")
      .update(String(videoId))
      .digest("hex")
      .slice(0, 10);
    return path.join(provisionalInfoDir, `${safeStem}_${hash}.info.json`);
  }

  function buildVideoInfoSidecarCandidates(videoPath) {
    const candidates = [];
    const resolvedVideoPath = path.resolve(String(videoPath || ""));
    if (!resolvedVideoPath) return candidates;

    const baseName = path.parse(resolvedVideoPath).name;
    candidates.push(path.join(path.dirname(resolvedVideoPath), `${baseName}.info.json`));

    const libraryRoot = inferLibraryRootFromVideoPath(resolvedVideoPath);
    if (libraryRoot) {
      candidates.push(path.join(libraryRoot, "コメント", `${baseName}.info.json`));
      candidates.push(path.join(libraryRoot, "仮コメント", `${baseName}.info.json`));
    }

    return candidates;
  }

  async function sidecarInfoMatchesVideoId(videoPath, videoId) {
    const normalizedId = String(videoId || "").trim();
    if (!normalizedId) return false;

    for (const candidate of buildVideoInfoSidecarCandidates(videoPath)) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      let raw = "";
      try {
        raw = await fs.promises.readFile(candidate, "utf-8");
      } catch (_error) {
        continue;
      }
      if (!raw) continue;
      const match = raw.match(/"id"\s*:\s*"([^"]+)"/);
      if (String(match?.[1] || "").trim() === normalizedId) {
        return true;
      }
    }

    return false;
  }

  async function findLocalVideoPathById(videoId) {
    const sourceDirs = await getLocalVideoDirs();
    const normalizedId = String(videoId || "").trim();
    const videoExt = [".mp4", ".mkv", ".webm", ".mov"];

    for (const sourceDir of sourceDirs) {
      if (!fs.existsSync(sourceDir)) continue;
      const pendingDirs = [sourceDir];

      while (pendingDirs.length > 0) {
        const currentDir = pendingDirs.pop();
        if (!currentDir) continue;

        let entries = [];
        try {
          entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        } catch (_error) {
          continue;
        }

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            pendingDirs.push(fullPath);
            continue;
          }
          if (!entry.isFile()) continue;

          const ext = path.extname(entry.name).toLowerCase();
          if (!videoExt.includes(ext)) continue;

          const base = path.parse(entry.name).name;
          if (
            base === normalizedId ||
            base.startsWith(normalizedId) ||
            normalizedId.startsWith(base)
          ) {
            return fullPath;
          }

          if (await sidecarInfoMatchesVideoId(fullPath, normalizedId)) {
            return fullPath;
          }
        }
      }
    }

    return null;
  }

  function formatDateYYYYMMDD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }

  function extractLikelyYoutubeId(text) {
    const source = String(text || "");
    const m = source.match(
      /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{11})(?=$|[^A-Za-z0-9_-])/,
    );
    return m ? m[2] : null;
  }

  function normalizeUploadDate(value) {
    const source = String(value || "").trim();
    if (!source) return null;
    const digits = source.replace(/\D/g, "");
    if (digits.length >= 8) return digits.slice(0, 8);
    return null;
  }

  function extractYoutubeIdFromUrl(text) {
    const source = String(text || "");
    const watchMatch = source.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (watchMatch) return watchMatch[1];
    const shortMatch = source.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];
    return null;
  }

  function getTagValue(allTags, keys) {
    for (const key of keys) {
      const value = allTags[key];
      if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
      }
    }
    return null;
  }

  async function readVideoMetadataTags(videoPath) {
    const ffprobeCmd = await resolveFfprobeCommand();
    if (!ffprobeCmd) return {};

    try {
      const output = await runCommandCapture(ffprobeCmd, [
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        videoPath,
      ]);

      const parsed = JSON.parse(output);
      const lowerTags = {};
      const duration = Number(parsed?.format?.duration);

      const addTags = (obj) => {
        if (!obj || typeof obj !== "object") return;
        for (const [k, v] of Object.entries(obj)) {
          const key = String(k || "").toLowerCase();
          if (typeof v === "string" && v.trim() !== "" && !lowerTags[key]) {
            lowerTags[key] = v.trim();
          }
        }
      };

      addTags(parsed?.format?.tags);
      if (Array.isArray(parsed?.streams)) {
        for (const s of parsed.streams) {
          addTags(s?.tags);
        }
      }

      return {
        tags: lowerTags,
        duration: Number.isFinite(duration) ? duration : null,
      };
    } catch (error) {
      logger.warn("ffprobe metadata read failed", { error: error.message });
      return { tags: {}, duration: null };
    }
  }

  async function createProvisionalInfoFromVideo(videoPath, videoId) {
    const stats = await fs.promises.stat(videoPath);
    const base = path.parse(videoPath).name;
    const metadata = await readVideoMetadataTags(videoPath);
    const tags = metadata.tags || {};
    const durationSec = Number(metadata.duration);
    const normalizedDuration = Number.isFinite(durationSec)
      ? Math.max(0, Math.round(durationSec))
      : null;
    const commentText = getTagValue(tags, ["comment"]);
    const metaTitle = getTagValue(tags, ["title"]);
    const metaDescription = getTagValue(tags, [
      "description",
      "longdescription",
      "synopsis",
      "comment",
    ]);
    const metaChannel = getTagValue(tags, [
      "artist",
      "performer",
      "album_artist",
      "uploader",
    ]);
    const metaUploadDate =
      normalizeUploadDate(
        getTagValue(tags, [
          "recorded_date",
          "recording_date",
          "recording_time",
          "date",
          "creation_time",
          "encoded_date",
        ]),
      ) || formatDateYYYYMMDD(stats.mtime);

    const likelyId =
      extractYoutubeIdFromUrl(commentText) ||
      extractLikelyYoutubeId(base) ||
      extractLikelyYoutubeId(videoId);

    return {
      id: likelyId || null,
      title: metaTitle || base,
      description:
        metaDescription ||
        "info.json が見つからなかったため、ローカル動画のメタデータから自動生成しました。",
      upload_date: metaUploadDate,
      channel: metaChannel || "ローカル動画",
      channel_url: "#",
      uploader_id: metaChannel || "local",
      channel_follower_count: null,
      like_count: null,
      view_count: null,
      duration: normalizedDuration,
      comments: [],
      _provisional_info: true,
      _provisional_info_version: 3,
      _generated_at: new Date().toISOString(),
      _source_video: videoPath,
      _source_mtime_ms: stats.mtimeMs,
      _source_size: stats.size,
      _source_tags: {
        title: metaTitle || null,
        description: metaDescription || null,
        channel: metaChannel || null,
        upload_date: metaUploadDate || null,
        comment: commentText || null,
        duration: normalizedDuration,
      },
    };
  }

  async function readFreshProvisionalInfo(provisionalPath, stats) {
    if (!fs.existsSync(provisionalPath)) return null;
    try {
      const raw = await fs.promises.readFile(provisionalPath, "utf-8");
      const parsed = JSON.parse(raw);
      const sameMtime = Number(parsed?._source_mtime_ms) === Number(stats.mtimeMs);
      const sameSize = Number(parsed?._source_size) === Number(stats.size);
      const sameVersion = Number(parsed?._provisional_info_version) >= 3;
      if (sameMtime && sameSize && sameVersion) {
        return parsed;
      }
    } catch (_error) {
      // ignore broken cache
    }
    return null;
  }

  function pumpProvisionalQueue() {
    while (
      activeProvisionalJobs < PROVISIONAL_JOB_CONCURRENCY &&
      provisionalJobQueue.length > 0
    ) {
      const next = provisionalJobQueue.shift();
      if (!next) break;
      activeProvisionalJobs += 1;
      next.run()
        .then(next.resolve)
        .catch(next.reject)
        .finally(() => {
          activeProvisionalJobs = Math.max(0, activeProvisionalJobs - 1);
          pumpProvisionalQueue();
        });
    }
  }

  function enqueueProvisionalInfoJob(run) {
    return new Promise((resolve, reject) => {
      provisionalJobQueue.push({ run, resolve, reject });
      pumpProvisionalQueue();
    });
  }

  async function ensureProvisionalInfo(videoPath, videoId) {
    const provisionalPath = getProvisionalInfoPath(videoId);
    const stats = await fs.promises.stat(videoPath);
    const fresh = await readFreshProvisionalInfo(provisionalPath, stats);
    if (fresh) {
      return { path: provisionalPath, info: fresh, fromCache: true };
    }

    if (!provisionalInfoJobs.has(provisionalPath)) {
      const task = enqueueProvisionalInfoJob(async () => {
        const provisionalInfo = await createProvisionalInfoFromVideo(videoPath, videoId);
        await fs.promises.writeFile(
          provisionalPath,
          JSON.stringify(provisionalInfo, null, 2),
          "utf-8",
        );
        return { path: provisionalPath, info: provisionalInfo, fromCache: false };
      });
      provisionalInfoJobs.set(provisionalPath, task);
      task.finally(() => {
        provisionalInfoJobs.delete(provisionalPath);
      });
    }

    return provisionalInfoJobs.get(provisionalPath);
  }

  async function ensureFallbackThumbnail(videoPath, priority = "normal") {
    const outputPath = getFallbackThumbPath(videoPath);
    if (fs.existsSync(outputPath)) return outputPath;
    if (failedFallbackThumbnails.has(outputPath)) return null;

    if (!fallbackThumbnailJobs.has(outputPath)) {
      const job = enqueueFallbackThumbnailJob(async () => {
        const ffmpegCmd = await resolveFfmpegCommand();
        if (!ffmpegCmd) {
          failedFallbackThumbnails.add(outputPath);
          return null;
        }

        const attemptArgs = [
          [
            "-y",
            "-loglevel",
            "error",
            "-ss",
            "00:00:01.500",
            "-i",
            videoPath,
            "-an",
            "-sn",
            "-dn",
            "-frames:v",
            "1",
            "-update",
            "1",
            outputPath,
          ],
          [
            "-y",
            "-loglevel",
            "error",
            "-i",
            videoPath,
            "-an",
            "-sn",
            "-dn",
            "-frames:v",
            "1",
            "-update",
            "1",
            outputPath,
          ],
        ];

        let lastError = null;
        for (const args of attemptArgs) {
          try {
            await runCommand(ffmpegCmd, args);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
          }
        }

        if (lastError) {
          failedFallbackThumbnails.add(outputPath);
          throw lastError;
        }

        if (!fs.existsSync(outputPath)) {
          failedFallbackThumbnails.add(outputPath);
          return null;
        }

        return outputPath;
      }, priority);

      fallbackThumbnailJobs.set(outputPath, job);
      job.then(
        () => fallbackThumbnailJobs.delete(outputPath),
        () => fallbackThumbnailJobs.delete(outputPath),
      );
    }

    return fallbackThumbnailJobs.get(outputPath);
  }

  async function ensureCachedThumbnailFromPath(videoPath, thumbSourcePath, priority = "low") {
    const sourcePath = String(thumbSourcePath || "");
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;

    const sourceExt = path.extname(sourcePath).toLowerCase();
    if (!THUMB_EXTS.includes(sourceExt)) return null;

    const outputPath = `${getFallbackThumbBasePath(videoPath)}${sourceExt}`;
    if (fs.existsSync(outputPath)) return outputPath;

    if (!cachedThumbnailJobs.has(outputPath)) {
      const job = enqueueFallbackThumbnailJob(async () => {
        await fs.promises.mkdir(fallbackThumbnailDir, { recursive: true });
        const tmpPath = `${outputPath}.tmp`;
        await fs.promises.copyFile(sourcePath, tmpPath);
        await fs.promises.rename(tmpPath, outputPath);
        return outputPath;
      }, priority);
      cachedThumbnailJobs.set(outputPath, job);
      job.finally(() => {
        cachedThumbnailJobs.delete(outputPath);
      });
    }

    return cachedThumbnailJobs.get(outputPath);
  }

  return {
    findExistingThumbnailPath,
    findCachedFallbackThumbnailPath,
    getProvisionalInfoPath,
    findLocalVideoPathById,
    createProvisionalInfoFromVideo,
    ensureProvisionalInfo,
    ensureFallbackThumbnail,
    ensureCachedThumbnailFromPath,
  };
}

module.exports = {
  createLocalVideoService,
};
