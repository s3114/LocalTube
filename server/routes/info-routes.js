const { execFile } = require("child_process");
const { promisify } = require("util");
const { createLogger } = require("../services/logger-service");

function registerInfoRoutes(app, deps) {
  const execFileAsync = promisify(execFile);
  const {
    fs,
    path,
    baseDir,
    apiOk,
    apiError,
    loadConfig,
    getLocalVideoDirs,
    getProvisionalInfoPath,
    findLocalVideoPathById,
    createProvisionalInfoFromVideo,
    ensureProvisionalInfo,
  } = deps;
  const logger = deps.logger || createLogger("route-info");
  const INFO_DIR_INDEX_PATH = path.join(baseDir, "cache", "info-dir-index.json");
  const INFO_FILE_INDEX_PATH = path.join(baseDir, "cache", "info-file-index.json");
  const INFO_INDEX_CACHE_TTL_MS = 5000;
  let infoIndexCache = {
    signature: "",
    expiresAt: 0,
    entries: [],
  };
  const channelThumbnailEnrichmentState = new Map();
  const CHANNEL_THUMBNAIL_RETRY_COOLDOWN_MS = 10 * 60 * 1000;

  function buildChannelThumbnailEnrichmentKey(infoPath, infoObj) {
    if (String(infoPath || "").trim()) return `path:${path.resolve(String(infoPath))}`;
    const channelUrl = String(infoObj?.channel_url || "").trim();
    if (channelUrl) return `url:${channelUrl}`;
    const videoId = String(infoObj?.id || "").trim();
    if (videoId) return `id:${videoId}`;
    return "";
  }

  function shouldStartChannelThumbnailEnrichment(key) {
    if (!key) return false;
    const now = Date.now();
    const state = channelThumbnailEnrichmentState.get(key);
    if (!state) {
      channelThumbnailEnrichmentState.set(key, { status: "running", nextAllowedAt: 0 });
      return true;
    }
    if (state.status === "running") return false;
    if (state.nextAllowedAt > now) return false;
    state.status = "running";
    state.nextAllowedAt = 0;
    return true;
  }

  function finishChannelThumbnailEnrichment(key, succeeded) {
    if (!key) return;
    channelThumbnailEnrichmentState.set(key, {
      status: succeeded ? "done" : "idle",
      nextAllowedAt: succeeded ? 0 : Date.now() + CHANNEL_THUMBNAIL_RETRY_COOLDOWN_MS,
    });
  }

  function scheduleChannelThumbnailEnrichment(infoPath, info) {
    const infoObj = info && typeof info === "object" ? { ...info } : {};
    if (String(infoObj.channel_thumbnail || "").trim()) return;
    if (!String(infoObj.channel_url || "").trim()) return;
    const key = buildChannelThumbnailEnrichmentKey(infoPath, infoObj);
    if (!shouldStartChannelThumbnailEnrichment(key)) return;

    setImmediate(() => {
      enrichInfoWithChannelThumbnail(infoPath, infoObj)
        .then((enriched) => {
          finishChannelThumbnailEnrichment(
            key,
            Boolean(String(enriched?.channel_thumbnail || "").trim()),
          );
        })
        .catch((error) => {
          logger.warn("channel_thumbnail 非同期補完失敗", { error: error.message });
          finishChannelThumbnailEnrichment(key, false);
        });
    });
  }

  function normalizeChannelMetadataUrl(channelUrl) {
    const raw = String(channelUrl || "").trim();
    if (!raw || raw === "#") return "";
    const normalized = raw.replace(/\/+$/, "");
    if (/youtube\.com\/(channel|@|c\/|user\/)/i.test(normalized) && !/\/(videos|featured|streams|shorts)$/i.test(normalized)) {
      return `${normalized}/videos`;
    }
    return normalized;
  }

  function extractChannelIdFromChannelUrl(channelUrl) {
    const raw = String(channelUrl || "").trim();
    const match = raw.match(/youtube\.com\/channel\/([A-Za-z0-9_-]+)/i);
    return match ? match[1] : "";
  }

  function pickChannelAvatarUrl(channelObj) {
    let avatar = null;
    if (Array.isArray(channelObj?.thumbnails)) {
      avatar = channelObj.thumbnails.find((thumb) => thumb.id === "avatar_uncropped");
      if (!avatar) {
        avatar = channelObj.thumbnails.reduce((best, current) => {
          if (!best) return current;
          if (
            typeof current.preference === "number" &&
            typeof best.preference === "number"
          ) {
            return current.preference > best.preference ? current : best;
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

  async function enrichInfoWithCachedChannelThumbnail(infoPath, info) {
    const infoObj = info && typeof info === "object" ? { ...info } : {};
    if (String(infoObj.channel_thumbnail || "").trim()) {
      return infoObj;
    }
    if (!String(infoObj.channel_url || "").trim()) {
      return infoObj;
    }

    try {
      const existingChannelId =
        String(infoObj.channel_id || "").trim() ||
        extractChannelIdFromChannelUrl(infoObj.channel_url);
      if (!existingChannelId) {
        return infoObj;
      }
      const cachedChannelPath = path.join(
        baseDir,
        "downloads",
        "チャンネル",
        `${existingChannelId}.channel.json`,
      );
      if (!fs.existsSync(cachedChannelPath)) {
        return infoObj;
      }
      const cachedChannelJson = await fs.promises.readFile(cachedChannelPath, "utf-8");
      const cachedChannelObj = JSON.parse(cachedChannelJson);
      const cachedAvatarUrl = pickChannelAvatarUrl(cachedChannelObj);
      if (!cachedAvatarUrl) {
        return infoObj;
      }
      infoObj.channel_thumbnail = cachedAvatarUrl;
      if (infoPath) {
        await fs.promises.writeFile(
          infoPath,
          JSON.stringify(infoObj, null, 2),
          "utf-8",
        );
      }
    } catch (_error) {
      // キャッシュ参照失敗時は静かに元の情報を返す
    }

    return infoObj;
  }

  async function enrichInfoWithChannelThumbnail(infoPath, info) {
    const infoObj = await enrichInfoWithCachedChannelThumbnail(infoPath, info);
    if (String(infoObj.channel_thumbnail || "").trim()) {
      return infoObj;
    }
    if (!String(infoObj.channel_url || "").trim()) {
      return infoObj;
    }

    try {
      const channelArgs = ["-J", "--no-warnings", "--flat-playlist", "--playlist-items", "0"];
      const settings = typeof loadConfig === "function" ? await loadConfig() : {};
      if (settings?.selectedBrowser) {
        channelArgs.push("--cookies-from-browser", settings.selectedBrowser);
      }
      channelArgs.push(normalizeChannelMetadataUrl(infoObj.channel_url));

      const { stdout: channelJson } = await execFileAsync(
        path.join(baseDir, "yt-dlp.exe"),
        channelArgs,
        {
          encoding: "utf-8",
          timeout: 10000,
          windowsHide: true,
        },
      );
      const channelObj = JSON.parse(channelJson);

      try {
        const channelSaveDir = path.join(baseDir, "downloads", "チャンネル");
        fs.mkdirSync(channelSaveDir, { recursive: true });
        if (channelObj?.channel_id) {
          fs.writeFileSync(
            path.join(channelSaveDir, `${channelObj.channel_id}.channel.json`),
            channelJson,
            "utf-8",
          );
        }
      } catch (error) {
        logger.warn("チャンネルJSON保存失敗", { error: error.message });
      }

      const avatarUrl = pickChannelAvatarUrl(channelObj);
      if (avatarUrl) {
        infoObj.channel_thumbnail = avatarUrl;
        if (infoPath) {
          await fs.promises.writeFile(
            infoPath,
            JSON.stringify(infoObj, null, 2),
            "utf-8",
          );
        }
      }
    } catch (error) {
      logger.warn("チャンネル情報取得失敗", {
        error: error.message,
        stderr: String(error?.stderr || "").trim(),
      });
    }

    return infoObj;
  }

  function pickHomeLiteFields(info = {}) {
    return {
      id: info.id || null,
      title: info.title || "",
      channel: info.channel || "",
      uploader: info.uploader || info.uploader_id || "",
      upload_date: info.upload_date || "",
      duration: Number.isFinite(Number(info.duration))
        ? Math.max(0, Math.round(Number(info.duration)))
        : null,
      view_count: Number.isFinite(Number(info.view_count))
        ? Number(info.view_count)
        : null,
      channel_thumbnail: info.channel_thumbnail || "",
    };
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

  async function buildCommentSearchRoots() {
    const dirs = new Set([path.join(baseDir, "downloads", "コメント")]);
    if (typeof getLocalVideoDirs !== "function") return Array.from(dirs);
    const sourceDirs = await getLocalVideoDirs();
    const roots = deriveLibraryRootsFromSourceDirs(sourceDirs);
    for (const root of roots) {
      dirs.add(path.join(root, "コメント"));
    }
    return Array.from(dirs);
  }

  async function buildDirsSignature(dirs) {
    const stats = await Promise.all(
      dirs.map(async (dir) => {
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

  async function readIndexJson(indexPath) {
    try {
      if (!fs.existsSync(indexPath)) return null;
      const raw = await fs.promises.readFile(indexPath, "utf-8");
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  async function writeIndexJson(indexPath, value) {
    await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.promises.writeFile(indexPath, JSON.stringify(value, null, 2), "utf-8");
  }

  async function collectInfoDirectoriesRecursive(searchRoot) {
    const dirs = new Set();
    if (!fs.existsSync(searchRoot)) return [];
    const pendingDirs = [searchRoot];
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
        if (!entry.name.endsWith(".info.json")) continue;
        dirs.add(path.resolve(currentDir));
      }
    }
    return Array.from(dirs);
  }

  async function resolveCommentInfoDirs(searchRoots, signature) {
    const normalizedRoots = searchRoots.map((dir) => path.resolve(dir)).sort();
    const cached = await readIndexJson(INFO_DIR_INDEX_PATH);
    if (
      cached &&
      cached.signature === signature &&
      Array.isArray(cached.searchRoots) &&
      cached.searchRoots.join("|") === normalizedRoots.join("|") &&
      Array.isArray(cached.infoDirs)
    ) {
      return {
        dirs: cached.infoDirs,
        fromCache: true,
      };
    }

    const found = new Set();
    for (const root of searchRoots) {
      const dirs = await collectInfoDirectoriesRecursive(root);
      for (const dir of dirs) found.add(path.resolve(dir));
    }

    const infoDirs = Array.from(found).sort();
    await writeIndexJson(INFO_DIR_INDEX_PATH, {
      signature,
      searchRoots: normalizedRoots,
      infoDirs,
      generatedAt: new Date().toISOString(),
    });

    return {
      dirs: infoDirs,
      fromCache: false,
    };
  }

  async function buildInfoEntriesFromDirs(infoDirs) {
    const entries = [];
    for (const infoDir of infoDirs) {
      if (!fs.existsSync(infoDir)) continue;
      let files = [];
      try {
        files = await fs.promises.readdir(infoDir, { withFileTypes: true });
      } catch (_error) {
        continue;
      }
      for (const file of files) {
        if (!file.isFile()) continue;
        if (!file.name.endsWith(".info.json")) continue;
        entries.push({
          fileName: file.name,
          lowerName: file.name.toLowerCase(),
          fullPath: path.join(infoDir, file.name),
        });
      }
    }
    return entries;
  }

  async function getInfoEntries() {
    const searchRoots = await buildCommentSearchRoots();
    const signature = await buildDirsSignature(searchRoots);
    const now = Date.now();
    if (
      infoIndexCache.entries.length > 0 &&
      infoIndexCache.signature === signature &&
      infoIndexCache.expiresAt > now
    ) {
      return {
        entries: infoIndexCache.entries,
        signature,
        fromMemoryCache: true,
        fromDiskCache: false,
        dirIndexCacheHit: false,
      };
    }

    const diskIndex = await readIndexJson(INFO_FILE_INDEX_PATH);
    if (
      diskIndex &&
      diskIndex.signature === signature &&
      Array.isArray(diskIndex.entries)
    ) {
      const entries = diskIndex.entries
        .filter((v) => v && typeof v.fileName === "string" && typeof v.fullPath === "string")
        .map((v) => ({
          fileName: v.fileName,
          lowerName: v.fileName.toLowerCase(),
          fullPath: v.fullPath,
        }));
      infoIndexCache = {
        signature,
        expiresAt: now + INFO_INDEX_CACHE_TTL_MS,
        entries,
      };
      return {
        entries,
        signature,
        fromMemoryCache: false,
        fromDiskCache: true,
        dirIndexCacheHit: false,
      };
    }

    const { dirs: infoDirs, fromCache: dirIndexCacheHit } = await resolveCommentInfoDirs(
      searchRoots,
      signature,
    );
    const entries = await buildInfoEntriesFromDirs(infoDirs);
    await writeIndexJson(INFO_FILE_INDEX_PATH, {
      signature,
      entries: entries.map((v) => ({
        fileName: v.fileName,
        fullPath: v.fullPath,
      })),
      generatedAt: new Date().toISOString(),
    });

    infoIndexCache = {
      signature,
      expiresAt: now + INFO_INDEX_CACHE_TTL_MS,
      entries,
    };
    return {
      entries,
      signature,
      fromMemoryCache: false,
      fromDiskCache: false,
      dirIndexCacheHit,
    };
  }

  function findMatchingInfoPathFromEntries(videoId, entries) {
    const prefix = String(videoId || "").toLowerCase();
    const matched = entries.find((entry) => entry.lowerName.startsWith(prefix));
    return matched ? matched.fullPath : null;
  }

  async function findMatchingInfoJson(videoId, searchDir) {
    if (!fs.existsSync(searchDir)) return null;
    const pendingDirs = [searchDir];
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
        if (!entry.name.endsWith(".info.json")) continue;
        if (!entry.name.startsWith(videoId)) continue;
        return fullPath;
      }
    }
    return null;
  }

  async function resolveInfoJsonPath(videoId) {
    const { entries } = await getInfoEntries();
    return findMatchingInfoPathFromEntries(videoId, entries);
  }

  async function resolveLiteInfoByVideoId(videoId) {
    const provisionalPath = getProvisionalInfoPath(videoId);
    const infoPath = await resolveInfoJsonPath(videoId);
    if (infoPath) {
      const raw = await fs.promises.readFile(infoPath, "utf-8");
      const parsed = JSON.parse(raw);
      const enriched = await enrichInfoWithCachedChannelThumbnail(infoPath, parsed);
      return pickHomeLiteFields(enriched);
    }

    if (fs.existsSync(provisionalPath)) {
      try {
        const raw = await fs.promises.readFile(provisionalPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed?._provisional_info_version >= 3) {
          const enriched = await enrichInfoWithCachedChannelThumbnail(provisionalPath, parsed);
          return pickHomeLiteFields(enriched);
        }
      } catch (_error) {
        // ignore
      }
    }

    const videoPath = await findLocalVideoPathById(videoId);
    if (!videoPath) return null;

    if (typeof ensureProvisionalInfo === "function") {
      const generated = await ensureProvisionalInfo(videoPath, videoId);
      const enriched = await enrichInfoWithCachedChannelThumbnail(
        generated?.path || provisionalPath,
        generated?.info || {},
      );
      return pickHomeLiteFields(enriched);
    }

    const provisionalInfo = await createProvisionalInfoFromVideo(videoPath, videoId);
    await fs.promises.writeFile(
      provisionalPath,
      JSON.stringify(provisionalInfo, null, 2),
      "utf-8",
    );
    const enriched = await enrichInfoWithCachedChannelThumbnail(provisionalPath, provisionalInfo);
    return pickHomeLiteFields(enriched);
  }

  app.get("/info/:videoId", async (req, res) => {
    try {
      const startedAt = Date.now();
      const videoId = decodeURIComponent(req.params.videoId);
      const provisionalPath = getProvisionalInfoPath(videoId);

      logger.info("info lookup start", { videoId });

      const infoPath = await resolveInfoJsonPath(videoId);

      if (!infoPath) {
        if (fs.existsSync(provisionalPath)) {
          try {
            const cachedRaw = await fs.promises.readFile(provisionalPath, "utf-8");
            const cached = JSON.parse(cachedRaw);
            if (cached?._provisional_info_version >= 3) {
              scheduleChannelThumbnailEnrichment(provisionalPath, cached);
              res.type("application/json; charset=utf-8");
              return res.sendFile(provisionalPath);
            }
          } catch (_error) {
            // 壊れたJSONや旧形式は再生成する
          }
        }

        const videoPath = await findLocalVideoPathById(videoId);
        if (!videoPath) {
          logger.warn("info not found and no local video", { videoId });
          return res.status(404).json({ error: "info.json が見つかりません" });
        }

        if (typeof ensureProvisionalInfo === "function") {
          const generated = await ensureProvisionalInfo(videoPath, videoId);
          scheduleChannelThumbnailEnrichment(
            generated?.path || provisionalPath,
            generated?.info || {},
          );
          logger.info("provisional info resolved", {
            provisionalPath: generated?.path || provisionalPath,
            fromCache: Boolean(generated?.fromCache),
            elapsedMs: Date.now() - startedAt,
          });
        } else {
          const provisionalInfo = await createProvisionalInfoFromVideo(videoPath, videoId);
          await fs.promises.writeFile(
            provisionalPath,
            JSON.stringify(provisionalInfo, null, 2),
            "utf-8",
          );
          logger.info("generated provisional info", {
            provisionalPath,
            elapsedMs: Date.now() - startedAt,
          });
        }

        res.type("application/json; charset=utf-8");
        return res.sendFile(provisionalPath);
      }

      logger.info("serving existing info", {
        infoPath,
        elapsedMs: Date.now() - startedAt,
      });

      try {
        const raw = await fs.promises.readFile(infoPath, "utf-8");
        scheduleChannelThumbnailEnrichment(infoPath, JSON.parse(raw));
      } catch (error) {
        logger.warn("info.json の channel_thumbnail 非同期補完予約失敗", {
          error: error.message,
        });
      }

      res.type("application/json; charset=utf-8");
      res.sendFile(infoPath);
    } catch (e) {
      logger.error("failed to serve info.json", { error: e.message });
      res.status(500).json({ error: "info.json の取得に失敗しました" });
    }
  });

  app.get("/api/info-lite/:videoId", async (req, res) => {
    try {
      const startedAt = Date.now();
      const videoId = decodeURIComponent(req.params.videoId);
      const lite = await resolveLiteInfoByVideoId(videoId);
      if (!lite) {
        return apiError(res, 404, "info-lite が見つかりません");
      }
      logger.info("serving info-lite", {
        videoId,
        elapsedMs: Date.now() - startedAt,
      });
      apiOk(res, lite);
    } catch (error) {
      logger.error("failed to serve info-lite", { error: error.message });
      apiError(res, 500, "info-lite の取得に失敗しました");
    }
  });

  app.get("/api/home-info", async (req, res) => {
    try {
      const startedAt = Date.now();
      const idsRaw = String(req.query.ids || "");
      const ids = idsRaw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 200);
      if (ids.length === 0) {
        return apiError(res, 400, "ids が必要です");
      }

      const entries = await Promise.all(
        ids.map(async (videoId) => {
          const lite = await resolveLiteInfoByVideoId(videoId);
          return [videoId, lite];
        }),
      );

      const data = {};
      for (const [videoId, lite] of entries) {
        if (lite) data[videoId] = lite;
      }
      logger.info("serving home-info batch", {
        requested: ids.length,
        resolved: Object.keys(data).length,
        infoIndexSize: (await getInfoEntries()).entries.length,
        elapsedMs: Date.now() - startedAt,
      });
      apiOk(res, data);
    } catch (error) {
      logger.error("failed to serve home-info", { error: error.message });
      apiError(res, 500, "home-info の取得に失敗しました");
    }
  });
}

module.exports = {
  registerInfoRoutes,
};
