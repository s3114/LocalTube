const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  resolveExistingToolPath,
  resolveYtDlpPath,
  resolveFfmpegPath,
} = require("../server/services/tool-path-service");

test("tool-path-service prefers local yt-dlp.exe when present", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ytdl-tool-path-"));
  const toolPath = path.join(tempDir, "yt-dlp.exe");
  await fs.writeFile(toolPath, "stub", "utf8");

  assert.equal(resolveYtDlpPath(tempDir), toolPath);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test("tool-path-service falls back to PATH lookup command when local yt-dlp is absent", () => {
  const tempDir = path.join(os.tmpdir(), "ytdl-tool-path-missing");
  assert.equal(resolveYtDlpPath(tempDir), "yt-dlp.exe");
});

test("tool-path-service falls back to PATH lookup command when local ffmpeg is absent", () => {
  const tempDir = path.join(os.tmpdir(), "ytdl-ffmpeg-path-missing");
  assert.equal(resolveFfmpegPath(tempDir), "ffmpeg.exe");
});

test("tool-path-service returns null when PATH lookup is disabled and file is absent", () => {
  const tempDir = path.join(os.tmpdir(), "ytdl-tool-path-none");
  assert.equal(resolveExistingToolPath(tempDir, ["missing.exe"]), null);
});
