const MAX_LOG_ENTRIES = 2000;

let nextLogId = 1;
const logEntries = [];

function appendLogEntry(entry) {
  const normalized = {
    id: nextLogId++,
    timestamp: new Date().toISOString(),
    level: String(entry?.level || "info"),
    scope: String(entry?.scope || "app"),
    message: String(entry?.message || ""),
  };
  logEntries.push(normalized);
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries.splice(0, logEntries.length - MAX_LOG_ENTRIES);
  }
  return normalized;
}

function getLogEntries({ sinceId = 0, limit = 200 } = {}) {
  const normalizedSinceId = Number.isFinite(Number(sinceId))
    ? Number(sinceId)
    : 0;
  const normalizedLimit = Math.max(
    1,
    Math.min(1000, Number.isFinite(Number(limit)) ? Number(limit) : 200),
  );
  const filtered = logEntries.filter((entry) => entry.id > normalizedSinceId);
  return filtered.slice(-normalizedLimit);
}

module.exports = {
  appendLogEntry,
  getLogEntries,
};

