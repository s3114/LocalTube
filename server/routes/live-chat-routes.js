const { createLogger } = require("../services/logger-service");
const fsp = require("node:fs/promises");
const readline = require("node:readline");

function registerLiveChatRoutes(app, deps) {
  const {
    fs,
    path,
    baseDir,
    apiError,
    getLocalVideoDirs,
    loadConfig,
    saveConfig,
    findLocalVideoPathById,
  } = deps;
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

  function isLikelyYoutubeVideoId(value) {
    const text = String(value || "").trim();
    return /^[A-Za-z0-9_-]{11}$/.test(text);
  }

  function inferLibraryRootFromVideoPath(videoPath) {
    const resolvedVideoDir = path.resolve(path.dirname(String(videoPath || "")));
    const parsed = path.parse(resolvedVideoDir);
    const relative = resolvedVideoDir.slice(parsed.root.length);
    const segments = relative.split(path.sep).filter(Boolean);
    const videoDirIndex = segments.lastIndexOf("動画");
    if (videoDirIndex < 0) return null;
    return path.join(parsed.root, ...segments.slice(0, videoDirIndex));
  }

  function buildSidecarLiveChatCandidates(videoPath) {
    if (!videoPath) return [];
    const libraryRoot = inferLibraryRootFromVideoPath(videoPath);
    if (!libraryRoot) return [];
    const base = path.parse(videoPath).name;
    return [
      path.join(libraryRoot, "ライブチャット", `${base}.live_chat.json`),
      path.join(libraryRoot, "ライブチャット", `${base}.live-chat.json`),
    ];
  }

  function normalizeChatBaseName(fileName) {
    return String(fileName || "")
      .replace(/\.live_chat\.json$/i, "")
      .replace(/\.live-chat\.json$/i, "");
  }

  function buildInfoCandidatesFromChatPath(chatFilePath) {
    const resolved = path.resolve(String(chatFilePath || ""));
    if (!resolved) return [];
    const baseName = normalizeChatBaseName(path.basename(resolved));
    const chatDir = path.dirname(resolved);
    const candidates = [];

    candidates.push(path.join(chatDir, `${baseName}.info.json`));

    const parentDir = path.dirname(chatDir);
    if (path.basename(chatDir) === "ライブチャット") {
      candidates.push(path.join(parentDir, "コメント", `${baseName}.info.json`));
      candidates.push(path.join(parentDir, "仮コメント", `${baseName}.info.json`));
    } else {
      candidates.push(path.join(chatDir, "コメント", `${baseName}.info.json`));
      candidates.push(path.join(chatDir, "仮コメント", `${baseName}.info.json`));
    }

    return candidates;
  }

  async function chatFileMatchesVideoId(chatFilePath, videoId) {
    const normalizedId = String(videoId || "").trim();
    if (!normalizedId) return false;

    for (const candidate of buildInfoCandidatesFromChatPath(chatFilePath)) {
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

  async function findLiveChatByInfoJsonId(videoId) {
    const normalizedId = String(videoId || "").trim();
    if (!normalizedId) return null;
    const infoRoots = await buildInfoSearchRoots();
    for (const root of infoRoots) {
      if (!root || !fs.existsSync(root)) continue;
      let entries = [];
      try {
        entries = await fsp.readdir(root, { withFileTypes: true });
      } catch (_error) {
        continue;
      }
      for (const entry of entries) {
        if (!entry?.isFile?.()) continue;
        if (!/\.info\.json$/i.test(entry.name || "")) continue;
        const infoPath = path.join(root, entry.name);
        let raw = "";
        try {
          raw = await fsp.readFile(infoPath, "utf-8");
        } catch (_error) {
          continue;
        }
        const match = raw.match(/"id"\s*:\s*"([^"]+)"/);
        if (String(match?.[1] || "").trim() !== normalizedId) continue;
        const baseName = String(entry.name).replace(/\.info\.json$/i, "");
        const libraryRoot = path.dirname(root);
        const candidatePaths = [
          path.join(libraryRoot, "ライブチャット", `${baseName}.live_chat.json`),
          path.join(libraryRoot, "ライブチャット", `${baseName}.live-chat.json`),
        ];
        for (const candidate of candidatePaths) {
          if (candidate && fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    }
    return null;
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
        if (
          !entry.name.endsWith(".live_chat.json") &&
          !entry.name.endsWith(".live-chat.json")
        ) {
          continue;
        }
        dirs.add(path.resolve(currentDir));
      }
    }
    return Array.from(dirs);
  }

  async function buildInfoSearchRoots() {
    const dirs = new Set([
      path.join(baseDir, "downloads", "コメント"),
      path.join(baseDir, "downloads", "仮コメント"),
    ]);
    if (typeof getLocalVideoDirs !== "function") return Array.from(dirs);
    const sourceDirs = await getLocalVideoDirs();
    const roots = deriveLibraryRootsFromSourceDirs(sourceDirs);
    for (const root of roots) {
      dirs.add(path.join(root, "コメント"));
      dirs.add(path.join(root, "仮コメント"));
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
        if (
          !entry.name.endsWith(".live_chat.json") &&
          !entry.name.endsWith(".live-chat.json")
        ) {
          continue;
        }
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
    const candidates = [
      videoFile,
      `${videoFile}.live_chat.json`,
      `${videoFile}.live-chat.json`,
    ];
    const { map, fromMemoryCache, fromDiskCache, dirIndexCacheHit } = await getLiveChatFileMap();
    for (const candidate of candidates) {
      const found = map.get(candidate);
      if (found) return found;
    }

    // yt-dlp の命名で「タイトル [id].live_chat.json」のようにIDが含まれている場合を拾う
    if (isLikelyYoutubeVideoId(videoFile)) {
      const normalized = String(videoFile).toLowerCase();
      for (const [fileName, fullPath] of map.entries()) {
        if (!fileName) continue;
        const lower = String(fileName).toLowerCase();
        if (
          (lower.endsWith(".live_chat.json") || lower.endsWith(".live-chat.json")) &&
          lower.includes(normalized)
        ) {
          return fullPath;
        }
      }

      for (const [, fullPath] of map.entries()) {
        if (!fullPath) continue;
        if (await chatFileMatchesVideoId(fullPath, videoFile)) {
          return fullPath;
        }
      }

      const derivedFromInfoPath = await findLiveChatByInfoJsonId(videoFile);
      if (derivedFromInfoPath) {
        return derivedFromInfoPath;
      }

      // ローカル動画が見つかるなら、そこから sidecar を推測する
      if (typeof findLocalVideoPathById === "function") {
        const videoPath = await findLocalVideoPathById(videoFile);
        if (videoPath) {
          for (const candidatePath of buildSidecarLiveChatCandidates(videoPath)) {
            if (!candidatePath) continue;
            if (!fs.existsSync(candidatePath)) continue;
            return candidatePath;
          }
        }
      }
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

  function getChatTimeSecFromMessage(msg) {
    const rawTimeMs = msg?.replayChatItemAction?.videoOffsetTimeMsec;
    const timeMs = Number(rawTimeMs);
    if (!Number.isFinite(timeMs)) return null;
    return Math.floor(timeMs / 1000);
  }

  async function readLiveChatWindow(chatFile, { startSec, endSec, limit }) {
    const items = [];
    let hasMoreAfter = false;
    let hasMoreBefore = false;
    const maxItems = Math.max(1, Math.min(1000, Number(limit) || 300));
    const fromSec = Math.max(0, Number(startSec) || 0);
    const toSec = Math.max(fromSec, Number(endSec) || fromSec + 60);

    const stream = fs.createReadStream(chatFile, { encoding: "utf8" });
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    try {
      for await (const rawLine of rl) {
        const line = String(rawLine || "").trim();
        if (!line) continue;

        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch (_error) {
          continue;
        }

        const timeSec = getChatTimeSecFromMessage(parsed);
        if (!Number.isFinite(timeSec)) continue;
        if (timeSec < fromSec) {
          hasMoreBefore = true;
          continue;
        }
        if (timeSec > toSec) {
          hasMoreAfter = true;
          break;
        }
        if (items.length >= maxItems) {
          hasMoreAfter = true;
          break;
        }

        items.push(parsed);
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    return {
      items,
      startSec: fromSec,
      endSec: toSec,
      hasMoreBefore,
      hasMoreAfter,
    };
  }

  async function buildEmojiShortcutMap(chatFile) {
    const shortcutMap = new Map();
    const stream = fs.createReadStream(chatFile, { encoding: "utf8" });
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    function collectEmojiRuns(value) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(collectEmojiRuns);
        return;
      }

      if (Array.isArray(value.runs)) {
        for (const run of value.runs) {
          const emoji = run?.emoji;
          if (!emoji) continue;
          const thumb = emoji.image?.thumbnails?.slice(-1)[0];
          const thumbUrl = thumb?.url || "";
          if (!thumbUrl) continue;
          const shortcuts = Array.isArray(emoji.shortcuts) ? emoji.shortcuts : [];
          const label =
            emoji.image?.accessibility?.accessibilityData?.label ||
            emoji.emojiId ||
            "emoji";
          for (const shortcut of shortcuts) {
            const key = String(shortcut || "").trim();
            if (!key || shortcutMap.has(key)) continue;
            shortcutMap.set(key, {
              shortcut: key,
              label,
              url: `/api/chat-image-fallback?url=${encodeURIComponent(thumbUrl)}&kind=emoji`,
            });
          }
        }
      }

      for (const child of Object.values(value)) {
        if (child && typeof child === "object") {
          collectEmojiRuns(child);
        }
      }
    }

    try {
      for await (const rawLine of rl) {
        const line = String(rawLine || "").trim();
        if (!line) continue;
        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch (_error) {
          continue;
        }
        collectEmojiRuns(parsed);
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    return Array.from(shortcutMap.values());
  }

  function buildEmojiItemsFromDictionary(dictionary) {
    if (!dictionary || typeof dictionary !== "object") return [];
    const items = [];
    const seenShortcuts = new Set();
    for (const [shortcut, value] of Object.entries(dictionary)) {
      const key = String(shortcut || "").trim();
      if (!key || seenShortcuts.has(key)) continue;
      if (typeof value === "string") {
        const url = value.trim();
        if (!url) continue;
        seenShortcuts.add(key);
        items.push({ shortcut: key, url, label: key });
        continue;
      }
      if (!value || typeof value !== "object") continue;
      const url = String(value.url || "").trim();
      if (!url) continue;
      seenShortcuts.add(key);
      items.push({
        shortcut: key,
        url,
        label: String(value.label || key).trim() || key,
      });
    }
    return items;
  }

  async function persistEmojiShortcutMap(items) {
    if (typeof loadConfig !== "function" || typeof saveConfig !== "function") return;
    if (!Array.isArray(items) || items.length === 0) return;

    const currentConfig = await loadConfig();
    const nextDictionary = {
      ...(currentConfig.emojiDictionary && typeof currentConfig.emojiDictionary === "object"
        ? currentConfig.emojiDictionary
        : {}),
    };

    let changed = false;
    const seenShortcuts = new Set();
    for (const item of items) {
      const shortcut = String(item?.shortcut || "").trim();
      const url = String(item?.url || "").trim();
      if (!shortcut || !url || seenShortcuts.has(shortcut)) continue;
      seenShortcuts.add(shortcut);
      const nextValue = {
        url,
        label: String(item?.label || shortcut).trim() || shortcut,
      };
      const prev = nextDictionary[shortcut];
      if (
        prev &&
        typeof prev === "object" &&
        prev.url === nextValue.url &&
        String(prev.label || "").trim() === nextValue.label
      ) {
        continue;
      }
      nextDictionary[shortcut] = nextValue;
      changed = true;
    }

    if (!changed) return;
    currentConfig.emojiDictionary = nextDictionary;
    await saveConfig(currentConfig);
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

      const hasWindowQuery =
        req.query &&
        (req.query.startSec !== undefined ||
          req.query.endSec !== undefined ||
          req.query.limit !== undefined);
      if (hasWindowQuery) {
        const payload = await readLiveChatWindow(chatFile, {
          startSec: req.query.startSec,
          endSec: req.query.endSec,
          limit: req.query.limit,
        });
        return res.json(payload);
      }

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      fs.createReadStream(chatFile).pipe(res);
    } catch (e) {
      logger.error("failed to serve live chat", { error: e.message });
      apiError(res, 500, "ライブチャットの取得に失敗しました");
    }
  });

  app.get("/api/live-chat-emoji-map/:videoFile", async (req, res) => {
    try {
      const videoFile = decodeURIComponent(req.params.videoFile);
      const chatFile = await findLiveChatFile(videoFile);
      if (!chatFile || !fs.existsSync(chatFile)) {
        const settings = typeof loadConfig === "function" ? await loadConfig() : {};
        return res.json({
          items: buildEmojiItemsFromDictionary(settings?.emojiDictionary),
          source: "config",
        });
      }

      const items = await buildEmojiShortcutMap(chatFile);
      await persistEmojiShortcutMap(items);
      return res.json({ items, source: "live-chat" });
    } catch (e) {
      logger.error("failed to build live chat emoji map", { error: e.message });
      return apiError(res, 500, "ライブチャット絵文字マップの取得に失敗しました");
    }
  });
}

module.exports = {
  registerLiveChatRoutes,
};
