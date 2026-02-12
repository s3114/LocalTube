function formatMeta(meta) {
  if (!meta || typeof meta !== "object") return "";
  const entries = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`);
  return entries.length > 0 ? ` ${entries.join(" ")}` : "";
}

function createLogger(scope = "app") {
  function info(message, meta) {
    console.log(`[${scope}] ${message}${formatMeta(meta)}`);
  }

  function warn(message, meta) {
    console.warn(`[${scope}] ${message}${formatMeta(meta)}`);
  }

  function error(message, meta) {
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
};
