const { createLogger } = require("../services/logger-service");
const fsp = require("node:fs/promises");

function registerLiveChatRoutes(app, deps) {
  const { fs, path, baseDir, apiError, getLocalVideoDirs } = deps;
  const logger = deps.logger || createLogger("route-live-chat");
  const LIVE_CHAT_DIR_INDEX_PATH = path.join(baseDir, "cache", "live-chat-dir-index.json");
  const LIVE_CHAT_FILE_INDEX_PATH = path.join(baseDir, "cache", "live-chat-file-index.json");
  const LIVE_CHAT_INDEX_CACHE_TTL_MS = 5000;
  let liveChatIndexCache = {
    signature: "",
    expiresAt: 0,
    map: new Map(),
  };

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

  async function buildLiveChatSearchRoots() {
    const dirs = new Set([path.join(baseDir, "downloads", "ライブチャット")]);
    if (typeof getLocalVideoDirs !== "function") return Array.from(dirs);
    const sourceDirs = await getLocalVideoDirs();
    const roots = deriveLibraryRootsFromSourceDirs(sourceDirs);
    for (const root of roots) {
      dirs.add(path.join(root, "ライブチャット"));
    }
    return Array.from(dirs);
  }

  async function buildDirsSignature(dirs) {
    const stats = await Promise.all(
      dirs.map(async (dir) => {
        try {
          if (!fs.existsSync(dir)) return `${dir}:missing`;
          let stat = null;
          if (fs.promises?.stat) {
            stat = await fs.promises.stat(dir);
          } else {
            stat = await fsp.stat(dir);
          }
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
      let raw = "";
      if (fs.promises?.readFile) {
        raw = await fs.promises.readFile(indexPath, "utf-8");
      } else {
        raw = await fsp.readFile(indexPath, "utf-8");
      }
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  async function writeIndexJson(indexPath, value) {
    try {
      if (fs.promises?.mkdir) {
        await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
      } else {
        await fsp.mkdir(path.dirname(indexPath), { recursive: true });
      }
      if (fs.promises?.writeFile) {
        await fs.promises.writeFile(indexPath, JSON.stringify(value, null, 2), "utf-8");
      } else {
        await fsp.writeFile(indexPath, JSON.stringify(value, null, 2), "utf-8");
      }
    } catch (_error) {
      // ignore cache persistence errors
    }
  }

  async function collectLiveChatDirsRecursive(searchRoot) {
    const dirs = new Set();
    if (!fs.existsSync(searchRoot)) return [];
    const pendingDirs = [searchRoot];
    while (pendingDirs.length > 0) {
      const currentDir = pendingDirs.pop();
      if (!currentDir) continue;
      let entries = [];
      try {
        if (fs.promises?.readdir) {
          entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        } else {
          entries = await fsp.readdir(currentDir, { withFileTypes: true });
        }
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
        if (!entry.name.endsWith(".live_chat.json")) continue;
        dirs.add(path.resolve(currentDir));
      }
    }
    return Array.from(dirs);
  }

  async function resolveLiveChatDirs(searchRoots, signature) {
    const normalizedRoots = searchRoots.map((dir) => path.resolve(dir)).sort();
    const cached = await readIndexJson(LIVE_CHAT_DIR_INDEX_PATH);
    if (
      cached &&
      cached.signature === signature &&
      Array.isArray(cached.searchRoots) &&
      cached.searchRoots.join("|") === normalizedRoots.join("|") &&
      Array.isArray(cached.chatDirs)
    ) {
      return {
        dirs: cached.chatDirs,
        fromCache: true,
      };
    }

    const found = new Set();
    for (const root of searchRoots) {
      const dirs = await collectLiveChatDirsRecursive(root);
      for (const dir of dirs) found.add(path.resolve(dir));
    }

    const chatDirs = Array.from(found).sort();
    await writeIndexJson(LIVE_CHAT_DIR_INDEX_PATH, {
      signature,
      searchRoots: normalizedRoots,
      chatDirs,
      generatedAt: new Date().toISOString(),
    });

    return {
      dirs: chatDirs,
      fromCache: false,
    };
  }

  async function buildLiveChatFileMap(chatDirs) {
    const map = new Map();
    for (const chatDir of chatDirs) {
      if (!fs.existsSync(chatDir)) continue;
      let entries = [];
      try {
        if (fs.promises?.readdir) {
          entries = await fs.promises.readdir(chatDir, { withFileTypes: true });
        } else {
          entries = await fsp.readdir(chatDir, { withFileTypes: true });
        }
      } catch (_error) {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".live_chat.json")) continue;
        map.set(entry.name, path.join(chatDir, entry.name));
      }
    }
    return map;
  }

  async function getLiveChatFileMap() {
    const searchRoots = await buildLiveChatSearchRoots();
    const signature = await buildDirsSignature(searchRoots);
    const now = Date.now();
    if (
      liveChatIndexCache.map.size > 0 &&
      liveChatIndexCache.signature === signature &&
      liveChatIndexCache.expiresAt > now
    ) {
      return {
        map: liveChatIndexCache.map,
        signature,
        fromMemoryCache: true,
        fromDiskCache: false,
        dirIndexCacheHit: false,
      };
    }

    const disk = await readIndexJson(LIVE_CHAT_FILE_INDEX_PATH);
    if (disk && disk.signature === signature && disk.files && typeof disk.files === "object") {
      const map = new Map();
      for (const [fileName, fullPath] of Object.entries(disk.files)) {
        if (typeof fullPath !== "string") continue;
        map.set(fileName, fullPath);
      }
      liveChatIndexCache = {
        signature,
        expiresAt: now + LIVE_CHAT_INDEX_CACHE_TTL_MS,
        map,
      };
      return {
        map,
        signature,
        fromMemoryCache: false,
        fromDiskCache: true,
        dirIndexCacheHit: false,
      };
    }

    const { dirs: chatDirs, fromCache: dirIndexCacheHit } = await resolveLiveChatDirs(
      searchRoots,
      signature,
    );
    const map = await buildLiveChatFileMap(chatDirs);
    const files = {};
    for (const [fileName, fullPath] of map.entries()) {
      files[fileName] = fullPath;
    }
    await writeIndexJson(LIVE_CHAT_FILE_INDEX_PATH, {
      signature,
      files,
      generatedAt: new Date().toISOString(),
    });

    liveChatIndexCache = {
      signature,
      expiresAt: now + LIVE_CHAT_INDEX_CACHE_TTL_MS,
      map,
    };
    return {
      map,
      signature,
      fromMemoryCache: false,
      fromDiskCache: false,
      dirIndexCacheHit,
    };
  }

  async function findLiveChatFile(videoFile) {
    const candidates = [videoFile, `${videoFile}.live_chat.json`];
    const { map, fromMemoryCache, fromDiskCache, dirIndexCacheHit } = await getLiveChatFileMap();
    for (const candidate of candidates) {
      const found = map.get(candidate);
      if (found) return found;
    }
    logger.info("live-chat lookup miss", {
      videoFile,
      fromMemoryCache,
      fromDiskCache,
      dirIndexCacheHit,
      indexedFiles: map.size,
    });
    return null;
  }

  app.get("/api/live-chat/:videoFile", async (req, res) => {
    try {
      const videoFile = decodeURIComponent(req.params.videoFile);
      const chatFile = await findLiveChatFile(videoFile);

      logger.info("resolved chat path", { chatFile });
      if (!chatFile || !fs.existsSync(chatFile)) {
        logger.warn("chat file not found", { chatFile });
        return apiError(res, 404, "対応するライブチャットがありません");
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      fs.createReadStream(chatFile).pipe(res);
    } catch (e) {
      logger.error("failed to serve live chat", { error: e.message });
      apiError(res, 500, "ライブチャットの取得に失敗しました");
    }
  });
}

module.exports = {
  registerLiveChatRoutes,
};
