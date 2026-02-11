const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  normalizeDirList,
  normalizeConfig,
  loadConfig,
  saveConfig,
} = require("../server/config-store");

test("normalizeDirList trims, removes empty values, and deduplicates", () => {
  const input = [" C:\\a ", "", "C:\\a", "C:\\b", "   "];
  const normalized = normalizeDirList(input);
  assert.deepEqual(normalized, ["C:\\a", "C:\\b"]);
});

test("normalizeConfig applies defaults and clamps numeric settings", () => {
  const normalized = normalizeConfig({
    selectedBrowser: null,
    localVideoDirs: "not-array",
    enableFallbackThumbnails: "yes",
    wallpaperBlur: 999,
    wallpaperBrightness: -10,
  });

  assert.equal(normalized.selectedBrowser, "");
  assert.deepEqual(normalized.localVideoDirs, []);
  assert.equal(normalized.enableFallbackThumbnails, true);
  assert.equal(normalized.wallpaperBlur, 30);
  assert.equal(normalized.wallpaperBrightness, 30);
});

test("saveConfig and loadConfig round-trip normalized values", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "ytdl-config-store-test-"),
  );
  const configPath = path.join(tempDir, "config.json");

  const saved = await saveConfig(configPath, {
    selectedBrowser: "firefox",
    localVideoDirs: [" C:\\v1 ", "C:\\v1", "C:\\v2"],
    enableFallbackThumbnails: false,
    wallpaperBlur: 5,
    wallpaperBrightness: 80,
  });

  assert.equal(saved.selectedBrowser, "firefox");
  assert.deepEqual(saved.localVideoDirs, ["C:\\v1", "C:\\v2"]);
  assert.equal(saved.enableFallbackThumbnails, false);
  assert.equal(saved.wallpaperBlur, 5);
  assert.equal(saved.wallpaperBrightness, 80);

  const loaded = await loadConfig(configPath);
  assert.deepEqual(loaded, saved);

  await fs.rm(tempDir, { recursive: true, force: true });
});
