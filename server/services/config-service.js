const {
  loadConfig: loadConfigFromPath,
  saveConfig: saveConfigToPath,
  normalizeEmojiDictionary,
} = require("../config-store");
const fs = require("node:fs/promises");

function createConfigService({ path, baseDir, env = process.env }) {
  const configPath = env.YTDL_CONFIG_PATH
    ? path.resolve(env.YTDL_CONFIG_PATH)
    : path.join(baseDir, "config.json");
  const configExt = path.extname(configPath);
  const configBaseName = path.basename(configPath, configExt);
  const legacyEmojiDictionaryPath = path.join(path.dirname(configPath), "emoji-dictionary.json");
  const emojiDictionaryPath = env.YTDL_EMOJI_DICTIONARY_PATH
    ? path.resolve(env.YTDL_EMOJI_DICTIONARY_PATH)
    : path.join(path.dirname(configPath), `${configBaseName}.emoji-dictionary.json`);

  async function readEmojiDictionaryFrom(targetPath) {
    try {
      const raw = await fs.readFile(targetPath, "utf-8");
      const parsed = JSON.parse(raw);
      return normalizeEmojiDictionary(parsed);
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      return {};
    }
  }

  async function loadEmojiDictionary() {
    const preferred = await readEmojiDictionaryFrom(emojiDictionaryPath);
    if (preferred !== null) return preferred;
    return readEmojiDictionaryFrom(legacyEmojiDictionaryPath);
  }

  async function saveEmojiDictionary(dictionary) {
    const normalized = normalizeEmojiDictionary(dictionary);
    await fs.mkdir(path.dirname(emojiDictionaryPath), { recursive: true });
    await fs.writeFile(emojiDictionaryPath, JSON.stringify(normalized, null, 2), "utf-8");
    if (legacyEmojiDictionaryPath !== emojiDictionaryPath) {
      try {
        await fs.unlink(legacyEmojiDictionaryPath);
      } catch (_error) {
        // noop
      }
    }
    return normalized;
  }

  async function loadConfig() {
    const settings = await loadConfigFromPath(configPath);
    const dictionaryFromFile = await loadEmojiDictionary();
    settings.emojiDictionary =
      dictionaryFromFile !== null
        ? dictionaryFromFile
        : normalizeEmojiDictionary(settings.emojiDictionary);
    return settings;
  }

  async function saveConfig(config) {
    const normalizedDictionary = await saveEmojiDictionary(config?.emojiDictionary);
    const saved = await saveConfigToPath(configPath, config);
    saved.emojiDictionary = normalizedDictionary;
    return saved;
  }

  return {
    configPath,
    emojiDictionaryPath,
    loadConfig,
    saveConfig,
  };
}

module.exports = {
  createConfigService,
};
