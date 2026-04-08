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
    emojiDictionary: {
      ":_kanataTen:": {
        url: "/api/chat-image-fallback?url=abc&kind=emoji",
        label: "kanataTen",
      },
    },
  });
  const loaded = await service.loadConfig();
  const savedConfigText = await fs.readFile(service.configPath, "utf8");
  const savedConfig = JSON.parse(savedConfigText);
  const savedDictionaryText = await fs.readFile(service.emojiDictionaryPath, "utf8");
  const savedDictionary = JSON.parse(savedDictionaryText);

  assert.equal(service.configPath, path.resolve(configPath));
  assert.equal(
    service.emojiDictionaryPath,
    path.join(tempDir, "custom-config.emoji-dictionary.json"),
  );
  assert.equal(loaded.selectedBrowser, "firefox");
  assert.deepEqual(loaded.localVideoDirs, ["C:\\v"]);
  assert.deepEqual(loaded.emojiDictionary, {
    ":_kanataTen:": {
      url: "/api/chat-image-fallback?url=abc&kind=emoji",
      label: "kanataTen",
    },
  });
  assert.equal(Object.hasOwn(savedConfig, "emojiDictionary"), false);
  assert.deepEqual(savedDictionary, loaded.emojiDictionary);

  await fs.rm(tempDir, { recursive: true, force: true });
});
