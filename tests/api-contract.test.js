const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestServerContext } = require("./helpers/test-server");

const ctx = createTestServerContext();

function assertApiEnvelope(body) {
  assert.equal(typeof body, "object");
  assert.ok(Object.prototype.hasOwnProperty.call(body, "ok"));
  assert.ok(Object.prototype.hasOwnProperty.call(body, "data"));
  assert.ok(Object.prototype.hasOwnProperty.call(body, "error"));
}

test.before(async () => {
  await ctx.start();
});

test.after(async () => {
  await ctx.stop();
});

test("GET /ping returns standard API envelope", async () => {
  const res = await ctx.fetchJson(`${ctx.baseUrl}/ping`);
  assert.equal(res.status, 200);
  assertApiEnvelope(res.body);
  assert.equal(res.body.ok, true);
});

test("GET /api/settings returns standard API envelope", async () => {
  const res = await ctx.fetchJson(`${ctx.baseUrl}/api/settings`);
  assert.equal(res.status, 200);
  assertApiEnvelope(res.body);
  assert.equal(res.body.ok, true);
});

test("GET /api/local-media invalid request returns standard error envelope", async () => {
  const res = await ctx.fetchJson(`${ctx.baseUrl}/api/local-media`);
  assert.equal(res.status, 400);
  assertApiEnvelope(res.body);
  assert.equal(res.body.ok, false);
  assert.equal(typeof res.body.error, "string");
});

test("POST /download without urls returns standard error envelope", async () => {
  const res = await ctx.fetchJson(`${ctx.baseUrl}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  assertApiEnvelope(res.body);
  assert.equal(res.body.ok, false);
});
