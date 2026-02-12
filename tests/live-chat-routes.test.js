const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { registerLiveChatRoutes } = require("../server/routes/live-chat-routes");

function createCaptureApp() {
  const routes = new Map();
  return {
    get(routePath, handler) {
      routes.set(routePath, handler);
    },
    routes,
  };
}

test("live-chat-routes returns 404 when chat file is missing", async () => {
  const app = createCaptureApp();
  let apiErrorCalled = null;

  registerLiveChatRoutes(app, {
    fs,
    path,
    baseDir: process.cwd(),
    apiError: (_res, status, message) => {
      apiErrorCalled = { status, message };
    },
  });

  const handler = app.routes.get("/api/live-chat/:videoFile");
  await handler({ params: { videoFile: "not-found" } }, { setHeader: () => {} });

  assert.deepEqual(apiErrorCalled, {
    status: 404,
    message: "対応するライブチャットがありません",
  });
});

test("live-chat-routes resolves file with .live_chat.json suffix", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ytdl-livechat-test-"));
  const chatDir = path.join(tempDir, "downloads", "ライブチャット");
  await fsp.mkdir(chatDir, { recursive: true });
  const chatPath = path.join(chatDir, "sample.live_chat.json");
  await fsp.writeFile(chatPath, "{\"ok\":true}", "utf-8");

  const app = createCaptureApp();
  let piped = false;
  const fakeFs = {
    existsSync: fs.existsSync,
    createReadStream: () => ({
      pipe() {
        piped = true;
      },
    }),
  };
  registerLiveChatRoutes(app, {
    fs: fakeFs,
    path,
    baseDir: tempDir,
    apiError: () => {},
  });

  const handler = app.routes.get("/api/live-chat/:videoFile");
  let sentHeader = null;
  const res = {
    setHeader(name, value) {
      sentHeader = { name, value };
    },
  };

  await handler({ params: { videoFile: "sample" } }, res);

  assert.deepEqual(sentHeader, {
    name: "Content-Type",
    value: "application/json; charset=utf-8",
  });
  assert.equal(piped, true);

  await fsp.rm(tempDir, { recursive: true, force: true });
});
