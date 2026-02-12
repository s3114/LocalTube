function createFetchWithTimeout() {
  let nodeFetchPromise;

  async function getNodeFetch() {
    if (!nodeFetchPromise) {
      nodeFetchPromise = import("node-fetch").then((mod) => mod.default);
    }
    return nodeFetchPromise;
  }

  return async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const fetch = await getNodeFetch();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

module.exports = {
  createFetchWithTimeout,
};
