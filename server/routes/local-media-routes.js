const crypto = require("crypto");
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
    runCommand,
    apiOk,
    apiError,
  } = deps;
  const logger = deps.logger || createLogger("route-local-media");
  const LOCAL_VIDEOS_CACHE_TTL_MS = 5000;
  const LOCAL_VIDEOS_INDEX_VERSION = 3;
  const VIDEO_EXT = [".mp4", ".mkv", ".webm", ".mov"];
  const THUMB_EXT = [".jpg", ".jpeg", ".png", ".webp"];
  const VIDEO_DIR_INDEX_PATH = path.join(baseDir, "cache", "video-dir-index.json");
  const THUMB_DIR_INDEX_PATH = path.join(baseDir, "cache", "thumb-dir-index.json");
  const LOCAL_VIDEOS_INDEX_PATH = path.join(baseDir, "cache", "local-videos-index.json");
  const MEMBER_EMOJI_DIR = path.join(baseDir, "downloads", "メンバー絵文字");
  const MEMBER_BADGE_DIR = path.join(baseDir, "downloads", "メンバーバッチ");
  const POWERSHELL_EXE =
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
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

  function isLoopbackRequest(req) {
    const remote = String(req.socket?.remoteAddress || "").toLowerCase();
    return remote === "::1" || remote === "127.0.0.1" || remote === "::ffff:127.0.0.1";
  }

  function normalizeVideoBaseName(videoPath) {
    return path
      .parse(String(videoPath || ""))
      .name.replace(/\.live_chat\.json$/i, "");
  }

  function addExistingPath(targetSet, candidatePath) {
    const value = String(candidatePath || "").trim();
    if (!value) return;
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved)) return;
    targetSet.add(resolved);
  }

  async function addMatchingFilesFromDir(targetSet, dirPath, matcher) {
    const resolvedDir = String(dirPath || "").trim();
    if (!resolvedDir || !fs.existsSync(resolvedDir)) return;
    let entries = [];
    try {
      entries = await fs.promises.readdir(resolvedDir, { withFileTypes: true });
    } catch (_error) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!matcher(entry.name)) continue;
      targetSet.add(path.resolve(path.join(resolvedDir, entry.name)));
    }
  }

  async function movePathToRecycleBin(targetPath) {
    const resolved = path.resolve(targetPath);
    const targetStat = await fs.promises.stat(resolved);
    const escapedTarget = resolved.replace(/'/g, "''");
    const kind = targetStat.isDirectory() ? "dir" : "file";
    const script =
      `$target = '${escapedTarget}';` +
      `$kind = '${kind}';` +
      "Add-Type -AssemblyName Microsoft.VisualBasic;" +
      "if ($kind -eq 'dir') {" +
      "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($target,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin);" +
      "} else {" +
      "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($target,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin);" +
      "}";
    await runCommand(POWERSHELL_EXE, [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
  }

  async function collectDeleteTargets(videoPath) {
    const targets = new Set();
    const resolvedVideoPath = path.resolve(videoPath);
    const sourceDir = path.resolve(path.dirname(resolvedVideoPath));
    const libraryRoot = inferLibraryRootFromVideoPath(resolvedVideoPath);
    const videoBaseName = normalizeVideoBaseName(resolvedVideoPath);

    addExistingPath(targets, resolvedVideoPath);
    addExistingPath(targets, findExistingThumbnailPath(resolvedVideoPath, true));
    addExistingPath(targets, findCachedFallbackThumbnailPath(resolvedVideoPath));

    const commentDirs = [
      libraryRoot ? path.join(libraryRoot, "コメント") : "",
      libraryRoot ? path.join(libraryRoot, "仮コメント") : "",
    ];
    for (const commentDir of commentDirs) {
      addExistingPath(targets, path.join(commentDir, `${videoBaseName}.info.json`));
    }

    const liveChatDirs = [
      libraryRoot ? path.join(libraryRoot, "ライブチャット") : "",
      libraryRoot || "",
    ];
    for (const liveChatDir of liveChatDirs) {
      await addMatchingFilesFromDir(
        targets,
        liveChatDir,
        (fileName) => fileName.startsWith(`${videoBaseName}.live_chat.json`),
      );
    }

    const thumbnailDirs = [
      sourceDir,
      libraryRoot ? path.join(libraryRoot, "サムネ") : "",
      libraryRoot ? path.join(libraryRoot, "サムネイル") : "",
      fallbackThumbnailDir,
    ];
    for (const thumbnailDirPath of thumbnailDirs) {
      await addMatchingFilesFromDir(targets, thumbnailDirPath, (fileName) => {
        const parsed = path.parse(fileName);
        return (
          THUMB_EXT.includes(parsed.ext.toLowerCase()) &&
          parsed.name.toLowerCase() === videoBaseName.toLowerCase()
        );
      });
    }

    return Array.from(targets);
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

  function normalizeChatEmojiUrl(url) {
    return String(url || "").replace(/=w\d+-h\d+[-a-z0-9]*/i, "");
  }

  function normalizeChatBadgeUrl(url) {
    return String(url || "").replace(/=s\d+[-a-z0-9]*/i, "");
  }

  function hasExtendedLocalVideoMetadata(videos) {
    if (!Array.isArray(videos)) return false;
    if (videos.length === 0) return true;
    return videos.every((video) =>
      video &&
      typeof video === "object" &&
      Object.prototype.hasOwnProperty.call(video, "videoId") &&
      Object.prototype.hasOwnProperty.call(video, "channelId") &&
      Object.prototype.hasOwnProperty.call(video, "channelName") &&
      Object.prototype.hasOwnProperty.call(video, "duration") &&
      Object.prototype.hasOwnProperty.call(video, "liveStatus") &&
      Object.prototype.hasOwnProperty.call(video, "isLive") &&
      Object.prototype.hasOwnProperty.call(video, "wasLive") &&
      Object.prototype.hasOwnProperty.call(video, "webpageUrl"),
    );
  }

  function pickChannelAvatarUrl(channelObj) {
    if (!Array.isArray(channelObj?.thumbnails)) return "";
    const avatarThumb =
      channelObj.thumbnails.find((thumb) => thumb?.id === "avatar_uncropped") ||
      channelObj.thumbnails.find((thumb) =>
        Number.isFinite(Number(thumb?.width)) &&
        Number.isFinite(Number(thumb?.height)) &&
        Math.abs(Number(thumb.width) - Number(thumb.height)) <= 16,
      ) ||
      channelObj.thumbnails[channelObj.thumbnails.length - 1];
    return String(avatarThumb?.url || "").trim();
  }

  function pickChannelBannerUrl(channelObj) {
    if (!Array.isArray(channelObj?.thumbnails)) return "";
    const bannerThumb =
      channelObj.thumbnails.find((thumb) => thumb?.id === "banner_uncropped") ||
      channelObj.thumbnails.find((thumb) =>
        Number(thumb?.width || 0) > Number(thumb?.height || 0) * 2,
      ) ||
      channelObj.thumbnails[0];
    return String(bannerThumb?.url || "").trim();
  }

  function normalizeChannelSummary(channelObj) {
    const source = channelObj && typeof channelObj === "object" ? channelObj : {};
    const channelId = String(
      source.channel_id || source.id || "",
    ).trim();
    const name = String(
      source.channel || source.uploader || source.title || "",
    )
      .replace(/\s+-\s+videos$/i, "")
      .trim();
    if (!channelId || !name) return null;
    return {
      id: channelId,
      channelId,
      name,
      handle: String(source.uploader_id || "").trim(),
      url: String(source.channel_url || source.uploader_url || "").trim(),
      avatar: pickChannelAvatarUrl(source),
      banner: pickChannelBannerUrl(source),
      subscriberCount: Number.isFinite(Number(source.channel_follower_count))
        ? Number(source.channel_follower_count)
        : null,
    };
  }

  function extractLikelyYoutubeId(text) {
    const source = String(text || "");
    const match = source.match(
      /(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{11})(?=$|[^A-Za-z0-9_-])/,
    );
    return match ? match[2] : "";
  }

  const infoJsonIdIndexCache = new Map();
  const INFO_JSON_ID_INDEX_TTL_MS = 5 * 60 * 1000;

  async function buildInfoJsonIdIndexForLibraryRoot(libraryRoot) {
    const idToPath = new Map();
    const dirs = [
      path.join(libraryRoot, "コメント"),
      path.join(libraryRoot, "仮コメント"),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      let entries = [];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (_error) {
        continue;
      }

      for (const entry of entries) {
        if (!entry?.isFile?.()) continue;
        if (!String(entry.name || "").endsWith(".info.json")) continue;

        const fullPath = path.join(dir, entry.name);
        let raw = "";
        try {
          raw = await fs.promises.readFile(fullPath, "utf-8");
        } catch (_error) {
          continue;
        }
        if (!raw) continue;

        // JSON.parse せずに id だけ拾う（速い）
        const match = raw.match(/"id"\s*:\s*"([^"]+)"/);
        const id = String(match?.[1] || "").trim();
        if (!id || idToPath.has(id)) continue;
        idToPath.set(id, fullPath);
      }
    }

    return idToPath;
  }

  async function resolveInfoJsonPathById(libraryRoot, videoId) {
    const rootKey = String(libraryRoot || "").trim();
    const idKey = String(videoId || "").trim();
    if (!rootKey || !idKey) return "";

    const now = Date.now();
    const cached = infoJsonIdIndexCache.get(rootKey);
    if (cached && cached.expiresAt > now && cached.idToPath instanceof Map) {
      return cached.idToPath.get(idKey) || "";
    }

    const idToPath = await buildInfoJsonIdIndexForLibraryRoot(rootKey);
    infoJsonIdIndexCache.set(rootKey, {
      expiresAt: now + INFO_JSON_ID_INDEX_TTL_MS,
      idToPath,
    });
    return idToPath.get(idKey) || "";
  }

  async function readInfoJsonSummary(videoPath) {
    const resolvedVideoPath = path.resolve(String(videoPath || ""));
    if (!resolvedVideoPath) {
      return {
        id: "",
        title: "",
        channelId: "",
        channelName: "",
        channelThumbnail: "",
        duration: null,
        liveStatus: "",
        isLive: false,
        wasLive: false,
        webpageUrl: "",
        uploadDate: "",
        viewCount: null,
      };
    }

    const baseName = normalizeVideoBaseName(resolvedVideoPath);
    const libraryRoot = inferLibraryRootFromVideoPath(resolvedVideoPath);
    const sameDirCandidate = path.join(path.dirname(resolvedVideoPath), `${baseName}.info.json`);
    const candidatePaths = [
      libraryRoot ? path.join(libraryRoot, "コメント", `${baseName}.info.json`) : "",
      libraryRoot ? path.join(libraryRoot, "仮コメント", `${baseName}.info.json`) : "",
      sameDirCandidate,
    ].filter(Boolean);

    for (const candidatePath of candidatePaths) {
      try {
        if (!fs.existsSync(candidatePath)) continue;
        const raw = await fs.promises.readFile(candidatePath, "utf-8");
        const parsed = JSON.parse(raw);
        const videoId = String(parsed?.id || "").trim();
        if (!videoId) continue;
        return {
          id: videoId,
          title: String(parsed?.title || "").trim(),
          channelId: String(parsed?.channel_id || "").trim(),
          channelName: String(parsed?.channel || parsed?.uploader || "").trim(),
          channelThumbnail: String(parsed?.channel_thumbnail || "").trim(),
          duration: Number.isFinite(Number(parsed?.duration))
            ? Math.max(0, Math.round(Number(parsed.duration)))
            : null,
          liveStatus: String(parsed?.live_status || "").trim(),
          isLive: parsed?.is_live === true,
          wasLive: parsed?.was_live === true,
          webpageUrl: String(parsed?.webpage_url || "").trim(),
          uploadDate: String(parsed?.upload_date || "").trim(),
          viewCount: Number.isFinite(Number(parsed?.view_count))
            ? Number(parsed.view_count)
            : null,
        };
      } catch (_error) {
        // ignore malformed sidecar json and continue fallback detection
      }
    }

    // ファイル名が一致しない場合でも、id から info.json を引けるようにする
    const videoIdFallback = extractLikelyYoutubeId(baseName);
    if (libraryRoot && videoIdFallback) {
      const matchedPath = await resolveInfoJsonPathById(libraryRoot, videoIdFallback);
      if (matchedPath && fs.existsSync(matchedPath)) {
        try {
          const raw = await fs.promises.readFile(matchedPath, "utf-8");
          const parsed = JSON.parse(raw);
          const videoId = String(parsed?.id || "").trim();
          if (videoId) {
            return {
              id: videoId,
              title: String(parsed?.title || "").trim(),
              channelId: String(parsed?.channel_id || "").trim(),
              channelName: String(parsed?.channel || parsed?.uploader || "").trim(),
              channelThumbnail: String(parsed?.channel_thumbnail || "").trim(),
              duration: Number.isFinite(Number(parsed?.duration))
                ? Math.max(0, Math.round(Number(parsed.duration)))
                : null,
              liveStatus: String(parsed?.live_status || "").trim(),
              isLive: parsed?.is_live === true,
              wasLive: parsed?.was_live === true,
              webpageUrl: String(parsed?.webpage_url || "").trim(),
              uploadDate: String(parsed?.upload_date || "").trim(),
              viewCount: Number.isFinite(Number(parsed?.view_count))
                ? Number(parsed.view_count)
                : null,
            };
          }
        } catch (_error) {
          // ignore
        }
      }
    }

    return {
      id: extractLikelyYoutubeId(baseName),
      title: "",
      channelId: "",
      channelName: "",
      channelThumbnail: "",
      duration: null,
      liveStatus: "",
      isLive: false,
      wasLive: false,
      webpageUrl: "",
      uploadDate: "",
      viewCount: null,
    };
  }

  function getChatAssetFallbackPath(assetUrl, kind) {
    const normalizedUrl =
      kind === "badge"
        ? normalizeChatBadgeUrl(assetUrl)
        : normalizeChatEmojiUrl(assetUrl);
    if (!normalizedUrl) return null;
    const hash = crypto
      .createHash("sha256")
      .update(normalizedUrl)
      .digest("hex");
    const dir = kind === "badge" ? MEMBER_BADGE_DIR : MEMBER_EMOJI_DIR;
    const filePath = path.join(dir, `${hash}.png`);
    return fs.existsSync(filePath) ? filePath : null;
  }

  function isAllowedRemoteChatAssetUrl(assetUrl) {
    try {
      const parsed = new URL(String(assetUrl || ""));
      if (parsed.protocol !== "https:") return false;
      return /(^|\.)ggpht\.com$/i.test(parsed.hostname);
    } catch (_error) {
      return false;
    }
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

  app.get("/api/chat-image-fallback", async (req, res) => {
    try {
      const assetUrl = String(req.query.url || "");
      const kind = String(req.query.kind || "").toLowerCase();
      if (!assetUrl || !["emoji", "badge"].includes(kind)) {
        return apiError(res, 400, "無効なリクエストです。");
      }

      const fallbackPath = getChatAssetFallbackPath(assetUrl, kind);
      if (!fallbackPath) {
        if (isAllowedRemoteChatAssetUrl(assetUrl)) {
          return res.redirect(assetUrl);
        }
        return apiError(res, 404, "対応するローカル画像が見つかりません。");
      }

      res.sendFile(path.resolve(fallbackPath));
    } catch (error) {
      logger.warn("チャット画像フォールバックの取得に失敗", {
        error: error.message,
      });
      apiError(res, 500, "チャット画像フォールバックの取得に失敗しました。");
    }
  });

  app.post("/api/local-video/delete", async (req, res) => {
    try {
      if (!isLoopbackRequest(req)) {
        return apiError(res, 403, "この操作はサーバー本体PC（localhost）からのみ実行できます。");
      }

      const videoPath = String(req.body?.videoPath || "").trim();
      if (!videoPath) {
        return apiError(res, 400, "videoPath が必要です。");
      }

      const allowedVideoDirs = await getLocalVideoDirs();
      const isAllowed = allowedVideoDirs.some((dir) => isPathWithin(videoPath, dir));
      if (!isAllowed) {
        return apiError(res, 403, "アクセスが許可されていません。");
      }

      const ext = path.extname(videoPath).toLowerCase();
      if (!VIDEO_EXT.includes(ext)) {
        return apiError(res, 400, "無効な動画ファイルです。");
      }

      if (!fs.existsSync(videoPath)) {
        return apiError(res, 404, "動画が見つかりません。");
      }

      const deleteTargets = await collectDeleteTargets(videoPath);
      for (const targetPath of deleteTargets) {
        await movePathToRecycleBin(targetPath);
      }

      localVideosCache = {
        expiresAt: 0,
        signature: "",
        data: null,
      };

      apiOk(res, {
        message: "ローカル動画をごみ箱へ移動しました。",
        deletedCount: deleteTargets.length,
        deletedPaths: deleteTargets,
      });
    } catch (error) {
      logger.warn("ローカル動画の削除に失敗", {
        error: error.message,
      });
      apiError(res, 500, "ローカル動画の削除に失敗しました。");
    }
  });

  app.get("/api/local-videos", async (_req, res) => {
    try {
      const startedAt = Date.now();
      const forceRefresh = String(_req.query.refresh || "").toLowerCase() === "1";
      const sourceDirs = await getLocalVideoDirs();
      const signature = await buildLocalVideoDirsSignature(sourceDirs);
      const normalizedSourceDirs = sourceDirs.map((dir) => path.resolve(dir)).sort();
      const settings = await loadConfig();
      const fallbackEnabled = settings.enableFallbackThumbnails !== false;
      const now = Date.now();
      if (
        !forceRefresh &&
        localVideosCache.data &&
        localVideosCache.expiresAt > now &&
        localVideosCache.signature === "memory-cache" &&
        hasExtendedLocalVideoMetadata(localVideosCache.data)
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
          diskIndex.indexVersion === LOCAL_VIDEOS_INDEX_VERSION &&
          diskIndex.signature === signature &&
          Array.isArray(diskIndex.sourceDirs) &&
          diskIndex.sourceDirs.join("|") === normalizedSourceDirs.join("|") &&
          diskIndex.fallbackEnabled === fallbackEnabled &&
          hasExtendedLocalVideoMetadata(diskIndex.videos)
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

            const infoSummary = await readInfoJsonSummary(fullPath);

            return {
              title: infoSummary.title || base,
              video: `/api/local-media?type=video&path=${encodeURIComponent(fullPath)}`,
              videoPath: fullPath,
              thumb: thumbPath
                ? `/api/local-media?type=thumb&path=${encodeURIComponent(thumbPath)}&videoPath=${encodeURIComponent(fullPath)}`
                : fallbackEnabled
                  ? `/api/local-thumb-fallback?videoPath=${encodeURIComponent(fullPath)}&priority=low`
                  : null,
              filename: file,
              videoId: infoSummary.id,
              channelId: infoSummary.channelId,
              channelName: infoSummary.channelName,
              channelThumbnail: infoSummary.channelThumbnail,
              duration: infoSummary.duration,
              liveStatus: infoSummary.liveStatus,
              isLive: infoSummary.isLive,
              wasLive: infoSummary.wasLive,
              webpageUrl: infoSummary.webpageUrl,
              uploadDate: infoSummary.uploadDate,
              viewCount: infoSummary.viewCount,
              mtime: stat.mtimeMs,
              sourceDir: videoDir,
            };
          }),
        );

        videos.push(...scanned.filter(Boolean));
      }

      videos.sort((a, b) => b.mtime - a.mtime);
      await writeLocalVideosIndex({
        indexVersion: LOCAL_VIDEOS_INDEX_VERSION,
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

  app.get("/api/local-channels", async (_req, res) => {
    try {
      const channelDir = path.join(baseDir, "downloads", "チャンネル");
      if (!fs.existsSync(channelDir)) {
        return apiOk(res, []);
      }

      const entries = await fs.promises.readdir(channelDir, { withFileTypes: true });
      const channels = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".channel.json")) continue;
        try {
          const fullPath = path.join(channelDir, entry.name);
          const raw = await fs.promises.readFile(fullPath, "utf-8");
          const parsed = JSON.parse(raw);
          const channel = normalizeChannelSummary(parsed);
          if (channel) {
            channels.push(channel);
          }
        } catch (error) {
          logger.warn("channel json parse failed", {
            file: entry.name,
            error: error.message,
          });
        }
      }

      channels.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "ja"),
      );
      apiOk(res, channels);
    } catch (error) {
      logger.error("ローカルチャンネル一覧の取得に失敗", {
        error: error.message,
      });
      apiError(res, 500, "チャンネル一覧の取得に失敗しました。");
    }
  });
}

module.exports = {
  registerLocalMediaRoutes,
};
