const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const path = require("node:path");

const { createInputUrlResolver } = require("../server/services/input-url-resolver");

test("input-url-resolver returns direct URL for watch links without spawn", async () => {
  let spawnCalled = false;
  const resolver = createInputUrlResolver({
    spawn: () => {
      spawnCalled = true;
      throw new Error("should not be called");
    },
    path,
    baseDir: process.cwd(),
  });

  const urls = await resolver.getUrlsFromInput(
    "https://www.youtube.com/watch?v=abc123&list=xyz",
    null,
  );
  assert.deepEqual(urls, ["https://www.youtube.com/watch?v=abc123"]);
  assert.equal(spawnCalled, false);
});

test("input-url-resolver resolves channel IDs through spawn output", async () => {
  const resolver = createInputUrlResolver({
    spawn: () => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      process.nextTick(() => {
        proc.stdout.emit("data", Buffer.from("id1\nid2\n"));
        proc.emit("close", 0);
      });
      return proc;
    },
    path,
    baseDir: process.cwd(),
  });

  const urls = await resolver.getUrlsFromInput(
    "https://www.youtube.com/channel/UC123",
    null,
  );
  assert.deepEqual(urls, [
    "https://www.youtube.com/watch?v=id1",
    "https://www.youtube.com/watch?v=id2",
  ]);
});
