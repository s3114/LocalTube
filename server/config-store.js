const fs = require("fs");
const path = require("path");
const { createLogger } = require("./services/logger-service");

const logger = createLogger("config-store");

const CONFIG_DEFAULTS = {
  selectedBrowser: "",
  localVideoDirs: [],
  enableFallbackThumbnails: true,
  wallpaperBlur: 2,
  wallpaperBrightness: 50,
  playlistsState: {
    playlists: [],
    selectedId: "",
  },
};

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeDirList(dirList) {
  if (!Array.isArray(dirList)) return [];

  return dirList
    .map((dir) => String(dir || "").trim())
    .filter(Boolean)
    .filter((dir, idx, arr) => arr.indexOf(dir) === idx);
}

function normalizePlaylistsState(rawState) {
  const source = rawState && typeof rawState === "object" ? rawState : {};
  const playlists = Array.isArray(source.playlists)
    ? source.playlists
      .filter((playlist) => playlist && typeof playlist === "object")
      .map((playlist) => ({
        id: String(playlist.id || "").trim(),
        name: String(playlist.name || "").trim(),
        items: Array.isArray(playlist.items)
          ? playlist.items.map((item) => String(item || "").trim()).filter(Boolean)
          : [],
      }))
      .filter((playlist) => playlist.id && playlist.name)
    : [];

  const selectedId = String(source.selectedId || "").trim();
  const resolvedSelectedId = playlists.some((playlist) => playlist.id === selectedId)
    ? selectedId
    : playlists[0]?.id || "";

  return {
    playlists,
    selectedId: resolvedSelectedId,
  };
}

function normalizeConfig(config) {
  const raw = config || {};
  return {
    selectedBrowser: String(raw.selectedBrowser || CONFIG_DEFAULTS.selectedBrowser),
    localVideoDirs: normalizeDirList(raw.localVideoDirs),
    enableFallbackThumbnails:
      typeof raw.enableFallbackThumbnails === "boolean"
        ? raw.enableFallbackThumbnails
        : CONFIG_DEFAULTS.enableFallbackThumbnails,
    wallpaperBlur: clampNumber(
      raw.wallpaperBlur,
      0,
      30,
      CONFIG_DEFAULTS.wallpaperBlur,
    ),
    wallpaperBrightness: clampNumber(
      raw.wallpaperBrightness,
      30,
      200,
      CONFIG_DEFAULTS.wallpaperBrightness,
    ),
    playlistsState: normalizePlaylistsState(raw.playlistsState),
  };
}

async function loadConfig(configPath) {
  try {
    if (!fs.existsSync(configPath)) {
      return { ...CONFIG_DEFAULTS };
    }

    const configData = await fs.promises.readFile(configPath, "utf-8");
    const parsed = JSON.parse(configData);
    return normalizeConfig(parsed);
  } catch (error) {
    logger.error("設定ファイル読み込みエラー", { error: error.message });
    return { ...CONFIG_DEFAULTS };
  }
}

async function saveConfig(configPath, config) {
  const normalized = normalizeConfig(config);

  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await fs.promises.writeFile(configPath, JSON.stringify(normalized, null, 2));
  return normalized;
}

module.exports = {
  CONFIG_DEFAULTS,
  normalizeDirList,
  normalizePlaylistsState,
  normalizeConfig,
  loadConfig,
  saveConfig,
};
