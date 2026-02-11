const fs = require("fs");
const path = require("path");

const CONFIG_DEFAULTS = {
  selectedBrowser: "",
  localVideoDirs: [],
  enableFallbackThumbnails: true,
  wallpaperBlur: 2,
  wallpaperBrightness: 50,
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
    console.error("設定ファイル読み込みエラー:", error);
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
  normalizeConfig,
  loadConfig,
  saveConfig,
};
