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

test("POST /api/wallpaper rejects missing file", async () => {
  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/wallpaper`, {
    method: "POST",
  });
  assert.equal(save.status, 400);
  assert.equal(save.body.ok, false);
});

test("POST /api/wallpaper rejects unsupported extension", async () => {
  const formData = new FormData();
  formData.append("wallpaper", new Blob(["dummy"]), "wallpaper.txt");

  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/wallpaper`, {
    method: "POST",
    body: formData,
  });
  assert.equal(save.status, 400);
  assert.equal(save.body.ok, false);
});

test("POST /api/wallpaper uploads image and /api/wallpaper-meta reports exists", async () => {
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const formData = new FormData();
  formData.append("wallpaper", new Blob([pngBytes]), "wallpaper.png");
  formData.append("wallpaperBlur", "7");
  formData.append("wallpaperBrightness", "85");

  const save = await ctx.fetchJson(`${ctx.baseUrl}/api/wallpaper`, {
    method: "POST",
    body: formData,
  });
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);
  assert.equal(typeof save.body.data.url, "string");
  assert.equal(Number(save.body.data.wallpaperBlur), 7);
  assert.equal(Number(save.body.data.wallpaperBrightness), 85);

  const meta = await ctx.fetchJson(`${ctx.baseUrl}/api/wallpaper-meta`);
  assert.equal(meta.status, 200);
  assert.equal(meta.body.ok, true);
  assert.equal(meta.body.data.exists, true);
  assert.equal(typeof meta.body.data.url, "string");
});

test("POST /api/wallpaper/clear removes uploaded wallpaper", async () => {
  const clear = await ctx.fetchJson(`${ctx.baseUrl}/api/wallpaper/clear`, {
    method: "POST",
  });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.ok, true);

  const meta = await ctx.fetchJson(`${ctx.baseUrl}/api/wallpaper-meta`);
  assert.equal(meta.status, 200);
  assert.equal(meta.body.ok, true);
  assert.equal(meta.body.data.exists, false);
  assert.equal(meta.body.data.url, null);
});
