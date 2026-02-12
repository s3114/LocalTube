function createLocalPathService({ path, normalizeDirList, movieDir, loadConfig }) {
  function isPathWithin(targetPath, baseDir) {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedBase = path.resolve(baseDir);
    return (
      resolvedTarget === resolvedBase ||
      resolvedTarget.startsWith(resolvedBase + path.sep)
    );
  }

  async function getLocalVideoDirs() {
    const config = await loadConfig();
    const extraDirs = normalizeDirList(config.localVideoDirs);
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
