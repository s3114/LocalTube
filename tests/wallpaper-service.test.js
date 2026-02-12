const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { createWallpaperService } = require("../server/services/wallpaper-service");

test("wallpaper-service returns public URL for existing wallpaper file", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ytdl-wallpaper-"));
  const filePath = path.join(tempDir, "wallpaper.png");
  await fsp.writeFile(filePath, "png", "utf-8");

  const service = createWallpaperService({
    fs,
    path,
    publicDir: tempDir,
  });

  const url = service.getWallpaperPublicUrl();
  assert.ok(url);
  assert.ok(url.startsWith("/wallpaper.png?v="));

  await fsp.rm(tempDir, { recursive: true, force: true });
});

test("wallpaper-service clears wallpaper files", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ytdl-wallpaper-"));
  const jpgPath = path.join(tempDir, "wallpaper.jpg");
  const webpPath = path.join(tempDir, "wallpaper.webp");
  await fsp.writeFile(jpgPath, "jpg", "utf-8");
  await fsp.writeFile(webpPath, "webp", "utf-8");

  const service = createWallpaperService({
    fs,
    path,
    publicDir: tempDir,
  });

  await service.clearWallpaperFiles();
  assert.equal(fs.existsSync(jpgPath), false);
  assert.equal(fs.existsSync(webpPath), false);

  await fsp.rm(tempDir, { recursive: true, force: true });
});
