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

test("GET /api/validate-url rejects empty url", async () => {
  const res = await ctx.fetchJson(`${ctx.baseUrl}/api/validate-url`);
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});

test("POST /api/resolve-handle rejects invalid url", async () => {
  const res = await ctx.fetchJson(`${ctx.baseUrl}/api/resolve-handle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/not-youtube" }),
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
});
