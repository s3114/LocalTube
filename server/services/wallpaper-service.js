function createWallpaperService({ fs, path, publicDir, wallpaperExts }) {
  const exts =
    Array.isArray(wallpaperExts) && wallpaperExts.length > 0
      ? wallpaperExts
      : [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];

  function findWallpaperFilePath() {
    for (const ext of exts) {
      const candidate = path.join(publicDir, `wallpaper${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  function getWallpaperPublicUrl() {
    const filePath = findWallpaperFilePath();
    if (!filePath) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mtime = fs.statSync(filePath).mtimeMs;
    return `/wallpaper${ext}?v=${Math.floor(mtime)}`;
  }

  async function clearWallpaperFiles() {
    for (const ext of exts) {
      const target = path.join(publicDir, `wallpaper${ext}`);
      if (fs.existsSync(target)) {
        await fs.promises.unlink(target);
      }
    }
  }

  return {
    wallpaperExts: exts,
    findWallpaperFilePath,
    getWallpaperPublicUrl,
    clearWallpaperFiles,
  };
}

module.exports = {
  createWallpaperService,
};
