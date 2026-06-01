const fs = require("fs");
const path = require("path");

function resolveExistingToolPath(baseDir, candidates, { allowPathLookup = false } = {}) {
  const normalizedBaseDir = String(baseDir || "").trim();
  const list = Array.isArray(candidates) ? candidates : [];

  for (const candidate of list) {
    const rawCandidate = String(candidate || "").trim();
    if (!rawCandidate) continue;

    const absoluteCandidate = path.isAbsolute(rawCandidate)
      ? rawCandidate
      : normalizedBaseDir
        ? path.join(normalizedBaseDir, rawCandidate)
        : "";
    if (absoluteCandidate && fs.existsSync(absoluteCandidate)) {
      return absoluteCandidate;
    }
  }

  if (!allowPathLookup) return null;
  return list.find((candidate) => String(candidate || "").trim()) || null;
}

function platformToolCandidates(windowsName, posixName, platform = process.platform) {
  return platform === "win32" ? [windowsName, posixName] : [posixName];
}

function resolveYtDlpPath(baseDir) {
  return resolveExistingToolPath(
    baseDir,
    platformToolCandidates("yt-dlp.exe", "yt-dlp"),
    { allowPathLookup: true },
  );
}

function resolveFfmpegPath(baseDir) {
  return resolveExistingToolPath(
    baseDir,
    platformToolCandidates("ffmpeg.exe", "ffmpeg"),
    { allowPathLookup: true },
  );
}

module.exports = {
  platformToolCandidates,
  resolveExistingToolPath,
  resolveYtDlpPath,
  resolveFfmpegPath,
};
