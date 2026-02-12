const LOG_LEVEL_ORDER = {
  error: 0,
  warn: 1,
  info: 2,
};

function formatMeta(meta) {
  if (!meta || typeof meta !== "object") return "";
  const entries = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`);
  return entries.length > 0 ? ` ${entries.join(" ")}` : "";
}

function normalizeLogLevel(level) {
  const normalized = String(level || "")
    .trim()
    .toLowerCase();
  return Object.prototype.hasOwnProperty.call(LOG_LEVEL_ORDER, normalized)
    ? normalized
    : "info";
}

function createLogger(scope = "app", options = {}) {
  const configuredLevel = normalizeLogLevel(options.level || process.env.LOG_LEVEL);

  function canLog(level) {
    return LOG_LEVEL_ORDER[level] <= LOG_LEVEL_ORDER[configuredLevel];
  }

  function info(message, meta) {
    if (!canLog("info")) return;
    console.log(`[${scope}] ${message}${formatMeta(meta)}`);
  }

  function warn(message, meta) {
    if (!canLog("warn")) return;
    console.warn(`[${scope}] ${message}${formatMeta(meta)}`);
  }

  function error(message, meta) {
    if (!canLog("error")) return;
    console.error(`[${scope}] ${message}${formatMeta(meta)}`);
  }

  return {
    info,
    warn,
    error,
  };
}

module.exports = {
  createLogger,
  normalizeLogLevel,
};
