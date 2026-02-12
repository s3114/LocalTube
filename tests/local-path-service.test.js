const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createLocalPathService } = require("../server/services/local-path-service");

test("local-path-service checks path containment correctly", () => {
  const service = createLocalPathService({
    path,
    normalizeDirList: (list) => list,
    movieDir: "C:\\movie",
    loadConfig: async () => ({ localVideoDirs: [] }),
  });

  assert.equal(service.isPathWithin("C:\\movie\\a.mp4", "C:\\movie"), true);
  assert.equal(service.isPathWithin("C:\\movie2\\a.mp4", "C:\\movie"), false);
});

test("local-path-service returns deduplicated local video directories", async () => {
  const service = createLocalPathService({
    path,
    normalizeDirList: (list) =>
      Array.from(
        new Set(
          list.map((x) => String(x || "").trim()).filter(Boolean),
        ),
      ),
    movieDir: "C:\\movie",
    loadConfig: async () => ({
      localVideoDirs: [" C:\\extra ", "C:\\extra", "C:\\second"],
    }),
  });

  const dirs = await service.getLocalVideoDirs();
  assert.deepEqual(dirs, ["C:\\movie", "C:\\extra", "C:\\second"]);
});
