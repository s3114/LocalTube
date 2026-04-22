const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { registerDownloadRoutes } = require("../server/routes/download-routes");

function createRouteCaptureApp() {
  const routes = { get: new Map(), post: new Map() };
  return {
    routes,
    get(routePath, ...handlers) {
      routes.get.set(routePath, handlers[handlers.length - 1]);
    },
    post(routePath, ...handlers) {
      routes.post.set(routePath, handlers[handlers.length - 1]);
    },
  };
}

function createApiFns() {
  return {
    apiOk(res, data, status = 200) {
      res.statusCode = status;
      res.body = { ok: true, data, error: null };
      return res;
    },
    apiError(res, status, error, data = null) {
      res.statusCode = status;
      res.body = { ok: false, data, error };
      return res;
    },
  };
}

test("download-routes rejects empty /download request", async () => {
  const app = createRouteCaptureApp();
  const jobHistory = new Map();
  const queued = [];
  const api = createApiFns();

  registerDownloadRoutes(app, {
    upload: { single: () => (_req, _res, next) => next?.() },
    crypto,
    jobHistory,
    broadcast: () => {},
    downloadQueueService: {
      setMaxConcurrentDownloads: () => {},
      enqueueJobs: (jobs) => queued.push(...jobs),
    },
    getUrlsFromInput: async () => [],
    fs: require("node:fs"),
    path,
    baseDir: process.cwd(),
    apiOk: api.apiOk,
    apiError: api.apiError,
  });

  const handler = app.routes.post.get("/download");
  const res = {};
  await handler({ body: {}, file: null }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(queued.length, 0);
});

test("download-routes creates jobs and enqueues them", async () => {
  const app = createRouteCaptureApp();
  const jobHistory = new Map();
  const enqueued = [];
  const api = createApiFns();
  const broadcasts = [];
  let maxParallel = null;

  registerDownloadRoutes(app, {
    upload: { single: () => (_req, _res, next) => next?.() },
    crypto,
    jobHistory,
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    downloadQueueService: {
      setMaxConcurrentDownloads: (value) => {
        maxParallel = value;
      },
      enqueueJobs: (jobs) => enqueued.push(...jobs),
    },
    getUrlsFromInput: async () => ["https://www.youtube.com/watch?v=abc"],
    fs: require("node:fs"),
    path,
    baseDir: process.cwd(),
    apiOk: api.apiOk,
    apiError: api.apiError,
  });

  const handler = app.routes.post.get("/download");
  const res = {};
  await handler(
    {
      body: {
        urls: "https://www.youtube.com/watch?v=abc",
        parallelDownloads: "2",
        format: "best",
        saveHistory: "false",
        downloadThumb: "true",
        drmProtect: "false",
        savePath: "",
        concurrentFragments: "2",
        commentOptions: "none",
      },
      file: null,
    },
    res,
  );

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(maxParallel, "2");
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].status, "queued");
  assert.equal(enqueued[0].progress.estimatedTotalSize, "");
  assert.ok(broadcasts.some((ev) => ev.event === "jobs_added"));
});

test("download-routes attaches estimated size to queued job when provided", async () => {
  const app = createRouteCaptureApp();
  const api = createApiFns();
  const enqueued = [];

  registerDownloadRoutes(app, {
    upload: { single: () => (_req, _res, next) => next?.() },
    crypto,
    jobHistory: new Map(),
    broadcast: () => {},
    downloadQueueService: {
      setMaxConcurrentDownloads: () => {},
      enqueueJobs: (jobs) => enqueued.push(...jobs),
    },
    getUrlsFromInput: async () => ["https://www.youtube.com/watch?v=abc"],
    fs: require("node:fs"),
    path,
    baseDir: process.cwd(),
    apiOk: api.apiOk,
    apiError: api.apiError,
  });

  const handler = app.routes.post.get("/download");
  const res = {};
  await handler(
    {
      body: {
        urls: "https://www.youtube.com/watch?v=abc",
        parallelDownloads: "1",
        estimateEntriesJson: JSON.stringify([
          {
            url: "https://www.youtube.com/watch?v=abc",
            title: "sample title",
            estimatedSizeText: "1.2 GB",
          },
        ]),
      },
      file: null,
    },
    res,
  );

  assert.equal(res.statusCode, 202);
  assert.equal(enqueued[0].title, "sample title");
  assert.equal(enqueued[0].progress.estimatedTotalSize, "1.2 GB");
});

test("download-routes returns size estimates", async () => {
  const app = createRouteCaptureApp();
  const api = createApiFns();

  registerDownloadRoutes(app, {
    upload: { single: () => (_req, _res, next) => next?.() },
    crypto,
    jobHistory: new Map(),
    broadcast: () => {},
    downloadQueueService: {
      setMaxConcurrentDownloads: () => {},
      enqueueJobs: () => {},
    },
    getUrlsFromInput: async () => ["https://www.youtube.com/watch?v=abc"],
    fs: require("node:fs"),
    path,
    baseDir: process.cwd(),
    apiOk: api.apiOk,
    apiError: api.apiError,
    downloadEstimateService: {
      estimateUrl: async () => ({
        url: "https://www.youtube.com/watch?v=abc",
        title: "sample title",
        estimatedBytes: 1024,
        estimatedSizeText: "1 KB",
      }),
      buildEstimateSummary: () => ({
        totalText: "1 KB",
        count: 1,
        label: "予測サイズ: 1 KB (1件)",
      }),
    },
  });

  const handler = app.routes.post.get("/api/download-estimate");
  const res = {};
  await handler(
    {
      body: {
        urls: "https://www.youtube.com/watch?v=abc",
        downloadVideo: "true",
        format: "best",
      },
      file: null,
    },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.entries[0].estimatedSizeText, "1 KB");
  assert.equal(res.body.data.summary.totalText, "1 KB");
});

test("download-routes clears history file", async () => {
  const app = createRouteCaptureApp();
  const api = createApiFns();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ytdl-route-test-"));
  const historyPath = path.join(tempDir, "finished.txt");
  await fs.writeFile(historyPath, "abc", "utf-8");

  registerDownloadRoutes(app, {
    upload: { single: () => (_req, _res, next) => next?.() },
    crypto,
    jobHistory: new Map(),
    broadcast: () => {},
    downloadQueueService: {
      setMaxConcurrentDownloads: () => {},
      enqueueJobs: () => {},
    },
    getUrlsFromInput: async () => [],
    fs: require("node:fs"),
    path,
    baseDir: tempDir,
    apiOk: api.apiOk,
    apiError: api.apiError,
  });

  const handler = app.routes.post.get("/api/clear-history");
  const res = {};
  await handler({}, res);
  const content = await fs.readFile(historyPath, "utf-8");

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(content, "");
});
