const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { initializeDirectoryLayout } = require("../server/services/startup-service");

test("startup-service initializes expected directory layout", async () => {
  const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ytdl-startup-"));

  const dirs = initializeDirectoryLayout({
    fs,
    path,
    baseDir,
  });

  assert.equal(fs.existsSync(dirs.downloadsDir), true);
  assert.equal(fs.existsSync(dirs.movieDir), true);
  assert.equal(fs.existsSync(dirs.thumbnailDir), true);
  assert.equal(fs.existsSync(dirs.fallbackThumbnailDir), true);
  assert.equal(fs.existsSync(dirs.commentsDir), true);
  assert.equal(fs.existsSync(dirs.provisionalInfoDir), true);
  assert.equal(fs.existsSync(dirs.liveChatDir), true);
  assert.equal(fs.existsSync(dirs.subtitleDir), true);
  assert.equal(fs.existsSync(dirs.pendingChatDir), true);

  await fsp.rm(baseDir, { recursive: true, force: true });
});
