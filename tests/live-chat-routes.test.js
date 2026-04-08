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

test("live-chat-routes returns a time window when query is provided", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ytdl-livechat-window-test-"));
  const chatDir = path.join(tempDir, "downloads", "ライブチャット");
  await fsp.mkdir(chatDir, { recursive: true });
  const chatPath = path.join(chatDir, "sample.live_chat.json");
  await fsp.writeFile(
    chatPath,
    [
      JSON.stringify({
        replayChatItemAction: {
          videoOffsetTimeMsec: 1000,
          actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: {} } } }],
        },
      }),
      JSON.stringify({
        replayChatItemAction: {
          videoOffsetTimeMsec: 6000,
          actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: {} } } }],
        },
      }),
      JSON.stringify({
        replayChatItemAction: {
          videoOffsetTimeMsec: 12000,
          actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: {} } } }],
        },
      }),
    ].join("\n"),
    "utf-8",
  );

  const app = createCaptureApp();
  let sentJson = null;
  registerLiveChatRoutes(app, {
    fs,
    path,
    baseDir: tempDir,
    apiError: () => {},
  });

  const handler = app.routes.get("/api/live-chat/:videoFile");
  await handler(
    {
      params: { videoFile: "sample" },
      query: { startSec: "5", endSec: "10", limit: "50" },
    },
    {
      json(payload) {
        sentJson = payload;
      },
      setHeader() {},
    },
  );

  assert.equal(Array.isArray(sentJson?.items), true);
  assert.equal(sentJson.items.length, 1);
  assert.equal(sentJson.startSec, 5);
  assert.equal(sentJson.endSec, 10);
  assert.equal(sentJson.hasMoreBefore, true);
  assert.equal(sentJson.hasMoreAfter, true);

  await fsp.rm(tempDir, { recursive: true, force: true });
});

test("live-chat-emoji-map falls back to config dictionary when chat file is missing", async () => {
  const app = createCaptureApp();
  let apiErrorCalled = null;

  registerLiveChatRoutes(app, {
    fs,
    path,
    baseDir: process.cwd(),
    apiError: (_res, status, message) => {
      apiErrorCalled = { status, message };
    },
    loadConfig: async () => ({
      emojiDictionary: {
        ":_kanataTen:": {
          label: "kanataTen",
          url: "/api/chat-image-fallback?kind=emoji&url=https%3A%2F%2Fexample.com%2Femoji.png",
        },
      },
    }),
  });

  const handler = app.routes.get("/api/live-chat-emoji-map/:videoFile");
  let sentJson = null;
  await handler(
    { params: { videoFile: "not-found" } },
    {
      json(payload) {
        sentJson = payload;
      },
    },
  );

  assert.equal(apiErrorCalled, null);
  assert.deepEqual(sentJson, {
    items: [
      {
        shortcut: ":_kanataTen:",
        label: "kanataTen",
        url: "/api/chat-image-fallback?kind=emoji&url=https%3A%2F%2Fexample.com%2Femoji.png",
      },
    ],
    source: "config",
  });
});

test("live-chat-emoji-map persists discovered emoji shortcuts into config", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ytdl-livechat-emoji-test-"));
  const chatDir = path.join(tempDir, "downloads", "ライブチャット");
  await fsp.mkdir(chatDir, { recursive: true });
  const chatPath = path.join(chatDir, "sample.live_chat.json");
  await fsp.writeFile(
    chatPath,
    JSON.stringify({
      replayChatItemAction: {
        videoOffsetTimeMsec: "1000",
        actions: [
          {
            addChatItemAction: {
              item: {
                liveChatTextMessageRenderer: {
                  message: {
                    runs: [
                      {
                        emoji: {
                          emojiId: "kanata-ten",
                          shortcuts: [":_kanataTen:"],
                          searchTerms: ["kanataTen"],
                          image: {
                            thumbnails: [
                              {
                                url: "https://example.com/emoji.png",
                              },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      },
    }),
    "utf-8",
  );

  const savedConfigs = [];
  const app = createCaptureApp();
  registerLiveChatRoutes(app, {
    fs,
    path,
    baseDir: tempDir,
    apiError: () => {},
    loadConfig: async () => ({ emojiDictionary: {} }),
    saveConfig: async (config) => {
      savedConfigs.push(config);
      return config;
    },
  });

  const handler = app.routes.get("/api/live-chat-emoji-map/:videoFile");
  let sentJson = null;
  await handler(
    { params: { videoFile: "sample" } },
    {
      json(payload) {
        sentJson = payload;
      },
    },
  );

  assert.deepEqual(sentJson, {
    items: [
      {
        shortcut: ":_kanataTen:",
        label: "kanata-ten",
        url: "/api/chat-image-fallback?url=https%3A%2F%2Fexample.com%2Femoji.png&kind=emoji",
      },
    ],
    source: "live-chat",
  });
  assert.equal(savedConfigs.length, 1);
  assert.deepEqual(savedConfigs[0].emojiDictionary, {
    ":_kanataTen:": {
      label: "kanata-ten",
      url: "/api/chat-image-fallback?url=https%3A%2F%2Fexample.com%2Femoji.png&kind=emoji",
    },
  });

  await fsp.rm(tempDir, { recursive: true, force: true });
});
