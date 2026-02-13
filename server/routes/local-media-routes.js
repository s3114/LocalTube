const { createLogger } = require("../services/logger-service");

function registerLocalMediaRoutes(app, deps) {
  const {
    fs,
    path,
    baseDir,
    thumbnailDir,
    fallbackThumbnailDir,
    getLocalVideoDirs,
    loadConfig,
    isPathWithin,
    findExistingThumbnailPath,
    findCachedFallbackThumbnailPath,
    ensureFallbackThumbnail,
    ensureCachedThumbnailFromPath,
    apiOk,
    apiError,
  } = deps;
  const logger = deps.logger || createLogger("route-local-media");
  const LOCAL_VIDEOS_CACHE_TTL_MS = 5000;
  const VIDEO_EXT = [".mp4", ".mkv", ".webm", ".mov"];
  const THUMB_EXT = [".jpg", ".jpeg", ".png", ".webp"];
  const VIDEO_DIR_INDEX_PATH = path.join(baseDir, "cache", "video-dir-index.json");
  const THUMB_DIR_INDEX_PATH = path.join(baseDir, "cache", "thumb-dir-index.json");
  const LOCAL_VIDEOS_INDEX_PATH = path.join(baseDir, "cache", "local-videos-index.json");
  const SKIP_SCAN_DIR_NAMES = new Set([
    "コメント",
    "ライブチャット",
    "サムネ",
    "サムネイル",
    "字幕",
    "仮コメント",
    "仮サムネイル",
    "チャンネル",
  ]);
  let localVideosCache = {
    expiresAt: 0,
    signature: "",
    data: null,
  };

  async function buildLocalVideoDirsSignature(sourceDirs) {
    const stats = await Promise.all(
      sourceDirs.map(async (dir) => {
        try {
          if (!fs.existsSync(dir)) return `${dir}:missing`;
          const stat = await fs.promises.stat(dir);
          return `${dir}:${Math.round(stat.mtimeMs)}`;
        } catch (_error) {
          return `${dir}:error`;
        }
      }),
    );
    return stats.join("|");
  }

  async function collectDirectoriesContainingExtRecursive(rootDir, exts) {
    const targetDirs = new Set();
    const pendingDirs = [rootDir];

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
          if (SKIP_SCAN_DIR_NAMES.has(entry.name)) continue;
          pendingDirs.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!exts.includes(ext)) continue;
        targetDirs.add(currentDir);
      }
    }

    return Array.from(targetDirs);
  }

  async function listDirEntriesSafe(targetDir) {
    try {
      return await fs.promises.readdir(targetDir, { withFileTypes: true });
    } catch (_error) {
      return [];
    }
  }

  async function hasDirectFileWithExt(targetDir, exts) {
    const entries = await listDirEntriesSafe(targetDir);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (exts.includes(ext)) return true;
    }
    return false;
  }

  async function collectPreferredVideoDirsFromSource(sourceDir) {
    const discovered = new Set();
    if (!fs.existsSync(sourceDir)) return discovered;

    const hasDirectVideos = await hasDirectFileWithExt(sourceDir, VIDEO_EXT);

    // 1) 直下に動画がある場合は、そのディレクトリを採用。
    //    さらに "動画" フォルダ配下の整理（例: 動画\アニメ）も取りこぼさないよう、
    //    直下サブフォルダのみ再帰探索する。
    if (hasDirectVideos) {
      discovered.add(path.resolve(sourceDir));
      const directEntries = await listDirEntriesSafe(sourceDir);
      for (const entry of directEntries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_SCAN_DIR_NAMES.has(entry.name)) continue;
        const childDir = path.join(sourceDir, entry.name);
        const dirs = await collectDirectoriesContainingExtRecursive(childDir, VIDEO_EXT);
        for (const dir of dirs) discovered.add(path.resolve(dir));
      }
      return discovered;
    }

    // 2) 直下に「動画」フォルダがある構成は、その配下だけを探索
    const movieChildDir = path.join(sourceDir, "動画");
    if (fs.existsSync(movieChildDir)) {
      const dirs = await collectDirectoriesContainingExtRecursive(movieChildDir, VIDEO_EXT);
      for (const dir of dirs) discovered.add(path.resolve(dir));
      return discovered;
    }

    // 3) 上記どちらにも該当しない場合のみ、sourceDir全体を再帰探索
    const fallbackDirs = await collectDirectoriesContainingExtRecursive(sourceDir, VIDEO_EXT);
    for (const dir of fallbackDirs) discovered.add(path.resolve(dir));
    return discovered;
  }

  async function readDirIndex(indexPath, dirsKey) {
    try {
      if (!fs.existsSync(indexPath)) return null;
      const raw = await fs.promises.readFile(indexPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed[dirsKey]) || !Array.isArray(parsed.sourceDirs)) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  async function writeDirIndex(indexPath, index) {
    await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  }

  async function readLocalVideosIndex() {
    try {
      if (!fs.existsSync(LOCAL_VIDEOS_INDEX_PATH)) return null;
      const raw = await fs.promises.readFile(LOCAL_VIDEOS_INDEX_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.videos)) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  async function writeLocalVideosIndex(index) {
    await fs.promises.mkdir(path.dirname(LOCAL_VIDEOS_INDEX_PATH), { recursive: true });
    await fs.promises.writeFile(
      LOCAL_VIDEOS_INDEX_PATH,
      JSON.stringify(index, null, 2),
      "utf-8",
    );
  }

  async function resolveVideoScanDirs(sourceDirs, signature, options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const normalizedSourceDirs = sourceDirs.map((dir) => path.resolve(dir)).sort();
    const cachedIndex = await readDirIndex(VIDEO_DIR_INDEX_PATH, "videoDirs");
    if (!forceRefresh && cachedIndex && Array.isArray(cachedIndex.videoDirs)) {
      return {
        dirs: cachedIndex.videoDirs,
        fromCache: true,
      };
    }
    if (
      !forceRefresh &&
      cachedIndex &&
      cachedIndex.signature === signature &&
      Array.isArray(cachedIndex.sourceDirs) &&
      cachedIndex.sourceDirs.join("|") === normalizedSourceDirs.join("|") &&
      Array.isArray(cachedIndex.videoDirs)
    ) {
      return {
        dirs: cachedIndex.videoDirs,
        fromCache: true,
      };
    }

    const discovered = new Set();
    for (const sourceDir of sourceDirs) {
      if (!fs.existsSync(sourceDir)) continue;
      const dirs = await collectPreferredVideoDirsFromSource(sourceDir);
      for (const dir of dirs) discovered.add(path.resolve(dir));
    }

    const videoDirs = Array.from(discovered).sort();
    await writeDirIndex(VIDEO_DIR_INDEX_PATH, {
      signature,
      sourceDirs: normalizedSourceDirs,
      videoDirs,
      generatedAt: new Date().toISOString(),
    });

    return {
      dirs: videoDirs,
      fromCache: false,
    };
  }

  async function resolveThumbScanDirs(sourceDirs, signature, options = {}) {
    const forceRefresh = options.forceRefresh === true;
    const normalizedSourceDirs = sourceDirs.map((dir) => path.resolve(dir)).sort();
    const cachedIndex = await readDirIndex(THUMB_DIR_INDEX_PATH, "thumbDirs");
    if (!forceRefresh && cachedIndex && Array.isArray(cachedIndex.thumbDirs)) {
      return {
        dirs: cachedIndex.thumbDirs,
        fromCache: true,
      };
    }
    if (
      !forceRefresh &&
      cachedIndex &&
      cachedIndex.signature === signature &&
      Array.isArray(cachedIndex.sourceDirs) &&
      cachedIndex.sourceDirs.join("|") === normalizedSourceDirs.join("|") &&
      Array.isArray(cachedIndex.thumbDirs)
    ) {
      return {
        dirs: cachedIndex.thumbDirs,
        fromCache: true,
      };
    }

    const libraryRoots = deriveLibraryRootsFromSourceDirs(sourceDirs);
    const thumbSourceRoots = new Set();
    thumbSourceRoots.add(path.resolve(thumbnailDir));
    thumbSourceRoots.add(path.resolve(fallbackThumbnailDir));

    // 動画直下サムネ対応: sourceDir に直接サムネがあるケースのみ shallow に拾う
    for (const sourceDir of sourceDirs) {
      if (!fs.existsSync(sourceDir)) continue;
      if (await hasDirectFileWithExt(sourceDir, THUMB_EXT)) {
        thumbSourceRoots.add(path.resolve(sourceDir));
      }
    }

    for (const root of libraryRoots) {
      thumbSourceRoots.add(path.resolve(path.join(root, "サムネ")));
      thumbSourceRoots.add(path.resolve(path.join(root, "サムネイル")));
    }

    const discovered = new Set();
    for (const sourceRoot of thumbSourceRoots) {
      if (!fs.existsSync(sourceRoot)) continue;
      const dirs = await collectDirectoriesContainingExtRecursive(sourceRoot, THUMB_EXT);
      for (const dir of dirs) discovered.add(path.resolve(dir));
    }

    const thumbDirs = Array.from(discovered).sort();
    await writeDirIndex(THUMB_DIR_INDEX_PATH, {
      signature,
      sourceDirs: normalizedSourceDirs,
      thumbDirs,
      generatedAt: new Date().toISOString(),
    });

    return {
      dirs: thumbDirs,
      fromCache: false,
    };
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

  async function buildThumbnailLookup(thumbDirs) {
    const lookup = new Map();
    for (const thumbDir of thumbDirs) {
      if (!fs.existsSync(thumbDir)) continue;
      let entries = [];
      try {
        entries = await fs.promises.readdir(thumbDir, { withFileTypes: true });
      } catch (_error) {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!THUMB_EXT.includes(ext)) continue;
        const fullPath = path.join(thumbDir, entry.name);
        const key = path.parse(entry.name).name.toLowerCase();
        if (!lookup.has(key)) lookup.set(key, []);
        lookup.get(key).push(fullPath);
      }
    }
    return lookup;
  }

  function findThumbnailPathByLookup(videoPath, thumbLookup) {
    const base = path.parse(videoPath).name;
    const key = base.toLowerCase();
    const candidates = thumbLookup.get(key);
    if (!candidates || candidates.length === 0) return null;

    const sourceDir = path.resolve(path.dirname(videoPath));
    const libraryRoot = inferLibraryRootFromVideoPath(videoPath);
    const preferredDirs = [
      sourceDir,
      path.resolve(thumbnailDir),
      libraryRoot ? path.resolve(path.join(libraryRoot, "サムネ")) : "",
      libraryRoot ? path.resolve(path.join(libraryRoot, "サムネイル")) : "",
      path.resolve(fallbackThumbnailDir),
    ].filter(Boolean);

    for (const preferredDir of preferredDirs) {
      const found = candidates.find((p) => path.resolve(path.dirname(p)) === preferredDir);
      if (found) return found;
    }

    return candidates[0] || null;
  }

  function deriveLibraryRootsFromSourceDirs(sourceDirs) {
    const roots = new Set();
    for (const sourceDir of sourceDirs) {
      const resolved = path.resolve(sourceDir);
      const parsed = path.parse(resolved);
      const relative = resolved.slice(parsed.root.length);
      const segments = relative.split(path.sep).filter(Boolean);
      const videoDirIndex = segments.lastIndexOf("動画");
      if (videoDirIndex >= 0) {
        roots.add(path.join(parsed.root, ...segments.slice(0, videoDirIndex)));
      } else {
        roots.add(resolved);
      }
    }
    return Array.from(roots);
  }

  function appendVideoPathToThumbUrl(videoItem) {
    if (!videoItem || typeof videoItem !== "object") return videoItem;
    const thumbUrl = String(videoItem.thumb || "");
    const videoUrl = String(videoItem.video || "");
    if (!thumbUrl.includes("/api/local-media?type=thumb")) return videoItem;
    if (thumbUrl.includes("videoPath=")) return videoItem;
    const marker = "path=";
    const index = videoUrl.indexOf(marker);
    if (index < 0) return videoItem;
    const encodedVideoPath = videoUrl.slice(index + marker.length).split("&")[0];
    if (!encodedVideoPath) return videoItem;
    const joiner = thumbUrl.includes("?") ? "&" : "?";
    return {
      ...videoItem,
      thumb: `${thumbUrl}${joiner}videoPath=${encodedVideoPath}`,
    };
  }

  function normalizeThumbUrlsForCaching(videos) {
    if (!Array.isArray(videos)) return [];
    return videos.map((video) => appendVideoPathToThumbUrl(video));
  }

  app.get("/api/local-media", async (req, res) => {
    try {
      const type = req.query.type;
      const targetPath = String(req.query.path || "");

      if (!targetPath || !["video", "thumb"].includes(type)) {
        return apiError(res, 400, "無効なリクエストです。");
      }

      const allowedVideoDirs = await getLocalVideoDirs();
      const libraryRoots = deriveLibraryRootsFromSourceDirs(allowedVideoDirs);
      const siblingThumbDirs = [];
      for (const root of libraryRoots) {
        siblingThumbDirs.push(path.join(root, "サムネ"));
        siblingThumbDirs.push(path.join(root, "サムネイル"));
      }
      const allowedThumbDirs = [
        thumbnailDir,
        fallbackThumbnailDir,
        ...allowedVideoDirs,
        ...siblingThumbDirs,
      ];
      const allowedDirs = type === "video" ? allowedVideoDirs : allowedThumbDirs;

      const isAllowed = allowedDirs.some((dir) => isPathWithin(targetPath, dir));
      if (!isAllowed) {
        return apiError(res, 403, "アクセスが許可されていません。");
      }

      const ext = path.extname(targetPath).toLowerCase();
      if (type === "video" && !VIDEO_EXT.includes(ext)) {
        return apiError(res, 400, "無効な動画ファイルです。");
      }

      if (type === "thumb" && !THUMB_EXT.includes(ext)) {
        return apiError(res, 400, "無効な画像ファイルです。");
      }

      if (!fs.existsSync(targetPath)) {
        return apiError(res, 404, "ファイルが見つかりません。");
      }

      if (type === "thumb") {
        const videoPath = String(req.query.videoPath || "");
        if (videoPath) {
          const isVideoPathAllowed = allowedVideoDirs.some((dir) =>
            isPathWithin(videoPath, dir),
          );
          if (isVideoPathAllowed) {
            ensureCachedThumbnailFromPath(videoPath, targetPath, "low").catch((error) => {
              logger.warn("サムネイルの仮キャッシュ保存に失敗", { error: error.message });
            });
          }
        }
      }

      res.sendFile(path.resolve(targetPath));
    } catch (e) {
      logger.error("ローカルメディアの配信に失敗", { error: e.message });
      apiError(res, 500, "ローカルメディアの取得に失敗しました。");
    }
  });

  app.get("/api/local-thumb-fallback", async (req, res) => {
    try {
      const videoPath = String(req.query.videoPath || "");
      const priority = String(req.query.priority || "normal").toLowerCase();
      if (!videoPath) {
        return apiError(res, 400, "videoPath が必要です。");
      }

      const allowedVideoDirs = await getLocalVideoDirs();
      const isAllowed = allowedVideoDirs.some((dir) => isPathWithin(videoPath, dir));
      if (!isAllowed) {
        return apiError(res, 403, "アクセスが許可されていません。");
      }

      const ext = path.extname(videoPath).toLowerCase();
      const videoExt = [".mp4", ".mkv", ".webm", ".mov"];
      if (!videoExt.includes(ext)) {
        return apiError(res, 400, "無効な動画ファイルです。");
      }

      if (!fs.existsSync(videoPath)) {
        return apiError(res, 404, "動画が見つかりません。");
      }

      const settings = await loadConfig();
      const fallbackEnabled = settings.enableFallbackThumbnails !== false;
      if (!fallbackEnabled) {
        return res.redirect("/none_icon.jpg");
      }

      const existingThumbPath =
        findCachedFallbackThumbnailPath(videoPath) ||
        findExistingThumbnailPath(videoPath, true);
      const thumbPath =
        existingThumbPath || (await ensureFallbackThumbnail(videoPath, priority));
      if (!thumbPath) {
        return res.redirect("/none_icon.jpg");
      }
      res.sendFile(path.resolve(thumbPath));
    } catch (error) {
      logger.warn("フォールバックサムネイル生成をスキップ", {
        error: error.message,
      });
      res.redirect("/none_icon.jpg");
    }
  });

  app.get("/api/local-videos", async (_req, res) => {
    try {
      const startedAt = Date.now();
      const forceRefresh = String(_req.query.refresh || "").toLowerCase() === "1";
      const sourceDirs = await getLocalVideoDirs();
      const settings = await loadConfig();
      const fallbackEnabled = settings.enableFallbackThumbnails !== false;
      const now = Date.now();
      if (
        !forceRefresh &&
        localVideosCache.data &&
        localVideosCache.expiresAt > now &&
        localVideosCache.signature === "memory-cache"
      ) {
        logger.info("local videos cache hit", {
          count: localVideosCache.data.length,
          elapsedMs: Date.now() - startedAt,
        });
        return apiOk(res, normalizeThumbUrlsForCaching(localVideosCache.data));
      }

      if (!forceRefresh) {
        const diskIndex = await readLocalVideosIndex();
        if (
          diskIndex &&
          Array.isArray(diskIndex.videos) &&
          diskIndex.fallbackEnabled === fallbackEnabled
        ) {
          localVideosCache = {
            expiresAt: Date.now() + LOCAL_VIDEOS_CACHE_TTL_MS,
            signature: "memory-cache",
            data: diskIndex.videos,
          };
          logger.info("local videos disk cache hit", {
            count: diskIndex.videos.length,
            elapsedMs: Date.now() - startedAt,
          });
          return apiOk(res, normalizeThumbUrlsForCaching(diskIndex.videos));
        }
      }

      const signature = await buildLocalVideoDirsSignature(sourceDirs);

      const videos = [];
      const seenVideoPaths = new Set();
      const { dirs: videoDirs, fromCache } = await resolveVideoScanDirs(
        sourceDirs,
        signature,
        { forceRefresh },
      );
      const { dirs: thumbDirs, fromCache: thumbDirsFromCache } = await resolveThumbScanDirs(
        sourceDirs,
        signature,
        { forceRefresh },
      );
      const thumbLookup = await buildThumbnailLookup(thumbDirs);

      for (const videoDir of videoDirs) {
        if (!fs.existsSync(videoDir)) continue;
        let entries = [];
        try {
          entries = await fs.promises.readdir(videoDir, { withFileTypes: true });
        } catch (_error) {
          continue;
        }

        const scanned = await Promise.all(
          entries.map(async (entry) => {
            if (!entry.isFile()) return null;
            const ext = path.extname(entry.name).toLowerCase();
            if (!VIDEO_EXT.includes(ext)) return null;
            const fullPath = path.join(videoDir, entry.name);
            const normalizedPath = path.resolve(fullPath);
            if (seenVideoPaths.has(normalizedPath)) return null;
            seenVideoPaths.add(normalizedPath);

            const file = entry.name;
            const base = path.parse(file).name;
            const cachedThumbPath = findCachedFallbackThumbnailPath(fullPath);
            const thumbPath =
              cachedThumbPath ||
              findThumbnailPathByLookup(fullPath, thumbLookup) ||
              findExistingThumbnailPath(fullPath, false);
            const stat = await fs.promises.stat(fullPath);

            return {
              title: base,
              video: `/api/local-media?type=video&path=${encodeURIComponent(fullPath)}`,
              thumb: thumbPath
                ? `/api/local-media?type=thumb&path=${encodeURIComponent(thumbPath)}&videoPath=${encodeURIComponent(fullPath)}`
                : fallbackEnabled
                  ? `/api/local-thumb-fallback?videoPath=${encodeURIComponent(fullPath)}&priority=low`
                  : null,
              filename: file,
              mtime: stat.mtimeMs,
              sourceDir: videoDir,
            };
          }),
        );

        videos.push(...scanned.filter(Boolean));
      }

      videos.sort((a, b) => b.mtime - a.mtime);
      await writeLocalVideosIndex({
        sourceDirs: sourceDirs.map((dir) => path.resolve(dir)).sort(),
        fallbackEnabled,
        signature,
        videos,
        generatedAt: new Date().toISOString(),
      });
      localVideosCache = {
        expiresAt: Date.now() + LOCAL_VIDEOS_CACHE_TTL_MS,
        signature: "memory-cache",
        data: videos,
      };
      logger.info("local videos scanned", {
        count: videos.length,
        sourceDirs: sourceDirs.length,
        videoDirs: videoDirs.length,
        dirIndexCacheHit: fromCache,
        thumbDirs: thumbDirs.length,
        thumbDirIndexCacheHit: thumbDirsFromCache,
        forceRefresh,
        elapsedMs: Date.now() - startedAt,
      });
      apiOk(res, normalizeThumbUrlsForCaching(videos));
    } catch (e) {
      logger.error("ローカル動画のスキャンに失敗", { error: e.message });
      apiError(res, 500, "動画一覧の取得に失敗しました。");
    }
  });
}

module.exports = {
  registerLocalMediaRoutes,
};
