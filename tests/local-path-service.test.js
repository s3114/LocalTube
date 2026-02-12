const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createLocalPathService } = require("../server/services/local-path-service");

test("local-path-service checks path containment correctly", () => {
  const movieDir = path.join(path.sep, "movie");
  const inMoviePath = path.join(movieDir, "a.mp4");
  const outMoviePath = path.join(path.join(path.sep, "movie2"), "a.mp4");

  const service = createLocalPathService({
    path,
    normalizeDirList: (list) => list,
    movieDir,
    loadConfig: async () => ({ localVideoDirs: [] }),
  });

  assert.equal(service.isPathWithin(inMoviePath, movieDir), true);
  assert.equal(service.isPathWithin(outMoviePath, movieDir), false);
});

test("local-path-service returns deduplicated local video directories", async () => {
  const movieDir = path.join(path.sep, "movie");
  const extraDir = path.join(path.sep, "extra");
  const secondDir = path.join(path.sep, "second");

  const service = createLocalPathService({
    path,
    normalizeDirList: (list) =>
      Array.from(
        new Set(
          list.map((x) => String(x || "").trim()).filter(Boolean),
        ),
      ),
    movieDir,
    loadConfig: async () => ({
      localVideoDirs: [` ${extraDir} `, extraDir, secondDir],
    }),
  });

  const dirs = await service.getLocalVideoDirs();
  assert.deepEqual(dirs, [movieDir, extraDir, secondDir]);
});
