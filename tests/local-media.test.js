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

test("GET /info/:videoId returns 404 when no info and no local video", async () => {
  const res = await fetch(`${ctx.baseUrl}/info/non-existent-video-id-for-test`);
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(typeof body.error, "string");
});

test("GET /api/local-media rejects invalid request", async () => {
  const res = await ctx.fetchJson(`${ctx.baseUrl}/api/local-media`);
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test("GET /api/local-media rejects forbidden path", async () => {
  const forbiddenPath = "/tmp/not-allowed.mp4";
  const url = `${ctx.baseUrl}/api/local-media?type=video&path=${encodeURIComponent(forbiddenPath)}`;
  const res = await ctx.fetchJson(url);
  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
});

test("GET /api/local-videos returns list payload", async () => {
  const res = await ctx.fetchJson(`${ctx.baseUrl}/api/local-videos`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(Array.isArray(res.body.data), true);
});
