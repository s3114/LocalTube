const { execFileSync } = require("child_process");

function createLocalPathService({ path, normalizeDirList, movieDir, loadConfig }) {
  const networkDriveRootCache = new Map();

  function isPathWithin(targetPath, baseDir) {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedBase = path.resolve(baseDir);
    return (
      resolvedTarget === resolvedBase ||
      resolvedTarget.startsWith(resolvedBase + path.sep)
    );
  }

  function readWindowsNetworkDriveRoot(driveLetter) {
    const normalizedLetter = String(driveLetter || "").trim().toUpperCase();
    if (!/^[A-Z]$/.test(normalizedLetter)) return null;
    if (networkDriveRootCache.has(normalizedLetter)) {
      return networkDriveRootCache.get(normalizedLetter);
    }

    try {
      const stdout = execFileSync(
        "cmd.exe",
        ["/d", "/s", "/c", `net use ${normalizedLetter}:`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      const match = String(stdout || "").match(/Remote name\s+(.+)\r?\n/i);
      const remoteRoot = match ? String(match[1] || "").trim() : "";
      const resolvedRoot = remoteRoot.startsWith("\\\\") ? remoteRoot : null;
      networkDriveRootCache.set(normalizedLetter, resolvedRoot);
      return resolvedRoot;
    } catch (_error) {
      networkDriveRootCache.set(normalizedLetter, null);
      return null;
    }
  }

  function normalizeSourceDir(dir) {
    const input = String(dir || "").trim();
    if (!input) return "";
    if (process.platform !== "win32") return input;

    const normalized = input.replace(/\//g, "\\");
    const match = normalized.match(/^([A-Za-z]):(\\.*)?$/);
    if (!match) return input;

    const driveLetter = match[1].toUpperCase();
    const remoteRoot = readWindowsNetworkDriveRoot(driveLetter);
    if (!remoteRoot) return input;

    const suffix = String(match[2] || "").replace(/^\\+/, "");
    return suffix ? path.join(remoteRoot, suffix) : remoteRoot;
  }

  async function getLocalVideoDirs() {
    const config = await loadConfig();
    const extraDirs = normalizeDirList(config.localVideoDirs)
      .map(normalizeSourceDir)
      .filter(Boolean);
    return [movieDir, ...extraDirs].filter(
      (dir, idx, arr) => arr.indexOf(dir) === idx,
    );
  }

  return {
    isPathWithin,
    getLocalVideoDirs,
  };
}

module.exports = {
  createLocalPathService,
};
