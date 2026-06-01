const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  platformToolCandidates,
  resolveExistingToolPath,
  resolveYtDlpPath,
  resolveFfmpegPath,
} = require("../server/services/tool-path-service");

test("tool-path-service prefers local yt-dlp.exe only on Windows", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ytdl-tool-path-"));
  const windowsToolPath = path.join(tempDir, "yt-dlp.exe");
  await fs.writeFile(windowsToolPath, "stub", "utf8");

  if (process.platform === "win32") {
    assert.equal(resolveYtDlpPath(tempDir), windowsToolPath);
  } else {
    assert.equal(resolveYtDlpPath(tempDir), "yt-dlp");
  }

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("tool-path-service orders candidates by platform and excludes exe on POSIX", () => {
  assert.deepEqual(platformToolCandidates("tool.exe", "tool", "win32"), ["tool.exe", "tool"]);
  assert.deepEqual(platformToolCandidates("tool.exe", "tool", "darwin"), ["tool"]);
  assert.deepEqual(platformToolCandidates("tool.exe", "tool", "linux"), ["tool"]);
});

test("tool-path-service falls back to PATH lookup command when local yt-dlp is absent", () => {
  const tempDir = path.join(os.tmpdir(), "ytdl-tool-path-missing");
  assert.equal(resolveYtDlpPath(tempDir), process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
});

test("tool-path-service falls back to PATH lookup command when local ffmpeg is absent", () => {
  const tempDir = path.join(os.tmpdir(), "ytdl-ffmpeg-path-missing");
  assert.equal(resolveFfmpegPath(tempDir), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
});

test("tool-path-service returns null when PATH lookup is disabled and file is absent", () => {
  const tempDir = path.join(os.tmpdir(), "ytdl-tool-path-none");
  assert.equal(resolveExistingToolPath(tempDir, ["missing.exe"]), null);
});
