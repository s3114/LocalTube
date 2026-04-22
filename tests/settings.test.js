const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestServerContext } = require("./helpers/test-server");

const ctx = createTestServerContext();

test.before(async () => {
  await ctx.start();
});

test.after(async () => {
  await ctx.stop();
});

test("GET /api/settings returns expected shape", async () => {
  const { status, body } = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.data, "object");
  assert.equal(Array.isArray(body.data.localVideoDirs), true);
  assert.equal(typeof body.data.enableFallbackThumbnails, "boolean");
  assert.equal(typeof body.data.enableDownloadEstimates, "boolean");
  assert.equal(typeof body.data.emojiDictionary, "object");
});

test("POST /api/settings persists localVideoDirs", async () => {
  const payload = {
    localVideoDirs: ["C:\\videos\\a", "C:\\videos\\b"],
  };
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(loaded.status, 200);
  assert.deepEqual(loaded.body.data.localVideoDirs, payload.localVideoDirs);
});

test("POST /api/settings persists fallback thumbnail toggle", async () => {
  const saveFalse = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enableFallbackThumbnails: false }),
  });
  assert.equal(saveFalse.status, 200);
  assert.equal(saveFalse.body.ok, true);

  let loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(loaded.body.data.enableFallbackThumbnails, false);

  const saveTrue = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enableFallbackThumbnails: true }),
  });
  assert.equal(saveTrue.status, 200);
  assert.equal(saveTrue.body.ok, true);

  loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(loaded.body.data.enableFallbackThumbnails, true);
});

test("POST /api/settings persists download estimate toggle", async () => {
  const saveFalse = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enableDownloadEstimates: false }),
  });
  assert.equal(saveFalse.status, 200);
  assert.equal(saveFalse.body.ok, true);

  let loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(loaded.body.data.enableDownloadEstimates, false);

  const saveTrue = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enableDownloadEstimates: true }),
  });
  assert.equal(saveTrue.status, 200);
  assert.equal(saveTrue.body.ok, true);

  loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(loaded.body.data.enableDownloadEstimates, true);
});

test("POST /api/settings persists wallpaper blur and brightness", async () => {
  const payload = {
    wallpaperBlur: 6,
    wallpaperBrightness: 80,
  };
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(Number(loaded.body.data.wallpaperBlur), payload.wallpaperBlur);
  assert.equal(
    Number(loaded.body.data.wallpaperBrightness),
    payload.wallpaperBrightness,
  );
});

test("POST /api/settings rejects empty payload", async () => {
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(save.status, 400);
  assert.equal(save.body.ok, false);
});

test("POST /api/settings clamps blur and brightness values", async () => {
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallpaperBlur: 999,
      wallpaperBrightness: -10,
    }),
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(Number(loaded.body.data.wallpaperBlur), 30);
  assert.equal(Number(loaded.body.data.wallpaperBrightness), 30);
});

test("POST /api/settings normalizes localVideoDirs", async () => {
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      localVideoDirs: ["  C:\\videos\\x  ", "", "C:\\videos\\x", "C:\\videos\\y"],
    }),
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.deepEqual(loaded.body.data.localVideoDirs, [
    "C:\\videos\\x",
    "C:\\videos\\y",
  ]);
});

test("POST /api/settings persists browser selection", async () => {
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ browser: "firefox" }),
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(loaded.body.data.selectedBrowser, "firefox");
});

test("POST /api/settings persists yt-dlp custom command", async () => {
  const payload = {
    ytDlpCustomCommand: "--cookies-from-browser firefox --sleep-interval 5",
  };
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(loaded.body.data.ytDlpCustomCommand, payload.ytDlpCustomCommand);
});

test("POST /api/settings persists emoji dictionary", async () => {
  const payload = {
    emojiDictionary: {
      ":_kanataTen:": {
        url: "/api/chat-image-fallback?url=abc&kind=emoji",
        label: "kanataTen",
      },
    },
  };
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.deepEqual(loaded.body.data.emojiDictionary, payload.emojiDictionary);
});

test("POST /api/settings normalizes invalid localVideoDirs type to empty array", async () => {
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      localVideoDirs: "C:\\not-array",
    }),
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.deepEqual(loaded.body.data.localVideoDirs, []);
});

test("POST /api/settings normalizes null browser to empty string", async () => {
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ browser: null }),
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const loaded = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(loaded.body.data.selectedBrowser, "");
});

test("POST /api/settings response and reloaded settings stay consistent", async () => {
  const payload = {
    localVideoDirs: ["C:\\videos\\home", "C:\\videos\\archive"],
    enableFallbackThumbnails: false,
    wallpaperBlur: 4,
    wallpaperBrightness: 70,
    browser: "firefox",
  };

  const saved = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  assert.equal(typeof saved.body.data, "object");
  assert.equal(typeof saved.body.data.settings, "object");

  const fromSave = saved.body.data.settings;
  const loadedOnce = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  const loadedTwice = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  const fromLoadOnce = loadedOnce.body.data;
  const fromLoadTwice = loadedTwice.body.data;

  assert.deepEqual(fromLoadOnce.localVideoDirs, fromSave.localVideoDirs);
  assert.equal(
    fromLoadOnce.enableFallbackThumbnails,
    fromSave.enableFallbackThumbnails,
  );
  assert.equal(Number(fromLoadOnce.wallpaperBlur), Number(fromSave.wallpaperBlur));
  assert.equal(
    Number(fromLoadOnce.wallpaperBrightness),
    Number(fromSave.wallpaperBrightness),
  );
  assert.equal(fromLoadOnce.selectedBrowser, fromSave.selectedBrowser);

  assert.deepEqual(fromLoadTwice.localVideoDirs, fromLoadOnce.localVideoDirs);
  assert.equal(
    fromLoadTwice.enableFallbackThumbnails,
    fromLoadOnce.enableFallbackThumbnails,
  );
  assert.equal(Number(fromLoadTwice.wallpaperBlur), Number(fromLoadOnce.wallpaperBlur));
  assert.equal(
    Number(fromLoadTwice.wallpaperBrightness),
    Number(fromLoadOnce.wallpaperBrightness),
  );
  assert.equal(fromLoadTwice.selectedBrowser, fromLoadOnce.selectedBrowser);
});
