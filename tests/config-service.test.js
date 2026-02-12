const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { createConfigService } = require("../server/services/config-service");

test("config-service uses YTDL_CONFIG_PATH when provided", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ytdl-config-svc-"));
  const configPath = path.join(tempDir, "custom-config.json");
  const service = createConfigService({
    path,
    baseDir: tempDir,
    env: { YTDL_CONFIG_PATH: configPath },
  });

  await service.saveConfig({
    selectedBrowser: "firefox",
    localVideoDirs: ["C:\\v"],
    enableFallbackThumbnails: false,
    wallpaperBlur: 4,
    wallpaperBrightness: 70,
  });
  const loaded = await service.loadConfig();

  assert.equal(service.configPath, path.resolve(configPath));
  assert.equal(loaded.selectedBrowser, "firefox");
  assert.deepEqual(loaded.localVideoDirs, ["C:\\v"]);

  await fs.rm(tempDir, { recursive: true, force: true });
});
