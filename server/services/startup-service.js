function ensureDir(fs, dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function initializeDirectoryLayout({ fs, path, baseDir }) {
  const downloadsDir = path.join(baseDir, "downloads");
  const movieDir = path.join(downloadsDir, "動画");
  const thumbnailDir = path.join(downloadsDir, "サムネイル");
  const fallbackThumbnailDir = path.join(downloadsDir, "仮サムネイル");
  const commentsDir = path.join(downloadsDir, "コメント");
  const provisionalInfoDir = path.join(downloadsDir, "仮コメント");
  const liveChatDir = path.join(downloadsDir, "ライブチャット");
  const subtitleDir = path.join(downloadsDir, "字幕");
  const pendingChatDir = path.join(baseDir, "syorimachi_folder");

  ensureDir(fs, downloadsDir);
  ensureDir(fs, movieDir);
  ensureDir(fs, thumbnailDir);
  ensureDir(fs, fallbackThumbnailDir);
  ensureDir(fs, commentsDir);
  ensureDir(fs, provisionalInfoDir);
  ensureDir(fs, liveChatDir);
  ensureDir(fs, subtitleDir);
  ensureDir(fs, pendingChatDir);

  return {
    downloadsDir,
    movieDir,
    thumbnailDir,
    fallbackThumbnailDir,
    commentsDir,
    provisionalInfoDir,
    liveChatDir,
    subtitleDir,
    pendingChatDir,
  };
}

module.exports = {
  initializeDirectoryLayout,
};
