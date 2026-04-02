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

test("POST /api/report/download returns downloadable html report", async () => {
  const response = await fetch(`${ctx.baseUrl}/api/report/download`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currentUrl: `${ctx.baseUrl}/#settings`,
      browserUserAgent: "TestBrowser/1.0",
      cookieInfo: {
        mode: "firefox",
        updatedAt: "2026-04-03T00:00:00.000Z",
        updatedAtLocal: "2026-04-03 09:00:00",
      },
      downloadSettings: {
        formatText: "1080p",
        savePath: "C:\\downloads",
        saveHistory: true,
      },
    }),
  });

  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/html/i);
  assert.match(
    response.headers.get("content-disposition") || "",
    /attachment/i,
  );
  assert.match(html, /LocalTube レポート/);
  assert.match(html, /TestBrowser\/1.0/);
  assert.match(html, /Cookie 取得方法/);
});
