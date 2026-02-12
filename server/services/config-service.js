const {
  loadConfig: loadConfigFromPath,
  saveConfig: saveConfigToPath,
} = require("../config-store");

function createConfigService({ path, baseDir, env = process.env }) {
  const configPath = env.YTDL_CONFIG_PATH
    ? path.resolve(env.YTDL_CONFIG_PATH)
    : path.join(baseDir, "config.json");

  async function loadConfig() {
    return loadConfigFromPath(configPath);
  }

  async function saveConfig(config) {
    return saveConfigToPath(configPath, config);
  }

  return {
    configPath,
    loadConfig,
    saveConfig,
  };
}

module.exports = {
  createConfigService,
};
