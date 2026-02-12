const LOG_LEVEL_ORDER = {
  error: 0,
  warn: 1,
  info: 2,
};
const { appendLogEntry } = require("./log-stream-service");

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
    const line = `[${scope}] ${message}${formatMeta(meta)}`;
    console.log(line);
    appendLogEntry({ level: "info", scope, message: `${message}${formatMeta(meta)}` });
  }

  function warn(message, meta) {
    if (!canLog("warn")) return;
    const line = `[${scope}] ${message}${formatMeta(meta)}`;
    console.warn(line);
    appendLogEntry({ level: "warn", scope, message: `${message}${formatMeta(meta)}` });
  }

  function error(message, meta) {
    if (!canLog("error")) return;
    const line = `[${scope}] ${message}${formatMeta(meta)}`;
    console.error(line);
    appendLogEntry({ level: "error", scope, message: `${message}${formatMeta(meta)}` });
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
